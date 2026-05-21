//! 本机内嵌钉钉 Stream 网关：用已保存的企业应用 Client ID / Secret 连接钉钉长连接，
//! 收到机器人文本 / 图片回调后组包为 `wiseAutomation: dingtalk:v1`，再走 `process_inbound_ingest`。

use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64_STANDARD;
use base64::Engine;
use chrono::{SecondsFormat, Utc};
use futures_util::{SinkExt, StreamExt};
use reqwest::Url;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::Manager;
use tauri::State;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::dingtalk_enterprise_bot::dingtalk_internal_access_token;
use crate::wise_db::WiseDb;
use crate::wise_mascot::{process_inbound_ingest, IngestInboundPayload, WiseToastMerge};

const SETTINGS_KEY: &str = "wise.dingtalk.enterprise_bot.v1";
const CONNECTIONS_OPEN: &str = "https://api.dingtalk.com/v1.0/gateway/connections/open";
const ROBOT_MESSAGE_FILE_DOWNLOAD: &str =
    "https://api.dingtalk.com/v1.0/robot/messageFiles/download";
/// 钉钉单聊图片常见约 5MB；此处允许到 6MiB 二进制，避免网关侧误拒收。
const MAX_INGEST_IMAGE_BYTES: usize = 6 * 1024 * 1024;

pub struct DingTalkStreamGatewayControl {
    join: Mutex<Option<tokio::task::JoinHandle<()>>>,
    runtime: Mutex<DingTalkStreamGatewayRuntime>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkStreamGatewayStatus {
    pub running: bool,
    pub phase: String,
    pub started_at: Option<String>,
    pub connected_at: Option<String>,
    pub last_inbound_at: Option<String>,
    pub last_error_at: Option<String>,
    pub last_error: Option<String>,
    pub last_stopped_at: Option<String>,
}

#[derive(Debug, Clone)]
struct DingTalkStreamGatewayRuntime {
    phase: String,
    started_at: Option<String>,
    connected_at: Option<String>,
    last_inbound_at: Option<String>,
    last_error_at: Option<String>,
    last_error: Option<String>,
    last_stopped_at: Option<String>,
}

impl Default for DingTalkStreamGatewayRuntime {
    fn default() -> Self {
        Self {
            phase: "stopped".to_string(),
            started_at: None,
            connected_at: None,
            last_inbound_at: None,
            last_error_at: None,
            last_error: None,
            last_stopped_at: None,
        }
    }
}

impl Default for DingTalkStreamGatewayControl {
    fn default() -> Self {
        Self {
            join: Mutex::new(None),
            runtime: Mutex::new(DingTalkStreamGatewayRuntime::default()),
        }
    }
}

impl DingTalkStreamGatewayControl {
    pub fn stop_locked(&self) {
        if let Some(h) = self.join.lock().unwrap().take() {
            h.abort();
        }
        self.mark_stopped();
    }

    pub fn is_running(&self) -> bool {
        self.join
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|h| !h.is_finished())
    }

    pub fn status(&self) -> DingTalkStreamGatewayStatus {
        let running = self.is_running();
        let runtime = self.runtime.lock().unwrap().clone();
        DingTalkStreamGatewayStatus {
            running,
            phase: if running {
                runtime.phase
            } else {
                "stopped".to_string()
            },
            started_at: runtime.started_at,
            connected_at: runtime.connected_at,
            last_inbound_at: runtime.last_inbound_at,
            last_error_at: runtime.last_error_at,
            last_error: runtime.last_error,
            last_stopped_at: runtime.last_stopped_at,
        }
    }

    fn mark_started(&self) {
        let mut runtime = self.runtime.lock().unwrap();
        runtime.phase = "connecting".to_string();
        runtime.started_at = Some(now_rfc3339());
        runtime.connected_at = None;
        runtime.last_error_at = None;
        runtime.last_error = None;
        runtime.last_stopped_at = None;
    }

    fn mark_connecting(&self) {
        self.runtime.lock().unwrap().phase = "connecting".to_string();
    }

