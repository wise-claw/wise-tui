//! Localhost HTTP bridge for the Wise Chrome page-monitor extension.
//!
//! Binds `127.0.0.1` only. The extension polls `/v1/active-monitor` and posts
//! CDP-equivalent issues to `/v1/issues`, which are re-emitted as
//! `chrome-devtools-issue` for the existing frontend auto-fix pipeline.

use axum::extract::State as AxumState;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

use crate::chrome_devtools_monitor::{ChromeDevtoolsIssue, VitalsThresholds};

pub const DEFAULT_BRIDGE_PORT: u16 = 17321;
const EVENT_ISSUE: &str = "chrome-devtools-issue";

#[derive(Debug, Clone)]
struct ActiveExtensionMonitor {
    session_id: String,
    url: String,
    vitals: VitalsThresholds,
    synthetic_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveMonitorSnapshot {
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub port: u16,
    pub service: String,
    /// Monotonic token; extension reloads tabs when this increases.
    pub reload_token: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vitals: Option<VitalsThresholds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synthetic_interval_secs: Option<u64>,
}

fn empty_snapshot(port: u16, reload_token: u64) -> ActiveMonitorSnapshot {
    ActiveMonitorSnapshot {
        active: false,
        session_id: None,
        url: None,
        port,
        service: "wise-page-monitor".into(),
        reload_token,
        vitals: None,
        synthetic_interval_secs: None,
    }
}

fn snapshot_from(
    port: u16,
    reload_token: u64,
    active: Option<&ActiveExtensionMonitor>,
) -> ActiveMonitorSnapshot {
    match active {
        Some(a) => ActiveMonitorSnapshot {
            active: true,
            session_id: Some(a.session_id.clone()),
            url: Some(a.url.clone()),
            port,
            service: "wise-page-monitor".into(),
            reload_token,
            vitals: Some(a.vitals),
            synthetic_interval_secs: Some(a.synthetic_interval_secs),
        },
        None => empty_snapshot(port, reload_token),
    }
}

#[derive(Clone)]
struct BridgeInner {
    app: AppHandle,
    port: u16,
    /// Single active extension monitor.
    active: Arc<Mutex<Option<ActiveExtensionMonitor>>>,
    reload_token: Arc<Mutex<u64>>,
}

struct RunningBridge {
    port: u16,
    active: Arc<Mutex<Option<ActiveExtensionMonitor>>>,
    reload_token: Arc<Mutex<u64>>,
    /// Held open while the bridge runs; sending/dropping triggers graceful shutdown.
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl Drop for RunningBridge {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

static BRIDGE: Mutex<Option<RunningBridge>> = Mutex::new(None);

fn with_cors(mut res: Response) -> Response {
    let headers = res.headers_mut();
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type, authorization"),
    );
    res
}

fn session_matches_active(
    active: &Mutex<Option<ActiveExtensionMonitor>>,
    session_id: &str,
) -> bool {
    active
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|a| a.session_id == session_id))
        .unwrap_or(false)
}

async fn options_ok() -> Response {
    with_cors(StatusCode::NO_CONTENT.into_response())
}

async fn health(AxumState(inner): AxumState<BridgeInner>) -> Response {
    with_cors(
        Json(serde_json::json!({
            "ok": true,
            "service": "wise-page-monitor",
            "port": inner.port,
        }))
        .into_response(),
    )
}

async fn active_monitor(AxumState(inner): AxumState<BridgeInner>) -> Response {
    let reload_token = inner
        .reload_token
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0);
    let snap = match inner.active.lock() {
        Ok(guard) => snapshot_from(inner.port, reload_token, guard.as_ref()),
        Err(_) => empty_snapshot(inner.port, reload_token),
    };
    with_cors(Json(snap).into_response())
}

