//! Cursor Agent CLI execution for Wise.
//!
//! Spawns the `agent` CLI (`agent -p --output-format stream-json`) and stores
//! optional `CURSOR_API_KEY` in SQLite. Auth may also come from `agent login`.

use crate::cursor_binary::{
    apply_cursor_child_env, cursor_merged_path_env, find_cursor_agent_binary,
};
use crate::cursor_disk::{
    append_cursor_session_line, build_cursor_user_turn_line, load_cursor_session_jsonl,
};
use crate::cursor_stream_adapter::{map_cursor_cli_stdout_line, CursorCliStdoutMap};

use crate::agent_registry::{Probe, ProbeResult};
use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::wise_db;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

pub const CURSOR_API_KEY_SETTING: &str = "cursor_sdk.api_key";
const CLI_ONESHOT_TIMEOUT: Duration = Duration::from_secs(60);
/// Single-turn execute wait; kill child and emit complete on timeout.
const CURSOR_EXECUTE_TIMEOUT: Duration = Duration::from_secs(900);

const WISE_CURSOR_CLI_PREAMBLE: &str = "[Wise Cursor CLI] 你在本地 Cursor Agent CLI 模式运行，工作区为当前仓库。请直接使用文件读写与 shell 工具修改代码；禁止无必要地委派子代理。\n\n";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorCompletePayload {
    session_id: String,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor_agent_id: Option<String>,
}

fn cursor_assistant_stream_line(text: &str) -> String {
    serde_json::json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": text }]
        }
    })
    .to_string()
}

fn cursor_agent_bind_line(agent_id: &str) -> String {
    serde_json::json!({
        "type": "cursor_agent",
        "agentId": agent_id,
    })
    .to_string()
}

