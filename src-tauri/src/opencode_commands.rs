//! OpenCode CLI execution (`opencode run --format json`) for Wise main / member sessions.

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::opencode_binary::{
    apply_opencode_child_env, find_opencode_binary, opencode_merged_path_env,
};
use crate::opencode_config_dir::{
    effective_opencode_model_from_disk, list_opencode_models_from_config,
};
use crate::opencode_stream_adapter::{
    opencode_session_clear_line, OpencodeStdoutMap, OpencodeStdoutMapper,
};
use crate::wise_db::WiseDb;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpencodeCompletePayload {
    session_id: String,
    success: bool,
}

/// 默认配置 DB key：opencode 启动默认权限设置（JSON）。
/// 与前端 `WISE_OPENCODE_DEFAULT_SETTINGS_KEY` 一致。
pub(crate) const OPENCODE_DEFAULT_SETTINGS_KEY: &str = "wise.opencodeDefaultSettings.v1";

/// opencode 启动默认权限设置。
/// - `mode == "auto"`（或缺省）：保留 `--dangerously-skip-permissions`（自动批准，现状）；
/// - `mode == "custom"`：移除 skip，改用 `OPENCODE_PERMISSION` 注入用户 permission JSON
///   （allow/ask/deny 规则全部生效）。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpencodeDefaultSettings {
    mode: Option<String>,            // "auto" | "custom"
    permission_json: Option<String>, // OPENCODE_PERMISSION 内容
}

/// 解析 opencode 默认设置，返回 (是否保留 `--dangerously-skip-permissions`, `OPENCODE_PERMISSION` env 值)。
///
/// custom 模式移除 skip 让规则生效；`permission_json` 为空时不注入 env（仍移除 skip，
/// 此时 opencode 回退其内置默认规则）。auto/None 维持现状（skip=true、不注入 env）。
fn resolve_opencode_permission(
    settings: Option<&OpencodeDefaultSettings>,
) -> (bool, Option<String>) {
    match settings {
        Some(s) if s.mode.as_deref() == Some("custom") => {
            let env = s
                .permission_json
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
                .map(|t| t.to_string());
            (false, env)
        }
        _ => (true, None),
    }
}

struct OpencodeSpawnParams {
    opencode_path: String,
    project_path: String,
    prompt: String,
    exec_model: Option<String>,
    resume_session_id: Option<String>,
    force_new_session: bool,
    path_env: String,
    default_settings: Option<OpencodeDefaultSettings>,
}

#[derive(Clone)]
struct OpencodeRuntimeContext {
    app: AppHandle,
    session_id: String,
    invocation_key: Option<String>,
    project_path: String,
    prompt: String,
    exec_model: Option<String>,
    registry: ClaudeSessionRegistry,
    active_child_by_invocation_key:
        Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
    active_child_by_claude_session:
        Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
    opencode_path: String,
    path_env: String,
    default_settings: Option<OpencodeDefaultSettings>,
}

fn normalize_opencode_model(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Composer「Auto」：不传 `-m`，由 OpenCode 本机配置决定。
    let lower = trimmed.to_ascii_lowercase();
    if lower == "auto" || lower == "default" {
        return None;
    }
    Some(trimmed.to_string())
}

fn should_pass_opencode_model_flag(model: &str) -> bool {
    // 只要 model 非空就传参，不再要求必须包含 '/'（provider/model 格式）。
    // 即使裸模型名（如 claude-sonnet-4-20250514）也透传给 opencode，由它自行解析；
    // 这样用户自定义的不带 provider 前缀的模型名不会被静默丢弃。
    !model.is_empty()
}

fn opencode_assistant_stream_line(text: &str) -> String {
    serde_json::json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": text }]
        }
    })
    .to_string()
}

fn opencode_init_stream_line(session_id: &str) -> String {
    serde_json::json!({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
    })
    .to_string()
}