async fn post_issue(
    AxumState(inner): AxumState<BridgeInner>,
    Json(mut issue): Json<ChromeDevtoolsIssue>,
) -> Response {
    let session_id = issue.session_id.trim().to_string();
    if session_id.is_empty() {
        return with_cors(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": "sessionId required" })),
            )
                .into_response(),
        );
    }
    let session_allowed = session_matches_active(&inner.active, &session_id);
    if !session_allowed {
        return with_cors(
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "ok": false,
                    "error": "session is not the active page monitor"
                })),
            )
                .into_response(),
        );
    }
    let kind = issue.kind.trim().to_ascii_lowercase();
    let allowed_kind = matches!(
        kind.as_str(),
        "page-error"
            | "console-error"
            | "console-warning"
            | "network-http"
            | "network-failed"
            | "page-crash"
            | "page-vitals"
            | "long-task"
            | "slow-request"
            | "breadcrumb"
            | "page-timing"
            | "blank-screen"
            | "vitals-alert"
            | "synthetic-check"
    );
    if !allowed_kind || issue.message.trim().is_empty() {
        return with_cors(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": "invalid issue payload" })),
            )
                .into_response(),
        );
    }
    issue.session_id = session_id;
    issue.kind = kind;
    let _ = inner.app.emit(EVENT_ISSUE, issue);
    with_cors(Json(serde_json::json!({ "ok": true })).into_response())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvidencePayload {
    session_id: String,
    image_jpeg: String,
}

async fn post_evidence(
    AxumState(inner): AxumState<BridgeInner>,
    Json(payload): Json<EvidencePayload>,
) -> Response {
    let session_id = payload.session_id.trim().to_string();
    if session_id.is_empty() {
        return with_cors(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": "sessionId required" })),
            )
                .into_response(),
        );
    }
    let session_allowed = session_matches_active(&inner.active, &session_id);
    if !session_allowed {
        return with_cors(
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "ok": false,
                    "error": "session is not the active page monitor"
                })),
            )
                .into_response(),
        );
    }
    match crate::chrome_devtools_monitor::save_page_monitor_jpeg_evidence(
        &session_id,
        &payload.image_jpeg,
    ) {
        Ok(path) => with_cors(Json(serde_json::json!({ "ok": true, "path": path })).into_response()),
        Err(error) => with_cors(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": error })),
            )
                .into_response(),
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceLocationPayload {
    session_id: String,
    url: String,
    line: Option<u32>,
    column: Option<u32>,
}

async fn post_source_location(
    AxumState(inner): AxumState<BridgeInner>,
    Json(payload): Json<SourceLocationPayload>,
) -> Response {
    let session_id = payload.session_id.trim().to_string();
    if session_id.is_empty() {
        return with_cors(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": "sessionId required" })),
            )
                .into_response(),
        );
    }
    if !session_matches_active(&inner.active, &session_id) {
        return with_cors(
            (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "ok": false,
                    "error": "session is not the active page monitor"
                })),
            )
                .into_response(),
        );
    }
    let orig = crate::chrome_devtools_monitor::resolve_orig_source_location(
        payload.url.trim(),
        payload.line.unwrap_or(0),
        payload.column.unwrap_or(0),
    )
    .await;
    with_cors(Json(serde_json::json!({ "ok": true, "orig": orig })).into_response())
}

async fn bind_listener(preferred: u16) -> Result<(tokio::net::TcpListener, u16), String> {
    for offset in 0u16..=16 {
        let port = preferred.saturating_add(offset);
        if port == 0 {
            break;
        }
        if let Ok(listener) = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await {
            return Ok((listener, port));
        }
    }
    Err(format!(
        "无法绑定页面监控扩展桥端口（尝试 {preferred}–{}）",
        preferred.saturating_add(16)
    ))
}

/// Ensure the localhost bridge is running. Returns the bound port.
pub async fn ensure_started(app: AppHandle) -> Result<u16, String> {
    {
        let guard = BRIDGE.lock().map_err(|_| "扩展桥状态锁失败".to_string())?;
        if let Some(running) = guard.as_ref() {
            return Ok(running.port);
        }
    }

    let (listener, port) = bind_listener(DEFAULT_BRIDGE_PORT).await?;
    let active = Arc::new(Mutex::new(None::<ActiveExtensionMonitor>));
    let reload_token = Arc::new(Mutex::new(0u64));
    let inner = BridgeInner {
        app,
        port,
        active: active.clone(),
        reload_token: reload_token.clone(),
    };

    let router = Router::new()
        .route("/", get(health).options(options_ok))
        .route("/health", get(health).options(options_ok))
        .route(
            "/v1/active-monitor",
            get(active_monitor).options(options_ok),
        )
        .route("/v1/issues", post(post_issue).options(options_ok))
        .route("/v1/evidence", post(post_evidence).options(options_ok))
        .route(
            "/v1/source-location",
            post(post_source_location).options(options_ok),
        )
        .with_state(inner);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let serve = axum::serve(listener, router).with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
    });

    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve.await {
            eprintln!("[chrome_page_monitor_bridge] server error: {e}");
        }
        if let Ok(mut guard) = BRIDGE.lock() {
            *guard = None;
        }
    });

    // Brief yield so the listener is accepting before callers probe.
    tokio::task::yield_now().await;

    let mut guard = BRIDGE.lock().map_err(|_| "扩展桥状态锁失败".to_string())?;
    *guard = Some(RunningBridge {
        port,
        active,
        reload_token,
        shutdown_tx: Some(shutdown_tx),
    });
    Ok(port)
}

