//! Chrome DevTools Protocol (CDP) monitor for AI 报错监控.
//!
//! Modes:
//! - `launch`：独立 Chrome profile + 远程调试口（默认，与日常浏览器隔离）
//! - `attach`：附着已开启 `--remote-debugging-port` 的既有 Chrome；停止时不断开浏览器进程

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const EVENT_ISSUE: &str = "chrome-devtools-issue";
const ACTIVE_PORT_FILE: &str = "DevToolsActivePort";
const ATTACH_TIMEOUT: Duration = Duration::from_secs(12);
const ATTACH_POLL: Duration = Duration::from_millis(200);
const DEFAULT_ATTACH_DEBUG_PORT: u16 = 9222;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeDevtoolsIssue {
    pub session_id: String,
    /// `page-error` | `console-error` | `console-warning` | `network-http` | `network-failed`
    pub kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

enum MonitorCmd {
    Reload,
}

struct MonitorSession {
    child: Option<Child>,
    cancel_tx: watch::Sender<bool>,
    cmd_tx: Option<mpsc::UnboundedSender<MonitorCmd>>,
    /// Extension mode has no CDP loop; reload goes through the localhost bridge.
    extension_mode: bool,
    task: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Default)]
pub struct ChromeDevtoolsMonitorState {
    sessions: Mutex<HashMap<String, MonitorSession>>,
}

fn wise_chrome_profile_dir(session_id: &str) -> Result<PathBuf, String> {
    let safe: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dir = crate::wise_paths::wise_dir()
        .map_err(|e| format!("无法解析 ~/.wise：{e}"))?
        .join("chrome-devtools-monitor")
        .join(if safe.is_empty() { "default".into() } else { safe });
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建 Chrome 监控配置目录：{e}"))?;
    Ok(dir)
}

