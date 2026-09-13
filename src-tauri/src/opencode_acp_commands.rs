//! Tauri commands for ACP-based engines (OpenCode `opencode acp`, DeepSeek Harness `dsh --profile acp`).
//!
//! Both engines share the whole turn pipeline (persistent per-tab session, prompt loop,
//! stream adaptation, permission bridge); `AcpEngine` supplies the engine-specific
//! binary, argv, resume method, and event channel names.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::acp_engine::AcpEngine;
use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::cursor_disk::{append_cursor_session_line, build_cursor_user_turn_line};
use crate::opencode_acp_session::OpencodeAcpSession;
use crate::opencode_acp_stream_adapter::{
    acp_bind_line, adapt_acp_notification_to_stream_lines, auto_approve_option_id,
    emit_acp_complete, emit_opencode_acp_output_line, opencode_acp_init_line,
    permission_event_payload, resolve_permission_decision_result,
};
use crate::opencode_acp_types::{
    permission_cancelled_result, permission_selected_result, AcpServerRequest, JsonRpcId,
    JsonRpcMessage,
};

/// Per-engine persistent ACP session registry keyed by Wise tab session id.
#[derive(Default, Clone)]
pub(crate) struct AcpSessionStore {
    pub(crate) sessions: Arc<TokioMutex<HashMap<String, Arc<TokioMutex<OpencodeAcpSession>>>>>,
    /// Tabs currently running a prompt turn (prevents overlapping prompts).
    pub(crate) busy: Arc<TokioMutex<HashMap<String, bool>>>,
    /// Monotonic turn epoch per tab. Interrupt / newer execute bumps this so a
    /// superseded prompt loop must not clear `busy` or emit complete for the new turn.
    pub(crate) turn_epoch: Arc<TokioMutex<HashMap<String, u64>>>,
    /// Last advertised permission options per request id, so a UI decision can be
    /// resolved against the exact option ids the agent expects.
    pub(crate) permission_options: Arc<TokioMutex<HashMap<String, Value>>>,
}

/// Tauri state for the OpenCode engine (distinct type so it coexists with DeepSeek).
#[derive(Default, Clone)]
pub(crate) struct OpencodeAcpSessionStore(pub(crate) AcpSessionStore);

/// Tauri state for the DeepSeek Harness engine.
#[derive(Default, Clone)]
pub(crate) struct DeepseekAcpSessionStore(pub(crate) AcpSessionStore);