pub fn set_active_monitor(
    session_id: &str,
    url: &str,
    vitals: VitalsThresholds,
    synthetic_interval_secs: u64,
) -> Result<(), String> {
    let sid = session_id.trim();
    let u = url.trim();
    if sid.is_empty() || u.is_empty() {
        return Err("sessionId/url 不能为空".into());
    }
    let guard = BRIDGE.lock().map_err(|_| "扩展桥状态锁失败".to_string())?;
    let Some(running) = guard.as_ref() else {
        return Err("扩展桥未启动".into());
    };
    let mut map = running
        .active
        .lock()
        .map_err(|_| "扩展桥状态锁失败".to_string())?;
    *map = Some(ActiveExtensionMonitor {
        session_id: sid.to_string(),
        url: u.to_string(),
        vitals,
        synthetic_interval_secs,
    });
    if let Ok(mut token) = running.reload_token.lock() {
        *token = 0;
    }
    Ok(())
}

pub fn request_reload(session_id: &str) -> Result<(), String> {
    let sid = session_id.trim();
    if sid.is_empty() {
        return Err("sessionId 不能为空".into());
    }
    let guard = BRIDGE.lock().map_err(|_| "扩展桥状态锁失败".to_string())?;
    let Some(running) = guard.as_ref() else {
        return Err("扩展桥未启动".into());
    };
    let active = running
        .active
        .lock()
        .map_err(|_| "扩展桥状态锁失败".to_string())?;
    let Some(active_sid) = active.as_ref().map(|a| a.session_id.as_str()) else {
        return Err("当前没有扩展模式的活动监控".into());
    };
    if active_sid != sid {
        return Err("session 不是当前扩展监控目标".into());
    }
    drop(active);
    let mut token = running
        .reload_token
        .lock()
        .map_err(|_| "扩展桥状态锁失败".to_string())?;
    *token = token.saturating_add(1).max(1);
    Ok(())
}

pub fn clear_active_monitor(session_id: &str) {
    let Ok(guard) = BRIDGE.lock() else {
        return;
    };
    let Some(running) = guard.as_ref() else {
        return;
    };
    let Ok(mut map) = running.active.lock() else {
        return;
    };
    if map
        .as_ref()
        .is_some_and(|a| a.session_id == session_id.trim())
    {
        *map = None;
    }
}

pub fn bridge_port() -> Option<u16> {
    BRIDGE.lock().ok().and_then(|g| g.as_ref().map(|r| r.port))
}

pub fn active_monitor_snapshot() -> ActiveMonitorSnapshot {
    let fallback_port = bridge_port().unwrap_or(DEFAULT_BRIDGE_PORT);
    let Ok(guard) = BRIDGE.lock() else {
        return empty_snapshot(fallback_port, 0);
    };
    let Some(running) = guard.as_ref() else {
        return empty_snapshot(fallback_port, 0);
    };
    let reload_token = running
        .reload_token
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0);
    let active = running.active.lock().ok();
    snapshot_from(running.port, reload_token, active.as_ref().and_then(|g| g.as_ref()))
}

const EXTENSION_DIR_NAME: &str = "wise-page-monitor";

