//! OpenAI Codex CLI execution (`codex exec`) for Wise main / member sessions.

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
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

fn normalize_codex_model(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn codex_binary_candidates() -> Vec<String> {
    let out: Vec<String> = crate::claude_commands::claude_path_search_prefixes()
        .into_iter()
        .map(|dir| {
            #[cfg(windows)]
            {
                dir.join("codex.cmd").to_string_lossy().to_string()
            }
            #[cfg(not(windows))]
            {
                dir.join("codex").to_string_lossy().to_string()
            }
        })
        .collect();

    #[cfg(windows)]
    {
        let mut out = out;
        out.extend(
            crate::claude_commands::claude_path_search_prefixes()
                .into_iter()
                .map(|dir| dir.join("codex.exe").to_string_lossy().to_string()),
        );
        out
    }

    #[cfg(not(windows))]
    {
        out
    }
}

#[cfg(unix)]
fn try_codex_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v codex"]),
        ("/bin/bash", vec!["-lc", "command -v codex"]),
    ] {
        let output = std::process::Command::new(shell)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !p.is_empty() && Path::new(&p).is_file() {
            return Some(p);
        }
    }
    None
}

fn find_codex_binary() -> Result<String, String> {
    for candidate in codex_binary_candidates() {
        if Path::new(&candidate).is_file() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    {
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("where")
            .arg("codex")
            .env("PATH", &path_merged)
            .output()
        {
            if output.status.success() {
                let line = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !line.is_empty() && Path::new(&line).exists() {
                    return Ok(line);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("which")
            .arg("codex")
            .env("PATH", &path_merged)
            .output()
        {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() && Path::new(&p).is_file() {
                    return Ok(p);
                }
            }
        }
        if let Some(p) = try_codex_from_login_shell() {
            return Ok(p);
        }
    }

    Err(
        "未找到 codex 可执行文件。请确认已安装 codex，并确保其位于 PATH，或安装在 /opt/homebrew/bin、/usr/local/bin、以及 nvm/fnm 的 node 版本 bin 目录下。"
            .to_string(),
    )
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

    let codex_path = find_codex_binary()?;
    let mut cmd = Command::new(&codex_path);
    cmd.arg("exec");
    cmd.arg("--skip-git-repo-check");
    cmd.arg("-s").arg(WISE_CODEX_EXEC_SANDBOX);
    if let Some(model_name) = normalize_codex_model(model.as_deref()) {
        cmd.arg("-m").arg(model_name);
    }
    cmd.arg(prompt);
    cmd.current_dir(&project_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.env(
        "PATH",
        crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes()),
    );

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
    if !session_id.is_empty() {
        process_state
            .active_child_by_claude_session
            .lock()
            .await
            .insert(session_id.clone(), wait_child.clone());
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

    let stderr_lines = Arc::new(TokioMutex::new(Vec::<String>::new()));
    let stderr_lines_reader = stderr_lines.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            stderr_lines_reader.lock().await.push(line);
        }
    });

    let app_wait = app.clone();
    let registry_wait = registry.inner().clone();
    let session_id_wait = session_id.clone();
    let invocation_key_wait = invocation_key.clone();
    let active_child_by_invocation = process_state.active_child_by_invocation_key.clone();
    let active_child_by_session = process_state.active_child_by_claude_session.clone();
    let stderr_lines_wait = stderr_lines.clone();

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
        if !success {
            let lines = stderr_lines_wait.lock().await;
            if let Some(last_line) = lines.iter().rev().find(|line| !line.trim().is_empty()) {
                let diagnostic = format!("Codex 执行失败：{}", last_line.trim());
                emit_codex_stdout_line(
                    &app_wait,
                    &session_id_wait,
                    &codex_assistant_stream_line(&diagnostic),
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