macro_rules! impl_acp_store_deref {
    ($ty:ty) => {
        impl std::ops::Deref for $ty {
            type Target = AcpSessionStore;
            fn deref(&self) -> &Self::Target {
                &self.0
            }
        }
    };
}
impl_acp_store_deref!(OpencodeAcpSessionStore);
impl_acp_store_deref!(DeepseekAcpSessionStore);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteOpencodeAcpParams {
    prompt: String,
    #[serde(default)]
    project_path: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    invocation_key: Option<String>,
    #[serde(default)]
    tab_session_id: Option<String>,
    /// Previously bound OpenCode ACP session id for session/load.
    #[serde(default)]
    opencode_session_id: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    /// When true (default), auto-allow tool permissions like former `--force`.
    #[serde(default = "default_true")]
    auto_approve_permissions: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteDeepseekAcpParams {
    prompt: String,
    #[serde(default)]
    project_path: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    invocation_key: Option<String>,
    #[serde(default)]
    tab_session_id: Option<String>,
    /// Previously bound DeepSeek Harness ACP session id for session/resume.
    #[serde(default)]
    deepseek_session_id: Option<String>,
    /// When true (default), auto-allow tool permissions.
    #[serde(default = "default_true")]
    auto_approve_permissions: bool,
}

/// Engine-neutral turn parameters shared by every ACP command entry point.
#[derive(Debug, Clone)]
pub(crate) struct AcpTurnParams {
    pub prompt: String,
    pub project_path: String,
    pub model: Option<String>,
    pub invocation_key: Option<String>,
    pub tab_session_id: Option<String>,
    pub resume_session_id: Option<String>,
    pub mode: Option<String>,
    pub auto_approve_permissions: bool,
}

impl From<ExecuteOpencodeAcpParams> for AcpTurnParams {
    fn from(p: ExecuteOpencodeAcpParams) -> Self {
        Self {
            prompt: p.prompt,
            project_path: p.project_path,
            model: p.model,
            invocation_key: p.invocation_key,
            tab_session_id: p.tab_session_id,
            resume_session_id: p.opencode_session_id,
            mode: p.mode,
            auto_approve_permissions: p.auto_approve_permissions,
        }
    }
}

impl From<ExecuteDeepseekAcpParams> for AcpTurnParams {
    fn from(p: ExecuteDeepseekAcpParams) -> Self {
        Self {
            prompt: p.prompt,
            project_path: p.project_path,
            model: p.model,
            invocation_key: p.invocation_key,
            tab_session_id: p.tab_session_id,
            resume_session_id: p.deepseek_session_id,
            mode: None,
            auto_approve_permissions: p.auto_approve_permissions,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InterruptAcpParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShutdownAcpParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondAcpPermissionParams {
    pub session_id: String,
    pub request_id: String,
    /// once | always | reject | cancelled
    pub decision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondAcpQuestionParams {
    pub session_id: String,
    pub request_id: String,
    pub outcome: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondAcpPlanParams {
    pub session_id: String,
    pub request_id: String,
    pub outcome: Value,
}

fn default_true() -> bool {
    true
}

fn persist_line(project_path: &str, tab_session_id: &str, line: &str) {
    if let Err(e) = append_cursor_session_line(project_path, tab_session_id, line) {
        eprintln!("[acp] transcript append failed (tab={tab_session_id}): {e}");
    }
}

fn emit_and_persist(
    app: &AppHandle,
    project_path: &str,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    persist_line(project_path, session_id, line);
    emit_opencode_acp_output_line(app, session_id, line, invocation_key);
}

fn parse_request_id(raw: &str) -> JsonRpcId {
    let trimmed = raw.trim();
    if let Ok(n) = trimmed.parse::<u64>() {
        JsonRpcId::Number(n)
    } else {
        JsonRpcId::String(trimmed.to_string())
    }
}

fn request_id_key(id: &JsonRpcId) -> String {
    match id {
        JsonRpcId::Number(n) => n.to_string(),
        JsonRpcId::String(s) => s.clone(),
    }
}

async fn get_or_create_session(
    engine: AcpEngine,
    store: &AcpSessionStore,
    tab_session_id: &str,
    project_path: &str,
    resume_id: Option<&str>,
) -> Result<Arc<TokioMutex<OpencodeAcpSession>>, String> {
    // Reuse healthy session.
    {
        let sessions = store.sessions.lock().await;
        if let Some(existing) = sessions.get(tab_session_id) {
            let mut guard = existing.lock().await;
            if !guard.is_dead() && guard.acp_session_id.is_some() {
                drop(guard);
                return Ok(existing.clone());
            }
        }
    }

    let agent = engine.find_binary()?;

    let mut session = OpencodeAcpSession::bootstrap(engine, &agent, project_path)
        .await
        .map_err(|e| format!("{} ACP 启动失败: {e}", engine.display_name()))?;

    let acp_sid = if let Some(resume) = resume_id.map(str::trim).filter(|s| !s.is_empty()) {
        match session.session_load(resume).await {
            Ok(sid) => sid,
            Err(e) => {
                eprintln!(
                    "[{}_acp] {} failed ({e}); falling back to session/new",
                    engine.kind(),
                    engine.resume_method()
                );
                session.session_new().await.map_err(|e2| {
                    format!("{} ACP session/new 失败: {e2}", engine.display_name())
                })?
            }
        }
    } else {
        session
            .session_new()
            .await
            .map_err(|e| format!("{} ACP session/new 失败: {e}", engine.display_name()))?
    };

    let _ = acp_sid;
    let arc = Arc::new(TokioMutex::new(session));
    {
        let mut sessions = store.sessions.lock().await;
        sessions.insert(tab_session_id.to_string(), arc.clone());
    }
    Ok(arc)
}

/// One non-blocking message read from the ACP session.
enum AcpPump {
    /// `session/update` notification (assistant output, tool lifecycle, usage).
    Update(String, Option<Value>),
    /// Agent-initiated request that needs a client response (permission / question).
    Request(AcpServerRequest),
    /// Nothing queued right now.
    Idle,
}

impl AcpPump {
    /// Whether this message must be handled before the loop reacts to a settled
    /// `session/prompt` result.
    ///
    /// Always true for queued messages. Agents that only publish committed output
    /// (DeepSeek Harness) flush the whole assistant message and settle the prompt
    /// in the same burst, so reacting to settlement first silently dropped every
    /// visible update of the turn.
    fn must_drain_before_settlement(&self) -> bool {
        !matches!(self, AcpPump::Idle)
    }
}

/// Read the next queued ACP message without blocking on the agent.
async fn pump_acp_message(session_arc: &Arc<TokioMutex<OpencodeAcpSession>>) -> AcpPump {
    let mut guard = session_arc.lock().await;
    if let Some((method, params)) = guard.poll_notification() {
        AcpPump::Update(method, params)
    } else if let Some(req) = guard.poll_server_request() {
        AcpPump::Request(req)
    } else {
        AcpPump::Idle
    }
}

/// Main execute entry: persistent ACP session + one prompt turn.
async fn execute_acp_turn(
    engine: AcpEngine,
    app: AppHandle,
    store: &AcpSessionStore,
    params: AcpTurnParams,
) -> Result<(), String> {
    let trimmed_prompt = params.prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err(format!("{} 执行需要非空提示词", engine.display_name()));
    }
    if params.project_path.trim().is_empty() {
        return Err(format!("{} 执行需要 projectPath", engine.display_name()));
    }

    let session_id = params
        .tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}-acp-{}", engine.kind(), Uuid::new_v4().simple()));

    {
        let mut busy = store.busy.lock().await;
        if busy.get(&session_id).copied().unwrap_or(false) {
            return Err(format!("该会话已有进行中的 {} 回合", engine.display_name()));
        }
        busy.insert(session_id.clone(), true);
    }

    let turn_epoch = {
        let mut epochs = store.turn_epoch.lock().await;
        let entry = epochs.entry(session_id.clone()).or_insert(0);
        *entry = entry.saturating_add(1);
        *entry
    };

    let invocation_key = params
        .invocation_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);

    {
        let registry = app.state::<ClaudeSessionRegistry>();
        let model_label = params.model.as_deref().unwrap_or(engine.kind()).to_string();
        registry.register(session_id.clone(), params.project_path.clone(), model_label);
    }

    if let Some(inv) = invocation_key.as_deref() {
        let process_state = app.state::<ClaudeProcessState>();
        process_state
            .invocation_tab_session_by_key
            .lock()
            .await
            .insert(inv.to_string(), session_id.clone());
    }

    let resume = params.resume_session_id.as_deref();
    let session_arc = match get_or_create_session(
        engine,
        store,
        &session_id,
        &params.project_path,
        resume,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            store.busy.lock().await.remove(&session_id);
            emit_and_persist(
                &app,
                &params.project_path,
                &session_id,
                &json!({
                    "type": "assistant",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": &e }] }
                })
                .to_string(),
                invocation_key.as_deref(),
            );
            let registry = app.state::<ClaudeSessionRegistry>();
            registry.mark_completed(&session_id, false);
            emit_acp_complete(
                engine,
                &app,
                invocation_key.as_deref(),
                &session_id,
                false,
                None,
            );
            return Err(e);
        }
    };

    // Configure model/mode + emit bind/init + persist user turn.
    let acp_session_id = {
        let mut guard = session_arc.lock().await;
        if let Some(mode) = params.mode.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let _ = guard.set_config_option("mode", mode).await;
        }
        if let Err(e) = guard.set_model_if_needed(params.model.as_deref()).await {
            eprintln!(
                "[{}_acp] set model failed (non-fatal): {e}",
                engine.kind()
            );
        }
        guard
            .acp_session_id
            .clone()
            .unwrap_or_else(|| session_id.clone())
    };

    emit_and_persist(
        &app,
        &params.project_path,
        &session_id,
        &opencode_acp_init_line(&session_id),
        invocation_key.as_deref(),
    );
    emit_and_persist(
        &app,
        &params.project_path,
        &session_id,
        &acp_bind_line(engine, &acp_session_id),
        invocation_key.as_deref(),
    );

    let user_line = build_cursor_user_turn_line(trimmed_prompt, None);
    persist_line(&params.project_path, &session_id, &user_line);

    let prompt_rx = {
        let mut guard = session_arc.lock().await;
        match guard.begin_prompt(trimmed_prompt).await {
            Ok((_id, rx)) => rx,
            Err(e) => {
                store.busy.lock().await.remove(&session_id);
                let msg = format!("{} ACP prompt 失败: {e}", engine.display_name());
                emit_and_persist(
                    &app,
                    &params.project_path,
                    &session_id,
                    &json!({
                        "type": "assistant",
                        "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
                    })
                    .to_string(),
                    invocation_key.as_deref(),
                );
                let registry = app.state::<ClaudeSessionRegistry>();
                registry.mark_completed(&session_id, false);
                emit_acp_complete(
                    engine,
                    &app,
                    invocation_key.as_deref(),
                    &session_id,
                    false,
                    Some(&acp_session_id),
                );
                return Err(msg);
            }
        }
    };

    // Dispatch/oneshot calls carry no tab session id: the ACP process must be
    // torn down after the turn instead of lingering for reuse.
    let persistent_tab = params
        .tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    let app_loop = app.clone();
    let session_id_loop = session_id.clone();
    let project_path_loop = params.project_path.clone();
    let invocation_key_loop = invocation_key.clone();
    let acp_sid_loop = acp_session_id.clone();
    let auto_approve = params.auto_approve_permissions;
    let store_loop = store.clone();
    let session_arc_loop = session_arc.clone();

    tokio::spawn(async move {
        let mut success = true;
        let mut prompt_rx = prompt_rx;

        loop {
            // Drain every queued agent message first. Agents that publish only
            // committed output (DeepSeek Harness) flush the final assistant message
            // and settle `session/prompt` in the same burst; checking the prompt
            // result first dropped those queued updates and the turn finished with
            // no visible output at all.
            let mut drained_any = false;
            loop {
                let pump = pump_acp_message(&session_arc_loop).await;
                if !pump.must_drain_before_settlement() {
                    break;
                }
                drained_any = true;
                match pump {
                    AcpPump::Update(method, params) => {
                        let lines = adapt_acp_notification_to_stream_lines(
                            engine,
                            &method,
                            params.as_ref(),
                            &session_id_loop,
                        );
                        for line in &lines {
                            emit_and_persist(
                                &app_loop,
                                &project_path_loop,
                                &session_id_loop,
                                line,
                                invocation_key_loop.as_deref(),
                            );
                        }
                    }
                    AcpPump::Request(req) => {
                        handle_server_request(
                            engine,
                            &app_loop,
                            &store_loop,
                            &session_arc_loop,
                            &session_id_loop,
                            req,
                            auto_approve,
                        )
                        .await;
                    }
                    AcpPump::Idle => {}
                }
            }

            // Only now honor prompt settlement: everything the agent sent before
            // answering is already on its way to the UI.
            match prompt_rx.try_recv() {
                Ok(msg) => {
                    match msg {
                        JsonRpcMessage::Response { error: Some(err), .. } => {
                            success = false;
                            let text = format!("{} ACP 错误: {}", engine.display_name(), err.message);
                            emit_and_persist(
                                &app_loop,
                                &project_path_loop,
                                &session_id_loop,
                                &json!({
                                    "type": "assistant",
                                    "message": { "role": "assistant", "content": [{ "type": "text", "text": text }] }
                                })
                                .to_string(),
                                invocation_key_loop.as_deref(),
                            );
                        }
                        JsonRpcMessage::Response { result, .. } => {
                            let stop = result
                                .as_ref()
                                .and_then(|v| v.get("stopReason"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("end_turn");
                            if stop == "cancelled" || stop == "refusal" {
                                success = false;
                            }
                        }
                        _ => {
                            success = false;
                        }
                    }
                    break;
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    success = false;
                    break;
                }
            }

            if !drained_any {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        }

        {
            let still_current = {
                let epochs = store_loop.turn_epoch.lock().await;
                epochs.get(&session_id_loop).copied().unwrap_or(0) == turn_epoch
            };
            if !still_current {
                // Interrupt or a newer execute owns this tab; do not touch busy /
                // prompt_in_flight / completion events belonging to the new turn.
                return;
            }
            let mut guard = session_arc_loop.lock().await;
            guard.mark_prompt_done();
        }
        store_loop.busy.lock().await.remove(&session_id_loop);

        let registry = app_loop.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id_loop, success);
        emit_acp_complete(
            engine,
            &app_loop,
            invocation_key_loop.as_deref(),
            &session_id_loop,
            success,
            Some(&acp_sid_loop),
        );

        if !persistent_tab {
            store_loop.sessions.lock().await.remove(&session_id_loop);
            let mut guard = session_arc_loop.lock().await;
            let _ = guard.shutdown().await;
        }
    });

    Ok(())
}

async fn handle_server_request(
    engine: AcpEngine,
    app: &AppHandle,
    store: &AcpSessionStore,
    session_arc: &Arc<TokioMutex<OpencodeAcpSession>>,
    wise_session_id: &str,
    req: AcpServerRequest,
    auto_approve: bool,
) {
    match req {
        AcpServerRequest::RequestPermission { request_id, params } => {
            let key = request_id_key(&request_id);
            if auto_approve {
                let option_id = auto_approve_option_id(&params);
                let mut guard = session_arc.lock().await;
                let _ = guard
                    .respond(request_id, permission_selected_result(&option_id))
                    .await;
                return;
            }
            {
                let mut options = store.permission_options.lock().await;
                options.insert(key.clone(), params.clone());
            }
            let payload = permission_event_payload(wise_session_id, &key, &params);
            let _ = app.emit(engine.permission_request_event(), payload);
        }
        AcpServerRequest::Unknown {
            request_id,
            method,
            params,
        } => {
            eprintln!(
                "[{}_acp] unknown server request: {method} params={params:?}",
                engine.kind()
            );
            // Unblock the agent with a cancelled/empty result when possible.
            let mut guard = session_arc.lock().await;
            let _ = guard
                .respond(request_id, permission_cancelled_result())
                .await;
        }
    }
}

async fn interrupt_acp(
    engine: AcpEngine,
    app: AppHandle,
    store: &AcpSessionStore,
    session_id: &str,
) -> Result<(), String> {
    // Invalidate the in-flight prompt loop's finalize before unblocking waiters /
    // clearing busy, so a quick re-send cannot have its busy flag stolen.
    {
        let mut epochs = store.turn_epoch.lock().await;
        let entry = epochs.entry(session_id.to_string()).or_insert(0);
        *entry = entry.saturating_add(1);
    }
    store.busy.lock().await.remove(session_id);

    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions.get(session_id).cloned()
    };
    if let Some(session_arc) = session_arc {
        let mut guard = session_arc.lock().await;
        guard
            .cancel_prompt()
            .await
            .map_err(|e| format!("session/cancel failed: {e}"))?;
    }

    let registry = app.state::<ClaudeSessionRegistry>();
    registry.mark_completed(session_id, false);

    let _ = app.emit(engine.interrupted_event(), json!({ "sessionId": session_id }));
    Ok(())
}

async fn shutdown_acp(store: &AcpSessionStore, session_id: &str) -> Result<(), String> {
    let session_arc = {
        let mut sessions = store.sessions.lock().await;
        sessions.remove(session_id)
    };
    store.turn_epoch.lock().await.remove(session_id);
    store.busy.lock().await.remove(session_id);
    if let Some(arc) = session_arc {
        let mut guard = arc.lock().await;
        let _ = guard.shutdown().await;
    }
    Ok(())
}

async fn respond_acp_permission(
    engine: AcpEngine,
    app: AppHandle,
    store: &AcpSessionStore,
    params: RespondAcpPermissionParams,
) -> Result<(), String> {
    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions.get(&params.session_id).cloned().ok_or_else(|| {
            format!("No active {} ACP session: {}", engine.display_name(), params.session_id)
        })?
    };
    let options = {
        let mut options = store.permission_options.lock().await;
        options.remove(&params.request_id)
    };
    let result = resolve_permission_decision_result(options.as_ref(), &params.decision);
    let id = parse_request_id(&params.request_id);
    {
        let mut guard = session_arc.lock().await;
        guard
            .respond(id, result)
            .await
            .map_err(|e| format!("respond permission failed: {e}"))?;
    }
    let _ = app.emit(
        engine.permission_resolved_event(),
        json!({
            "sessionId": params.session_id,
            "requestId": params.request_id,
            "decision": params.decision,
        }),
    );
    Ok(())
}

async fn respond_acp_question(
    engine: AcpEngine,
    app: AppHandle,
    store: &AcpSessionStore,
    params: RespondAcpQuestionParams,
) -> Result<(), String> {
    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions.get(&params.session_id).cloned().ok_or_else(|| {
            format!("No active {} ACP session: {}", engine.display_name(), params.session_id)
        })?
    };
    let id = parse_request_id(&params.request_id);
    {
        let mut guard = session_arc.lock().await;
        guard
            .respond(id, params.outcome.clone())
            .await
            .map_err(|e| format!("respond question failed: {e}"))?;
    }
    let _ = app.emit(
        engine.question_resolved_event(),
        json!({
            "sessionId": params.session_id,
            "requestId": params.request_id,
        }),
    );
    Ok(())
}