    fn mark_connected(&self) {
        let mut runtime = self.runtime.lock().unwrap();
        runtime.phase = "connected".to_string();
        runtime.connected_at = Some(now_rfc3339());
        runtime.last_error_at = None;
        runtime.last_error = None;
    }

    fn mark_inbound(&self) {
        self.runtime.lock().unwrap().last_inbound_at = Some(now_rfc3339());
    }

    fn mark_error(&self, error: &str) {
        let mut runtime = self.runtime.lock().unwrap();
        runtime.phase = "reconnecting".to_string();
        runtime.last_error_at = Some(now_rfc3339());
        runtime.last_error = Some(error.chars().take(900).collect());
    }

    fn mark_stopped(&self) {
        let mut runtime = self.runtime.lock().unwrap();
        runtime.phase = "stopped".to_string();
        runtime.last_stopped_at = Some(now_rfc3339());
    }
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn frame_headers(frame: &Value) -> Option<&serde_json::Map<String, Value>> {
    frame
        .get("headers")
        .and_then(|h| h.as_object())
        .or_else(|| frame.get("header").and_then(|h| h.as_object()))
}

fn parse_saved_enterprise_bot_config(
    raw: Option<String>,
) -> Result<(String, String, String), String> {
    let raw = raw.ok_or_else(|| {
        "未找到钉钉配置：请先在侧栏保存 AppKey（Client ID）与 AppSecret（Client Secret）"
            .to_string()
    })?;
    let v: Value =
        serde_json::from_str(&raw).map_err(|e| format!("解析钉钉配置 JSON 失败: {}", e))?;
    let app_key = v
        .get("appKey")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let app_secret = v
        .get("appSecret")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let robot_code = v
        .get("robotCode")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if app_key.is_empty() || app_secret.is_empty() {
        return Err("钉钉配置中缺少 appKey 或 appSecret".to_string());
    }
    Ok((app_key, app_secret, robot_code))
}

async fn register_stream_ticket(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, String), String> {
    let client = reqwest::Client::new();
    let body = json!({
        "clientId": client_id,
        "clientSecret": client_secret,
        "subscriptions": [
            { "topic": "*", "type": "EVENT" },
            { "topic": "/v1.0/im/bot/messages/get", "type": "CALLBACK" }
        ],
        "ua": concat!("wise/", env!("CARGO_PKG_VERSION"), " rust"),
    });
    let resp = client
        .post(CONNECTIONS_OPEN)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("connections/open 请求失败: {}", e))?;
    let status = resp.status();
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("connections/open 解析 JSON 失败: {}", e))?;
    if !status.is_success() {
        return Err(format!(
            "connections/open HTTP {}: {}",
            status,
            v.to_string()
        ));
    }
    let endpoint = v
        .get("endpoint")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("connections/open 缺少 endpoint: {}", v))?;
    let ticket = v
        .get("ticket")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("connections/open 缺少 ticket: {}", v))?;
    Ok((endpoint.to_string(), ticket.to_string()))
}

fn build_ws_url(endpoint: &str, ticket: &str) -> Result<Url, String> {
    let base = endpoint.split('?').next().unwrap_or(endpoint).trim();
    let mut u = Url::parse(base).map_err(|e| format!("endpoint 非合法 URL: {} — {}", base, e))?;
    u.query_pairs_mut().append_pair("ticket", ticket);
    Ok(u)
}

fn ack_callback_ok(message_id: &str) -> String {
    json!({
        "code": 200,
        "message": "OK",
        "headers": {
            "messageId": message_id,
            "contentType": "application/json"
        },
        "data": "{\"response\": null}"
    })
    .to_string()
}

fn ack_event_ok(message_id: &str) -> String {
    json!({
        "code": 200,
        "message": "OK",
        "headers": {
            "messageId": message_id,
            "contentType": "application/json"
        },
        "data": "{\"status\":\"SUCCESS\",\"message\":\"wise\"}"
    })
    .to_string()
}