fn find_chrome_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.extend([
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
            PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
            PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"),
            PathBuf::from("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
        ]);
        if let Some(home) = dirs::home_dir() {
            candidates.push(
                home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
            );
        }
    }
    #[cfg(target_os = "linux")]
    {
        for name in [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "brave-browser",
        ] {
            if let Ok(output) = Command::new("which").arg(name).output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        candidates.push(PathBuf::from(path));
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program = std::env::var("PROGRAMFILES").unwrap_or_default();
        let program_x86 = std::env::var("PROGRAMFILES(X86)").unwrap_or_default();
        for root in [local, program, program_x86] {
            if root.is_empty() {
                continue;
            }
            candidates.push(PathBuf::from(&root).join(r"Google\Chrome\Application\chrome.exe"));
            candidates.push(PathBuf::from(&root).join(r"Microsoft\Edge\Application\msedge.exe"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn launch_chrome(profile: &Path, url: &str) -> Result<Child, String> {
    let chrome = find_chrome_binary().ok_or_else(|| {
        "未找到 Chrome / Chromium / Edge。请安装 Google Chrome 以启用 DevTools 监控。".to_string()
    })?;
    let _ = fs::remove_file(profile.join(ACTIVE_PORT_FILE));
    Command::new(&chrome)
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--remote-debugging-port=0")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-default-apps")
        .arg("--disable-popup-blocking")
        .arg("--disable-background-networking")
        .arg("--disable-features=Translate,MediaRouter")
        .arg("--new-window")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 Chrome 失败（{}）：{e}", chrome.display()))
}

fn read_devtools_active_port(profile: &Path) -> Option<(u16, String)> {
    let text = fs::read_to_string(profile.join(ACTIVE_PORT_FILE)).ok()?;
    let mut lines = text.lines();
    let port: u16 = lines.next()?.trim().parse().ok()?;
    let path = lines.next().unwrap_or("/devtools/browser").trim().to_string();
    Some((port, path))
}

async fn wait_for_devtools_port(profile: &Path) -> Result<(u16, String), String> {
    let started = std::time::Instant::now();
    loop {
        if let Some(pair) = read_devtools_active_port(profile) {
            return Ok(pair);
        }
        if started.elapsed() > ATTACH_TIMEOUT {
            return Err("等待 Chrome DevTools 调试端口超时".to_string());
        }
        tokio::time::sleep(ATTACH_POLL).await;
    }
}

fn normalize_url_for_match(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let without_hash = trimmed.split('#').next().unwrap_or(trimmed);
    without_hash.trim_end_matches('/').to_string()
}

/// Higher score = better match for attaching to an existing tab.
fn score_page_url_match(page_url: &str, preferred: &str) -> i32 {
    let page = normalize_url_for_match(page_url);
    let want = normalize_url_for_match(preferred);
    if page.is_empty() || want.is_empty() {
        return 0;
    }
    if page == want {
        return 100;
    }
    if page.starts_with(&want) || want.starts_with(&page) {
        return 60;
    }
    let page_origin = page.split('/').take(3).collect::<Vec<_>>().join("/");
    let want_origin = want.split('/').take(3).collect::<Vec<_>>().join("/");
    if !page_origin.is_empty() && page_origin == want_origin {
        return 30;
    }
    0
}

fn pick_best_page_ws(pages: &[Value], preferred_url: &str) -> Option<(String, i32)> {
    let mut best: Option<(String, i32)> = None;
    for item in pages {
        let ty = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if ty != "page" {
            continue;
        }
        let Some(ws) = item
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let page_url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
        let score = if preferred_url.trim().is_empty() {
            1
        } else {
            score_page_url_match(page_url, preferred_url)
        };
        match &best {
            None => best = Some((ws.to_string(), score)),
            Some((_, best_score)) if score > *best_score => {
                best = Some((ws.to_string(), score));
            }
            _ => {}
        }
    }
    best
}

async fn http_json_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())
}

async fn probe_debug_port(port: u16) -> Result<(), String> {
    let client = http_json_client().await?;
    let version_url = format!("http://127.0.0.1:{port}/json/version");
    let resp = client.get(&version_url).send().await.map_err(|e| {
        format!(
            "无法连接本机 Chrome 调试端口 {port}：{e}。请先用 `--remote-debugging-port={port}` 启动 Chrome。"
        )
    })?;
    if !resp.status().is_success() {
        return Err(format!(
            "Chrome 调试端口 {port} 响应异常（HTTP {}）",
            resp.status()
        ));
    }
    Ok(())
}

async fn list_targets(port: u16) -> Result<Vec<Value>, String> {
    let client = http_json_client().await?;
    let list_url = format!("http://127.0.0.1:{port}/json/list");
    let pages: Value = client
        .get(&list_url)
        .send()
        .await
        .map_err(|e| format!("读取 Chrome target 列表失败：{e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Chrome target 列表失败：{e}"))?;
    Ok(pages.as_array().cloned().unwrap_or_default())
}

/// Minimal URL encoding for query string (Chrome /json/new).
fn urlencoding_minimal(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() * 3);
    for b in raw.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' | b'/' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{b:02X}"));
            }
        }
    }
    out
}

async fn create_page_target(port: u16, url: &str) -> Result<String, String> {
    let client = http_json_client().await?;
    let new_url = format!(
        "http://127.0.0.1:{port}/json/new?{}",
        urlencoding_minimal(url)
    );
    let resp = match client.put(&new_url).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(_) | Err(_) => client
            .get(&new_url)
            .send()
            .await
            .map_err(|e| format!("在已有 Chrome 中打开新标签失败：{e}"))?,
    };
    if !resp.status().is_success() {
        return Err(format!(
            "在已有 Chrome 中打开新标签失败（HTTP {}）",
            resp.status()
        ));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("解析新建标签响应失败：{e}"))?;
    body.get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "新建标签未返回 webSocketDebuggerUrl".to_string())
}

