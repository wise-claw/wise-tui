//! OpenAI Codex CLI execution (`codex exec`) for Wise main / member sessions.

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::claude_model_profiles::ensure_active_codex_profile_applied;
use crate::codex_binary::{apply_codex_child_env, codex_merged_path_env, find_codex_binary};
use crate::codex_stream_adapter::{map_codex_exec_stdout_line, CodexStdoutMap};
use crate::wise_db::WiseDb;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

/// Codex `exec` defaults to read-only; Wise main/member chat needs repo edits in the session workdir.
const WISE_CODEX_EXEC_SANDBOX: &str = "workspace-write";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexCompletePayload {
    session_id: String,
    success: bool,
}

struct CodexSpawnParams {
    codex_path: String,
    project_path: String,
    prompt: String,
    exec_model: Option<String>,
    resume_session_id: Option<String>,
    force_new_session: bool,
    path_env: String,
    spawn_env_overrides: Option<(String, String)>,
}

#[derive(Clone)]
struct CodexRuntimeContext {
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
    codex_path: String,
    path_env: String,
    spawn_env_overrides: Option<(String, String)>,
}

fn normalize_codex_model(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn codex_assistant_stream_line(text: &str) -> String {
    serde_json::json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": text }]
        }
    })
    .to_string()
}

fn codex_session_clear_stream_line() -> String {
    serde_json::json!({
        "type": "codex_session",
        "sessionId": "",
    })
    .to_string()
}

fn codex_init_stream_line(session_id: &str) -> String {
    serde_json::json!({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
    })
    .to_string()
}

fn emit_codex_stdout_line(app: &AppHandle, sid: &str, line: &str, invocation_key: Option<&str>) {
    if !sid.is_empty() {
        let _ = app.emit(&format!("claude-output:{}", sid), line);
    }
    // 带 invocation_key（前端定向监听已建立）时抑制全局通道，避免多屏并行被全局 handleOutput 的单值兜底路由串屏。
    // 与 claude emit_claude_stdout_line 的 suppress_shared_stdout 语义一致。
    if invocation_key.is_none() {
        let _ = app.emit("claude-output", line);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-output:invocation:{}", inv), line);
    }
}

fn emit_codex_complete(app: &AppHandle, sid: &str, success: bool, invocation_key: Option<&str>) {
    let payload = CodexCompletePayload {
        session_id: sid.to_string(),
        success,
    };
    if !sid.is_empty() {
        let _ = app.emit(&format!("claude-complete:{}", sid), &payload);
    }
    // 同 emit_codex_stdout_line：带 invocation_key 时抑制全局通道。
    if invocation_key.is_none() {
        let _ = app.emit("claude-complete", &payload);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-complete:invocation:{}", inv), &payload);
    }
}

