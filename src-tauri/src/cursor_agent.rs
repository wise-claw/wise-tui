//! Cursor Agent SDK bridge for Wise.
//!
//! Spawns `scripts/cursor-sdk-bridge.ts` via Bun and stores `CURSOR_API_KEY` in SQLite.

use crate::agent_registry::{Probe, ProbeResult};
use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::wise_db;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
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
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorCompletePayload {
    session_id: String,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor_agent_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CursorStreamEvent {
    #[serde(rename = "type")]
    event_type: String,
    #[serde(default, rename = "agentId")]
    agent_id: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    success: Option<bool>,
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
    let _ = app.emit("claude-output", line);
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
    let _ = app.emit("claude-complete", &payload);
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-complete:invocation:{}", inv), &payload);
    }
}

fn handle_cursor_stream_event(
    app: &AppHandle,
    tab_session_id: &str,
    invocation_key: Option<&str>,
    event: CursorStreamEvent,
    cursor_agent_id: &mut Option<String>,
) -> bool {
    match event.event_type.as_str() {
        "agent" => {
            if let Some(agent_id) = event
                .agent_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                *cursor_agent_id = Some(agent_id.to_string());
                emit_cursor_stdout_line(
                    app,
                    tab_session_id,
                    &cursor_agent_bind_line(agent_id),
                    invocation_key,
                );
            }
            true
        }
        "assistant" => {
            let text = event.text.unwrap_or_default();
            if !text.is_empty() {
                emit_cursor_stdout_line(
                    app,
                    tab_session_id,
                    &cursor_assistant_stream_line(&text),
                    invocation_key,
                );
            }
            true
        }
        "error" => {
            let message = event
                .message
                .unwrap_or_else(|| "Cursor SDK 执行失败".to_string());
            emit_cursor_stdout_line(
                app,
                tab_session_id,
                &cursor_assistant_stream_line(&format!("[cursor-sdk] {message}")),
                invocation_key,
            );
            false
        }
        "complete" => {
            if event.success == Some(false) {
                return false;
            }
            true
        }
        _ => true,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAgentStatus {
    pub available: bool,
    pub bun_available: bool,
    pub bridge_available: bool,
    pub sdk_available: bool,
    pub api_key_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_valid: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BridgeResponse {
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
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

pub fn resolve_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("WISE_CURSOR_BRIDGE_SCRIPT") {
        let path = PathBuf::from(raw.trim());
        if path.is_file() {
            return path.canonicalize().map_err(|e| e.to_string());
        }
        return Err(format!(
            "WISE_CURSOR_BRIDGE_SCRIPT 指向的文件不存在: {}",
            path.display()
        ));
    }

    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/cursor-sdk-bridge.ts");
    if dev.is_file() {
        return dev.canonicalize().map_err(|e| e.to_string());
    }

    let res = app
        .path()
        .resolve("cursor-sdk-bridge.ts", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if res.is_file() {
        return Ok(res);
    }

    Err(format!(
        "未找到 Cursor SDK bridge 脚本（开发路径 {} 或资源路径）",
        dev.display()
    ))
}

fn resolve_bun_binary() -> PathBuf {
    if let Ok(raw) = std::env::var("WISE_BUN_BIN") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    PathBuf::from("bun")
}

async fn resolve_bun_binary_async() -> PathBuf {
    if let Ok(raw) = std::env::var("WISE_BUN_BIN") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let probe = crate::agent_registry::OsProbe;
    let result = probe.probe("bun", &HashMap::new()).await;
    result
        .resolved_path
        .map(PathBuf::from)
        .unwrap_or_else(resolve_bun_binary)
}

pub async fn probe_cursor_registry(db: &Mutex<Connection>, probe: &dyn Probe) -> ProbeResult {
    let empty_env = HashMap::new();
    let bun = probe.probe("bun", &empty_env).await;
    if !bun.ok {
        return ProbeResult {
            ok: false,
            error: Some(
                bun.error
                    .unwrap_or_else(|| "未找到 bun，无法运行 Cursor SDK bridge".to_string()),
            ),
            resolved_path: None,
        };
    }

    if load_cursor_api_key(db).is_none() {
        return ProbeResult {
            ok: false,
            error: Some("未配置 Cursor API Key（设置或 CURSOR_API_KEY 环境变量）".to_string()),
            resolved_path: bun.resolved_path,
        };
    }

    ProbeResult {
        ok: true,
        error: None,
        resolved_path: bun.resolved_path,
    }
}

async fn run_bridge(
    app: &AppHandle,
    method: &str,
    params: Option<serde_json::Value>,
    api_key: Option<&str>,
) -> Result<BridgeResponse, String> {
    let bridge = resolve_bridge_script(app)?;
    let request = serde_json::json!({
        "method": method,
        "params": params,
    });
    let bun_bin = resolve_bun_binary_async().await;
    let mut cmd = Command::new(&bun_bin);
    cmd.arg(&bridge);
    cmd.arg(request.to_string());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    if let Some(key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        cmd.env("CURSOR_API_KEY", key);
    }

    let output = timeout(BRIDGE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| format!("Cursor SDK bridge 超时（>{BRIDGE_TIMEOUT:?}）"))?
        .map_err(|e| format!("无法启动 Cursor SDK bridge: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Cursor SDK bridge 未返回输出".to_string()
        } else {
            format!("Cursor SDK bridge 失败: {stderr}")
        });
    }

    let parsed: BridgeResponse =
        serde_json::from_str(&stdout).map_err(|e| format!("Cursor SDK bridge 输出解析失败: {e}"))?;
    if !output.status.success() && parsed.error.is_none() {
        return Err(format!(
            "Cursor SDK bridge 退出码 {:?}",
            output.status.code()
        ));
    }
    Ok(parsed)
}

pub async fn build_cursor_agent_status(
    app: &AppHandle,
    db: &Mutex<Connection>,
    probe: &dyn Probe,
) -> Result<CursorAgentStatus, String> {
    let empty_env = HashMap::new();
    let bun = probe.probe("bun", &empty_env).await;
    let bridge_available = resolve_bridge_script(app).is_ok();
    let api_key = load_cursor_api_key(db);
    let api_key_configured = api_key.is_some();

    let mut sdk_available = false;
    let mut api_key_valid = None;
    let mut failure_reason = None;

    if !bun.ok {
        failure_reason = Some(
            bun.error
                .clone()
                .unwrap_or_else(|| "未找到 bun".to_string()),
        );
    } else if !bridge_available {
        failure_reason = Some("未找到 cursor-sdk-bridge.ts".to_string());
    } else if !api_key_configured {
        failure_reason = Some("未配置 Cursor API Key".to_string());
    } else {
        match run_bridge(app, "probe", None, None).await {
            Ok(probe_resp) => {
                sdk_available = probe_resp
                    .result
                    .as_ref()
                    .and_then(|value| value.get("sdkAvailable"))
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false);
                if !sdk_available {
                    failure_reason = Some(
                        probe_resp
                            .result
                            .as_ref()
                            .and_then(|value| value.get("error"))
                            .and_then(|value| value.as_str())
                            .map(str::to_string)
                            .unwrap_or_else(|| "@cursor/sdk 不可用".to_string()),
                    );
                }
            }
            Err(error) => failure_reason = Some(error),
        }

        if sdk_available {
            match run_bridge(
                app,
                "models.list",
                None,
                api_key.as_deref(),
            )
            .await
            {
                Ok(models_resp) => {
                    api_key_valid = Some(models_resp.ok);
                    if !models_resp.ok {
                        failure_reason = models_resp.error.or(failure_reason);
                    }
                }
                Err(error) => {
                    api_key_valid = Some(false);
                    failure_reason = Some(error);
                }
            }
        }
    }

    let available = bun.ok
        && bridge_available
        && api_key_configured
        && sdk_available
        && api_key_valid.unwrap_or(false);

    Ok(CursorAgentStatus {
        available,
        bun_available: bun.ok,
        bridge_available,
        sdk_available,
        api_key_configured,
        api_key_valid,
        failure_reason,
    })
}

#[tauri::command]
pub async fn cursor_agent_get_status(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<CursorAgentStatus, String> {
    let probe = crate::agent_registry::OsProbe;
    build_cursor_agent_status(&app, &db.0, &probe).await
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
) -> Result<CursorAgentStatus, String> {
    cursor_agent_get_status(app, db).await
}

#[tauri::command]
pub(crate) async fn execute_cursor_code(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    tab_session_id: Option<String>,
    cursor_agent_id: Option<String>,
    trellis_context_id: Option<String>,
) -> Result<(), String> {
    let _ = trellis_context_id;
    let api_key = load_cursor_api_key(&db.0).ok_or_else(|| {
        "未配置 Cursor API Key，请在执行环境中完成配置".to_string()
    })?;

    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();
    let session_id = tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("cursor-{}", Uuid::new_v4().simple()));

    let bridge = resolve_bridge_script(&app)?;
    let request = serde_json::json!({
        "method": "execute",
        "params": {
            "prompt": prompt,
            "cwd": project_path,
            "model": model.as_deref().unwrap_or("default"),
            "agentId": cursor_agent_id.as_deref().filter(|value| !value.trim().is_empty()),
        }
    });

    let mut cmd = Command::new(resolve_bun_binary_async().await);
    cmd.arg(&bridge);
    cmd.arg(request.to_string());
    cmd.env("CURSOR_API_KEY", api_key);
    cmd.current_dir(&project_path);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 Cursor SDK bridge: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 Cursor SDK bridge stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 Cursor SDK bridge stderr".to_string())?;

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
        .unwrap_or("default")
        .to_string();
    registry.register(session_id.clone(), project_path.clone(), model_label);

    let app_stdout = app.clone();
    let session_id_stdout = session_id.clone();
    let invocation_key_stdout = invocation_key.clone();
    let cursor_agent_id_shared = Arc::new(TokioMutex::new(None::<String>));
    let stream_success = Arc::new(AtomicBool::new(true));
    let cursor_agent_id_stdout = cursor_agent_id_shared.clone();
    let stream_success_stdout = stream_success.clone();

    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: CursorStreamEvent = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(error) => {
                    emit_cursor_stdout_line(
                        &app_stdout,
                        &session_id_stdout,
                        &cursor_assistant_stream_line(&format!(
                            "[cursor-sdk] 无法解析 bridge 输出: {error}"
                        )),
                        invocation_key_stdout.as_deref(),
                    );
                    stream_success_stdout.store(false, Ordering::SeqCst);
                    continue;
                }
            };
            if parsed.event_type == "complete" {
                if parsed.success == Some(false) {
                    stream_success_stdout.store(false, Ordering::SeqCst);
                }
            }
            let mut guard = cursor_agent_id_stdout.lock().await;
            if !handle_cursor_stream_event(
                &app_stdout,
                &session_id_stdout,
                invocation_key_stdout.as_deref(),
                parsed,
                &mut guard,
            ) {
                stream_success_stdout.store(false, Ordering::SeqCst);
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
            // Connect RPC / Bun 会把 SDK 内部堆栈打到 stderr；结构化错误走 stdout `{ type: "error" }`。
            #[cfg(debug_assertions)]
            if std::env::var("WISE_CURSOR_BRIDGE_DEBUG").ok().as_deref() == Some("1") {
                eprintln!("[cursor-sdk-bridge stderr] {trimmed}");
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
            invocation_tab_session_by_key.lock().await.remove(inv);
        }
        if !session_id_wait.is_empty() {
            active_child_by_session.lock().await.remove(&session_id_wait);
        }

        let exit_success = exit_status.map(|status| status.success()).unwrap_or(false);
        let final_success =
            stream_success_wait.load(Ordering::SeqCst) && exit_success;
        let cursor_agent_id = cursor_agent_id_wait.lock().await.clone();
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[derive(Clone)]
    struct MockProbe {
        calls: Arc<AtomicUsize>,
        ok: bool,
    }

    impl MockProbe {
        fn ok() -> Self {
            Self {
                calls: Arc::new(AtomicUsize::new(0)),
                ok: true,
            }
        }
    }

    impl Probe for MockProbe {
        fn probe<'a>(
            &'a self,
            _command: &'a str,
            _env: &'a HashMap<String, String>,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ProbeResult> + Send + 'a>> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                ProbeResult {
                    ok: self.ok,
                    error: if self.ok {
                        None
                    } else {
                        Some("bun unavailable".to_string())
                    },
                    resolved_path: Some("/mock/bun".to_string()),
                }
            })
        }
    }

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
        clear_cursor_api_key(&db).expect("clear api key");
        assert!(load_cursor_api_key(&db).is_none());
    }

    #[tokio::test]
    async fn probe_cursor_registry_requires_api_key() {
        let db = test_db();
        let probe = MockProbe::ok();
        let result = probe_cursor_registry(&db, &probe).await;
        assert!(!result.ok);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("API Key"));
    }

    #[tokio::test]
    async fn probe_cursor_registry_ok_when_bun_and_key_present() {
        let db = test_db();
        save_cursor_api_key(&db, "cursor_test_key").expect("save api key");
        let probe = MockProbe::ok();
        let result = probe_cursor_registry(&db, &probe).await;
        assert!(result.ok);
    }
}