fn emit_opencode_stdout_line(app: &AppHandle, sid: &str, line: &str, invocation_key: Option<&str>) {
    if !sid.is_empty() {
        let _ = app.emit(&format!("claude-output:{}", sid), line);
    }
    // 带 invocation_key（前端定向监听已建立）时抑制全局通道，避免多屏并行被全局 handleOutput 的单值兜底路由串屏。
    if invocation_key.is_none() {
        let _ = app.emit("claude-output", line);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-output:invocation:{}", inv), line);
    }
}

fn emit_opencode_complete(app: &AppHandle, sid: &str, success: bool, invocation_key: Option<&str>) {
    let payload = OpencodeCompletePayload {
        session_id: sid.to_string(),
        success,
    };
    if !sid.is_empty() {
        let _ = app.emit(&format!("claude-complete:{}", sid), &payload);
    }
    // 同 emit_opencode_stdout_line：带 invocation_key 时抑制全局通道。
    if invocation_key.is_none() {
        let _ = app.emit("claude-complete", &payload);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-complete:invocation:{}", inv), &payload);
    }
}

fn normalize_opencode_resume_session_id(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn configure_opencode_run_command(
    cmd: &mut Command,
    prompt: &str,
    model: Option<&str>,
    project_path: &str,
    resume_session_id: Option<&str>,
    force_new_session: bool,
    skip_permissions: bool,
) {
    cmd.arg("run");
    cmd.arg("--format").arg("json");
    if skip_permissions {
        cmd.arg("--dangerously-skip-permissions");
    }
    if !project_path.trim().is_empty() {
        cmd.arg("--dir").arg(project_path.trim());
    }
    if let Some(model_name) = normalize_opencode_model(model) {
        if should_pass_opencode_model_flag(&model_name) {
            cmd.arg("-m").arg(model_name);
        }
    }
    if !force_new_session {
        if let Some(resume_id) = resume_session_id {
            cmd.arg("-s").arg(resume_id);
        }
    }
    cmd.arg(prompt);
}

fn stderr_suggests_resume_session_missing(lines: &[String]) -> bool {
    lines.iter().any(|line| {
        let lower = line.to_lowercase();
        let has_session_word = lower.contains("session") || line.contains("会话");
        has_session_word
            && (lower.contains("not found")
                || lower.contains("no such")
                || lower.contains("unknown")
                || lower.contains("does not exist")
                || lower.contains("invalid")
                || lower.contains("expired")
                || lower.contains("找不到")
                || lower.contains("不存在"))
    })
}

fn stderr_line_is_actionable(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("error")
        || lower.contains("unauthorized")
        || lower.contains("failed")
        || lower.contains("not found")
        || lower.contains("denied")
        || lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("429")
        || lower.contains("api key")
        || lower.contains("apikey")
        || lower.contains("provider")
}

/// 进程非零退出时产出一条诊断文案。
///
/// 优先级：stderr 可行动行 > stdout `error` 事件真实消息 > stderr 最后非空行 > 兜底。
/// 可行动的 stderr（含 error/401/403/api key 等关键词）最可信；其次复用 OpenCode 经 stdout
/// JSON 事件报告的真实错误（如 provider 401），它优先于无关的 stderr 普通日志；最后才兜底。
/// 这样避免过去「stdout 已吐真实错误，等待任务却无视它再发『无 stderr 输出』笼统提示」的遮蔽。
fn build_opencode_failure_diagnostic(
    stderr_lines: &[String],
    stdout_error: Option<&str>,
) -> String {
    if let Some(line) = stderr_lines
        .iter()
        .rev()
        .find(|l| stderr_line_is_actionable(l))
    {
        return format!("OpenCode 执行失败：{}", line.trim());
    }
    if let Some(msg) = stdout_error.map(str::trim).filter(|s| !s.is_empty()) {
        return format!("OpenCode 执行失败：{}", msg);
    }
    if let Some(last) = stderr_lines.iter().rev().find(|l| !l.trim().is_empty()) {
        return format!("OpenCode 执行失败：{}", last.trim());
    }
    "OpenCode 执行失败（未捕获到错误输出）。请检查 provider 凭据、模型配置与网络连接。".to_string()
}

fn validate_opencode_project_path(project_path: &str) -> Result<(), String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("OpenCode 执行需要有效的仓库路径".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err(format!("OpenCode 仓库路径不存在或不是目录: {trimmed}"));
    }
    Ok(())
}