async fn respond_acp_plan(
    engine: AcpEngine,
    app: AppHandle,
    store: &AcpSessionStore,
    params: RespondAcpPlanParams,
) -> Result<(), String> {
    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions.get(&params.session_id).cloned().ok_or_else(|| {
            format!("No active {} ACP session: {}", engine.display_name(), params.session_id)
        })?
    };
    let id = parse_request_id(&params.request_id);
    {
        let mut guard = session_arc.lock().await;
        guard
            .respond(id, params.outcome.clone())
            .await
            .map_err(|e| format!("respond plan failed: {e}"))?;
    }
    let _ = app.emit(
        engine.plan_resolved_event(),
        json!({
            "sessionId": params.session_id,
            "requestId": params.request_id,
        }),
    );
    Ok(())
}

// ---------------------------- OpenCode commands ----------------------------

#[tauri::command]
pub(crate) async fn execute_opencode_acp(
    app: AppHandle,
    store: tauri::State<'_, OpencodeAcpSessionStore>,
    params: ExecuteOpencodeAcpParams,
) -> Result<(), String> {
    execute_acp_turn(AcpEngine::OpenCode, app, &store.0, params.into()).await
}

#[tauri::command]
pub(crate) async fn interrupt_opencode_acp(
    app: AppHandle,
    store: tauri::State<'_, OpencodeAcpSessionStore>,
    params: InterruptAcpParams,
) -> Result<(), String> {
    interrupt_acp(AcpEngine::OpenCode, app, &store.0, &params.session_id).await
}

