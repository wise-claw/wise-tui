//! OpenAI Codex CLI execution (`codex exec`) for Wise main / member sessions.

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use serde::Serialize;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexCompletePayload {
    session_id: String,
    success: bool,
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
    let _ = app.emit("claude-output", line);
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
    let _ = app.emit("claude-complete", &payload);
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-complete:invocation:{}", inv), &payload);
    }
}

#[tauri::command]
pub(crate) async fn execute_codex_code(
    app: tauri::AppHandle,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    tab_session_id: Option<String>,
    trellis_context_id: Option<String>,
) -> Result<(), String> {
    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();
    let session_id = tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("codex-{}", Uuid::new_v4().simple()));

    let mut cmd = Command::new("codex");
    cmd.arg("exec");
    cmd.arg("--skip-git-repo-check");
    if let Some(model_name) = normalize_codex_model(model.as_deref()) {
        cmd.arg("-m").arg(model_name);
    }
    cmd.arg(prompt);
    cmd.current_dir(&project_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if let Some(ctx) = trellis_context_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.env("TRELLIS_CONTEXT_ID", ctx);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start codex: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to get codex stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to get codex stderr".to_string())?;

    let wait_child = Arc::new(TokioMutex::new(Some(child)));
    if let Some(inv) = invocation_key.as_deref().filter(|s| !s.is_empty()) {
        process_state
            .active_child_by_invocation_key
            .lock()
            .await
            .insert(inv.to_string(), wait_child.clone());
    }

    let model_label = normalize_codex_model(model.as_deref()).unwrap_or_else(|| "codex".to_string());
    emit_codex_stdout_line(
        &app,
        &session_id,
        &codex_init_stream_line(&session_id),
        invocation_key.as_deref(),
    );
    registry.register(session_id.clone(), project_path.clone(), model_label);

    let app_stdout = app.clone();
    let session_id_stdout = session_id.clone();
    let invocation_key_stdout = invocation_key.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            emit_codex_stdout_line(
                &app_stdout,
                &session_id_stdout,
                &codex_assistant_stream_line(&line),
                invocation_key_stdout.as_deref(),
            );
        }
    });

    let app_stderr = app.clone();
    let session_id_stderr = session_id.clone();
    let invocation_key_stderr = invocation_key.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let prefixed = format!("[stderr] {}", line);
            emit_codex_stdout_line(
                &app_stderr,
                &session_id_stderr,
                &codex_assistant_stream_line(&prefixed),
                invocation_key_stderr.as_deref(),
            );
        }
    });

    let app_wait = app.clone();
    let registry_wait = registry.inner().clone();
    let session_id_wait = session_id.clone();
    let invocation_key_wait = invocation_key.clone();
    let active_child_by_invocation = process_state.active_child_by_invocation_key.clone();

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

        let success = exit_status.map(|status| status.success()).unwrap_or(false);
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