fn ack_ping_ok(message_id: &str, opaque: &str) -> String {
    let data =
        serde_json::to_string(&json!({ "opaque": opaque })).unwrap_or_else(|_| "{}".to_string());
    json!({
        "code": 200,
        "message": "OK",
        "headers": {
            "messageId": message_id,
            "contentType": "application/json"
        },
        "data": data
    })
    .to_string()
}

fn ack_unknown_ok(message_id: &str) -> String {
    json!({
        "code": 200,
        "message": "OK",
        "headers": {
            "messageId": message_id,
            "contentType": "application/json"
        },
        "data": "{}"
    })
    .to_string()
}

fn resolve_bot_sender_user_id(inner: &Value) -> Result<String, String> {
    for key in [
        "senderStaffId",
        "senderId",
        "userId",
        "senderUserId",
        "fromUserId",
        "senderUnionId",
    ] {
        if let Some(s) = inner.get(key).and_then(|x| x.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Ok(t.to_string());
            }
        }
    }
    Err(
        "机器人回调缺少发送方 userId（已尝试 senderStaffId / senderId / userId 等字段）"
            .to_string(),
    )
}

/// Stream 帧 `data` 在协议上为 JSON 字符串，但部分网关/SDK 可能已解析为 Object，需兼容。
fn parse_bot_callback_inner(frame: &Value) -> Result<Value, String> {
    let data = frame.get("data").ok_or("Stream 帧缺少 data")?;
    match data {
        Value::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Err("Stream 帧 data 为空字符串".to_string());
            }
            serde_json::from_str(t).map_err(|e| format!("data JSON 字符串解析失败: {}", e))
        }
        Value::Object(_) => Ok(data.clone()),
        other => Err(format!("Stream 帧 data 类型不支持: {:?}", other)),
    }
}

fn callback_msgtype(inner: &Value) -> String {
    inner
        .get("msgtype")
        .or_else(|| inner.get("msgType"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

/// 钉钉「图文混排」：`msgtype=richText`，正文与多图在 `content.richText` 数组中。
fn parse_richtext_text_and_image_codes(inner: &Value) -> (String, Vec<String>) {
    let mut text_chunks: Vec<String> = Vec::new();
    let mut codes: Vec<String> = Vec::new();
    let Some(items) = inner
        .get("content")
        .and_then(|c| c.get("richText"))
        .and_then(|x| x.as_array())
        .or_else(|| inner.get("richText").and_then(|x| x.as_array()))
    else {
        return (String::new(), codes);
    };
    for item in items {
        if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
            let s = t.trim();
            if !s.is_empty() {
                text_chunks.push(s.to_string());
            }
        }
        let item_type = item
            .get("type")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if let Some(dc) = item
            .get("downloadCode")
            .and_then(|x| x.as_str())
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(String::from)
        {
            let t = item_type.as_str();
            // 文档为 type=picture；无 type 且无 text 时按图片块处理
            let picture_like =
                t == "picture" || t == "image" || (t.is_empty() && item.get("text").is_none());
            if picture_like {
                codes.push(dc);
            }
        }
    }
    (text_chunks.join("\n").trim().to_string(), codes)
}

/// 官方文档为 `content.downloadCode`；部分通道可能挂在 `picture` 下。
fn extract_picture_download_code(inner: &Value) -> Option<String> {
    let code = inner
        .get("content")
        .and_then(|c| c.get("downloadCode"))
        .and_then(|x| x.as_str())
        .or_else(|| {
            inner
                .get("picture")
                .and_then(|p| p.get("downloadCode"))
                .and_then(|x| x.as_str())
        })?;
    let t = code.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

fn sniff_image_mime_from_magic(bytes: &[u8]) -> &'static str {
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return "image/jpeg";
    }
    if bytes.len() >= 8 && bytes[0..8] == [0x89u8, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return "image/png";
    }
    if bytes.len() >= 6 && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46 {
        return "image/gif";
    }
    if bytes.len() >= 12
        && bytes[0..4] == [0x52u8, 0x49, 0x46, 0x46]
        && bytes[8..12] == [0x57u8, 0x45, 0x42, 0x50]
    {
        return "image/webp";
    }
    "application/octet-stream"
}

fn pick_download_url_from_json(v: &Value) -> Option<String> {
    v.get("downloadUrl")
        .or_else(|| v.get("downloadURL"))
        .or_else(|| v.get("result").and_then(|r| r.get("downloadUrl")))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

async fn dingtalk_robot_resolve_download_url(
    access_token: &str,
    robot_code: &str,
    download_code: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(ROBOT_MESSAGE_FILE_DOWNLOAD)
        .header("x-acs-dingtalk-access-token", access_token)
        .header("Content-Type", "application/json")
        .json(&json!({ "downloadCode": download_code, "robotCode": robot_code }))
        .send()
        .await
        .map_err(|e| format!("messageFiles/download 请求失败: {}", e))?;
    let status = resp.status();
    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("messageFiles/download 解析 JSON 失败: {}", e))?;
    if !status.is_success() {
        return Err(format!("messageFiles/download HTTP {}: {}", status, v));
    }
    if let Some(code) = v.get("code").and_then(|c| c.as_str()) {
        if !code.is_empty() && code != "OK" {
            let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("");
            return Err(format!(
                "messageFiles/download code={} message={}",
                code, msg
            ));
        }
    }
    pick_download_url_from_json(&v)
        .ok_or_else(|| format!("messageFiles/download 未返回 downloadUrl: {}", v))
}

async fn http_get_bytes_limited(
    url: &str,
    max_bytes: usize,
) -> Result<(Vec<u8>, Option<String>), String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载文件内容失败: {}", e))?;
    let status = resp.status();
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|x| x.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string());
    if !status.is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("下载文件内容 HTTP {}: {}", status, t));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("读取下载正文失败: {}", e))?;
    if bytes.len() > max_bytes {
        return Err(format!("下载文件超过 {} 字节上限", max_bytes));
    }
    Ok((bytes.to_vec(), ctype))
}

