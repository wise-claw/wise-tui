//! Tauri commands for the Codex App-Server JSON-RPC integration.
//!
//! These commands wire [`CodexRpcSession`] to the frontend, providing
//! `execute_codex_rpc`, `interrupt_codex_rpc`, and `shutdown_codex_rpc`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::sync::{Mutex as TokioMutex, Notify};
use uuid::Uuid;

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_OUTPUT,
};
use crate::claude_model_profiles::ensure_codex_profile_applied_for_model;
use crate::codex_binary::find_codex_binary;
use crate::codex_commands::{
    codex_read_only_settings, format_codex_rpc_error_line, load_codex_default_settings,
};
use crate::codex_config_dir::{
    codex_provider_switched, ensure_codex_project_trusted, read_codex_profile_envelope,
};
use crate::codex_rpc_session::CodexRpcSession;
use crate::codex_rpc_reuse::{IdleSessionPool, runtime_fingerprint};
use crate::rpc_background_tasks::RpcBackgroundTasks;
use crate::codex_rpc_stream_adapter::{
    adapt_notification_to_stream_lines, emit_approval_request, emit_dynamic_tool_request,
    emit_mcp_elicitation_request, emit_rpc_complete, CodexRpcStreamAdaptState,
};
use crate::codex_rpc_types::{ApprovalDecision, CommandExecParams, CommandExecResponse, ServerNotification, ServerRequest};
use crate::wise_db::WiseDb;

/// 把 Wise 持久化的 sandbox/approval 设置转成 app-server `thread/start.config`。
fn build_codex_rpc_thread_config(
    settings: Option<&crate::codex_commands::CodexDefaultSettings>,
) -> Option<HashMap<String, serde_json::Value>> {
    let Some(settings) = settings else {
        return None;
    };
    let mut config = HashMap::new();
    if let Some(sandbox) = settings
        .sandbox_mode
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        config.insert("sandbox_mode".to_string(), json!(sandbox));
    }
    if let Some(policy) = settings
        .approval_policy
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        config.insert("approval_policy".to_string(), json!(policy));
    }
    if config.is_empty() {
        None
    } else {
        Some(config)
    }
}

// ---------------------------------------------------------------------------
// Shared state for active RPC sessions
// ---------------------------------------------------------------------------

/// Refresh guidance periodically instead of growing every turn's history with
/// identical host text. Re-app startup/eviction safely starts a new interval.
#[derive(Default)]
struct ExecutionGuidanceSchedule {
    turns: VecDeque<(String, u8)>,
}

impl ExecutionGuidanceSchedule {
    fn should_inject(&self, thread_id: &str) -> bool {
        self.turns.iter().find(|(id, _)| id == thread_id)
            .is_none_or(|(_, count)| *count == 0)
    }

    // Call only after turn/start succeeds; failed dispatches must not consume a slot.
    fn record_accepted(&mut self, thread_id: &str) {
        let count = self.turns.iter().position(|(id, _)| id == thread_id)
            .and_then(|index| self.turns.remove(index))
            .map(|(_, count)| count).unwrap_or(0);
        self.turns.push_back((thread_id.to_string(), (count + 1) % 8));
        if self.turns.len() > 256 { self.turns.pop_front(); }
    }
}

/// 宿主级提示（Codex 配置警告 / 弃用提醒）按会话去重：app-server 会在每轮
/// turn 回放同样的提示，重复写入对话流只会污染转录，同一会话内相同提示只保留一次。
#[derive(Default)]
struct HostNoticeDedupe {
    seen: VecDeque<String>,
}

impl HostNoticeDedupe {
    /// `true` 表示该会话首次出现此提示（应展示并记录）；`false` 表示可以丢弃。
    fn first_seen(&mut self, session_id: &str, notice_key: &str) -> bool {
        let key = format!("{session_id}\u{1}{notice_key}");
        if self.seen.iter().any(|existing| existing == &key) {
            return false;
        }
        self.seen.push_back(key);
        if self.seen.len() > 1024 {
            self.seen.pop_front();
        }
        true
    }
}

/// Tauri-managed state holding active [`CodexRpcSession`] instances keyed by session id.
#[derive(Default, Clone)]
pub(crate) struct CodexRpcSessionStore {
    pub(crate) sessions: Arc<TokioMutex<HashMap<String, Arc<TokioMutex<CodexRpcSession>>>>>,
    /// 已发起取消的 session id：`execute_codex_rpc` 在 bootstrap/start_turn 完成前
    /// 尚未写入 `sessions`，点「结束」时 cancel 只能登记此标记，待 turn 启动后自检中止。
    pub(crate) cancelled: Arc<TokioMutex<HashSet<String>>>,
    guidance: Arc<TokioMutex<ExecutionGuidanceSchedule>>,
    notice_dedupe: Arc<TokioMutex<HostNoticeDedupe>>,
    idle: Arc<TokioMutex<IdleSessionPool<CodexRpcSession>>>,
    closing: Arc<AtomicBool>,
    idle_changed: Arc<Notify>,
    idle_reaper: Arc<TokioMutex<RpcBackgroundTasks>>,
}

impl CodexRpcSessionStore {
    /// 该会话是否应展示这条宿主提示（相同提示只展示一次，避免每轮重复回放）。
    async fn should_show_host_notice(&self, session_id: &str, notice_key: &str) -> bool {
        self.notice_dedupe
            .lock()
            .await
            .first_seen(session_id, notice_key)
    }

    /// 应用退出时关闭全部 app-server 子进程；返回关闭的会话数。
    pub(crate) async fn shutdown_all(&self) -> usize {
        self.closing.store(true, Ordering::Release);
        self.idle_reaper.lock().await.shutdown().await;
        let sessions: Vec<_> = self.sessions.lock().await.drain().map(|(_, s)| s).collect();
        let idle = self.idle.lock().await.drain();
        self.cancelled.lock().await.clear();
        self.notice_dedupe.lock().await.seen.clear();
        let count = sessions.len() + idle.len();
        for session in sessions {
            let _ = session.lock().await.shutdown().await;
        }
        shutdown_idle_runtimes(idle).await;
        count
    }

    pub(crate) async fn shutdown_idle(&self, tab: &str) -> bool {
        let idle = self.idle.lock().await.remove(tab);
        self.idle_changed.notify_one();
        let found = idle.is_some();
        shutdown_idle_runtimes(idle.into_iter().collect()).await;
        found
    }

