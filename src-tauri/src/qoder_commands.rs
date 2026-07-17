//! Qoder CLI execution (`qodercli -p … --output-format=stream-json`) for Wise sessions.

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::qoder_binary::{apply_qoder_child_env, find_qoder_binary, qoder_merged_path_env};
use crate::qoder_stream_adapter::{
    qoder_assistant_stream_line, qoder_init_stream_line, qoder_session_clear_line, QoderStdoutMap,
    QoderStdoutMapper,
};
use serde::Serialize;
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
struct QoderCompletePayload {
    session_id: String,
    success: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QoderModelListItem {
    pub id: String,
    pub display_name: String,
}

const QODER_BUILTIN_TIERS: &[(&str, &str)] = &[
    ("auto", "智能路由（Auto）"),
    ("ultimate", "Ultimate"),
    ("performance", "Performance"),
    ("efficient", "Efficient"),
    ("lite", "Lite"),
];

struct QoderSpawnParams {
    qoder_path: String,
    project_path: String,
    prompt: String,
    exec_model: Option<String>,
    resume_session_id: Option<String>,
    force_new_session: bool,
    path_env: String,
}

#[derive(Clone)]
struct QoderRuntimeContext {
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
    qoder_path: String,
    path_env: String,
}

fn normalize_qoder_model(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "auto" || lower == "default" {
        return None;
    }
    Some(trimmed.to_string())
}

fn normalize_qoder_resume_session_id(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn emit_qoder_stdout_line(app: &AppHandle, sid: &str, line: &str, invocation_key: Option<&str>) {
    if !sid.is_empty() {
        let _ = app.emit(&format!("claude-output:{}", sid), line);
    }
    if invocation_key.is_none() {
        let _ = app.emit("claude-output", line);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-output:invocation:{}", inv), line);
    }
}

fn emit_qoder_complete(app: &AppHandle, sid: &str, success: bool, invocation_key: Option<&str>) {
    let payload = QoderCompletePayload {
        session_id: sid.to_string(),
        success,
    };
    if !sid.is_empty() {
        let _ = app.emit(&format!("claude-complete:{}", sid), &payload);
    }
    if invocation_key.is_none() {
        let _ = app.emit("claude-complete", &payload);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-complete:invocation:{}", inv), &payload);
    }
}

fn configure_qoder_print_command(
    cmd: &mut Command,
    prompt: &str,
    model: Option<&str>,
    project_path: &str,
    resume_session_id: Option<&str>,
    force_new_session: bool,
) {
    // Non-interactive print mode with Claude-compatible stream-json.
    cmd.arg("-p").arg(prompt);
    cmd.arg("--output-format").arg("stream-json");
    // Skip interactive permission prompts in oneshot / automation.
    cmd.arg("--yolo");
    if !project_path.trim().is_empty() {
        cmd.arg("-w").arg(project_path.trim());
    }
    if let Some(model_name) = normalize_qoder_model(model) {
        cmd.arg("--model").arg(model_name);
    }
    if !force_new_session {
        if let Some(resume_id) = resume_session_id {
            cmd.arg("-r").arg(resume_id);
        }
    }
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
        || lower.contains("login")
        || lower.contains("token")
}

fn build_qoder_failure_diagnostic(stderr_lines: &[String], stdout_error: Option<&str>) -> String {
    if let Some(line) = stderr_lines
        .iter()
        .rev()
        .find(|l| stderr_line_is_actionable(l))
    {
        return format!("Qoder CLI 执行失败：{}", line.trim());
    }
    if let Some(msg) = stdout_error.map(str::trim).filter(|s| !s.is_empty()) {
        return format!("Qoder CLI 执行失败：{}", msg);
    }
    if let Some(last) = stderr_lines.iter().rev().find(|l| !l.trim().is_empty()) {
        return format!("Qoder CLI 执行失败：{}", last.trim());
    }
    "Qoder CLI 执行失败（未捕获到错误输出）。请检查登录状态（qodercli /login）、\
网络与 QODER_PERSONAL_ACCESS_TOKEN。"
        .to_string()
}

fn validate_qoder_project_path(project_path: &str) -> Result<(), String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("Qoder CLI 执行需要有效的仓库路径".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err(format!("Qoder CLI 仓库路径不存在或不是目录: {trimmed}"));
    }
    Ok(())
}

fn build_qoder_command(params: &QoderSpawnParams) -> Command {
    let mut cmd = Command::new(&params.qoder_path);
    configure_qoder_print_command(
        &mut cmd,
        params.prompt.trim(),
        params.exec_model.as_deref(),
        &params.project_path,
        params.resume_session_id.as_deref(),
        params.force_new_session,
    );
    cmd.current_dir(&params.project_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    apply_qoder_child_env(&mut cmd, &params.path_env);
    cmd
}

fn spawn_qoder_process(params: &QoderSpawnParams) -> Result<Child, String> {
    build_qoder_command(params)
        .spawn()
        .map_err(|e| format!("Failed to start qodercli: {e}"))
}

fn attach_qoder_child_io(
    ctx: &QoderRuntimeContext,
    mut child: Child,
    wait_child: Arc<TokioMutex<Option<Child>>>,
    used_resume: bool,
    allow_resume_retry: bool,
) -> Result<(), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to get qodercli stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to get qodercli stderr".to_string())?;

    {
        let mut slot = wait_child
            .try_lock()
            .map_err(|_| "Failed to lock qodercli child slot".to_string())?;
        *slot = Some(child);
    }

    let stdout_error_message = Arc::new(TokioMutex::new(None::<String>));
    let app_stdout = ctx.app.clone();
    let session_id_stdout = ctx.session_id.clone();
    let invocation_key_stdout = ctx.invocation_key.clone();
    let stdout_error_writer = stdout_error_message.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut mapper = QoderStdoutMapper::default();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let stream_lines = match mapper.map_line(&line) {
                QoderStdoutMap::PlainText => vec![qoder_assistant_stream_line(&line)],
                QoderStdoutMap::StreamLines(mapped) if mapped.is_empty() => continue,
                QoderStdoutMap::StreamLines(mapped) => mapped,
            };
            if let Some(msg) = mapper.last_error() {
                *stdout_error_writer.lock().await = Some(msg.to_string());
            }
            for stream_line in stream_lines {
                emit_qoder_stdout_line(
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
                emit_qoder_stdout_line(
                    &app_stderr,
                    &session_id_stderr,
                    &qoder_assistant_stream_line(&format!("Qoder CLI: {trimmed}")),
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
    let active_child_by_invocation = ctx.active_child_by_invocation_key.clone();
    let active_child_by_session = ctx.active_child_by_claude_session.clone();
    tokio::spawn(async move {
        let exit_status = {
            let mut slot = wait_child_wait.lock().await;
            match slot.as_mut() {
                Some(child) => child.wait().await.ok(),
                None => None,
            }
        };

        if let Some(inv) = invocation_key_wait.as_deref().filter(|s| !s.is_empty()) {
            active_child_by_invocation.lock().await.remove(inv);
        }
        if !session_id_wait.is_empty() {
            active_child_by_session.lock().await.remove(&session_id_wait);
        }

        let success = exit_status.map(|status| status.success()).unwrap_or(false);
        let stdout_err = stdout_error_reader.lock().await.clone();
        let lines = stderr_lines.lock().await.clone();
        if !success {
            if used_resume
                && allow_resume_retry
                && stderr_suggests_resume_session_missing(&lines)
            {
                emit_qoder_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &qoder_session_clear_line(),
                    invocation_key_wait.as_deref(),
                );
                emit_qoder_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &qoder_assistant_stream_line(
                        "Qoder CLI 续接会话已失效，正在自动以新会话重试…",
                    ),
                    invocation_key_wait.as_deref(),
                );
                let retry_params = QoderSpawnParams {
                    qoder_path: runtime_wait.qoder_path.clone(),
                    project_path: runtime_wait.project_path.clone(),
                    prompt: runtime_wait.prompt.clone(),
                    exec_model: runtime_wait.exec_model.clone(),
                    resume_session_id: None,
                    force_new_session: true,
                    path_env: runtime_wait.path_env.clone(),
                };
                match spawn_qoder_process(&retry_params) {
                    Ok(child) => {
                        let retry_wait_child = Arc::new(TokioMutex::new(None));
                        if let Some(inv) =
                            invocation_key_wait.as_deref().filter(|s| !s.is_empty())
                        {
                            active_child_by_invocation
                                .lock()
                                .await
                                .insert(inv.to_string(), retry_wait_child.clone());
                        }
                        if !session_id_wait.is_empty() {
                            active_child_by_session
                                .lock()
                                .await
                                .insert(session_id_wait.clone(), retry_wait_child.clone());
                        }
                        if attach_qoder_child_io(
                            &runtime_wait,
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
                        emit_qoder_stdout_line(
                            &app_wait,
                            &session_id_wait,
                            &qoder_assistant_stream_line(&format!(
                                "Qoder CLI 自动重试失败：{retry_err}"
                            )),
                            invocation_key_wait.as_deref(),
                        );
                    }
                }
            } else {
                let diagnostic =
                    build_qoder_failure_diagnostic(&lines, stdout_err.as_deref());
                emit_qoder_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &qoder_assistant_stream_line(&diagnostic),
                    invocation_key_wait.as_deref(),
                );
            }
        }

        registry_wait.mark_completed(&session_id_wait, success);
        emit_qoder_complete(
            &app_wait,
            &session_id_wait,
            success,
            invocation_key_wait.as_deref(),
        );
    });

    Ok(())
}

#[tauri::command]
pub(crate) async fn execute_qoder_code(
    app: tauri::AppHandle,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    tab_session_id: Option<String>,
    qoder_resume_session_id: Option<String>,
    force_new_session: Option<bool>,
) -> Result<(), String> {
    let exec_model = normalize_qoder_model(model.as_deref());

    validate_qoder_project_path(&project_path)?;

    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Qoder CLI 执行需要非空提示词".to_string());
    }

    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();
    let session_id = tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("qoder-{}", Uuid::new_v4().simple()));