async fn dingtalk_fetch_image_data_url_for_code(
    app_key: &str,
    app_secret: &str,
    robot_code: &str,
    download_code: &str,
) -> Result<String, String> {
    let token = dingtalk_internal_access_token(app_key, app_secret).await?;
    let dl_url = dingtalk_robot_resolve_download_url(&token, robot_code, download_code).await?;
    let (bytes, ctype_hint) = http_get_bytes_limited(&dl_url, MAX_INGEST_IMAGE_BYTES).await?;
    let mime = ctype_hint
        .as_deref()
        .filter(|m| m.starts_with("image/"))
        .unwrap_or_else(|| sniff_image_mime_from_magic(&bytes));
    let b64 = B64_STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

fn dispatch_dingtalk_automation_ingest(
    app: tauri::AppHandle,
    automation: Value,
    conv: String,
    msg_id: Option<String>,
) {
    let body = match serde_json::to_string(&automation) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("dingtalk_stream_gateway: 序列化自动化 JSON 失败: {}", e);
            return;
        }
    };
    let conversation_id = format!("dingtalk-stream:{conv}");
    let payload = IngestInboundPayload {
        conversation_id,
        body,
        server_msg_id: msg_id,
    };
    tokio::task::spawn_blocking(move || {
        match (app.try_state::<WiseDb>(), app.try_state::<WiseToastMerge>()) {
            (Some(db), Some(merge)) => {
                if let Err(e) = process_inbound_ingest(&app, &db, &merge, payload) {
                    eprintln!(
                        "dingtalk_stream_gateway: process_inbound_ingest 失败: {}",
                        e
                    );
                }
            }
            (db_ok, merge_ok) => {
                eprintln!(
                    "dingtalk_stream_gateway: 入站未写入（WiseDb 可用={} WiseToastMerge 可用={}）",
                    db_ok.is_some(),
                    merge_ok.is_some()
                );
            }
        }
    });
}