    /// One owned reaper for the whole store; no per-turn sleeping tasks retaining
    /// the pool. The weak reference also lets dropping the store release it.
    async fn wake_idle_reaper(&self) {
        let mut tasks = self.idle_reaper.lock().await;
        if self.closing.load(Ordering::Acquire) { return; }
        if tasks.is_empty() {
            let idle = Arc::downgrade(&self.idle);
            let changed = self.idle_changed.clone();
            tasks.spawn(async move {
                loop {
                    let Some(pool) = idle.upgrade() else { break; };
                    let (expired, deadline) = {
                        let mut pool = pool.lock().await;
                        let mut retired = pool.expire(Instant::now());
                        retired.extend(pool.trim_resident_memory(CodexRpcSession::resident_bytes));
                        let deadline = pool.next_expiry().map(|expiry|
                            expiry.min(Instant::now() + std::time::Duration::from_secs(15)));
                        (retired, deadline)
                    };
                    drop(pool);
                    shutdown_idle_runtimes(expired).await;
                    match deadline {
                        Some(deadline) => tokio::select! {
                            _ = tokio::time::sleep_until(deadline.into()) => {},
                            _ = changed.notified() => {},
                        },
                        None => changed.notified().await,
                    }
                }
            });
        }
        self.idle_changed.notify_one();
    }
}

async fn shutdown_idle_runtimes(runtimes: Vec<CodexRpcSession>) {
    for mut session in runtimes { let _ = session.shutdown().await; }
}