fn emit_cursor_stdout_line(
    app: &AppHandle,
    sid: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
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

fn emit_cursor_complete(
    app: &AppHandle,
    sid: &str,
    success: bool,
    cursor_agent_id: Option<&str>,
    invocation_key: Option<&str>,
) {
    let payload = CursorCompletePayload {
        session_id: sid.to_string(),
        success,
        cursor_agent_id: cursor_agent_id.map(str::to_string),
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAgentStatus {
    pub available: bool,
    pub cli_available: bool,
    pub api_key_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authenticated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

pub fn load_cursor_api_key(db: &Mutex<Connection>) -> Option<String> {
    let from_db = db
        .lock()
        .ok()
        .and_then(|conn| {
            conn.prepare("SELECT value FROM app_settings WHERE key = ?1")
                .ok()?
                .query_row(params![CURSOR_API_KEY_SETTING], |row| row.get::<_, String>(0))
                .ok()
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if from_db.is_some() {
        return from_db;
    }
    std::env::var("CURSOR_API_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn save_cursor_api_key(db: &Mutex<Connection>, api_key: &str) -> Result<(), String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err("Cursor API Key 不能为空".to_string());
    }
    let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![CURSOR_API_KEY_SETTING, trimmed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_cursor_api_key(db: &Mutex<Connection>) -> Result<(), String> {
    let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute(
        "DELETE FROM app_settings WHERE key = ?1",
        rusqlite::params![CURSOR_API_KEY_SETTING],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn with_cursor_cli_preamble(prompt: &str) -> String {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return WISE_CURSOR_CLI_PREAMBLE.trim().to_string();
    }
    if trimmed.starts_with("[Wise Cursor CLI]") || trimmed.starts_with("[Wise Cursor SDK]") {
        return trimmed.to_string();
    }
    format!("{WISE_CURSOR_CLI_PREAMBLE}{trimmed}")
}

fn append_attachment_hints(prompt: &str, attachments: &[(String, String)]) -> String {
    if attachments.is_empty() {
        return prompt.to_string();
    }
    let mut out = String::from(prompt);
    out.push_str("\n\n[附件]\n");
    for (path, mime) in attachments {
        out.push_str(&format!("- {path} ({mime})\n"));
    }
    out.push_str("请结合上述本地附件路径理解用户意图。\n");
    out
}

fn normalize_cli_model(raw: Option<&str>) -> Option<String> {
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

fn build_cursor_cli_command(
    agent_path: &str,
    project_path: &str,
    prompt: &str,
    model: Option<&str>,
    resume_session_id: Option<&str>,
    api_key: Option<&str>,
) -> Command {
    let path_env = cursor_merged_path_env();
    let mut cmd = Command::new(agent_path);
    apply_cursor_child_env(&mut cmd, &path_env);
    cmd.current_dir(project_path);
    cmd.arg("-p");
    cmd.arg("--force");
    cmd.arg("--sandbox");
    cmd.arg("disabled");
    cmd.arg("--approve-mcps");
    cmd.arg("--output-format");
    cmd.arg("stream-json");
    cmd.arg("--stream-partial-output");
    cmd.arg("--workspace");
    cmd.arg(project_path);
    if let Some(model_id) = normalize_cli_model(model) {
        cmd.arg("--model");
        cmd.arg(model_id);
    }
    if let Some(resume) = resume_session_id.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--resume");
        cmd.arg(resume);
    }
    if let Some(key) = api_key.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.env("CURSOR_API_KEY", key);
    }
    cmd.arg(prompt);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd
}

async fn run_cursor_cli_capture(
    args: &[&str],
    api_key: Option<&str>,
    cwd: Option<&str>,
) -> Result<(i32, String, String), String> {
    let agent = find_cursor_agent_binary()?;
    let path_env = cursor_merged_path_env();
    let mut cmd = Command::new(&agent);
    apply_cursor_child_env(&mut cmd, &path_env);
    for arg in args {
        cmd.arg(arg);
    }
    if let Some(key) = api_key.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.env("CURSOR_API_KEY", key);
    }
    if let Some(dir) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = timeout(CLI_ONESHOT_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("Cursor CLI 超时（>{CLI_ONESHOT_TIMEOUT:?}）"))?
        .map_err(|e| format!("无法启动 Cursor CLI: {e}"))?;

    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((code, stdout, stderr))
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
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

fn parse_cli_version(about_stdout: &str) -> Option<String> {
    let cleaned = strip_ansi(about_stdout);
    for line in cleaned.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("CLI Version") {
            let v = rest.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

pub async fn probe_cursor_registry(_db: &Mutex<Connection>, _probe: &dyn Probe) -> ProbeResult {
    match find_cursor_agent_binary() {
        Ok(path) => ProbeResult {
            ok: true,
            error: None,
            resolved_path: Some(path),
            version: None,
        },
        Err(error) => ProbeResult {
            ok: false,
            error: Some(error),
            resolved_path: None,
            version: None,
        },
    }
}

pub async fn build_cursor_agent_status(
    _app: &AppHandle,
    db: &Mutex<Connection>,
    _probe: &dyn Probe,
    _repository_path: Option<&str>,
) -> Result<CursorAgentStatus, String> {
    let api_key = load_cursor_api_key(db);
    let api_key_configured = api_key.is_some();

    let cli_path = match find_cursor_agent_binary() {
        Ok(path) => path,
        Err(error) => {
            return Ok(CursorAgentStatus {
                available: false,
                cli_available: false,
                api_key_configured,
                authenticated: None,
                cli_version: None,
                cli_path: None,
                failure_reason: Some(error),
            });
        }
    };

    let mut failure_reason = None;
    let mut authenticated: Option<bool>;
    let mut cli_version = None;

    match run_cursor_cli_capture(&["about"], api_key.as_deref(), None).await {
        Ok((_code, stdout, _stderr)) => {
            cli_version = parse_cli_version(&stdout);
            let cleaned = strip_ansi(&stdout).to_ascii_lowercase();
            // about 含 "User Email … Not logged in" → 未登录。
            let about_logged_in = !cleaned.contains("not logged in");
            authenticated = Some(about_logged_in || api_key_configured);
            if authenticated != Some(true) {
                failure_reason = Some(
                    "未登录 Cursor CLI。请运行 `agent login`，或在设置中配置 CURSOR_API_KEY。"
                        .to_string(),
                );
            }
        }
        Err(error) => {
            if api_key_configured {
                authenticated = Some(true);
            } else {
                authenticated = Some(false);
                failure_reason = Some(error);
            }
        }
    }

    let available = authenticated.unwrap_or(false);
    if available {
        failure_reason = None;
    }

    Ok(CursorAgentStatus {
        available,
        cli_available: true,
        api_key_configured,
        authenticated,
        cli_version,
        cli_path: Some(cli_path),
        failure_reason,
    })
}

#[tauri::command]
pub async fn cursor_agent_get_status(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_path: Option<String>,
) -> Result<CursorAgentStatus, String> {
    let probe = crate::agent_registry::OsProbe;
    build_cursor_agent_status(&app, &db.0, &probe, repository_path.as_deref()).await
}

#[tauri::command]
pub async fn cursor_agent_set_api_key(
    api_key: String,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<(), String> {
    save_cursor_api_key(&db.0, &api_key)
}

#[tauri::command]
pub async fn cursor_agent_clear_api_key(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<(), String> {
    clear_cursor_api_key(&db.0)
}

#[tauri::command]
pub async fn cursor_agent_probe(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_path: Option<String>,
) -> Result<CursorAgentStatus, String> {
    cursor_agent_get_status(app, db, repository_path).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorRepositoryFilesProbeResult {
    pub repository_path: String,
    pub target_relative_path: String,
    pub target_exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_preview: Option<String>,
    pub repository_read_ok: bool,
    pub repository_write_ok: bool,
    pub write_probe_relative_path: String,
    pub write_probe_verified: bool,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn cursor_agent_probe_repository_files(
    _app: tauri::AppHandle,
    repository_path: String,
    target_relative_path: Option<String>,
) -> Result<CursorRepositoryFilesProbeResult, String> {
    let repo = repository_path.trim().to_string();
    if repo.is_empty() {
        return Err("repositoryPath 不能为空".to_string());
    }
    let target = target_relative_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("README.md")
        .to_string();
    let write_probe = ".wise-cursor-cli-write-probe.tmp";

    tokio::task::spawn_blocking(move || {
        let mut errors = Vec::new();
        let repo_path = PathBuf::from(&repo);
        let read_ok = repo_path.is_dir();
        if !read_ok {
            errors.push(format!("仓库目录不存在: {repo}"));
        }

        let target_path = repo_path.join(&target);
        let target_exists = target_path.is_file();
        let (target_size_bytes, target_preview) = if target_exists {
            let meta = std::fs::metadata(&target_path).ok();
            let size = meta.map(|m| m.len());
            let preview = std::fs::read_to_string(&target_path)
                .ok()
                .map(|s| s.chars().take(200).collect::<String>());
            (size, preview)
        } else {
            (None, None)
        };

        let probe_path = repo_path.join(write_probe);
        let write_ok = std::fs::write(&probe_path, b"wise-cursor-cli-probe").is_ok();
        let write_probe_verified = if write_ok {
            let verified = std::fs::read(&probe_path)
                .ok()
                .map(|b| b.as_slice() == b"wise-cursor-cli-probe")
                .unwrap_or(false);
            let _ = std::fs::remove_file(&probe_path);
            verified
        } else {
            errors.push("无法在目标仓库写入探测文件".to_string());
            false
        };

        Ok(CursorRepositoryFilesProbeResult {
            repository_path: repo,
            target_relative_path: target,
            target_exists,
            target_size_bytes,
            target_preview,
            repository_read_ok: read_ok,
            repository_write_ok: write_ok && write_probe_verified,
            write_probe_relative_path: write_probe.to_string(),
            write_probe_verified,
            errors,
        })
    })
    .await
    .map_err(|e| format!("cursor_agent_probe_repository_files: {e}"))?
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAgentWriteProbeResult {
    pub model_id: String,
    pub run_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_result_text: Option<String>,
    pub tools_at_init: Vec<String>,
    pub tool_calls: Vec<CursorAgentWriteToolCall>,
    pub tool_call_summary: CursorAgentWriteToolCallSummary,
    pub target_relative_path: String,
    pub file_created: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_content: Option<String>,
    pub agent_write_ok: bool,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAgentWriteToolCall {
    pub call_id: String,
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAgentWriteToolCallSummary {
    pub total: u32,
    pub running: u32,
    pub completed: u32,
    pub error: u32,
    pub unique_names: Vec<String>,
}

#[tauri::command]
pub async fn cursor_agent_probe_agent_write(
    _app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_path: String,
    model: Option<String>,
) -> Result<CursorAgentWriteProbeResult, String> {
    let repo = repository_path.trim().to_string();
    if repo.is_empty() {
        return Err("repositoryPath 不能为空".to_string());
    }
    let api_key = load_cursor_api_key(&db.0);
    let model_id = model
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("auto")
        .to_string();
    let target_relative_path = "public/.wise-cursor-cli-write-probe.md".to_string();
    let prompt = format!(
        "Create the file `{target_relative_path}` with exactly this content and nothing else:\n\nwise-cursor-cli-write-ok\n"
    );

    let agent = find_cursor_agent_binary()?;
    let mut cmd = build_cursor_cli_command(
        &agent,
        &repo,
        &prompt,
        Some(model_id.as_str()),
        None,
        api_key.as_deref(),
    );

    let output = timeout(Duration::from_secs(180), cmd.output())
        .await
        .map_err(|_| "Cursor CLI write probe 超时".to_string())?
        .map_err(|e| format!("无法启动 Cursor CLI write probe: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut tool_calls = Vec::new();
    let mut unique = std::collections::BTreeSet::new();
    let mut completed = 0u32;
    let mut running = 0u32;
    let mut error_n = 0u32;
    let mut result_text = None;

    for line in stdout.lines() {
        match map_cursor_cli_stdout_line(line) {
            CursorCliStdoutMap::StreamLines(lines) => {
                for stream_line in lines {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&stream_line) {
                        if let Some(content) = v
                            .pointer("/message/content")
                            .and_then(|c| c.as_array())
                        {
                            for block in content {
                                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                    let call_id = block
                                        .get("id")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let name = block
                                        .get("name")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("tool")
                                        .to_string();
                                    unique.insert(name.clone());
                                    running += 1;
                                    tool_calls.push(CursorAgentWriteToolCall {
                                        call_id,
                                        name,
                                        status: "running".to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
            CursorCliStdoutMap::Result { success, .. } => {
                if success {
                    completed += 1;
                } else {
                    error_n += 1;
                }
            }
            _ => {}
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("type").and_then(|t| t.as_str()) == Some("result") {
                result_text = v
                    .get("result")
                    .and_then(|r| r.as_str())
                    .map(str::to_string);
            }
        }
    }

    let target_path = Path::new(&repo).join(&target_relative_path);
    let file_content = std::fs::read_to_string(&target_path).ok();
    let file_created = file_content
        .as_deref()
        .map(|c| c.contains("wise-cursor-cli-write-ok"))
        .unwrap_or(false);
    let _ = std::fs::remove_file(&target_path);

    let mut errors = Vec::new();
    if !output.status.success() && !file_created {
        let stderr = String::from_utf8_lossy(&output.stderr);
        errors.push(format!(
            "CLI 退出码 {:?}；stderr: {}",
            output.status.code(),
            stderr.trim()
        ));
    }

    Ok(CursorAgentWriteProbeResult {
        model_id,
        run_status: if file_created {
            "completed".to_string()
        } else {
            "error".to_string()
        },
        run_result_text: result_text,
        tools_at_init: vec![],
        tool_calls,
        tool_call_summary: CursorAgentWriteToolCallSummary {
            total: running + completed + error_n,
            running,
            completed,
            error: error_n,
            unique_names: unique.into_iter().collect(),
        },
        target_relative_path,
        file_created,
        file_content,
        agent_write_ok: file_created,
        errors,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorModelListItem {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

fn curated_cursor_models() -> Vec<CursorModelListItem> {
    // CLI 拉取失败时的常用目录（id 与 `agent --model` / `--list-models` 对齐）。
    // 账户可用全集仍以 CLI 输出为准；此处保证 Composer 不只剩 2～3 项。
    const ENTRIES: &[(&str, &str)] = &[
        ("auto", "Auto"),
        ("composer-2.5", "Composer 2.5"),
        ("composer-2", "Composer 2"),
        ("composer-1.5", "Composer 1.5"),
        ("composer-1", "Composer 1"),
        ("grok-4.5", "Grok 4.5"),
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.5-medium", "GPT-5.5 Medium"),
        ("gpt-5.5-extra-high-fast", "GPT-5.5 Extra High Fast"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.4-mini", "GPT-5.4 Mini"),
        ("gpt-5.3-codex", "GPT-5.3 Codex"),
        ("gpt-5.2", "GPT-5.2"),
        ("gpt-5", "GPT-5"),
        ("gpt-5-high", "GPT-5 High"),
        ("gpt-5-mini", "GPT-5 Mini"),
        ("sonnet-4", "Sonnet 4"),
        ("sonnet-4-thinking", "Sonnet 4 Thinking"),
        ("claude-sonnet-4.6", "Claude Sonnet 4.6"),
        ("claude-sonnet-4.5", "Claude Sonnet 4.5"),
        ("claude-sonnet-4", "Claude Sonnet 4"),
        ("claude-opus-4.8", "Claude Opus 4.8"),
        ("claude-opus-4-6", "Claude Opus 4.6"),
        ("claude-opus-4.5", "Claude Opus 4.5"),
        ("claude-haiku-4.5", "Claude Haiku 4.5"),
        ("gemini-3.5-flash", "Gemini 3.5 Flash"),
        ("gemini-3.1-pro", "Gemini 3.1 Pro"),
        ("gemini-3-flash", "Gemini 3 Flash"),
        ("gemini-3-pro", "Gemini 3 Pro"),
        ("kimi-k2.5", "Kimi K2.5"),
    ];
    ENTRIES
        .iter()
        .map(|(id, name)| CursorModelListItem {
            id: (*id).to_string(),
            display_name: (*name).to_string(),
            description: None,
            aliases: if *id == "auto" {
                vec!["default".to_string()]
            } else {
                vec![]
            },
        })
        .collect()
}

fn looks_like_cursor_model_id(id: &str) -> bool {
    let trimmed = id.trim();
    if trimmed.len() < 2 || trimmed.len() > 96 {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "available"
            | "models"
            | "model"
            | "filter"
            | "loading"
            | "account"
            | "no"
            | "for"
            | "this"
            | "commands"
            | "options"
            | "usage"
            | "error"
            | "unknown"
    ) {
        return false;
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
    {
        return false;
    }
    if !trimmed.chars().any(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    lower == "auto"
        || trimmed.contains('-')
        || trimmed.contains('.')
        || lower.starts_with("gpt")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
}

fn clean_cursor_model_display_name(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let Some(rest) = s.strip_prefix('-') {
        s = rest.trim().to_string();
    }
    for marker in ["(current)", "(default)", "(active)"] {
        if let Some(idx) = s.to_ascii_lowercase().find(marker) {
            s = s[..idx].trim().to_string();
        }
    }
    s
}

/// 规范化 CLI 进度/ANSI 输出：处理 `\r` 覆盖行后再按行解析。
fn normalize_cli_list_text(stdout: &str) -> String {
    let cleaned = strip_ansi(stdout);
    let mut lines = Vec::new();
    for chunk in cleaned.split('\n') {
        let last = chunk.rsplit('\r').next().unwrap_or(chunk).trim();
        if !last.is_empty() {
            lines.push(last.to_string());
        }
    }
    lines.join("\n")
}

fn parse_models_list_output(stdout: &str) -> Vec<CursorModelListItem> {
    let cleaned = normalize_cli_list_text(stdout);
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in cleaned.lines() {
        let t = line.trim();
        if t.is_empty()
            || t.starts_with("Loading")
            || t.starts_with("No models")
            || t.starts_with("Available models")
            || t.starts_with("Filter:")
            || t.starts_with("Commands:")
            || t.starts_with("Options:")
            || t.starts_with("Usage:")
            || t.starts_with("Error")
        {
            continue;
        }

        // Formats:
        //   composer-2.5
        //   composer-2.5  Composer 2.5
        //   gpt-5.5-medium - GPT-5.5 Medium (current)
        let (id_raw, rest_owned) = if let Some((left, right)) = t.split_once(" - ") {
            (left.trim().to_string(), right.trim().to_string())
        } else {
            let mut parts = t.split_whitespace();
            let Some(id) = parts.next() else {
                continue;
            };
            (id.to_string(), parts.collect::<Vec<_>>().join(" "))
        };

        let id = id_raw
            .trim()
            .trim_matches(|c: char| matches!(c, '•' | '-' | '*' | '|' | '│'));
        if !looks_like_cursor_model_id(id) {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        let display_name = {
            let cleaned_rest = clean_cursor_model_display_name(&rest_owned);
            if cleaned_rest.is_empty() {
                id.to_string()
            } else {
                cleaned_rest
            }
        };
        out.push(CursorModelListItem {
            id: id.to_string(),
            display_name,
            description: None,
            aliases: vec![],
        });
    }
    out
}

fn merge_cursor_model_lists(
    primary: Vec<CursorModelListItem>,
    secondary: Vec<CursorModelListItem>,
) -> Vec<CursorModelListItem> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in primary.into_iter().chain(secondary) {
        let id = item.id.trim().to_string();
        if id.is_empty() || !seen.insert(id) {
            continue;
        }
        out.push(item);
    }
    out
}

fn ensure_auto_model_first(mut models: Vec<CursorModelListItem>) -> Vec<CursorModelListItem> {
    if let Some(idx) = models.iter().position(|m| {
        let id = m.id.trim().to_ascii_lowercase();
        id == "auto" || id == "default"
    }) {
        if idx != 0 {
            let item = models.remove(idx);
            models.insert(0, item);
        }
    } else {
        models.insert(
            0,
            CursorModelListItem {
                id: "auto".to_string(),
                display_name: "Auto".to_string(),
                description: Some("CLI 账户默认模型".to_string()),
                aliases: vec!["default".to_string()],
            },
        );
    }
    models
}

#[tauri::command]
pub async fn cursor_agent_list_models(
    _app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<CursorModelListItem>, String> {
    let api_key = load_cursor_api_key(&db.0);
    let mut from_cli: Vec<CursorModelListItem> = Vec::new();

    // Prefer account-scoped `models`；已有结果则跳过第二次 CLI，避免串行双探测。
    for args in [&["models"][..], &["--list-models"][..]] {
        match run_cursor_cli_capture(args, api_key.as_deref(), None).await {
            Ok((_code, stdout, stderr)) => {
                let combined = if stderr.trim().is_empty() {
                    stdout
                } else {
                    format!("{stdout}\n{stderr}")
                };
                let parsed = parse_models_list_output(&combined);
                if !parsed.is_empty() {
                    from_cli = merge_cursor_model_lists(from_cli, parsed);
                    break;
                }
            }
            Err(_) => continue,
        }
    }

    let curated = curated_cursor_models();
    let merged = if from_cli.is_empty() {
        curated
    } else {
        // CLI 结果优先；curated 补齐 Auto / 常见项，避免账户列表偶发过短。
        merge_cursor_model_lists(from_cli, curated)
    };

    if merged.is_empty() {
        if api_key.is_none() {
            return Err("无法列出模型：请配置 API Key 或执行 `agent login`".to_string());
        }
        return Ok(ensure_auto_model_first(curated_cursor_models()));
    }

    Ok(ensure_auto_model_first(merged))
}

#[tauri::command]
pub async fn cursor_agent_read_spawn_mcp_servers(
    config_path: String,
) -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let path = config_path.trim().to_string();
    if path.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    tokio::task::spawn_blocking(move || {
        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("读取 MCP 配置失败: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("解析 MCP 配置失败: {e}"))?;
        let servers = json
            .get("mcpServers")
            .and_then(|value| value.as_object())
            .ok_or_else(|| "MCP 配置缺少 mcpServers 对象".to_string())?;
        Ok(servers
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect())
    })
    .await
    .map_err(|e| format!("cursor_agent_read_spawn_mcp_servers: {e}"))?
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CursorAttachmentInput {
    path: String,
    #[serde(default)]
    mime_type: Option<String>,
}

#[tauri::command]
pub async fn load_cursor_session_jsonl_command(
    project_path: String,
    tab_session_id: String,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let project = project_path.trim().to_string();
    let tab = tab_session_id.trim().to_string();
    tokio::task::spawn_blocking(move || load_cursor_session_jsonl(&project, &tab, tail_lines))
        .await
        .map_err(|e| format!("load_cursor_session_jsonl: {e}"))?
}

#[tauri::command]
pub(crate) async fn execute_cursor_code(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    project_path: String,
    prompt: String,
    model: Option<String>,
    mcp_servers: Option<serde_json::Value>,
    cursor_attachments: Option<Vec<CursorAttachmentInput>>,
    invocation_key: Option<String>,
    tab_session_id: Option<String>,
    cursor_agent_id: Option<String>,
) -> Result<(), String> {
    let _ = mcp_servers; // CLI 自动读取工作区 / 用户 mcp.json；用 --approve-mcps 放行。

    let api_key = load_cursor_api_key(&db.0);
    let agent_path = find_cursor_agent_binary()?;

    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();
    let session_id = tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("cursor-{}", Uuid::new_v4().simple()));

    let attachment_pairs: Vec<(String, String)> = cursor_attachments
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let path = item.path.trim();
            if path.is_empty() {
                return None;
            }
            Some((
                path.to_string(),
                item.mime_type
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("image/png")
                    .to_string(),
            ))
        })
        .collect();

    let user_turn_line = build_cursor_user_turn_line(
        prompt.trim(),
        if attachment_pairs.is_empty() {
            None
        } else {
            Some(attachment_pairs.as_slice())
        },
    );
    let _ = append_cursor_session_line(&project_path, &session_id, &user_turn_line);

    let full_prompt = append_attachment_hints(
        &with_cursor_cli_preamble(prompt.trim()),
        &attachment_pairs,
    );
    let resume = cursor_agent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let mut cmd = build_cursor_cli_command(
        &agent_path,
        &project_path,
        &full_prompt,
        model.as_deref(),
        resume,
        api_key.as_deref(),
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 Cursor Agent CLI: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 Cursor CLI stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 Cursor CLI stderr".to_string())?;

    let wait_child = Arc::new(TokioMutex::new(Some(child)));
    if let Some(inv) = invocation_key.as_deref().filter(|s| !s.is_empty()) {
        process_state
            .active_child_by_invocation_key
            .lock()
            .await
            .insert(inv.to_string(), wait_child.clone());
        process_state
            .invocation_tab_session_by_key
            .lock()
            .await
            .insert(inv.to_string(), session_id.clone());
    }
    if !session_id.is_empty() {
        process_state
            .active_child_by_claude_session
            .lock()
            .await
            .insert(session_id.clone(), wait_child.clone());
    }

    let model_label = model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("auto")
        .to_string();
    registry.register(session_id.clone(), project_path.clone(), model_label);

    let app_stdout = app.clone();
    let session_id_stdout = session_id.clone();
    let invocation_key_stdout = invocation_key.clone();
    let cursor_agent_id_shared = Arc::new(TokioMutex::new(None::<String>));
    let stream_success = Arc::new(AtomicBool::new(true));
    let saw_terminal_result = Arc::new(AtomicBool::new(false));
    let cursor_agent_id_stdout = cursor_agent_id_shared.clone();
    let stream_success_stdout = stream_success.clone();
    let saw_terminal_result_stdout = saw_terminal_result.clone();
    let disk_project_path_stdout = project_path.clone();

    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match map_cursor_cli_stdout_line(trimmed) {
                CursorCliStdoutMap::SessionId(id) => {
                    let mut guard = cursor_agent_id_stdout.lock().await;
                    *guard = Some(id.clone());
                    let bind = cursor_agent_bind_line(&id);
                    emit_cursor_stdout_line(
                        &app_stdout,
                        &session_id_stdout,
                        &bind,
                        invocation_key_stdout.as_deref(),
                    );
                    let _ = append_cursor_session_line(
                        &disk_project_path_stdout,
                        &session_id_stdout,
                        &bind,
                    );
                }
                CursorCliStdoutMap::StreamLines(stream_lines) => {
                    for stream_line in stream_lines {
                        emit_cursor_stdout_line(
                            &app_stdout,
                            &session_id_stdout,
                            &stream_line,
                            invocation_key_stdout.as_deref(),
                        );
                        let _ = append_cursor_session_line(
                            &disk_project_path_stdout,
                            &session_id_stdout,
                            &stream_line,
                        );
                    }
                }
                CursorCliStdoutMap::Result {
                    success,
                    session_id: result_sid,
                } => {
                    saw_terminal_result_stdout.store(true, Ordering::SeqCst);
                    if !success {
                        stream_success_stdout.store(false, Ordering::SeqCst);
                    }
                    if let Some(id) = result_sid {
                        let mut guard = cursor_agent_id_stdout.lock().await;
                        if guard.is_none() {
                            *guard = Some(id.clone());
                            let bind = cursor_agent_bind_line(&id);
                            emit_cursor_stdout_line(
                                &app_stdout,
                                &session_id_stdout,
                                &bind,
                                invocation_key_stdout.as_deref(),
                            );
                        }
                    }
                }
                CursorCliStdoutMap::Skip => {}
            }
        }
    });

    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            #[cfg(debug_assertions)]
            if std::env::var("WISE_CURSOR_CLI_DEBUG").ok().as_deref() == Some("1") {
                eprintln!("[cursor-cli stderr] {trimmed}");
            }
        }
    });

    let app_wait = app.clone();
    let registry_wait = registry.inner().clone();
    let session_id_wait = session_id.clone();
    let invocation_key_wait = invocation_key.clone();
    let active_child_by_invocation = process_state.active_child_by_invocation_key.clone();
    let active_child_by_session = process_state.active_child_by_claude_session.clone();
    let invocation_tab_session_by_key = process_state.invocation_tab_session_by_key.clone();
    let cursor_agent_id_wait = cursor_agent_id_shared.clone();
    let stream_success_wait = stream_success.clone();
    let saw_terminal_result_wait = saw_terminal_result.clone();
    let disk_project_path_wait = project_path.clone();
    let disk_session_id_wait = session_id.clone();

    tokio::spawn(async move {
        let exit_status = {
            let mut slot = wait_child.lock().await;
            match slot.as_mut() {
                Some(child) => match timeout(CURSOR_EXECUTE_TIMEOUT, child.wait()).await {
                    Ok(status) => status.ok(),
                    Err(_) => {
                        let _ = child.kill().await;
                        emit_cursor_stdout_line(
                            &app_wait,
                            &session_id_wait,
                            &cursor_assistant_stream_line(
                                "[cursor-cli] 执行超时。请点「结束」后重试，并检查 API Key / `agent login`、网络与模型选择。",
                            ),
                            invocation_key_wait.as_deref(),
                        );
                        stream_success_wait.store(false, Ordering::SeqCst);
                        None
                    }
                },
                None => None,
            }
        };

        if let Some(inv) = invocation_key_wait.as_deref().filter(|s| !s.is_empty()) {
            active_child_by_invocation.lock().await.remove(inv);
            invocation_tab_session_by_key.lock().await.remove(inv);
        }
        if !session_id_wait.is_empty() {
            active_child_by_session.lock().await.remove(&session_id_wait);
        }

        let exit_success = exit_status.map(|status| status.success()).unwrap_or(false);
        let stream_ok = stream_success_wait.load(Ordering::SeqCst);
        let saw_result = saw_terminal_result_wait.load(Ordering::SeqCst);
        let final_success = stream_ok && (exit_success || saw_result);
        let cursor_agent_id = cursor_agent_id_wait.lock().await.clone();
        let complete_line = serde_json::json!({
            "type": "cursor_complete",
            "success": final_success,
            "cursorAgentId": cursor_agent_id,
        })
        .to_string();
        let _ = append_cursor_session_line(
            &disk_project_path_wait,
            &disk_session_id_wait,
            &complete_line,
        );
        registry_wait.mark_completed(&session_id_wait, final_success);
        emit_cursor_complete(
            &app_wait,
            &session_id_wait,
            final_success,
            cursor_agent_id.as_deref(),
            invocation_key_wait.as_deref(),
        );
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().expect("in-memory sqlite opens");
        conn.execute_batch(
            "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .expect("app_settings table is created");
        Mutex::new(conn)
    }

    #[test]
    fn cursor_api_key_round_trips_sqlite() {
        let db = test_db();
        assert!(load_cursor_api_key(&db).is_none());
        save_cursor_api_key(&db, "cursor_test_key").expect("save api key");
        assert_eq!(
            load_cursor_api_key(&db).as_deref(),
            Some("cursor_test_key")
        );
        clear_cursor_api_key(&db).expect("clear");
        assert!(load_cursor_api_key(&db).is_none());
    }

    #[test]
    fn normalize_cli_model_skips_auto() {
        assert_eq!(normalize_cli_model(Some("auto")), None);
        assert_eq!(normalize_cli_model(Some("default")), None);
        assert_eq!(
            normalize_cli_model(Some("composer-2.5")).as_deref(),
            Some("composer-2.5")
        );
    }

    #[test]
    fn preamble_is_idempotent() {
        let once = with_cursor_cli_preamble("hello");
        assert!(once.starts_with("[Wise Cursor CLI]"));
        let twice = with_cursor_cli_preamble(&once);
        assert_eq!(once, twice);
    }

    #[test]
    fn strip_ansi_removes_escapes() {
        let raw = "\u{1b}[2K\u{1b}[GCLI Version         2026.01.23";
        assert!(strip_ansi(raw).contains("CLI Version"));
        assert!(!strip_ansi(raw).contains('\u{1b}'));
    }

    #[test]
    fn parse_models_list_handles_common_cli_formats() {
        let raw = "\u{1b}[2K\u{1b}[GLoading models…\r\n\
Available models:\n\
composer-2.5 - Composer 2.5 (default)\n\
gpt-5.5-medium - GPT-5.5 Medium (current)\n\
sonnet-4  Sonnet 4\n\
No models available for this account.\n\
bogus\n\
path/with/slash\n";
        let models = parse_models_list_output(raw);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["composer-2.5", "gpt-5.5-medium", "sonnet-4"]);
        assert_eq!(models[0].display_name, "Composer 2.5");
        assert_eq!(models[1].display_name, "GPT-5.5 Medium");
        assert_eq!(models[2].display_name, "Sonnet 4");
    }

    #[test]
    fn curated_models_include_frontier_skus() {
        let models = curated_cursor_models();
        assert!(models.len() > 10);
        assert_eq!(models[0].id, "auto");
        assert!(models.iter().any(|m| m.id == "gpt-5.5"));
        assert!(models.iter().any(|m| m.id == "claude-opus-4-6"));
        assert!(models.iter().any(|m| m.id == "sonnet-4"));
    }

    #[test]
    fn merge_prefers_primary_order_and_dedupes() {
        let primary = vec![CursorModelListItem {
            id: "gpt-5".to_string(),
            display_name: "From CLI".to_string(),
            description: None,
            aliases: vec![],
        }];
        let secondary = curated_cursor_models();
        let merged = ensure_auto_model_first(merge_cursor_model_lists(primary, secondary));
        assert_eq!(merged[0].id, "auto");
        let gpt = merged.iter().find(|m| m.id == "gpt-5").expect("gpt-5");
        assert_eq!(gpt.display_name, "From CLI");
    }
}