#[tauri::command]
pub(crate) async fn shutdown_opencode_acp(
    store: tauri::State<'_, OpencodeAcpSessionStore>,
    params: ShutdownAcpParams,
) -> Result<(), String> {
    shutdown_acp(&store.0, &params.session_id).await
}

#[tauri::command]
pub(crate) async fn respond_opencode_acp_permission(
    app: AppHandle,
    store: tauri::State<'_, OpencodeAcpSessionStore>,
    params: RespondAcpPermissionParams,
) -> Result<(), String> {
    respond_acp_permission(AcpEngine::OpenCode, app, &store.0, params).await
}

#[tauri::command]
pub(crate) async fn respond_opencode_acp_question(
    app: AppHandle,
    store: tauri::State<'_, OpencodeAcpSessionStore>,
    params: RespondAcpQuestionParams,
) -> Result<(), String> {
    respond_acp_question(AcpEngine::OpenCode, app, &store.0, params).await
}

#[tauri::command]
pub(crate) async fn respond_opencode_acp_plan(
    app: AppHandle,
    store: tauri::State<'_, OpencodeAcpSessionStore>,
    params: RespondAcpPlanParams,
) -> Result<(), String> {
    respond_acp_plan(AcpEngine::OpenCode, app, &store.0, params).await
}