// ---------------------------------------------------------------------------
// Command parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteCodexRpcParams {
    prompt: String,
    #[serde(default)]
    project_path: String,
    #[serde(default)]
    model: Option<String>,
    /// App-server `turn/start.effort`（minimal/low/medium/high/xhigh/ultra）。
    #[serde(default)]
    effort: Option<String>,
    #[serde(default)]
    invocation_key: Option<String>,
    #[serde(default)]
    tab_session_id: Option<String>,
    #[serde(default)]
    codex_resume_session_id: Option<String>,
    /// 提交信息等短任务强制 read-only + never，避免等待审批或修改仓库。
    #[serde(default)]
    read_only: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InterruptCodexRpcParams {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShutdownCodexRpcParams {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexRpcApprovalParams {
    pub session_id: String,
    pub request_id: u64,
    pub decision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCodexRpcMcpServersParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CallCodexRpcMcpToolParams {
    pub session_id: String,
    pub server: String,
    pub tool: String,
    #[serde(default)]
    pub arguments: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartCodexRpcMcpOAuthParams {
    pub session_id: String,
    pub server: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexRpcMcpElicitationParams {
    pub session_id: String,
    pub request_id: u64,
    pub action: String,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn codex_rpc_init_stream_line() -> String {
    json!({
        "type": "system",
        "subtype": "init",
    })
    .to_string()
}

/// 需要按会话去重的宿主提示指纹；`None` 表示该通知不属于去重范围。
/// 指纹包含完整正文，只有逐字相同的提示才会被折叠，配置变化后的新提示仍会展示。
fn host_notice_dedupe_key(notification: &ServerNotification) -> Option<String> {
    match notification {
        ServerNotification::ConfigWarning { summary, details, path } => {
            let summary = summary.trim();
            if summary.is_empty() {
                return None;
            }
            Some(format!(
                "config\u{1}{summary}\u{1}{}\u{1}{}",
                path.as_deref().unwrap_or("").trim(),
                details.as_deref().unwrap_or("").trim()
            ))
        }
        ServerNotification::DeprecationNotice { summary, details } => {
            let summary = summary.trim();
            if summary.is_empty() {
                return None;
            }
            Some(format!(
                "deprecation\u{1}{summary}\u{1}{}",
                details.as_deref().unwrap_or("").trim()
            ))
        }
        _ => None,
    }
}

fn emit_rpc_output_line(
    app: &AppHandle,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    emit_adapted_stream_payload(app, CLAUDE_STREAM_EVENT_OUTPUT, session_id, &line, invocation_key);
}

/// Persist a transcript line; log failures so silent disk miss doesn't look like a UI bug.
fn persist_codex_rpc_transcript_line(project_path: &str, tab_session_id: &str, line: &str) {
    if let Err(e) =
        crate::codex_rpc_disk::append_codex_rpc_session_line(project_path, tab_session_id, line)
    {
        eprintln!(
            "[codex_rpc] transcript append failed (tab={tab_session_id}): {e}"
        );
    }
}

fn persist_codex_rpc_event_lines(
    writer: &mut Option<crate::codex_rpc_disk::CodexRpcTranscriptWriter>,
    project_path: &str,
    tab_session_id: &str,
    lines: &[String],
) {
    if lines.is_empty() { return; }
    let result = (|| {
        if writer.is_none() {
            *writer = Some(crate::codex_rpc_disk::CodexRpcTranscriptWriter::open(
                project_path, tab_session_id,
            )?);
        }
        writer.as_mut().expect("writer initialized").append_lines(lines)
    })();
    if let Err(error) = result {
        // Retry opening on the next durable event, matching prior recovery behavior.
        *writer = None;
        eprintln!("[codex_rpc] transcript append failed (tab={tab_session_id}): {error}");
    }
}

/// 续接旧 thread 失败时应改为新建 thread：
/// - 切 provider 后旧配置里的 model_provider 已不存在；
/// - 误把 Wise 标签 id（`session_…`）当成 Codex UUID。
fn codex_rpc_resume_should_start_fresh(err: &str) -> bool {
    let lower = err.to_lowercase();
    (lower.contains("provider") && lower.contains("not found"))
        || lower.contains("failed to load configuration")
        || lower.contains("invalid session id")
        || lower.contains("invalid character")
        || ((lower.contains("session") || lower.contains("thread"))
            && (lower.contains("not found")
                || lower.contains("no such")
                || lower.contains("does not exist")))
}

fn is_codex_rpc_thread_id(id: &str) -> bool {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return false;
    }
    let uuid = trimmed
        .strip_prefix("urn:uuid:")
        .unwrap_or(trimmed);
    Uuid::parse_str(uuid).is_ok()
}

fn emit_and_persist_rpc_output_line(
    app: &AppHandle,
    project_path: &str,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    persist_codex_rpc_transcript_line(project_path, session_id, line);
    emit_rpc_output_line(app, session_id, line, invocation_key);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Main command: start a conversation turn via JSON-RPC.
///
/// Flow:
/// 1. Resolve codex binary.
/// 2. Bootstrap a `CodexRpcSession` (spawn subprocess + initialize).
/// 3. Start or resume a thread.
/// 4. Start a turn with the user's prompt.
/// 5. Enter a notification loop: poll notifications, adapt each, emit to frontend.
/// 6. When `TurnCompleted` is received, emit completion.
#[tauri::command]
pub(crate) async fn execute_codex_rpc(
    app: AppHandle,
    db: tauri::State<'_, WiseDb>,
    params: ExecuteCodexRpcParams,
) -> Result<(), String> {
    let dispatch_started = Instant::now();
    let trimmed_prompt = params.prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Codex RPC 执行需要非空提示词".to_string());
    }
    if app.state::<CodexRpcSessionStore>().closing.load(Ordering::Acquire) {
        return Err("Codex 执行环境正在关闭".to_string());
    }

    let proxy_model = crate::opencode_go_proxy::apply_codex_bridge_for_spawn(&db)?;
    let previous_config = read_codex_profile_envelope().config;
    if proxy_model.is_none() {
        ensure_codex_profile_applied_for_model(&db, params.model.as_deref())?;
    }
    let provider_switched =
        proxy_model.is_none() && codex_provider_switched(&previous_config, &read_codex_profile_envelope().config);
    if let Err(e) = ensure_codex_project_trusted(&params.project_path) {
        eprintln!("[codex_rpc] failed to mark project trusted: {e}");
    }
    let spawn_env_overrides = crate::opencode_go_proxy::codex_spawn_env_overrides(&db);

    let codex_path = tokio::task::spawn_blocking(find_codex_binary)
        .await.map_err(|e| format!("codex binary discovery task: {e}"))?
        .map_err(|e| format!("codex binary: {e}"))?;

    let session_id = params
        .tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("codex-rpc-{}", Uuid::new_v4().simple()));

    let invocation_key = params
        .invocation_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);

    // 清掉同 session id 上一次生命周期残留的取消标记（新请求不等于已取消）。
    app.state::<CodexRpcSessionStore>()
        .cancelled
        .lock()
        .await
        .remove(&session_id);

    // Register in the session registry so the frontend can track it.
    {
        let registry = app.state::<ClaudeSessionRegistry>();
        let model_label = params.model.as_deref().unwrap_or("codex-rpc").to_string();
        registry.register(session_id.clone(), params.project_path.clone(), model_label);
    }

    // Emit + persist init line so reopen can hydrate even if the turn fails later.
    emit_and_persist_rpc_output_line(
        &app,
        &params.project_path,
        &session_id,
        &codex_rpc_init_stream_line(),
        invocation_key.as_deref(),
    );

    // Persist user prompt before thread/turn so a failed start still leaves recoverable history.
    let user_line = crate::cursor_disk::build_cursor_user_turn_line(trimmed_prompt, None);
    persist_codex_rpc_transcript_line(&params.project_path, &session_id, &user_line);

    let resume_id = params.codex_resume_session_id.as_deref()
        .map(str::trim).filter(|id| is_codex_rpc_thread_id(id));
    let default_settings = if params.read_only {
        Some(codex_read_only_settings())
    } else {
        load_codex_default_settings(&db)
    };
    let thread_config = build_codex_rpc_thread_config(default_settings.as_ref());
    let fingerprint = {
        let binary = codex_path.clone();
        let cwd = params.project_path.clone();
        let home = crate::codex_config_dir::user_codex_dir();
        let settings = json!({
            "model": &params.model, "permissions": &thread_config,
            "profile": read_codex_profile_envelope(), "env": &spawn_env_overrides,
        });
        tokio::task::spawn_blocking(move || runtime_fingerprint(&binary, &cwd, &settings, &home))
            .await.map_err(|e| format!("Codex runtime fingerprint: {e}"))?
    };
    let (mut cached, retired) = app.state::<CodexRpcSessionStore>().idle.lock().await.take(
        &session_id, resume_id.filter(|_| !provider_switched && !params.read_only), fingerprint, Instant::now(),
    );
    shutdown_idle_runtimes(retired).await;
    if cached.as_ref().is_some_and(|session| !session.is_connected()) {
        shutdown_idle_runtimes(cached.take().into_iter().collect()).await;
    }
    let reused_runtime = cached.is_some();
    let startup = if let Some(session) = cached {
        Ok(session)
    } else {
        CodexRpcSession::bootstrap(&codex_path, spawn_env_overrides.as_ref(), Some(&params.project_path)).await
    };
    let mut session = match startup {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("Codex app-server 启动失败: {e}");
            eprintln!("[codex_rpc] {msg}");
            emit_and_persist_rpc_output_line(
                &app,
                &params.project_path,
                &session_id,
                &json!({
                    "type": "assistant",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
                }).to_string(),
                invocation_key.as_deref(),
            );
            let registry = app.state::<ClaudeSessionRegistry>();
            registry.mark_completed(&session_id, false);
            emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
            return Err(msg);
        }
    };

    // Only an explicit selection overrides native config precedence. The server
    // resolves project/profile defaults and returns the actual model for images.
    // 模型白名单护栏：未知模型（如 Claude 侧泄漏的 MiniMax-M3）不下发，
    // 交给原生配置解析默认模型，避免 provider 以 invalid_request_error 拒绝。
    let mut effective_model = params
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    if let Some(m) = effective_model.as_deref().filter(|_| !reused_runtime) {
        if !crate::codex_models::codex_model_is_known(m).await {
            effective_model = None;
        }
    }

    let mut started_new_thread = false;
    let had_resume_id = resume_id.is_some();
    let thread_result = if reused_runtime {
        Ok(())
    } else if let Some(thread_id) = resume_id.as_deref().filter(|_| !provider_switched) {
        match session
            .resume_thread(
                thread_id,
                Some(params.project_path.as_str()),
                effective_model.as_deref(),
                thread_config.clone(),
            )
            .await
        {
            Ok(()) => Ok(()),
            Err(e) if codex_rpc_resume_should_start_fresh(&e.to_string()) => {
                eprintln!(
                    "[codex_rpc] resume incompatible with current provider, starting new thread: {e}"
                );
                started_new_thread = true;
                session
                    .start_thread(
                        Some(params.project_path.as_str()),
                        effective_model.as_deref(),
                        thread_config.clone(),
                    )
                    .await
                    .map(|_| ())
            }
            Err(e) => Err(e),
        }
    } else {
        if provider_switched && had_resume_id {
            eprintln!(
                "[codex_rpc] provider switched, skipping resume and starting new thread"
            );
        }
        started_new_thread = true;
        session
            .start_thread(
                Some(params.project_path.as_str()),
                effective_model.as_deref(),
                thread_config,
            )
            .await
            .map(|_| ())
    };

    if let Err(e) = thread_result {
        let msg = format!("Codex thread 创建失败: {e}");
        eprintln!("[codex_rpc] {msg}");
        emit_and_persist_rpc_output_line(
            &app,
            &params.project_path,
            &session_id,
            &json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
            }).to_string(),
            invocation_key.as_deref(),
        );
        let _ = session.shutdown().await;
        let registry = app.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id, false);
        emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
        return Err(msg);
    }

    if started_new_thread {
        if let Some(tid) = session.current_thread_id() {
            emit_and_persist_rpc_output_line(
                &app,
                &params.project_path,
                &session_id,
                &json!({
                    "type": "codex_session",
                    "sessionId": tid,
                })
                .to_string(),
                invocation_key.as_deref(),
            );
        }
        if provider_switched && had_resume_id {
            emit_and_persist_rpc_output_line(
                &app,
                &params.project_path,
                &session_id,
                &json!({
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [{
                            "type": "text",
                            "text": "已切换 Codex 供应商，无法续接上一轮对话，已新开会话。"
                        }]
                    }
                })
                .to_string(),
                invocation_key.as_deref(),
            );
        }
    }

    // Start the turn.
    // DeepSeek 等模型的 API 不接受 image 内容块时，start_turn 会保留 `附图：@path` 文本，不发 image item。
    let effort = params
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let guidance_thread = session.current_thread_id()
        .filter(|_| !params.read_only && !trimmed_prompt.starts_with('/'))
        .map(str::to_string);
    let inject_guidance = if let Some(thread_id) = guidance_thread.as_deref() {
        app.state::<CodexRpcSessionStore>().guidance.lock().await.should_inject(thread_id)
    } else { false };
    let turn_result = session
        .start_turn(trimmed_prompt, effort, inject_guidance)
        .await;
    if let Err(e) = turn_result {
        let msg = format!("Codex turn 启动失败: {e}");
        eprintln!("[codex_rpc] {msg}");
        emit_and_persist_rpc_output_line(
            &app,
            &params.project_path,
            &session_id,
            &json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
            }).to_string(),
            invocation_key.as_deref(),
        );
        let _ = session.shutdown().await;
        let registry = app.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id, false);
        emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
        return Err(msg);
    }

    if let Some(thread_id) = guidance_thread.as_deref() {
        app.state::<CodexRpcSessionStore>().guidance.lock().await.record_accepted(thread_id);
    }
    eprintln!("[codex_rpc] runtime={} turn_dispatched_in_ms={}",
        if reused_runtime { "reused" } else { "cold" }, dispatch_started.elapsed().as_millis());

    // Consume events without taking the control mutex or polling on a timer.
    let mut events = session.take_events();
    let active_thread_id = session.current_thread_id().unwrap_or_default().to_string();
    let active_turn_id = session.current_turn_id().unwrap_or_default().to_string();
    // Store the session for potential interrupt/shutdown.
    let session_arc = Arc::new(TokioMutex::new(session));
    {
        let session_store = app.state::<CodexRpcSessionStore>();
        let mut store = session_store.sessions.lock().await;
        store.insert(session_id.clone(), session_arc.clone());
    }

    // 竞态窗口：用户点「结束」发生在 bootstrap/start_turn 期间（store 尚无条目，
    // cancel 只登记了 `cancelled` 标记），这里自检到后立即中止，避免 turn 空转输出。
    {
        let session_store = app.state::<CodexRpcSessionStore>();
        let was_cancelled = session_store.cancelled.lock().await.contains(&session_id);
        if was_cancelled || session_store.closing.load(Ordering::Acquire) {
            let _ = session_arc.lock().await.shutdown().await;
            session_store.sessions.lock().await.remove(&session_id);
            session_store.cancelled.lock().await.remove(&session_id);
            let registry = app.state::<ClaudeSessionRegistry>();
            registry.mark_completed(&session_id, false);
            emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
            return Ok(());
        }
    }

    // Track in process state for cancellation support.
    if let Some(inv) = invocation_key.as_deref().filter(|s| !s.is_empty()) {
        let process_state = app.state::<ClaudeProcessState>();
        process_state
            .invocation_tab_session_by_key
            .lock()
            .await
            .insert(inv.to_string(), session_id.clone());
    }

    // Notification loop owns its receivers; approvals/interrupts can use the session
    // concurrently even when a long RPC is waiting for its response.
    let app_loop = app.clone();
    let session_id_loop = session_id.clone();
    let invocation_key_loop = invocation_key.clone();
    let project_path_loop = params.project_path.clone();
    let allow_reuse = !params.read_only;

    tokio::spawn(async move {
        let mut success = true;
        let mut completed_cleanly = false;
        let mut stream_adapt_state = CodexRpcStreamAdaptState::default();
        let mut transcript_writer = None;

        loop {
            use crate::codex_rpc_session::CodexRpcSessionEvent;
            let result = events.next().await;

            match result {
                CodexRpcSessionEvent::Notification(ServerNotification::TurnCompleted {
                    thread_id,
                    turn_id,
                    status,
                    error_message,
                    ..
                }) => {
                    if (!thread_id.is_empty() && thread_id != active_thread_id)
                        || (!turn_id.is_empty() && turn_id != active_turn_id) {
                        continue;
                    }
                    completed_cleanly = status.eq_ignore_ascii_case("completed")
                        && thread_id == active_thread_id && turn_id == active_turn_id;
                    if !status.eq_ignore_ascii_case("completed") { success = false; }
                    let failed = status.eq_ignore_ascii_case("failed")
                        || status.eq_ignore_ascii_case("errored")
                        || status.eq_ignore_ascii_case("error");
                    if failed {
                        success = false;
                        if let Some(msg) = error_message.filter(|s| !s.is_empty()) {
                            let line = json!({
                                "type": "assistant",
                                "message": {
                                    "role": "assistant",
                                    "content": [{
                                        "type": "text",
                                        "text": format_codex_rpc_error_line(&msg)
                                    }]
                                }
                            })
                            .to_string();
                            persist_codex_rpc_event_lines(
                                &mut transcript_writer,
                                &project_path_loop,
                                &session_id_loop,
                                std::slice::from_ref(&line),
                            );
                            emit_adapted_stream_payload(
                                &app_loop,
                                crate::claude_events::CLAUDE_STREAM_EVENT_OUTPUT,
                                &session_id_loop,
                                &line,
                                invocation_key_loop.as_deref(),
                            );
                        }
                    }
                    break;
                }
                CodexRpcSessionEvent::Notification(notification) => {
                    if matches!(&notification, ServerNotification::Error { .. }) {
                        success = false;
                    }
                    // Check for ServerRequestResolved — emit resolved event.
                    if let ServerNotification::ServerRequestResolved { request_id, .. } = &notification {
                        use tauri::Emitter;
                        let _ = app_loop.emit("codex-rpc:approval-resolved", json!({
                            "session_id": &session_id_loop,
                            "request_id": request_id,
                        }));
                    }
                    // app-server 每轮都会回放同一份配置警告；同一会话只写入一次。
                    if let Some(notice_key) = host_notice_dedupe_key(&notification) {
                        let store = app_loop.state::<CodexRpcSessionStore>();
                        if !store
                            .should_show_host_notice(&session_id_loop, &notice_key)
                            .await
                        {
                            continue;
                        }
                    }
                    // Persist durable lines, then emit (deltas emit-only to avoid JSONL bloat).
                    let output = adapt_notification_to_stream_lines(
                        &notification,
                        &session_id_loop,
                        &mut stream_adapt_state,
                    );
                    persist_codex_rpc_event_lines(
                        &mut transcript_writer,
                        &project_path_loop,
                        &session_id_loop,
                        &output.persist,
                    );
                    for line in &output.emit {
                        emit_adapted_stream_payload(
                            &app_loop,
                            crate::claude_events::CLAUDE_STREAM_EVENT_OUTPUT,
                            &session_id_loop,
                            line,
                            invocation_key_loop.as_deref(),
                        );
                    }
                }
                CodexRpcSessionEvent::Disconnected => {
                    // Channel closed — subprocess likely exited.
                    success = false;
                    break;
                }
                CodexRpcSessionEvent::ServerRequest(request) => {
                    // Handle different server request types.
                    match &request {
                        ServerRequest::McpServerElicitationRequest { request_id, ref params } => {
                            emit_mcp_elicitation_request(&app_loop, &session_id_loop, *request_id, params);
                        }
                        ServerRequest::DynamicToolCall { request_id, ref params } => {
                            emit_dynamic_tool_request(&app_loop, &session_id_loop, *request_id, params);
                        }
                        _ => {
                            emit_approval_request(&app_loop, &session_id_loop, &request);
                        }
                    }
                }
            }
        }

        // A late exit from an old process must not remove a replacement session.
        let mut shutdown_shared = Some(session_arc);
        let mut retired = Vec::new();
        let mut parked = false;
        let owned_session = {
            let session_store = app_loop.state::<CodexRpcSessionStore>();
            let mut store = session_store.sessions.lock().await;
            let owned = store.get(&session_id_loop)
                .is_some_and(|current| Arc::ptr_eq(current, shutdown_shared.as_ref().unwrap()));
            if owned {
                store.remove(&session_id_loop);
                // Hold cancellation through parking: a concurrent cancel then either
                // prevents caching or removes the parked runtime via shutdown_idle.
                let mut cancelled = session_store.cancelled.lock().await;
                let was_cancelled = cancelled.remove(&session_id_loop);
                if was_cancelled { success = false; }
                if allow_reuse && completed_cleanly && success && !was_cancelled
                    && !session_store.closing.load(Ordering::Acquire) {
                    match Arc::try_unwrap(shutdown_shared.take().unwrap()) {
                        Ok(mutex) => {
                            let mut runtime = mutex.into_inner();
                            runtime.restore_events(events);
                            if runtime.is_connected() {
                                let mut idle = session_store.idle.lock().await;
                                retired = idle.park(
                                    session_id_loop.clone(), active_thread_id, fingerprint, runtime, Instant::now(),
                                );
                                retired.extend(idle.trim_resident_memory(CodexRpcSession::resident_bytes));
                                parked = true;
                            } else { retired.push(runtime); }
                        }
                        // A control request still owns the runtime: close it normally.
                        Err(shared) => shutdown_shared = Some(shared),
                    }
                }
            }
            owned
        };
        if let Some(shared) = shutdown_shared { let _ = shared.lock().await.shutdown().await; }
        shutdown_idle_runtimes(retired).await;
        if parked {
            app_loop.state::<CodexRpcSessionStore>().wake_idle_reaper().await;
        }
        if let Some(inv) = invocation_key_loop.as_deref() {
            app_loop.state::<ClaudeProcessState>()
                .invocation_tab_session_by_key.lock().await.remove(inv);
        }
        if !owned_session { return; }

        let registry = app_loop.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id_loop, success);
        emit_rpc_complete(
            &app_loop,
            invocation_key_loop.as_deref(),
            &session_id_loop,
            success,
        );
    });

    Ok(())
}

