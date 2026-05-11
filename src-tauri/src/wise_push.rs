//! 可选 WebSocket：远端推送 JSON，走与 `wise_notification_ingest` 相同的入库与气泡逻辑。

use futures_util::StreamExt;
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::http::{header, HeaderValue, Request, Uri};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::connect_async;

use crate::wise_db::WiseDb;
use crate::wise_mascot::{IngestInboundPayload, WiseToastMerge, process_inbound_ingest};

pub struct WisePushControl {
    cancel_tx: Mutex<Option<oneshot::Sender<()>>>,
}

impl Default for WisePushControl {
    fn default() -> Self {
        Self {
            cancel_tx: Mutex::new(None),
        }
    }
}

impl WisePushControl {
    pub fn stop_locked(&self) {
        let mut g = self.cancel_tx.lock().unwrap();
        if let Some(tx) = g.take() {
            let _ = tx.send(());
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushFrame {
    conversation_id: String,
    body: String,
    #[serde(default)]
    message_id: Option<String>,
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        return s.to_string();
    }
    s.chars().take(max_chars).collect()
}

fn build_ws_request(url: &str, bearer_token: Option<&str>) -> Result<Request<()>, String> {
    let uri: Uri = url
        .parse::<Uri>()
        .map_err(|e: tokio_tungstenite::tungstenite::http::uri::InvalidUri| e.to_string())?;
    let mut b = Request::builder().method("GET").uri(uri);
    if let Some(t) = bearer_token.filter(|s| !s.is_empty()) {
        let hv = HeaderValue::from_str(&format!("Bearer {}", t))
            .map_err(|e| format!("Authorization 头无效: {}", e))?;
        b = b.header(header::AUTHORIZATION, hv);
    }
    b.body(()).map_err(|e| e.to_string())
}

async fn one_ws_session(app: &AppHandle, url: &str, token: Option<&str>) -> Result<(), String> {
    let req = build_ws_request(url, token)?;
    let (ws, _) = connect_async(req).await.map_err(|e| e.to_string())?;
    let (mut _write, mut read) = ws.split();
    while let Some(msg) = read.next().await {
        let msg = msg.map_err(|e| e.to_string())?;
        if let Message::Text(t) = msg {
            let frame: PushFrame = match serde_json::from_str(&t) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let payload = IngestInboundPayload {
                conversation_id: frame.conversation_id,
                body: truncate_chars(&frame.body, 8000),
                server_msg_id: frame.message_id,
            };
            let app2 = app.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let (Some(db), Some(merge)) = (
                    app2.try_state::<WiseDb>(),
                    app2.try_state::<WiseToastMerge>(),
                ) {
                    let _ = process_inbound_ingest(&app2, &db, &merge, payload);
                }
            })
            .await;
        }
    }
    Ok(())
}

async fn push_runner(app: AppHandle, url: String, token: Option<String>, mut cancel: oneshot::Receiver<()>) {
    loop {
        tokio::select! {
            _ = &mut cancel => break,
            r = one_ws_session(&app, &url, token.as_deref()) => {
                if r.is_err() {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                } else {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    }
}

#[tauri::command]
pub async fn wise_push_start(
    app: AppHandle,
    control: State<'_, WisePushControl>,
    url: String,
    bearer_token: Option<String>,
) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err("url 不能为空".to_string());
    }
    control.stop_locked();
    let (tx, rx) = oneshot::channel();
    *control.cancel_tx.lock().unwrap() = Some(tx);
    let app2 = app.clone();
    let u = url.trim().to_string();
    tauri::async_runtime::spawn(async move {
        push_runner(app2, u, bearer_token, rx).await;
    });
    Ok(())
}

#[tauri::command]
pub fn wise_push_stop(control: State<WisePushControl>) -> Result<(), String> {
    control.stop_locked();
    Ok(())
}