fn ingest_bot_text_message_sync(app: &tauri::AppHandle, inner: &Value) -> Result<(), String> {
    let prompt = inner
        .get("text")
        .and_then(|t| t.get("content"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if prompt.is_empty() {
        return Ok(());
    }
    let ding_user = resolve_bot_sender_user_id(inner)?;
    let conv = inner
        .get("conversationId")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .trim()
        .to_string();
    let msg_id = inner
        .get("msgId")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let automation = json!({
        "wiseAutomation": "dingtalk:v1",
        "dingTalkUserId": ding_user,
        "prompt": prompt,
    });
    dispatch_dingtalk_automation_ingest(app.clone(), automation, conv, msg_id);
    Ok(())
}

async fn ingest_bot_picture_message(app: &tauri::AppHandle, inner: &Value) -> Result<(), String> {
    let Some(download_code) = extract_picture_download_code(inner) else {
        return Ok(());
    };

    let ding_user = resolve_bot_sender_user_id(inner)?;
    let conv = inner
        .get("conversationId")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .trim()
        .to_string();
    let msg_id = inner
        .get("msgId")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let pipeline = async {
        let db = app
            .try_state::<WiseDb>()
            .ok_or_else(|| "WiseDb 不可用".to_string())?;
        let (app_key, app_secret, saved_robot) =
            parse_saved_enterprise_bot_config(db.get_setting(SETTINGS_KEY)?)?;
        let robot_code = inner
            .get("robotCode")
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let s = saved_robot.trim().to_string();
                if s.is_empty() {
                    None
                } else {
                    Some(s)
                }
            })
            .ok_or_else(|| {
                "图片入站需要 robotCode：请在回调 JSON 或侧栏机器人配置中填写 robotCode".to_string()
            })?;

        dingtalk_fetch_image_data_url_for_code(&app_key, &app_secret, &robot_code, &download_code)
            .await
    }
    .await;

    match pipeline {
        Ok(data_url) => {
            let automation = json!({
                "wiseAutomation": "dingtalk:v1",
                "dingTalkUserId": ding_user,
                "prompt": "（来自钉钉的图片消息，请结合附图处理。）",
                "imageDataUrls": [data_url],
            });
            dispatch_dingtalk_automation_ingest(app.clone(), automation, conv, msg_id);
        }
        Err(e) => {
            eprintln!("dingtalk_stream_gateway ingest picture: {}", e);
            let mut msg = format!(
                "【钉钉图片入站失败】{}。若为超大图（当前单张上限约 {}MB）、网络或鉴权问题，请压缩图片、检查机器人配置后重试。",
                e,
                MAX_INGEST_IMAGE_BYTES / (1024 * 1024)
            );
            let max_chars = 900usize;
            if msg.chars().count() > max_chars {
                msg = msg.chars().take(max_chars).collect::<String>() + "…";
            }
            let automation = json!({
                "wiseAutomation": "dingtalk:v1",
                "dingTalkUserId": ding_user,
                "prompt": msg,
            });
            dispatch_dingtalk_automation_ingest(app.clone(), automation, conv, msg_id);
        }
    }

    Ok(())
}

