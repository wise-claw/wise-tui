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

use crate::chrome_devtools_monitor::ChromeDevtoolsIssue;

pub const DEFAULT_BRIDGE_PORT: u16 = 17321;
const EVENT_ISSUE: &str = "chrome-devtools-issue";

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
}

#[derive(Clone)]
struct BridgeInner {
    app: AppHandle,
    port: u16,
    /// Single active extension monitor: (sessionId, url)
    active: Arc<Mutex<Option<(String, String)>>>,
    reload_token: Arc<Mutex<u64>>,
}

struct RunningBridge {
    port: u16,
    active: Arc<Mutex<Option<(String, String)>>>,
    reload_token: Arc<Mutex<u64>>,
    shutdown_tx: Option<oneshot::Sender<()>>,
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
        Ok(guard) => {
            let (session_id, url) = guard
                .as_ref()
                .map(|(k, v)| (Some(k.clone()), Some(v.clone())))
                .unwrap_or((None, None));
            ActiveMonitorSnapshot {
                active: session_id.is_some(),
                session_id,
                url,
                port: inner.port,
                service: "wise-page-monitor".into(),
                reload_token,
            }
        }
        Err(_) => ActiveMonitorSnapshot {
            active: false,
            session_id: None,
            url: None,
            port: inner.port,
            service: "wise-page-monitor".into(),
            reload_token,
        },
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
    let session_allowed = inner
        .active
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|(sid, _)| sid == &session_id))
        .unwrap_or(false);
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
        "page-error" | "console-error" | "console-warning" | "network-http" | "network-failed"
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
    let active = Arc::new(Mutex::new(None::<(String, String)>));
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

pub fn set_active_monitor(session_id: &str, url: &str) -> Result<(), String> {
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
    *map = Some((sid.to_string(), u.to_string()));
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
    let Some((active_sid, _)) = active.as_ref() else {
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
        .is_some_and(|(sid, _)| sid == session_id.trim())
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
        return ActiveMonitorSnapshot {
            active: false,
            session_id: None,
            url: None,
            port: fallback_port,
            service: "wise-page-monitor".into(),
            reload_token: 0,
        };
    };
    let Some(running) = guard.as_ref() else {
        return ActiveMonitorSnapshot {
            active: false,
            session_id: None,
            url: None,
            port: fallback_port,
            service: "wise-page-monitor".into(),
            reload_token: 0,
        };
    };
    let reload_token = running
        .reload_token
        .lock()
        .ok()
        .map(|g| *g)
        .unwrap_or(0);
    let (session_id, url) = running
        .active
        .lock()
        .ok()
        .and_then(|g| {
            g.as_ref()
                .map(|(k, v)| (Some(k.clone()), Some(v.clone())))
        })
        .unwrap_or((None, None));
    ActiveMonitorSnapshot {
        active: session_id.is_some(),
        session_id,
        url,
        port: running.port,
        service: "wise-page-monitor".into(),
        reload_token,
    }
}

/// Resolve the unpacked Chrome extension directory (dev repo or bundled resource).
pub fn resolve_extension_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    // 1) Bundled resource (packaged app)
    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("browser-extensions/wise-page-monitor");
        if bundled.join("manifest.json").is_file() {
            return Ok(bundled);
        }
        let alt = resource.join("wise-page-monitor");
        if alt.join("manifest.json").is_file() {
            return Ok(alt);
        }
    }

    // 2) Dev: repo-relative from CARGO_MANIFEST_DIR / cwd
    let candidates = [
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../browser-extensions/wise-page-monitor"),
        std::env::current_dir()
            .unwrap_or_default()
            .join("browser-extensions/wise-page-monitor"),
        std::env::current_dir()
            .unwrap_or_default()
            .join("../browser-extensions/wise-page-monitor"),
    ];
    for path in candidates {
        if path.join("manifest.json").is_file() {
            return path.canonicalize().or(Ok(path));
        }
    }
    Err("未找到 Chrome 扩展目录 browser-extensions/wise-page-monitor".into())
}