/// Interrupt the current in-flight turn for a session.
#[tauri::command]
pub(crate) async fn interrupt_codex_rpc(
    app: AppHandle,
    params: InterruptCodexRpcParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();

    // Clone the Arc and drop the store lock BEFORE locking the session,
    // matching the shutdown_codex_rpc pattern to avoid deadlocks.
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    }; // store lock dropped here

    let mut session = session_arc.lock().await;
    session
        .interrupt_turn()
        .await
        .map_err(|e| format!("interrupt failed: {e}"))
}

/// Respond to a server-initiated approval request with an approval decision.
#[tauri::command]
pub(crate) async fn respond_codex_rpc_approval(
    app: AppHandle,
    params: RespondCodexRpcApprovalParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let decision = match params.decision.as_str() {
        "accept" => ApprovalDecision::Accept,
        "acceptForSession" => ApprovalDecision::AcceptForSession,
        "decline" => ApprovalDecision::Decline,
        "cancel" => ApprovalDecision::Cancel,
        other => return Err(format!("Unknown decision: {other}")),
    };

    let mut session = session_arc.lock().await;
    session
        .respond_to_request(params.request_id, &decision)
        .await
        .map_err(|e| format!("Failed to send approval response: {e}"))
}

/// Shutdown a session: kill the subprocess and clean up state.
#[tauri::command]
pub(crate) async fn shutdown_codex_rpc(
    app: AppHandle,
    params: ShutdownCodexRpcParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();

    session_store.cancelled.lock().await.insert(params.session_id.clone());
    let had_idle = session_store.shutdown_idle(&params.session_id).await;

    let session_arc = {
        let mut store = session_store.sessions.lock().await;
        store.remove(&params.session_id)
    };
    let Some(session_arc) = session_arc else {
        return if had_idle { Ok(()) } else { Err(format!("No active RPC session: {}", params.session_id)) };
    };

    let mut session = session_arc.lock().await;
    session
        .shutdown()
        .await
        .map_err(|e| format!("shutdown failed: {e}"))
}