/// `msgtype=richText`：合并 `content.richText` 中的文本块，并依次下载图片块。
async fn ingest_bot_richtext_message(app: &tauri::AppHandle, inner: &Value) -> Result<(), String> {
    let (prompt, download_codes) = parse_richtext_text_and_image_codes(inner);
    if prompt.is_empty() && download_codes.is_empty() {
        return Ok(());
    }

    let ding_user = resolve_bot_sender_user_id(inner)?;
    let conv = inner
        .get("conversationId")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .trim()
        .to_string();
    let msg_id = inner
        .get("msgId")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if download_codes.is_empty() {
        if !prompt.is_empty() {
            let automation = json!({
                "wiseAutomation": "dingtalk:v1",
                "dingTalkUserId": ding_user,
                "prompt": prompt,
            });
            dispatch_dingtalk_automation_ingest(app.clone(), automation, conv, msg_id);
        }
        return Ok(());
    }

    let db = app
        .try_state::<WiseDb>()
        .ok_or_else(|| "WiseDb 不可用".to_string())?;
    let (app_key, app_secret, saved_robot) =
        parse_saved_enterprise_bot_config(db.get_setting(SETTINGS_KEY)?)?;
    let robot_code = inner
        .get("robotCode")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let s = saved_robot.trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        })
        .ok_or_else(|| {
            "图文入站需要 robotCode：请在回调 JSON 或侧栏机器人配置中填写 robotCode".to_string()
        })?;

    const MAX_RICHTEXT_IMAGES: usize = 12;
    let mut data_urls: Vec<String> = Vec::new();
    let mut errs: Vec<String> = Vec::new();
    for (i, dc) in download_codes.iter().take(MAX_RICHTEXT_IMAGES).enumerate() {
        match dingtalk_fetch_image_data_url_for_code(&app_key, &app_secret, &robot_code, dc).await {
            Ok(url) => data_urls.push(url),
            Err(e) => errs.push(format!("图{}: {}", i + 1, e)),
        }
    }

    let mut prompt_final = prompt;
    if !errs.is_empty() {
        let note = errs.join("；");
        if prompt_final.is_empty() {
            prompt_final = format!("【钉钉图文：部分图片下载失败】{}", note);
        } else {
            prompt_final = format!("{}\n\n【部分图片下载失败】{}", prompt_final, note);
        }
    }

    if data_urls.is_empty() {
        if prompt_final.trim().is_empty() {
            return Ok(());
        }
        let automation = json!({
            "wiseAutomation": "dingtalk:v1",
            "dingTalkUserId": ding_user,
            "prompt": prompt_final,
        });
        dispatch_dingtalk_automation_ingest(app.clone(), automation, conv, msg_id);
        return Ok(());
    }

    if prompt_final.trim().is_empty() {
        prompt_final = "（来自钉钉的图文消息，请结合附图处理。）".to_string();
    }

    let automation = json!({
        "wiseAutomation": "dingtalk:v1",
        "dingTalkUserId": ding_user,
        "prompt": prompt_final,
        "imageDataUrls": data_urls,
    });
    dispatch_dingtalk_automation_ingest(app.clone(), automation, conv, msg_id);
    Ok(())
}

async fn ingest_bot_callback_message(app: tauri::AppHandle, inner: Value) {
    let msg_type = callback_msgtype(&inner);
    let res = match msg_type.as_str() {
        "text" => ingest_bot_text_message_sync(&app, &inner),
        "picture" | "image" => ingest_bot_picture_message(&app, &inner).await,
        "richtext" | "rich_text" => ingest_bot_richtext_message(&app, &inner).await,
        other => {
            if other.is_empty() {
                if inner.get("conversationId").is_some() || inner.get("msgId").is_some() {
                    let keys = inner
                        .as_object()
                        .map(|m| m.keys().map(|k| k.as_str()).collect::<Vec<_>>())
                        .unwrap_or_default();
                    eprintln!(
                        "dingtalk_stream_gateway: 机器人回调缺少 msgtype，顶层字段: {:?}",
                        keys
                    );
                }
            } else {
                eprintln!(
                    "dingtalk_stream_gateway: 未处理的机器人 msgtype={}（已支持 text / picture / richText）",
                    other
                );
            }
            Ok(())
        }
    };
    if let Err(e) = res {
        eprintln!("dingtalk_stream_gateway ingest: {}", e);
    }
}

fn handle_stream_text(app: &tauri::AppHandle, text: &str) -> Result<String, String> {
    let frame: Value =
        serde_json::from_str(text).map_err(|e| format!("Stream 帧非 JSON: {}", e))?;
    let headers = frame_headers(&frame).ok_or("Stream 帧缺少 headers")?;
    let message_id = headers
        .get("messageId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    if message_id.is_empty() {
        return Err("Stream 帧缺少 messageId".to_string());
    }

    let topic = headers.get("topic").and_then(|x| x.as_str()).unwrap_or("");
    let spec_type = frame
        .get("type")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_ascii_uppercase();

    match (spec_type.as_str(), topic) {
        ("SYSTEM", "ping") => {
            let data_str = frame.get("data").and_then(|x| x.as_str()).unwrap_or("{}");
            let inner: Value =
                serde_json::from_str(data_str).map_err(|e| format!("ping data: {}", e))?;
            let opaque = inner
                .get("opaque")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            Ok(ack_ping_ok(&message_id, &opaque))
        }
        ("SYSTEM", "disconnect") => Ok(ack_unknown_ok(&message_id)),
        ("CALLBACK", "/v1.0/im/bot/messages/get") => {
            let inner =
                parse_bot_callback_inner(&frame).map_err(|e| format!("机器人回调: {}", e))?;
            if let Some(control) = app.try_state::<DingTalkStreamGatewayControl>() {
                control.mark_inbound();
            }
            let app_handle = app.clone();
            tokio::spawn(async move {
                ingest_bot_callback_message(app_handle, inner).await;
            });
            Ok(ack_callback_ok(&message_id))
        }
        ("EVENT", _) => Ok(ack_event_ok(&message_id)),
        _ => Ok(ack_unknown_ok(&message_id)),
    }
}