fn normalize_codex_resume_session_id(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn append_codex_exec_shared_args(cmd: &mut Command, model: Option<&str>) {
    cmd.arg("--json");
    cmd.arg("--skip-git-repo-check");
    if let Some(model_name) = normalize_codex_model(model) {
        cmd.arg("-m").arg(model_name);
    }
}

/// `codex exec [OPTIONS] [PROMPT]` — supports sandbox + color flags.
fn append_codex_exec_fresh_args(cmd: &mut Command, model: Option<&str>, project_path: &str) {
    cmd.arg("--color").arg("never");
    append_codex_exec_shared_args(cmd, model);
    cmd.arg("-s").arg(WISE_CODEX_EXEC_SANDBOX);
    if !project_path.trim().is_empty() {
        cmd.arg("-C").arg(project_path.trim());
    }
}

/// `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` — options must precede id/prompt; no `-s`/`--color`.
fn append_codex_exec_resume_args(cmd: &mut Command, model: Option<&str>) {
    append_codex_exec_shared_args(cmd, model);
}

fn configure_codex_exec_command(
    cmd: &mut Command,
    prompt: &str,
    model: Option<&str>,
    project_path: &str,
    resume_session_id: Option<&str>,
    force_new_session: bool,
) {
    cmd.arg("exec");
    if !force_new_session {
        if let Some(resume_id) = resume_session_id {
            cmd.arg("resume");
            append_codex_exec_resume_args(cmd, model);
            cmd.arg(resume_id);
            cmd.arg(prompt);
            return;
        }
    }
    append_codex_exec_fresh_args(cmd, model, project_path);
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
        || lower.contains("legacy")
        || lower.contains("not found")
        || lower.contains("panic")
        || lower.contains("denied")
        || lower.contains("usage limit")
        || lower.contains("rate limit")
        || lower.contains("401")
        || lower.contains("403")
        || lower.contains("429")
        || lower.contains("config")
        || lower.contains("api key")
        || lower.contains("apikey")
}

/// 判定一行 codex 输出是否为可忽略的内部噪音（非用户可行动错误）。
///
/// codex 会在 stdout/stderr 混入两类干扰：
/// 1. `codex_core::util: ... without active item` —— 某些模型 provider 的流式事件顺序
///    与 codex 内部预期不符时打出的追踪日志，会随每个 delta 反复刷屏，但不影响最终结果。
/// 2. `Model metadata for <model> not found. Defaulting to fallback metadata` —— codex
///    未识别该模型元数据，回退后仍可运行，属一次性非致命警告。
/// 两者既不该作为正文展示，也不该计入失败诊断（避免遮蔽真实错误），统一过滤。
fn codex_line_is_benign_noise(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.contains("without active item") || lower.contains("defaulting to fallback metadata")
}

fn validate_codex_project_path(project_path: &str) -> Result<(), String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("Codex 执行需要有效的仓库路径".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_dir() {
        return Err(format!("Codex 仓库路径不存在或不是目录: {trimmed}"));
    }
    Ok(())
}

fn build_codex_command(params: &CodexSpawnParams) -> Command {
    let mut cmd = Command::new(&params.codex_path);
    configure_codex_exec_command(
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
    apply_codex_child_env(&mut cmd, &params.path_env);
    if let Some((api_key, base_url)) = params.spawn_env_overrides.as_ref() {
        cmd.env("OPENAI_API_KEY", api_key);
        cmd.env("OPENAI_BASE_URL", base_url);
    }
    cmd
}

fn spawn_codex_process(params: &CodexSpawnParams) -> Result<Child, String> {
    build_codex_command(params)
        .spawn()
        .map_err(|e| format!("Failed to start codex: {e}"))
}

fn attach_codex_child_io(
    ctx: &CodexRuntimeContext,
    mut child: Child,
    wait_child: Arc<TokioMutex<Option<Child>>>,
    used_resume: bool,
    allow_resume_retry: bool,
) -> Result<(), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to get codex stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to get codex stderr".to_string())?;

    {
        let mut slot = wait_child
            .try_lock()
            .map_err(|_| "Failed to lock codex child slot".to_string())?;
        *slot = Some(child);
    }

    // 捕获 stdout JSON 错误事件中的真实消息，供进程退出后的等待任务复用，
    // 避免在 stdout 已吐出真实错误的情况下仍回退成「无 stderr 输出」的兜底。
    let stdout_error_message = Arc::new(TokioMutex::new(None::<String>));
    let app_stdout = ctx.app.clone();
    let session_id_stdout = ctx.session_id.clone();
    let invocation_key_stdout = ctx.invocation_key.clone();
    let stdout_error_writer = stdout_error_message.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            // 在传给 mapper 之前先尝试从 JSON error 事件中提取错误文本，
            // 确保等待任务能拿到 stdout 上的真实错误消息。
            capture_codex_stdout_error(&line, &stdout_error_writer).await;
            let stream_lines = match map_codex_exec_stdout_line(&line) {
                CodexStdoutMap::PlainText => {
                    // codex 会把非 JSON 的内部日志/警告（如模型元数据回退）混入 stdout，
                    // 它们不是模型回复，跳过避免当成正文展示。
                    if codex_line_is_benign_noise(&line) {
                        continue;
                    }
                    vec![codex_assistant_stream_line(&line)]
                }
                CodexStdoutMap::StreamLines(mapped) if mapped.is_empty() => continue,
                CodexStdoutMap::StreamLines(mapped) => mapped,
            };
            for stream_line in stream_lines {
                emit_codex_stdout_line(
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
            if line.trim().is_empty() {
                continue;
            }
            // codex_core 的流式追踪噪音（如 "without active item"）会随每个 delta 反复刷屏，
            // 既不展示也不计入失败诊断，避免遮蔽真实错误。
            if codex_line_is_benign_noise(&line) {
                continue;
            }
            stderr_lines_reader.lock().await.push(line.clone());
            if stderr_line_is_actionable(&line) {
                emit_codex_stdout_line(
                    &app_stderr,
                    &session_id_stderr,
                    &codex_assistant_stream_line(&format!("Codex: {}", line.trim())),
                    invocation_key_stderr.as_deref(),
                );
            }
        }
    });

    let app_wait = ctx.app.clone();
    let registry_wait = ctx.registry.clone();
    let session_id_wait = ctx.session_id.clone();
    let invocation_key_wait = ctx.invocation_key.clone();
    let active_child_by_invocation = ctx.active_child_by_invocation_key.clone();
    let active_child_by_session = ctx.active_child_by_claude_session.clone();
    let stderr_lines_wait = stderr_lines.clone();
    let stdout_error_reader = stdout_error_message.clone();
    let used_resume_wait = used_resume;
    let retry_ctx = if allow_resume_retry && used_resume {
        Some(ctx.clone())
    } else {
        None
    };

    tokio::spawn(async move {
        let exit_status = {
            let mut slot = wait_child.lock().await;
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
        let lines = stderr_lines_wait.lock().await.clone();
        let stdout_err = stdout_error_reader.lock().await.clone();
        if !success {
            if used_resume_wait
                && allow_resume_retry
                && stderr_suggests_resume_session_missing(lines.as_slice())
            {
                if let Some(runtime) = retry_ctx {
                    let spawn = CodexSpawnParams {
                        codex_path: runtime.codex_path.clone(),
                        project_path: runtime.project_path.clone(),
                        prompt: runtime.prompt.clone(),
                        exec_model: runtime.exec_model.clone(),
                        resume_session_id: None,
                        force_new_session: true,
                        path_env: runtime.path_env.clone(),
                        spawn_env_overrides: runtime.spawn_env_overrides.clone(),
                    };
                    emit_codex_stdout_line(
                        &app_wait,
                        &session_id_wait,
                        &codex_session_clear_stream_line(),
                        invocation_key_wait.as_deref(),
                    );
                    emit_codex_stdout_line(
                        &app_wait,
                        &session_id_wait,
                        &codex_assistant_stream_line(
                            "Codex 续接会话已失效，正在自动以新会话重试…",
                        ),
                        invocation_key_wait.as_deref(),
                    );
                    match spawn_codex_process(&spawn) {
                        Ok(child) => {
                            let retry_runtime = runtime.clone();
                            let retry_wait_child = Arc::new(TokioMutex::new(None));
                            if let Some(inv) = invocation_key_wait.as_deref().filter(|s| !s.is_empty())
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
                            if attach_codex_child_io(
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
                            emit_codex_stdout_line(
                                &app_wait,
                                &session_id_wait,
                                &codex_assistant_stream_line(&format!(
                                    "Codex 自动重试失败：{retry_err}"
                                )),
                                invocation_key_wait.as_deref(),
                            );
                        }
                    }
                } else {
                    emit_codex_stdout_line(
                        &app_wait,
                        &session_id_wait,
                        &codex_session_clear_stream_line(),
                        invocation_key_wait.as_deref(),
                    );
                    let diagnostic =
                        "Codex 会话已失效，已清除续接 id；请重试，必要时简要说明上一轮背景。";
                    emit_codex_stdout_line(
                        &app_wait,
                        &session_id_wait,
                        &codex_assistant_stream_line(diagnostic),
                        invocation_key_wait.as_deref(),
                    );
                }
            } else if let Some(msg) = stdout_err.as_ref().map(String::as_str).filter(|s| !s.trim().is_empty()) {
                let diagnostic = format!("Codex 执行失败：{}", msg.trim());
                emit_codex_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &codex_assistant_stream_line(&diagnostic),
                    invocation_key_wait.as_deref(),
                );
            } else if let Some(last_line) = lines.iter().rev().find(|line| !line.trim().is_empty())
            {
                let diagnostic = format!("Codex 执行失败：{}", last_line.trim());
                emit_codex_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &codex_assistant_stream_line(&diagnostic),
                    invocation_key_wait.as_deref(),
                );
            } else {
                emit_codex_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &codex_assistant_stream_line(
                        "Codex 执行失败（无 stderr 输出）。请检查 API Key、模型配置与网络连接。",
                    ),
                    invocation_key_wait.as_deref(),
                );
            }
        }

        registry_wait.mark_completed(&session_id_wait, success);
        emit_codex_complete(
            &app_wait,
            &session_id_wait,
            success,
            invocation_key_wait.as_deref(),
        );
    });

    Ok(())
}