/// List MCP server statuses for an active session.
#[tauri::command]
pub(crate) async fn list_codex_rpc_mcp_servers(
    app: AppHandle,
    params: ListCodexRpcMcpServersParams,
) -> Result<Vec<crate::codex_rpc_types::McpServerStatusInfo>, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .list_mcp_server_statuses()
        .await
        .map_err(|e| format!("Failed to list MCP servers: {e}"))
}

/// Call an MCP tool directly.
#[tauri::command]
pub(crate) async fn call_codex_rpc_mcp_tool(
    app: AppHandle,
    params: CallCodexRpcMcpToolParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let result = session
        .call_mcp_tool(&params.server, &params.tool, params.arguments)
        .await
        .map_err(|e| format!("MCP tool call failed: {e}"))?;
    serde_json::to_value(result).map_err(|e| format!("Failed to serialize MCP tool result: {e}"))
}

/// Start MCP OAuth login for a server.
#[tauri::command]
pub(crate) async fn start_codex_rpc_mcp_oauth(
    app: AppHandle,
    params: StartCodexRpcMcpOAuthParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let result = session
        .start_mcp_oauth_login(&params.server)
        .await
        .map_err(|e| format!("MCP OAuth login failed: {e}"))?;
    serde_json::to_value(result).map_err(|e| format!("Failed to serialize OAuth response: {e}"))
}