async fn fallback_any_ws(port: u16, pages: &[Value]) -> Result<String, String> {
    if let Some((ws, _)) = pick_best_page_ws(pages, "") {
        return Ok(ws);
    }
    for item in pages {
        if let Some(ws) = item
            .get("webSocketDebuggerUrl")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Ok(ws.to_string());
        }
    }
    let client = http_json_client().await?;
    let version_url = format!("http://127.0.0.1:{port}/json/version");
    let version: Value = client
        .get(&version_url)
        .send()
        .await
        .map_err(|e| format!("读取 Chrome version 失败：{e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 Chrome version 失败：{e}"))?;
    version
        .get("webSocketDebuggerUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Chrome 未返回 webSocketDebuggerUrl".to_string())
}

/// Resolve a page WebSocket debugger URL. Returns `(ws_url, should_navigate)`.
async fn resolve_page_ws_url(port: u16, preferred_url: &str) -> Result<(String, bool), String> {
    let pages = list_targets(port).await?;
    if !preferred_url.trim().is_empty() {
        if let Some((ws, score)) = pick_best_page_ws(&pages, preferred_url) {
            if score >= 30 {
                // Matched existing tab — attach without navigate.
                return Ok((ws, false));
            }
            if score > 0 {
                return Ok((ws, true));
            }
        }
        match create_page_target(port, preferred_url).await {
            Ok(ws) => return Ok((ws, false)),
            Err(create_err) => {
                let ws = fallback_any_ws(port, &pages)
                    .await
                    .map_err(|e| format!("{e}；另：{create_err}"))?;
                return Ok((ws, true));
            }
        }
    }
    let ws = fallback_any_ws(port, &pages).await?;
    Ok((ws, true))
}

fn emit_issue(app: &AppHandle, issue: ChromeDevtoolsIssue) {
    let _ = app.emit(EVENT_ISSUE, issue);
}