fn build_opencode_command(params: &OpencodeSpawnParams) -> Command {
    let mut cmd = Command::new(&params.opencode_path);
    let (skip_permissions, permission_env) =
        resolve_opencode_permission(params.default_settings.as_ref());
    configure_opencode_run_command(
        &mut cmd,
        params.prompt.trim(),
        params.exec_model.as_deref(),
        &params.project_path,
        params.resume_session_id.as_deref(),
        params.force_new_session,
        skip_permissions,
    );
    cmd.current_dir(&params.project_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    apply_opencode_child_env(&mut cmd, &params.path_env);
    if let Some(permission_json) = permission_env {
        cmd.env("OPENCODE_PERMISSION", permission_json);
    }
    cmd
}

fn spawn_opencode_process(params: &OpencodeSpawnParams) -> Result<Child, String> {
    build_opencode_command(params)
        .spawn()
        .map_err(|e| format!("Failed to start opencode: {e}"))
}

fn attach_opencode_child_io(
    ctx: &OpencodeRuntimeContext,
    mut child: Child,
    wait_child: Arc<TokioMutex<Option<Child>>>,
    used_resume: bool,
    allow_resume_retry: bool,
) -> Result<(), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to get opencode stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to get opencode stderr".to_string())?;

    {
        let mut slot = wait_child
            .try_lock()
            .map_err(|_| "Failed to lock opencode child slot".to_string())?;
        *slot = Some(child);
    }

    // OpenCode 以 `--format json` 运行时，错误经 stdout 以 `{"type":"error",...}` 事件输出，
    // 而非 stderr。这里把流适配器解析出的真实错误文本留存一份，供进程退出后的等待任务复用，
    // 避免在 stdout 已吐出真实错误的情况下仍回退成「无 stderr 输出」的笼统提示。
    let stdout_error_message = Arc::new(TokioMutex::new(None::<String>));
    let app_stdout = ctx.app.clone();
    let session_id_stdout = ctx.session_id.clone();
    let invocation_key_stdout = ctx.invocation_key.clone();
    let stdout_error_writer = stdout_error_message.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut mapper = OpencodeStdoutMapper::default();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let stream_lines = match mapper.map_line(&line) {
                OpencodeStdoutMap::PlainText => vec![opencode_assistant_stream_line(&line)],
                OpencodeStdoutMap::StreamLines(mapped) if mapped.is_empty() => continue,
                OpencodeStdoutMap::StreamLines(mapped) => mapped,
            };
            if let Some(msg) = mapper.take_last_error() {
                *stdout_error_writer.lock().await = Some(msg);
            }
            for stream_line in stream_lines {
                emit_opencode_stdout_line(
                    &app_stdout,
                    &session_id_stdout,
                    &stream_line,
                    invocation_key_stdout.as_deref(),
                );
            }
        }
    });

    let stderr_lines = Arc::new(TokioMutex::new(Vec::<String>::new()));
    let stderr_lines_reader = stderr_lines.clone();
    let app_stderr = ctx.app.clone();
    let session_id_stderr = ctx.session_id.clone();
    let invocation_key_stderr = ctx.invocation_key.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            stderr_lines_reader.lock().await.push(trimmed.to_string());
            if stderr_line_is_actionable(trimmed) {
                emit_opencode_stdout_line(
                    &app_stderr,
                    &session_id_stderr,
                    &opencode_assistant_stream_line(&format!("OpenCode: {trimmed}")),
                    invocation_key_stderr.as_deref(),
                );
            }
        }
    });

    let app_wait = ctx.app.clone();
    let session_id_wait = ctx.session_id.clone();
    let invocation_key_wait = ctx.invocation_key.clone();
    let registry_wait = ctx.registry.clone();
    let runtime_wait = ctx.clone();
    let wait_child_wait = wait_child.clone();
    let stdout_error_reader = stdout_error_message.clone();
    tokio::spawn(async move {
        let mut success = false;
        if let Some(mut child) = wait_child_wait.lock().await.take() {
            success = child.wait().await.map(|s| s.success()).unwrap_or(false);
        }

        let stdout_err = stdout_error_reader.lock().await.clone();
        let lines = stderr_lines.lock().await.clone();
        if !success {
            if used_resume
                && allow_resume_retry
                && stderr_suggests_resume_session_missing(&lines)
            {
                let retry_params = OpencodeSpawnParams {
                    opencode_path: runtime_wait.opencode_path.clone(),
                    project_path: runtime_wait.project_path.clone(),
                    prompt: runtime_wait.prompt.clone(),
                    exec_model: runtime_wait.exec_model.clone(),
                    resume_session_id: None,
                    force_new_session: true,
                    path_env: runtime_wait.path_env.clone(),
                    default_settings: runtime_wait.default_settings.clone(),
                };
                let retry_runtime = OpencodeRuntimeContext {
                    app: runtime_wait.app.clone(),
                    session_id: runtime_wait.session_id.clone(),
                    invocation_key: runtime_wait.invocation_key.clone(),
                    project_path: runtime_wait.project_path.clone(),
                    prompt: runtime_wait.prompt.clone(),
                    exec_model: runtime_wait.exec_model.clone(),
                    registry: runtime_wait.registry.clone(),
                    active_child_by_invocation_key: runtime_wait
                        .active_child_by_invocation_key
                        .clone(),
                    active_child_by_claude_session: runtime_wait
                        .active_child_by_claude_session
                        .clone(),
                    opencode_path: runtime_wait.opencode_path.clone(),
                    path_env: runtime_wait.path_env.clone(),
                    default_settings: runtime_wait.default_settings.clone(),
                };
                let retry_wait_child = wait_child_wait.clone();
                match spawn_opencode_process(&retry_params) {
                    Ok(child) => {
                        if attach_opencode_child_io(
                            &retry_runtime,
                            child,
                            retry_wait_child,
                            false,
                            false,
                        )
                        .is_ok()
                        {
                            return;
                        }
                    }
                    Err(retry_err) => {
                        emit_opencode_stdout_line(
                            &app_wait,
                            &session_id_wait,
                            &opencode_assistant_stream_line(&format!(
                                "OpenCode 自动重试失败：{retry_err}"
                            )),
                            invocation_key_wait.as_deref(),
                        );
                    }
                }
            } else if used_resume && stderr_suggests_resume_session_missing(&lines) {
                emit_opencode_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &opencode_session_clear_line(),
                    invocation_key_wait.as_deref(),
                );
                let diagnostic =
                    "OpenCode 会话已失效，已清除续接 id；请重试，必要时简要说明上一轮背景。";
                emit_opencode_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &opencode_assistant_stream_line(diagnostic),
                    invocation_key_wait.as_deref(),
                );
            } else {
                let diagnostic =
                    build_opencode_failure_diagnostic(&lines, stdout_err.as_deref());
                emit_opencode_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &opencode_assistant_stream_line(&diagnostic),
                    invocation_key_wait.as_deref(),
                );
            }
        }

        registry_wait.mark_completed(&session_id_wait, success);
        emit_opencode_complete(
            &app_wait,
            &session_id_wait,
            success,
            invocation_key_wait.as_deref(),
        );
    });

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModelListItem {
    pub id: String,
    pub display_name: String,
}

fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(n) = chars.next() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

fn parse_opencode_models_cli_output(stdout: &str) -> Vec<OpencodeModelListItem> {
    let cleaned = strip_ansi_codes(stdout);
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for line in cleaned.lines() {
        let t = line.trim();
        if t.is_empty()
            || t.starts_with("Error")
            || t.starts_with("Unknown")
            || t.starts_with("Commands:")
            || t.starts_with("Options:")
        {
            continue;
        }
        // Typical: `provider/model` or `provider/model  Display Name`
        let mut parts = t.split_whitespace();
        let Some(id) = parts.next() else {
            continue;
        };
        if !id.contains('/') && !id.contains('-') {
            continue;
        }
        if id.starts_with('-') || id.starts_with('┌') || id.starts_with('│') {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        let rest = parts.collect::<Vec<_>>().join(" ");
        let display_name = if rest.is_empty() {
            id.to_string()
        } else {
            rest
        };
        out.push(OpencodeModelListItem {
            id: id.to_string(),
            display_name,
        });
    }
    out
}

async fn try_list_opencode_models_via_cli() -> Vec<OpencodeModelListItem> {
    let Ok(bin) = find_opencode_binary() else {
        return Vec::new();
    };
    let path_env = opencode_merged_path_env();
    let mut cmd = Command::new(&bin);
    apply_opencode_child_env(&mut cmd, &path_env);
    cmd.arg("models");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    // 列表失败时应快速回退到 opencode.json，避免拖慢 Composer 打开。
    let Ok(output) = timeout(Duration::from_secs(4), cmd.output()).await else {
        return Vec::new();
    };
    let Ok(output) = output else {
        return Vec::new();
    };
    parse_opencode_models_cli_output(&String::from_utf8_lossy(&output.stdout))
}

/// 列出 OpenCode 可选模型：优先本地 `opencode.json`，CLI 仅作补充（避免每次卡住数秒）。
#[tauri::command]
pub async fn opencode_list_models() -> Result<Vec<OpencodeModelListItem>, String> {
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for (id, display_name) in list_opencode_models_from_config() {
        if seen.insert(id.clone()) {
            out.push(OpencodeModelListItem { id, display_name });
        }
    }

    if let Some(disk) = effective_opencode_model_from_disk() {
        if seen.insert(disk.clone()) {
            out.insert(
                0,
                OpencodeModelListItem {
                    id: disk.clone(),
                    display_name: disk,
                },
            );
        }
    }

    // 配置已够用时跳过 CLI；否则短超时拉取一次。
    if out.len() < 2 {
        for item in try_list_opencode_models_via_cli().await {
            if seen.insert(item.id.clone()) {
                out.push(item);
            }
        }
    }

    Ok(out)
}

#[tauri::command]
pub(crate) async fn execute_opencode_code(
    app: tauri::AppHandle,
    db: tauri::State<'_, WiseDb>,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    tab_session_id: Option<String>,
    opencode_resume_session_id: Option<String>,
    force_new_session: Option<bool>,
) -> Result<(), String> {
    // Composer 只选模型：不再每次把 Wise OpenCode 档案写回磁盘（配置留在 OpenCode 本机）。
    // `-m` 由前端会话选择传入；Auto / 空则省略，走本机 opencode.json。
    let exec_model = normalize_opencode_model(model.as_deref());

    validate_opencode_project_path(&project_path)?;

    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("OpenCode 执行需要非空提示词".to_string());
    }

    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();
    let session_id = tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("opencode-{}", Uuid::new_v4().simple()));

    let opencode_path = find_opencode_binary()?;
    let resume_id = normalize_opencode_resume_session_id(opencode_resume_session_id.as_deref());
    let force_new = force_new_session.unwrap_or(false);
    let used_resume = !force_new && resume_id.is_some();
    let path_env = opencode_merged_path_env();
    // 全局默认配置：opencode 权限模式。DB 读失败或 JSON 非法时回退 None（现状=自动批准）。
    let default_settings = db
        .get_setting(OPENCODE_DEFAULT_SETTINGS_KEY)
        .ok()
        .flatten()
        .and_then(|s| {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                serde_json::from_str::<OpencodeDefaultSettings>(&t).ok()
            }
        });
    let spawn_params = OpencodeSpawnParams {
        opencode_path,
        project_path: project_path.clone(),
        prompt: trimmed_prompt.to_string(),
        exec_model: exec_model.clone(),
        resume_session_id: resume_id.clone(),
        force_new_session: force_new,
        path_env,
        default_settings,
    };

    let child = spawn_opencode_process(&spawn_params)?;
    let wait_child = Arc::new(TokioMutex::new(None));

    let model_label = exec_model.as_deref().unwrap_or("opencode").to_string();
    let runtime = OpencodeRuntimeContext {
        app: app.clone(),
        session_id,
        invocation_key: invocation_key.clone(),
        project_path,
        prompt: trimmed_prompt.to_string(),
        exec_model,
        registry: registry.inner().clone(),
        active_child_by_invocation_key: process_state.active_child_by_invocation_key.clone(),
        active_child_by_claude_session: process_state.active_child_by_claude_session.clone(),
        opencode_path: spawn_params.opencode_path.clone(),
        path_env: spawn_params.path_env.clone(),
        default_settings: spawn_params.default_settings.clone(),
    };

    if let Some(inv) = invocation_key.as_deref().filter(|s| !s.is_empty()) {
        process_state
            .active_child_by_invocation_key
            .lock()
            .await
            .insert(inv.to_string(), wait_child.clone());
    }
    if !runtime.session_id.is_empty() {
        process_state
            .active_child_by_claude_session
            .lock()
            .await
            .insert(runtime.session_id.clone(), wait_child.clone());
    }

    emit_opencode_stdout_line(
        &app,
        &runtime.session_id,
        &opencode_init_stream_line(&runtime.session_id),
        invocation_key.as_deref(),
    );
    registry.register(
        runtime.session_id.clone(),
        runtime.project_path.clone(),
        model_label,
    );

    attach_opencode_child_io(&runtime, child, wait_child, used_resume, true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_run_argv_order() {
        let mut cmd = Command::new("opencode");
        configure_opencode_run_command(
            &mut cmd,
            "hello",
            Some("anthropic/claude-haiku-4-5"),
            "/tmp/repo",
            None,
            false,
            true,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args[0], "run");
        assert!(args.contains(&"--format".to_string()));
        assert!(args.contains(&"json".to_string()));
        assert!(args.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(args.contains(&"--dir".to_string()));
        assert!(args.contains(&"/tmp/repo".to_string()));
        assert!(args.contains(&"-m".to_string()));
        assert!(args.contains(&"anthropic/claude-haiku-4-5".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("hello"));
    }

    #[test]
    fn passes_bare_model_name_without_slash() {
        let mut cmd = Command::new("opencode");
        configure_opencode_run_command(
            &mut cmd,
            "hello",
            Some("claude-sonnet-4-20250514"),
            "/tmp/repo",
            None,
            false,
            true,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        // 裸模型名也应传递 -m 参数，不再因缺少 '/' 被静默丢弃
        assert!(args.windows(2).any(|w| {
            w[0] == "-m" && w[1] == "claude-sonnet-4-20250514"
        }));
    }

    #[test]
    fn resume_run_includes_session_flag() {
        let mut cmd = Command::new("opencode");
        configure_opencode_run_command(
            &mut cmd,
            "continue",
            None,
            "/tmp/repo",
            Some("ses_abc"),
            false,
            true,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(args.windows(2).any(|w| w[0] == "-s" && w[1] == "ses_abc"));
    }

    #[test]
    fn custom_mode_omits_skip_permissions() {
        // custom 模式：configure 不应加 --dangerously-skip-permissions（skip=false）。
        let mut cmd = Command::new("opencode");
        configure_opencode_run_command(
            &mut cmd,
            "hello",
            None,
            "/tmp/repo",
            None,
            false,
            false,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(!args.contains(&"--dangerously-skip-permissions".to_string()));
    }

    #[test]
    fn resolve_permission_auto_keeps_skip() {
        let settings = OpencodeDefaultSettings {
            mode: Some("auto".to_string()),
            permission_json: Some("{\"bash\":{\"rm *\":\"deny\"}}".to_string()),
        };
        let (skip, env) = resolve_opencode_permission(Some(&settings));
        assert!(skip);
        assert!(env.is_none());
    }

    #[test]
    fn resolve_permission_none_keeps_skip() {
        let (skip, env) = resolve_opencode_permission(None);
        assert!(skip);
        assert!(env.is_none());
    }

    #[test]
    fn resolve_permission_custom_with_json() {
        let settings = OpencodeDefaultSettings {
            mode: Some("custom".to_string()),
            permission_json: Some("  {\"bash\":{\"rm *\":\"deny\"}}  ".to_string()),
        };
        let (skip, env) = resolve_opencode_permission(Some(&settings));
        assert!(!skip);
        assert_eq!(env.as_deref(), Some("{\"bash\":{\"rm *\":\"deny\"}}"));
    }

    #[test]
    fn resolve_permission_custom_empty_json_no_env() {
        // custom 模式但 permission_json 为空：仍移除 skip，但不注入空 env。
        let settings = OpencodeDefaultSettings {
            mode: Some("custom".to_string()),
            permission_json: Some("   ".to_string()),
        };
        let (skip, env) = resolve_opencode_permission(Some(&settings));
        assert!(!skip);
        assert!(env.is_none());
    }

    #[test]
    fn resolve_permission_custom_no_json_field() {
        let settings = OpencodeDefaultSettings {
            mode: Some("custom".to_string()),
            permission_json: None,
        };
        let (skip, env) = resolve_opencode_permission(Some(&settings));
        assert!(!skip);
        assert!(env.is_none());
    }

    #[test]
    fn failure_diagnostic_prefers_actionable_stderr() {
        let lines = vec![
            "loading config".to_string(),
            "Error: unauthorized 401".to_string(),
        ];
        let d = build_opencode_failure_diagnostic(&lines, Some("provider 401"));
        // stderr 可行动行优先于 stdout error，避免重复。
        assert!(d.contains("unauthorized 401"));
    }

    #[test]
    fn failure_diagnostic_uses_stdout_error_when_no_stderr() {
        let d = build_opencode_failure_diagnostic(&[], Some("provider returned 401"));
        assert!(d.contains("provider returned 401"));
        assert!(!d.contains("未捕获到错误输出"));
    }

    #[test]
    fn failure_diagnostic_prefers_stdout_error_over_non_actionable_stderr() {
        // stderr 仅有无关日志时，stdout 的真实 error 事件应优先于 stderr 普通行。
        let lines = vec!["loading plugins".to_string(), "done init".to_string()];
        let d = build_opencode_failure_diagnostic(&lines, Some("provider returned 401"));
        assert!(d.contains("provider returned 401"));
        assert!(!d.contains("done init"));
    }

    #[test]
    fn failure_diagnostic_falls_back_when_silent() {
        let d = build_opencode_failure_diagnostic(&[], None);
        assert!(d.contains("未捕获到错误输出"));
        assert!(d.contains("provider 凭据"));
    }

    #[test]
    fn auto_model_omits_m_flag() {
        assert_eq!(normalize_opencode_model(Some("auto")), None);
        assert_eq!(normalize_opencode_model(Some("DEFAULT")), None);
        assert_eq!(normalize_opencode_model(Some("  ")), None);
        assert_eq!(
            normalize_opencode_model(Some("anthropic/claude-haiku-4-5")).as_deref(),
            Some("anthropic/claude-haiku-4-5")
        );

        let mut cmd = Command::new("opencode");
        configure_opencode_run_command(
            &mut cmd,
            "hello",
            None,
            "/tmp/repo",
            None,
            false,
            true,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(!args.iter().any(|a| a == "-m"));
    }

    #[test]
    fn parses_opencode_models_cli_lines() {
        let items = parse_opencode_models_cli_output(
            "anthropic/claude-sonnet-4\nopenai/gpt-5  GPT-5\nCommands:\nbogus\n",
        );
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "anthropic/claude-sonnet-4");
        assert_eq!(items[1].id, "openai/gpt-5");
        assert_eq!(items[1].display_name, "GPT-5");
    }
}