/// Resolve the *source* unpacked Chrome extension (bundled resource, then dev tree).
/// User-facing load path must go through [`download_extension`] — never open the repo copy.
pub fn resolve_extension_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    // 1) Bundled resource (packaged app)
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("browser-extensions").join(EXTENSION_DIR_NAME);
        if bundled.join("manifest.json").is_file() {
            return Ok(bundled);
        }
        let alt = resource.join(EXTENSION_DIR_NAME);
        if alt.join("manifest.json").is_file() {
            return Ok(alt);
        }
    }

    // 2) Dev: repo-relative from CARGO_MANIFEST_DIR / cwd (source only)
    let candidates = [
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../browser-extensions")
            .join(EXTENSION_DIR_NAME),
        std::env::current_dir()
            .unwrap_or_default()
            .join("browser-extensions")
            .join(EXTENSION_DIR_NAME),
        std::env::current_dir()
            .unwrap_or_default()
            .join("../browser-extensions")
            .join(EXTENSION_DIR_NAME),
    ];
    for path in candidates {
        if path.join("manifest.json").is_file() {
            return path.canonicalize().or(Ok(path));
        }
    }
    Err("未找到 Chrome 扩展资源 browser-extensions/wise-page-monitor".into())
}

fn extension_download_dest() -> Result<std::path::PathBuf, String> {
    let downloads = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .ok_or_else(|| "无法解析下载目录".to_string())?;
    Ok(downloads.join(EXTENSION_DIR_NAME))
}

fn should_skip_extension_entry(name: &std::ffi::OsStr) -> bool {
    let Some(s) = name.to_str() else {
        return true;
    };
    matches!(s, "README.md" | ".DS_Store" | ".git" | ".gitignore")
}

fn copy_extension_dir(source: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!("{} 不是目录", source.display()));
    }
    if dest.exists() {
        std::fs::remove_dir_all(dest).map_err(|e| format!("清理旧扩展目录失败：{e}"))?;
    }
    std::fs::create_dir_all(dest).map_err(|e| format!("创建下载目录失败：{e}"))?;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if should_skip_extension_entry(&name) {
            continue;
        }
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        let s = entry.path();
        let d = dest.join(&name);
        if ft.is_dir() {
            copy_extension_dir(&s, &d)?;
        } else if ft.is_file() {
            if let Some(parent) = d.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&s, &d).map_err(|e| format!("复制 {} 失败：{e}", s.display()))?;
        }
    }
    Ok(())
}

/// Copy the app-bundled extension into the user Downloads folder for Chrome「加载已解压扩展」.
/// Returns the destination path (never the repo / resource path).
pub fn download_extension(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let source = resolve_extension_dir(app)?;
    let dest = extension_download_dest()?;
    // Avoid copying onto itself if Downloads somehow points at the source.
    let same = match (source.canonicalize(), dest.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    };
    if same {
        return Ok(dest);
    }
    copy_extension_dir(&source, &dest)?;
    if !dest.join("manifest.json").is_file() {
        return Err("扩展下载不完整：缺少 manifest.json".into());
    }
    Ok(dest)
}

#[cfg(test)]
mod extension_export_tests {
    use super::{copy_extension_dir, should_skip_extension_entry};
    use std::ffi::OsStr;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn skips_readme_and_junk() {
        assert!(should_skip_extension_entry(OsStr::new("README.md")));
        assert!(should_skip_extension_entry(OsStr::new(".DS_Store")));
        assert!(!should_skip_extension_entry(OsStr::new("manifest.json")));
    }

    #[test]
    fn copy_extension_dir_writes_manifest() {
        let root = std::env::temp_dir().join(format!(
            "wise-page-monitor-export-{}",
            std::process::id()
        ));
        let source = root.join("src");
        let dest = root.join("out");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(source.join("icons")).unwrap();
        fs::write(source.join("manifest.json"), r#"{"manifest_version":3}"#).unwrap();
        fs::write(source.join("README.md"), "skip me").unwrap();
        fs::write(source.join("background.js"), "// ok").unwrap();
        fs::write(source.join("icons").join("icon16.png"), b"png").unwrap();

        copy_extension_dir(&source, &dest).unwrap();
        assert!(dest.join("manifest.json").is_file());
        assert!(dest.join("background.js").is_file());
        assert!(dest.join("icons").join("icon16.png").is_file());
        assert!(!dest.join("README.md").exists());

        let _ = fs::remove_dir_all(&root);
        let _: PathBuf = root;
    }
}