#[tauri::command]
pub(crate) async fn execute_codex_code(
    app: tauri::AppHandle,
    db: tauri::State<'_, WiseDb>,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    tab_session_id: Option<String>,
    codex_resume_session_id: Option<String>,
    force_new_session: Option<bool>,
) -> Result<(), String> {
    let proxy_model = crate::opencode_go_proxy::apply_codex_bridge_for_spawn(&db)?;
    let use_wise_bridge = proxy_model.is_some();
    if !use_wise_bridge {
        ensure_active_codex_profile_applied(&db)?;
    }
    let exec_model = proxy_model.or_else(|| normalize_codex_model(model.as_deref()));

    validate_codex_project_path(&project_path)?;

    let trimmed_prompt = prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Codex 执行需要非空提示词".to_string());
    }

    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();
    let session_id = tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("codex-{}", Uuid::new_v4().simple()));

    let codex_path = find_codex_binary()?;
    let resume_id = normalize_codex_resume_session_id(codex_resume_session_id.as_deref());
    let force_new = force_new_session.unwrap_or(false);
    let used_resume = !force_new && resume_id.is_some();
    let path_env = codex_merged_path_env();
    let spawn_env_overrides = crate::opencode_go_proxy::codex_spawn_env_overrides(&db);
    let spawn_params = CodexSpawnParams {
        codex_path,
        project_path: project_path.clone(),
        prompt: trimmed_prompt.to_string(),
        exec_model: exec_model.clone(),
        resume_session_id: resume_id.clone(),
        force_new_session: force_new,
        path_env,
        spawn_env_overrides,
    };

    let child = spawn_codex_process(&spawn_params)?;
    let wait_child = Arc::new(TokioMutex::new(None));

    let model_label = exec_model.as_deref().unwrap_or("codex").to_string();
    let runtime = CodexRuntimeContext {
        app: app.clone(),
        session_id,
        invocation_key: invocation_key.clone(),
        project_path,
        prompt: trimmed_prompt.to_string(),
        exec_model,
        registry: registry.inner().clone(),
        active_child_by_invocation_key: process_state.active_child_by_invocation_key.clone(),
        active_child_by_claude_session: process_state.active_child_by_claude_session.clone(),
        codex_path: spawn_params.codex_path.clone(),
        path_env: spawn_params.path_env.clone(),
        spawn_env_overrides: spawn_params.spawn_env_overrides.clone(),
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

    emit_codex_stdout_line(
        &app,
        &runtime.session_id,
        &codex_init_stream_line(&runtime.session_id),
        invocation_key.as_deref(),
    );
    registry.register(
        runtime.session_id.clone(),
        runtime.project_path.clone(),
        model_label,
    );

    attach_codex_child_io(&runtime, child, wait_child, used_resume, true)?;
    Ok(())
}