async fn one_stream_session(app: &tauri::AppHandle) -> Result<(), String> {
    let (client_id, client_secret, _) = {
        let db = app
            .try_state::<WiseDb>()
            .ok_or_else(|| "WiseDb 不可用".to_string())?;
        parse_saved_enterprise_bot_config(db.get_setting(SETTINGS_KEY)?)?
    };

    let (endpoint, ticket) = register_stream_ticket(&client_id, &client_secret).await?;
    let ws_url = build_ws_url(&endpoint, &ticket)?;
    let ws_str = ws_url.as_str().to_string();

    let (mut ws, _) = connect_async(&ws_str)
        .await
        .map_err(|e| format!("连接钉钉 Stream WebSocket 失败: {}", e))?;
    if let Some(control) = app.try_state::<DingTalkStreamGatewayControl>() {
        control.mark_connected();
    }

    loop {
        let incoming = match ws.next().await {
            None => return Err("WebSocket 已结束".to_string()),
            Some(Err(e)) => return Err(format!("WebSocket 错误: {}", e)),
            Some(Ok(m)) => m,
        };
        match incoming {
            Message::Text(t) => {
                let reply = handle_stream_text(app, &t)?;
                ws.send(Message::Text(reply.into()))
                    .await
                    .map_err(|e| format!("发送 ACK 失败: {}", e))?;
            }
            Message::Close(_) => break,
            Message::Ping(p) => {
                let _ = ws.send(Message::Pong(p)).await;
            }
            _ => {}
        }
    }
    Ok(())
}

async fn gateway_loops(app: tauri::AppHandle) {
    loop {
        if let Some(control) = app.try_state::<DingTalkStreamGatewayControl>() {
            control.mark_connecting();
        }
        match one_stream_session(&app).await {
            Ok(()) => {}
            Err(e) => {
                if let Some(control) = app.try_state::<DingTalkStreamGatewayControl>() {
                    control.mark_error(&e);
                }
                eprintln!("dingtalk_stream_gateway: {}", e);
            }
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

#[tauri::command]
pub async fn dingtalk_stream_gateway_start(
    app: tauri::AppHandle,
    control: State<'_, DingTalkStreamGatewayControl>,
) -> Result<(), String> {
    {
        let mut jg = control.join.lock().unwrap();
        if let Some(ref h) = *jg {
            if !h.is_finished() {
                return Err("钉钉 Stream 网关已在运行；请先停止".to_string());
            }
        }
        *jg = None;
    }
    control.mark_started();
    let app2 = app.clone();
    let h = tokio::spawn(async move {
        gateway_loops(app2).await;
    });
    *control.join.lock().unwrap() = Some(h);
    Ok(())
}

#[tauri::command]
pub fn dingtalk_stream_gateway_stop(
    control: State<'_, DingTalkStreamGatewayControl>,
) -> Result<(), String> {
    control.stop_locked();
    Ok(())
}

#[tauri::command]
pub fn dingtalk_stream_gateway_is_running(
    control: State<'_, DingTalkStreamGatewayControl>,
) -> bool {
    control.is_running()
}

#[tauri::command]
pub fn dingtalk_stream_gateway_status(
    control: State<'_, DingTalkStreamGatewayControl>,
) -> DingTalkStreamGatewayStatus {
    control.status()
}