fn extract_exception_text(params: &Value) -> String {
    let details = params.get("exceptionDetails");
    let text = details
        .and_then(|d| d.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("exception");
    let desc = details
        .and_then(|d| d.get("exception"))
        .and_then(|e| e.get("description"))
        .and_then(|v| v.as_str())
        .or_else(|| {
            details
                .and_then(|d| d.get("exception"))
                .and_then(|e| e.get("value"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("");
    let url = details
        .and_then(|d| d.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let line = details
        .and_then(|d| d.get("lineNumber"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let mut out = if desc.is_empty() {
        text.to_string()
    } else {
        format!("{text}: {desc}")
    };
    if !url.is_empty() {
        out.push_str(&format!(" at {url}:{line}"));
    }
    out.replace('\n', " ").trim().to_string()
}

fn extract_console_text(params: &Value) -> String {
    let args = params
        .get("args")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let parts: Vec<String> = args
        .iter()
        .map(|arg| {
            arg.get("description")
                .and_then(|v| v.as_str())
                .or_else(|| arg.get("value").and_then(|v| v.as_str()))
                .map(|s| s.to_string())
                .or_else(|| {
                    arg.get("value")
                        .map(|v| v.to_string().trim_matches('"').to_string())
                })
                .unwrap_or_else(|| arg.to_string())
        })
        .collect();
    let joined = parts.join(" ").replace('\n', " ");
    joined.trim().to_string()
}

async fn run_cdp_loop(
    app: AppHandle,
    session_id: String,
    ws_url: String,
    navigate_url: Option<String>,
    mut cancel_rx: watch::Receiver<bool>,
    mut cmd_rx: mpsc::UnboundedReceiver<MonitorCmd>,
) {
    let Ok((ws, _)) = connect_async(&ws_url).await else {
        emit_issue(
            &app,
            ChromeDevtoolsIssue {
                session_id,
                kind: "page-error".into(),
                message: "无法连接 Chrome DevTools WebSocket".into(),
                url: None,
                method: None,
                status: None,
            },
        );
        return;
    };
    let (mut write, mut read) = ws.split();
    let next_id = AtomicU64::new(1);
    let mut request_urls: HashMap<String, (String, String)> = HashMap::new();

    let send = |method: &str, params: Value| {
        let id = next_id.fetch_add(1, Ordering::Relaxed);
        json!({ "id": id, "method": method, "params": params })
    };

    let mut bootstrap = vec![
        send("Network.enable", json!({})),
        send("Runtime.enable", json!({})),
        send("Page.enable", json!({})),
        send("Log.enable", json!({})),
    ];
    if let Some(url) = navigate_url {
        bootstrap.push(send("Page.navigate", json!({ "url": url })));
    }
    for msg in bootstrap {
        if write.send(Message::Text(msg.to_string())).await.is_err() {
            return;
        }
    }

    loop {
        tokio::select! {
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    break;
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(MonitorCmd::Reload) => {
                        let msg = send("Page.reload", json!({ "ignoreCache": true }));
                        if write.send(Message::Text(msg.to_string())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            frame = read.next() => {
                let Some(frame) = frame else { break; };
                let Ok(Message::Text(text)) = frame else { continue; };
                let Ok(value) = serde_json::from_str::<Value>(&text) else { continue; };

                if value.get("id").is_some() {
                    continue;
                }
                let Some(method) = value.get("method").and_then(|v| v.as_str()) else { continue; };
                let params = value.get("params").cloned().unwrap_or(json!({}));

                match method {
                    "Runtime.exceptionThrown" => {
                        let message = extract_exception_text(&params);
                        if message.is_empty() { continue; }
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "page-error".into(),
                            message,
                            url: params.pointer("/exceptionDetails/url").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            method: None,
                            status: None,
                        });
                    }
                    "Runtime.consoleAPICalled" => {
                        let level = params.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if level != "error" && level != "warning" && level != "assert" {
                            continue;
                        }
                        let message = extract_console_text(&params);
                        if message.is_empty() { continue; }
                        let kind = if level == "warning" { "console-warning" } else { "console-error" };
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: kind.into(),
                            message,
                            url: None,
                            method: None,
                            status: None,
                        });
                    }
                    "Network.requestWillBeSent" => {
                        let Some(request_id) = params.get("requestId").and_then(|v| v.as_str()) else { continue; };
                        let method_name = params.pointer("/request/method").and_then(|v| v.as_str()).unwrap_or("GET");
                        let url = params.pointer("/request/url").and_then(|v| v.as_str()).unwrap_or("");
                        request_urls.insert(request_id.to_string(), (method_name.to_string(), url.to_string()));
                    }
                    "Network.responseReceived" => {
                        let Some(request_id) = params.get("requestId").and_then(|v| v.as_str()) else { continue; };
                        let status = params.pointer("/response/status").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
                        if status < 400 { continue; }
                        let (method_name, url) = request_urls
                            .get(request_id)
                            .cloned()
                            .unwrap_or_else(|| {
                                let u = params.pointer("/response/url").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                ("GET".into(), u)
                            });
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "network-http".into(),
                            message: format!("{method_name} {url} {status}"),
                            url: Some(url),
                            method: Some(method_name),
                            status: Some(status),
                        });
                    }
                    "Network.loadingFailed" => {
                        let Some(request_id) = params.get("requestId").and_then(|v| v.as_str()) else { continue; };
                        let error_text = params.get("errorText").and_then(|v| v.as_str()).unwrap_or("failed");
                        let lower = error_text.to_ascii_lowercase();
                        if lower.contains("abort") || lower.contains("cancel") {
                            continue;
                        }
                        let (method_name, url) = request_urls
                            .remove(request_id)
                            .unwrap_or_else(|| ("GET".into(), String::new()));
                        emit_issue(&app, ChromeDevtoolsIssue {
                            session_id: session_id.clone(),
                            kind: "network-failed".into(),
                            message: error_text.to_string(),
                            url: if url.is_empty() { None } else { Some(url) },
                            method: Some(method_name),
                            status: None,
                        });
                    }
                    _ => {}
                }
            }
        }
    }
}

fn stop_session_locked(session: &mut MonitorSession) {
    let _ = session.cancel_tx.send(true);
    if let Some(task) = session.task.take() {
        task.abort();
    }
    // Only kill Chrome we launched ourselves. Attach mode keeps child = None.
    if let Some(mut child) = session.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn normalize_mode(mode: Option<String>) -> Result<&'static str, String> {
    match mode
        .as_deref()
        .unwrap_or("launch")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "" | "launch" | "standalone" | "new" => Ok("launch"),
        "attach" | "existing" | "reuse" => Ok("attach"),
        "extension" | "ext" | "plugin" => Ok("extension"),
        other => Err(format!(
            "未知监控模式「{other}」，请使用 launch / attach / extension"
        )),
    }
}

#[tauri::command]
pub async fn chrome_devtools_monitor_start(
    app: AppHandle,
    state: State<'_, ChromeDevtoolsMonitorState>,
    session_id: String,
    url: String,
    mode: Option<String>,
    debug_port: Option<u16>,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    let url = url.trim().to_string();
    if session_id.is_empty() {
        return Err("sessionId 不能为空".into());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("url 必须是 http(s)".into());
    }
    let mode = normalize_mode(mode)?;

    {
        let mut guard = state
            .sessions
            .lock()
            .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
        if let Some(mut existing) = guard.remove(&session_id) {
            stop_session_locked(&mut existing);
        }
    }

    let (child, ws_url, navigate_url) = if mode == "extension" {
        let port = crate::chrome_page_monitor_bridge::ensure_started(app.clone()).await?;
        crate::chrome_page_monitor_bridge::set_active_monitor(&session_id, &url)?;
        let (cancel_tx, cancel_rx) = watch::channel(false);
        let session_clone = session_id.clone();
        let task = tokio::spawn(async move {
            let mut cancel_rx = cancel_rx;
            loop {
                tokio::select! {
                    _ = cancel_rx.changed() => {
                        if *cancel_rx.borrow() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(3600)) => {}
                }
            }
            crate::chrome_page_monitor_bridge::clear_active_monitor(&session_clone);
        });
        let mut guard = state
            .sessions
            .lock()
            .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
        guard.insert(
            session_id.clone(),
            MonitorSession {
                child: None,
                cancel_tx,
                cmd_tx: None,
                extension_mode: true,
                task: Some(task),
            },
        );
        let _ = port;
        return Ok(());
    } else if mode == "attach" {
        let port = debug_port.unwrap_or(DEFAULT_ATTACH_DEBUG_PORT);
        if port == 0 {
            return Err("debugPort 无效".into());
        }
        probe_debug_port(port).await?;
        let (ws, should_navigate) = resolve_page_ws_url(port, &url).await?;
        (
            None,
            ws,
            if should_navigate {
                Some(url.clone())
            } else {
                None
            },
        )
    } else {
        let profile = wise_chrome_profile_dir(&session_id)?;
        let child = launch_chrome(&profile, &url)?;
        let (port, _path) = wait_for_devtools_port(&profile).await?;
        tokio::time::sleep(Duration::from_millis(400)).await;
        let (ws, _) = resolve_page_ws_url(port, &url).await?;
        (Some(child), ws, Some(url.clone()))
    };

    let (cancel_tx, cancel_rx) = watch::channel(false);
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let app_clone = app.clone();
    let session_clone = session_id.clone();
    let task = tokio::spawn(async move {
        run_cdp_loop(
            app_clone,
            session_clone,
            ws_url,
            navigate_url,
            cancel_rx,
            cmd_rx,
        )
        .await;
    });

    let mut guard = state
        .sessions
        .lock()
        .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
    guard.insert(
        session_id,
        MonitorSession {
            child,
            cancel_tx,
            cmd_tx: Some(cmd_tx),
            extension_mode: false,
            task: Some(task),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn chrome_devtools_monitor_reload(
    state: State<'_, ChromeDevtoolsMonitorState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("sessionId 不能为空".into());
    }
    let (extension_mode, cmd_tx) = {
        let guard = state
            .sessions
            .lock()
            .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
        let Some(session) = guard.get(&session_id) else {
            return Err("当前没有进行中的页面监控会话".into());
        };
        (session.extension_mode, session.cmd_tx.clone())
    };
    if extension_mode {
        crate::chrome_page_monitor_bridge::request_reload(&session_id)?;
        return Ok(());
    }
    let Some(tx) = cmd_tx else {
        return Err("当前监控会话不支持刷新".into());
    };
    tx.send(MonitorCmd::Reload)
        .map_err(|_| "页面刷新指令发送失败（监控连接可能已断开）".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn chrome_devtools_monitor_stop(
    state: State<'_, ChromeDevtoolsMonitorState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim().to_string();
    let mut guard = state
        .sessions
        .lock()
        .map_err(|_| "Chrome 监控状态锁失败".to_string())?;
    if let Some(mut existing) = guard.remove(&session_id) {
        stop_session_locked(&mut existing);
    }
    crate::chrome_page_monitor_bridge::clear_active_monitor(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn chrome_page_monitor_bridge_status(
    app: AppHandle,
) -> Result<crate::chrome_page_monitor_bridge::ActiveMonitorSnapshot, String> {
    let _ = crate::chrome_page_monitor_bridge::ensure_started(app).await?;
    Ok(crate::chrome_page_monitor_bridge::active_monitor_snapshot())
}

#[tauri::command]
pub fn chrome_page_monitor_extension_dir(app: AppHandle) -> Result<String, String> {
    crate::chrome_page_monitor_bridge::resolve_extension_dir(&app)
        .map(|p| p.display().to_string())
}

/// Export the app-bundled Chrome extension into `~/Downloads/wise-page-monitor`
/// and reveal that folder. Never opens the repo source tree.
#[tauri::command]
pub fn chrome_page_monitor_download_extension(app: AppHandle) -> Result<String, String> {
    let dest = crate::chrome_page_monitor_bridge::download_extension(&app)?;
    let path = dest.to_string_lossy().to_string();
    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|e| format!("扩展已下载到 {path}，但打开目录失败：{e}"))?;
    Ok(path)
}

/// Compatibility wrapper: same as [`chrome_page_monitor_download_extension`].
#[tauri::command]
pub fn chrome_page_monitor_open_extension_dir(app: AppHandle) -> Result<(), String> {
    chrome_page_monitor_download_extension(app).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{normalize_url_for_match, score_page_url_match, urlencoding_minimal};

    #[test]
    fn url_match_prefers_exact() {
        assert_eq!(
            score_page_url_match("http://localhost:3000/app", "http://localhost:3000/app"),
            100
        );
        assert!(
            score_page_url_match("http://localhost:3000/app", "http://localhost:3000/app/") >= 60
        );
        assert_eq!(
            score_page_url_match("http://localhost:3000/other", "http://localhost:3000/app"),
            30
        );
        assert_eq!(
            score_page_url_match("http://127.0.0.1:3000/", "http://localhost:3000/"),
            0
        );
    }

    #[test]
    fn normalize_strips_hash_and_slash() {
        assert_eq!(
            normalize_url_for_match("http://localhost:3000/app/#/x"),
            "http://localhost:3000/app"
        );
    }

    #[test]
    fn urlencoding_keeps_url_safe_chars() {
        let enc = urlencoding_minimal("http://localhost:3000/a b");
        assert!(enc.contains("http://localhost:3000/a"));
        assert!(enc.contains("%20"));
    }
}