/// 从 stdout 行中提前捕获 JSON error 事件的错误文本，供等待任务产出失败诊断。
///
/// Codex `exec --json` 的 error / turn.failed 等事件经 stdout JSONL 输出，
/// 但等待任务只持有 stderr 收集结果，不持有 stdout 映射后的状态。此函数在
/// stdout 逐行处理时并行捕获错误文本，通过 Arc<Mutex> 传递给等待任务，
/// 确保进程非零退出时诊断能取到 stdout 上的真实错误。
async fn capture_codex_stdout_error(
    line: &str,
    stdout_error_writer: &Arc<TokioMutex<Option<String>>>,
) {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
        return;
    };
    let Some(obj) = value.as_object() else {
        return;
    };
    let Some(event_type) = obj.get("type").and_then(serde_json::Value::as_str) else {
        return;
    };
    if event_type != "error" && !event_type.starts_with("turn.") {
        return;
    }
    if let Some(text) = crate::codex_stream_adapter::extract_codex_error_text_pub(&value) {
        if !text.trim().is_empty() {
            *stdout_error_writer.lock().await = Some(text);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_exec_argv_order() {
        let mut cmd = Command::new("codex");
        configure_codex_exec_command(
            &mut cmd,
            "hello",
            Some("gpt-5"),
            "/tmp/repo",
            None,
            false,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "exec".to_string(),
                "--color".to_string(),
                "never".to_string(),
                "--json".to_string(),
                "--skip-git-repo-check".to_string(),
                "-m".to_string(),
                "gpt-5".to_string(),
                "-s".to_string(),
                WISE_CODEX_EXEC_SANDBOX.to_string(),
                "-C".to_string(),
                "/tmp/repo".to_string(),
                "hello".to_string(),
            ]
        );
    }

    #[test]
    fn resume_exec_argv_order() {
        let mut cmd = Command::new("codex");
        configure_codex_exec_command(
            &mut cmd,
            "continue",
            None,
            "/tmp/repo",
            Some("0199a213-81c0-7800-8aa1-bbab2a035a53"),
            false,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "exec".to_string(),
                "resume".to_string(),
                "--json".to_string(),
                "--skip-git-repo-check".to_string(),
                "0199a213-81c0-7800-8aa1-bbab2a035a53".to_string(),
                "continue".to_string(),
            ]
        );
    }

    #[test]
    fn force_new_skips_resume() {
        let mut cmd = Command::new("codex");
        configure_codex_exec_command(
            &mut cmd,
            "fresh",
            None,
            "/tmp/repo",
            Some("0199a213-81c0-7800-8aa1-bbab2a035a53"),
            true,
        );
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .skip(1)
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert!(!args.contains(&"resume".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("fresh"));
    }

    #[test]
    fn stderr_resume_missing_detection() {
        assert!(stderr_suggests_resume_session_missing(&[
            "session not found".to_string()
        ]));
        assert!(stderr_suggests_resume_session_missing(&[
            "会话不存在".to_string()
        ]));
    }

    #[test]
    fn benign_noise_filtered_from_codex_output() {
        // codex_core 流式追踪噪音：随每个 delta 反复刷屏，但不影响结果。
        assert!(codex_line_is_benign_noise(
            "2026-06-21T23:41:58.897639Z ERROR codex_core::util: ReasoningSummaryPartAdded without active item"
        ));
        assert!(codex_line_is_benign_noise(
            "2026-06-21T23:42:00.941926Z ERROR codex_core::util: OutputTextDelta without active item"
        ));
        // 模型元数据回退警告：codex 未识别该模型，回退后仍可运行，非致命。
        assert!(codex_line_is_benign_noise(
            "Model metadata for minimax-m3 not found. Defaulting to fallback metadata; this can degrade performance and cause issues."
        ));
    }

    #[test]
    fn real_errors_not_mistaken_for_benign_noise() {
        // 真实错误与续接失效信号不应被 benign 过滤吞掉。
        assert!(!codex_line_is_benign_noise("Error: unauthorized 401"));
        assert!(!codex_line_is_benign_noise("session not found"));
        assert!(!codex_line_is_benign_noise("API key invalid"));
    }
}