/// Respond to an MCP elicitation request.
#[tauri::command]
pub(crate) async fn respond_codex_rpc_mcp_elicitation(
    app: AppHandle,
    params: RespondCodexRpcMcpElicitationParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .respond_to_mcp_elicitation(params.request_id, &params.action, params.content)
        .await
        .map_err(|e| format!("Failed to send MCP elicitation response: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 4: Command execution parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecCodexRpcCommandParams {
    pub session_id: String,
    pub command: Vec<String>,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub tty: bool,
    #[serde(default)]
    pub stream_stdin: bool,
    #[serde(default)]
    pub stream_stdout_stderr: bool,
    #[serde(default)]
    pub timeout_ms: Option<i64>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, Option<String>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminateCodexRpcCommandParams {
    pub session_id: String,
    pub process_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteCodexRpcCommandStdinParams {
    pub session_id: String,
    pub process_id: String,
    #[serde(default)]
    pub delta_base64: Option<String>,
    #[serde(default)]
    pub close_stdin: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResizeCodexRpcCommandParams {
    pub session_id: String,
    pub process_id: String,
    pub rows: u16,
    pub cols: u16,
}

// ---------------------------------------------------------------------------
// Phase 4: Filesystem operation parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsReadFileParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsWriteFileParams {
    pub session_id: String,
    pub path: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsCreateDirectoryParams {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsGetMetadataParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsReadDirectoryParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsRemoveParams {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsCopyParams {
    pub session_id: String,
    pub source_path: String,
    pub destination_path: String,
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsWatchParams {
    pub session_id: String,
    pub watch_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsUnwatchParams {
    pub session_id: String,
    pub watch_id: String,
}

// ---------------------------------------------------------------------------
// Phase 4: Command execution Tauri commands
// ---------------------------------------------------------------------------

/// Execute a sandboxed command via the codex app-server.
#[tauri::command]
pub(crate) async fn exec_codex_rpc_command(
    app: AppHandle,
    params: ExecCodexRpcCommandParams,
) -> Result<CommandExecResponse, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let exec_params = CommandExecParams {
        command: params.command,
        process_id: params.process_id,
        tty: params.tty,
        stream_stdin: params.stream_stdin,
        stream_stdout_stderr: params.stream_stdout_stderr,
        timeout_ms: params.timeout_ms,
        cwd: params.cwd,
        env: params.env,
        size: None,
    };

    let mut session = session_arc.lock().await;
    session
        .exec_command(exec_params)
        .await
        .map_err(|e| format!("command/exec failed: {e}"))
}

/// Terminate a running command.
#[tauri::command]
pub(crate) async fn terminate_codex_rpc_command(
    app: AppHandle,
    params: TerminateCodexRpcCommandParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .terminate_command(&params.process_id)
        .await
        .map_err(|e| format!("command/exec/terminate failed: {e}"))
}

/// Write stdin bytes to a running command.
#[tauri::command]
pub(crate) async fn write_codex_rpc_command_stdin(
    app: AppHandle,
    params: WriteCodexRpcCommandStdinParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let write_params = crate::codex_rpc_types::CommandExecWriteParams {
        process_id: params.process_id,
        delta_base64: params.delta_base64,
        close_stdin: params.close_stdin,
    };

    let mut session = session_arc.lock().await;
    session
        .write_command_stdin(write_params)
        .await
        .map_err(|e| format!("command/exec/write failed: {e}"))
}

/// Resize a PTY-backed command.
#[tauri::command]
pub(crate) async fn resize_codex_rpc_command(
    app: AppHandle,
    params: ResizeCodexRpcCommandParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .resize_command(&params.process_id, params.rows, params.cols)
        .await
        .map_err(|e| format!("command/exec/resize failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 4: Filesystem Tauri commands
// ---------------------------------------------------------------------------

/// Read a file via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_read_file(
    app: AppHandle,
    params: CodexRpcFsReadFileParams,
) -> Result<String, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_read_file(&params.path)
        .await
        .map_err(|e| format!("fs/readFile failed: {e}"))?;
    Ok(resp.data_base64)
}

/// Write a file via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_write_file(
    app: AppHandle,
    params: CodexRpcFsWriteFileParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_write_file(&params.path, &params.data_base64)
        .await
        .map_err(|e| format!("fs/writeFile failed: {e}"))
}

/// Create a directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_create_directory(
    app: AppHandle,
    params: CodexRpcFsCreateDirectoryParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_create_directory(&params.path, params.recursive)
        .await
        .map_err(|e| format!("fs/createDirectory failed: {e}"))
}

/// Get metadata for a path via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_get_metadata(
    app: AppHandle,
    params: CodexRpcFsGetMetadataParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_get_metadata(&params.path)
        .await
        .map_err(|e| format!("fs/getMetadata failed: {e}"))?;
    serde_json::to_value(resp).map_err(|e| format!("Failed to serialize metadata: {e}"))
}

/// Read a directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_read_directory(
    app: AppHandle,
    params: CodexRpcFsReadDirectoryParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_read_directory(&params.path)
        .await
        .map_err(|e| format!("fs/readDirectory failed: {e}"))?;
    serde_json::to_value(resp).map_err(|e| format!("Failed to serialize directory entries: {e}"))
}

/// Remove a file or directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_remove(
    app: AppHandle,
    params: CodexRpcFsRemoveParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_remove(&params.path, params.recursive, params.force)
        .await
        .map_err(|e| format!("fs/remove failed: {e}"))
}

/// Copy a file or directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_copy(
    app: AppHandle,
    params: CodexRpcFsCopyParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_copy(&params.source_path, &params.destination_path, params.recursive)
        .await
        .map_err(|e| format!("fs/copy failed: {e}"))
}

/// Start a filesystem watch via the codex app-server.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_watch(
    app: AppHandle,
    params: CodexRpcFsWatchParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_watch(&params.watch_id, &params.path)
        .await
        .map_err(|e| format!("fs/watch failed: {e}"))?;
    serde_json::to_value(resp).map_err(|e| format!("Failed to serialize watch response: {e}"))
}

/// Stop a filesystem watch via the codex app-server.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_unwatch(
    app: AppHandle,
    params: CodexRpcFsUnwatchParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_unwatch(&params.watch_id)
        .await
        .map_err(|e| format!("fs/unwatch failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Thread management parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCodexRpcThreadsParams {
    pub session_id: String,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnarchiveCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForkCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

// ---------------------------------------------------------------------------
// Phase 5: Turn steering parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteerCodexRpcTurnParams {
    pub session_id: String,
    pub turn_id: Option<String>,
    pub input: String,
}

// ---------------------------------------------------------------------------
// Phase 5: Code review parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartCodexRpcReviewParams {
    pub session_id: String,
    pub thread_id: String,
    #[serde(default)]
    pub instruction: Option<String>,
}

// ---------------------------------------------------------------------------
// Phase 5: Skills parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCodexRpcSkillsParams {
    pub session_id: String,
    #[serde(default)]
    pub cwd: Option<String>,
}

// ---------------------------------------------------------------------------
// Phase 5: Dynamic tool response parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexRpcDynamicToolParams {
    pub session_id: String,
    pub request_id: u64,
    pub result: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Phase 5: Thread management Tauri commands
// ---------------------------------------------------------------------------

/// List threads via the codex app-server.
#[tauri::command]
pub(crate) async fn list_codex_rpc_threads(
    app: AppHandle,
    params: ListCodexRpcThreadsParams,
) -> Result<crate::codex_rpc_types::ThreadListResponse, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let list_params = crate::codex_rpc_types::ThreadListParams {
        limit: params.limit,
        offset: params.offset,
        archived: params.archived,
    };

    let mut session = session_arc.lock().await;
    session
        .list_threads(Some(list_params))
        .await
        .map_err(|e| format!("thread/list failed: {e}"))
}