    let qoder_path = find_qoder_binary()?;
    let resume_id = normalize_qoder_resume_session_id(qoder_resume_session_id.as_deref());
    let force_new = force_new_session.unwrap_or(false);
    let used_resume = !force_new && resume_id.is_some();
    let path_env = qoder_merged_path_env();
    let spawn_params = QoderSpawnParams {
        qoder_path,
        project_path: project_path.clone(),
        prompt: trimmed_prompt.to_string(),
        exec_model: exec_model.clone(),
        resume_session_id: resume_id.clone(),
        force_new_session: force_new,
        path_env,
    };

    let child = spawn_qoder_process(&spawn_params)?;
    let wait_child = Arc::new(TokioMutex::new(None));

    let model_label = exec_model.as_deref().unwrap_or("qoder").to_string();
    let runtime = QoderRuntimeContext {
        app: app.clone(),
        session_id,
        invocation_key: invocation_key.clone(),
        project_path,
        prompt: trimmed_prompt.to_string(),
        exec_model,
        registry: registry.inner().clone(),
        active_child_by_invocation_key: process_state.active_child_by_invocation_key.clone(),
        active_child_by_claude_session: process_state.active_child_by_claude_session.clone(),
        qoder_path: spawn_params.qoder_path.clone(),
        path_env: spawn_params.path_env.clone(),
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

    emit_qoder_stdout_line(
        &app,
        &runtime.session_id,
        &qoder_init_stream_line(&runtime.session_id),
        invocation_key.as_deref(),
    );
    registry.register(
        runtime.session_id.clone(),
        runtime.project_path.clone(),
        model_label,
    );

    attach_qoder_child_io(&runtime, child, wait_child, used_resume, true)?;
    Ok(())
}

fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(ch) = chars.next() {
                    if ch.is_ascii_alphabetic() {
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

fn parse_qoder_models_cli_output(stdout: &str) -> Vec<QoderModelListItem> {
    let cleaned = strip_ansi_codes(stdout);
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for line in cleaned.lines() {
        let t = line.trim();
        if t.is_empty()
            || t.starts_with("Error")
            || t.starts_with("Not logged")
            || t.starts_with("Unknown")
            || t.starts_with("Commands:")
            || t.starts_with("Options:")
        {
            continue;
        }
        let mut parts = t.split_whitespace();
        let Some(id) = parts.next() else {
            continue;
        };
        if id.starts_with('-') || id.starts_with('┌') || id.starts_with('│') {
            continue;
        }
        if id.len() < 2 {
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
        out.push(QoderModelListItem {
            id: id.to_string(),
            display_name,
        });
    }
    out
}

async fn try_list_qoder_models_via_cli() -> Vec<QoderModelListItem> {
    let Ok(bin) = find_qoder_binary() else {
        return Vec::new();
    };
    let path_env = qoder_merged_path_env();
    let mut cmd = Command::new(&bin);
    apply_qoder_child_env(&mut cmd, &path_env);
    cmd.arg("--list-models");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let Ok(output) = timeout(Duration::from_secs(4), cmd.output()).await else {
        return Vec::new();
    };
    let Ok(output) = output else {
        return Vec::new();
    };
    let mut items = parse_qoder_models_cli_output(&String::from_utf8_lossy(&output.stdout));
    if items.is_empty() {
        items = parse_qoder_models_cli_output(&String::from_utf8_lossy(&output.stderr));
    }
    items
}

/// 列出 Qoder 可选模型：内置档位 + `qodercli --list-models` 补充。
#[tauri::command]
pub async fn qoder_list_models() -> Result<Vec<QoderModelListItem>, String> {
    let mut out = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for (id, display_name) in QODER_BUILTIN_TIERS {
        if seen.insert((*id).to_string()) {
            out.push(QoderModelListItem {
                id: (*id).to_string(),
                display_name: (*display_name).to_string(),
            });
        }
    }
    for item in try_list_qoder_models_via_cli().await {
        if seen.insert(item.id.clone()) {
            out.push(item);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_model_skips_auto() {
        assert_eq!(normalize_qoder_model(Some("auto")), None);
        assert_eq!(
            normalize_qoder_model(Some("efficient")),
            Some("efficient".to_string())
        );
    }

    #[test]
    fn resume_id_trim() {
        assert_eq!(
            normalize_qoder_resume_session_id(Some("  abc  ")),
            Some("abc".to_string())
        );
        assert_eq!(normalize_qoder_resume_session_id(Some("   ")), None);
    }

    #[test]
    fn parse_list_models_lines() {
        let raw = "auto\nefficient  Efficient\nQwen3.7-Max  Qwen Max\n";
        let items = parse_qoder_models_cli_output(raw);
        assert!(items.iter().any(|i| i.id == "efficient"));
        assert!(items.iter().any(|i| i.id == "Qwen3.7-Max"));
    }
}