// ---------------------------- DeepSeek commands ----------------------------

#[tauri::command]
pub(crate) async fn execute_deepseek_acp(
    app: AppHandle,
    store: tauri::State<'_, DeepseekAcpSessionStore>,
    params: ExecuteDeepseekAcpParams,
) -> Result<(), String> {
    execute_acp_turn(AcpEngine::DeepSeek, app, &store.0, params.into()).await
}

#[tauri::command]
pub(crate) async fn interrupt_deepseek_acp(
    app: AppHandle,
    store: tauri::State<'_, DeepseekAcpSessionStore>,
    params: InterruptAcpParams,
) -> Result<(), String> {
    interrupt_acp(AcpEngine::DeepSeek, app, &store.0, &params.session_id).await
}

#[tauri::command]
pub(crate) async fn shutdown_deepseek_acp(
    store: tauri::State<'_, DeepseekAcpSessionStore>,
    params: ShutdownAcpParams,
) -> Result<(), String> {
    shutdown_acp(&store.0, &params.session_id).await
}

#[tauri::command]
pub(crate) async fn respond_deepseek_acp_permission(
    app: AppHandle,
    store: tauri::State<'_, DeepseekAcpSessionStore>,
    params: RespondAcpPermissionParams,
) -> Result<(), String> {
    respond_acp_permission(AcpEngine::DeepSeek, app, &store.0, params).await
}