/// Archive a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn archive_codex_rpc_thread(
    app: AppHandle,
    params: ArchiveCodexRpcThreadParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .archive_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/archive failed: {e}"))
}

/// Unarchive a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn unarchive_codex_rpc_thread(
    app: AppHandle,
    params: UnarchiveCodexRpcThreadParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .unarchive_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/unarchive failed: {e}"))
}

/// Delete a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn delete_codex_rpc_thread(
    app: AppHandle,
    params: DeleteCodexRpcThreadParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .delete_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/delete failed: {e}"))
}

/// Fork a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn fork_codex_rpc_thread(
    app: AppHandle,
    params: ForkCodexRpcThreadParams,
) -> Result<crate::codex_rpc_types::ThreadSummary, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fork_thread(&params.thread_id, params.name.as_deref())
        .await
        .map_err(|e| format!("thread/fork failed: {e}"))
}

/// Read a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn read_codex_rpc_thread(
    app: AppHandle,
    params: ReadCodexRpcThreadParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .read_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/read failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Turn steering Tauri commands
// ---------------------------------------------------------------------------

/// Steer the active turn via the codex app-server.
#[tauri::command]
pub(crate) async fn steer_codex_rpc_turn(
    app: AppHandle,
    params: SteerCodexRpcTurnParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    if params.input.trim().is_empty() {
        return Err("瞬时消息不能为空".to_string());
    }
    let turn_id = params
        .turn_id
        .as_deref()
        .or_else(|| session.current_turn_id())
        .ok_or_else(|| "当前没有可接收瞬时消息的 Codex 轮次".to_string())?
        .to_string();
    session
        .steer_turn(&turn_id, &params.input)
        .await
        .map_err(|e| format!("turn/steer failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Code review Tauri commands
// ---------------------------------------------------------------------------

/// Start a code review via the codex app-server.
#[tauri::command]
pub(crate) async fn start_codex_rpc_review(
    app: AppHandle,
    params: StartCodexRpcReviewParams,
) -> Result<crate::codex_rpc_types::ReviewStartResponse, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .start_review(&params.thread_id, params.instruction.as_deref())
        .await
        .map_err(|e| format!("review/start failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Skills Tauri commands
// ---------------------------------------------------------------------------

/// List skills via the codex app-server.
#[tauri::command]
pub(crate) async fn list_codex_rpc_skills(
    app: AppHandle,
    params: ListCodexRpcSkillsParams,
) -> Result<Vec<crate::codex_rpc_types::SkillInfo>, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .list_skills(params.cwd.as_deref())
        .await
        .map_err(|e| format!("skills/list failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Dynamic tool response Tauri commands
// ---------------------------------------------------------------------------

/// Respond to a dynamic tool call server request.
#[tauri::command]
pub(crate) async fn respond_codex_rpc_dynamic_tool(
    app: AppHandle,
    params: RespondCodexRpcDynamicToolParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .respond_to_dynamic_tool(params.request_id, params.result)
        .await
        .map_err(|e| format!("dynamic tool response failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{codex_rpc_resume_should_start_fresh, is_codex_rpc_thread_id};
    use crate::codex_config_dir::codex_provider_switched;

    #[test]
    fn guidance_refreshes_every_eight_accepted_turns_per_thread() {
        let mut schedule = super::ExecutionGuidanceSchedule::default();
        for turn in 0..24 {
            assert_eq!(schedule.should_inject("thread"), turn % 8 == 0);
            // Reading the decision (or failing turn/start) doesn't advance it.
            assert_eq!(schedule.should_inject("thread"), turn % 8 == 0);
            assert!(schedule.should_inject("other-thread"));
            schedule.record_accepted("thread");
        }
    }

    #[test]
    fn guidance_history_is_bounded_and_evicted_threads_get_fresh_guidance() {
        let mut schedule = super::ExecutionGuidanceSchedule::default();
        for thread in 0..256 { schedule.record_accepted(&thread.to_string()); }
        schedule.record_accepted("0"); // Keep this recently used thread.
        schedule.record_accepted("new-thread");
        assert_eq!(schedule.turns.len(), 256);
        assert!(!schedule.should_inject("0"));
        assert!(schedule.should_inject("1"));
    }

    #[test]
    fn gpt_to_deepseek_skips_resume() {
        let openai = "model = \"gpt-5.6\"\n";
        let deepseek = r#"model = "deepseek-v4-flash"
model_provider = "deepseek"

[model_providers.deepseek]
base_url = "https://api.deepseek.com/v1"
"#;
        assert!(codex_provider_switched(openai, deepseek));
        assert!(codex_provider_switched(
            "model = \"gpt-5.6\"\n\n[model_providers.deepseek]\nbase_url = \"https://api.deepseek.com/v1\"\n",
            deepseek
        ));
    }

    #[test]
    fn missing_deepseek_provider_starts_fresh() {
        assert!(codex_rpc_resume_should_start_fresh(
            "thread/resume failed: [-32600] failed to load configuration: Model provider deepseek not found"
        ));
        assert!(codex_rpc_resume_should_start_fresh(
            "failed to load configuration: Model provider volc-ark-coding not found"
        ));
    }

    #[test]
    fn invalid_session_id_starts_fresh() {
        assert!(codex_rpc_resume_should_start_fresh(
            "thread/resume failed: [-32600] invalid session id: invalid character: expected an optional prefix of urn:uuid: followed by [0-9a-fA-F-], found s at 1"
        ));
        assert!(!is_codex_rpc_thread_id("session_1772170000_ab12cd"));
        assert!(!is_codex_rpc_thread_id("codex-rpc-abc"));
        assert!(is_codex_rpc_thread_id("0199a213-81c0-7800-8aa1-bbab2a035a53"));
        assert!(is_codex_rpc_thread_id("urn:uuid:0199a213-81c0-7800-8aa1-bbab2a035a53"));
    }

    #[test]
    fn missing_session_starts_fresh() {
        assert!(codex_rpc_resume_should_start_fresh("session not found"));
        assert!(codex_rpc_resume_should_start_fresh("thread does not exist"));
    }

    #[test]
    fn unrelated_resume_errors_are_not_swallowed() {
        assert!(!codex_rpc_resume_should_start_fresh("thread/resume failed: [-32600] unauthorized"));
        assert!(!codex_rpc_resume_should_start_fresh("API key invalid"));
        assert!(!codex_rpc_resume_should_start_fresh(
            "unexpected status 402 Payment Required: Insufficient Balance"
        ));
    }

    #[test]
    fn host_notice_key_covers_config_and_deprecation_only() {
        use crate::codex_rpc_types::ServerNotification;
        let warning = ServerNotification::ConfigWarning {
            summary: "unknown key".to_string(),
            details: Some("check typos".to_string()),
            path: Some("/Users/x/.codex/config.toml".to_string()),
        };
        let key = super::host_notice_dedupe_key(&warning).expect("config warning is deduped");
        assert!(key.starts_with("config\u{1}unknown key"));
        assert!(key.contains("config.toml"));
        assert!(key.contains("check typos"));

        let empty = ServerNotification::ConfigWarning {
            summary: "   ".to_string(),
            details: None,
            path: None,
        };
        assert!(super::host_notice_dedupe_key(&empty).is_none());
        assert!(super::host_notice_dedupe_key(&ServerNotification::Error {
            code: -32000,
            message: "boom".to_string(),
            data: None,
        })
        .is_none());
    }

    #[test]
    fn host_notice_dedupe_only_collapses_identical_text_per_session() {
        let mut dedupe = super::HostNoticeDedupe::default();
        assert!(dedupe.first_seen("s1", "config\u{1}a"));
        assert!(!dedupe.first_seen("s1", "config\u{1}a"));
        // 会话隔离：新会话仍会展示一次。
        assert!(dedupe.first_seen("s2", "config\u{1}a"));
        // 正文变化（配置改动后产生的新提示）不会被旧记录吞掉。
        assert!(dedupe.first_seen("s1", "config\u{1}b"));
    }
}