#[tauri::command]
pub(crate) async fn respond_deepseek_acp_question(
    app: AppHandle,
    store: tauri::State<'_, DeepseekAcpSessionStore>,
    params: RespondAcpQuestionParams,
) -> Result<(), String> {
    respond_acp_question(AcpEngine::DeepSeek, app, &store.0, params).await
}

#[tauri::command]
pub(crate) async fn respond_deepseek_acp_plan(
    app: AppHandle,
    store: tauri::State<'_, DeepseekAcpSessionStore>,
    params: RespondAcpPlanParams,
) -> Result<(), String> {
    respond_acp_plan(AcpEngine::DeepSeek, app, &store.0, params).await
}

/// DeepSeek Harness advertises its model catalog through the ACP session config
/// options, so listing models means starting a throwaway ACP session and reading
/// the `session/new` result. Failures degrade to an empty list (Composer falls
/// back to the dsh-configured default model).
#[tauri::command]
pub(crate) async fn deepseek_list_models(project_path: Option<String>) -> Result<Vec<Value>, String> {
    use crate::opencode_acp_model_choices::extract_model_choices;

    let engine = AcpEngine::DeepSeek;
    let binary = match engine.find_binary() {
        Ok(b) => b,
        Err(_) => return Ok(vec![]),
    };
    let cwd = project_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| dirs::home_dir().map(|h| h.to_string_lossy().to_string()))
        .unwrap_or_else(|| ".".to_string());

    let probe = async move {
        let mut session = OpencodeAcpSession::bootstrap(engine, &binary, &cwd).await?;
        session.session_new().await?;
        let choices = session
            .config_options
            .as_ref()
            .map(extract_model_choices)
            .unwrap_or_default();
        let _ = session.session_close().await;
        let _ = session.shutdown().await;
        Ok::<Vec<Value>, anyhow::Error>(choices)
    };

    match tokio::time::timeout(std::time::Duration::from_secs(30), probe).await {
        Ok(Ok(choices)) => Ok(choices),
        Ok(Err(e)) => {
            eprintln!("[deepseek_acp] list models failed: {e}");
            Ok(vec![])
        }
        Err(_) => {
            eprintln!("[deepseek_acp] list models timed out");
            Ok(vec![])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_agent_updates_outrank_prompt_settlement() {
        // dsh flushes the committed assistant message and the `session/prompt`
        // response together; settlement must never win that race.
        let update = AcpPump::Update("session/update".to_string(), None);
        assert!(update.must_drain_before_settlement());
        assert!(!AcpPump::Idle.must_drain_before_settlement());
    }

    #[test]
    fn permission_requests_are_drained_before_settlement() {
        let req = AcpPump::Request(AcpServerRequest::RequestPermission {
            request_id: JsonRpcId::Number(1),
            params: Value::Null,
        });
        assert!(req.must_drain_before_settlement());
    }
}
