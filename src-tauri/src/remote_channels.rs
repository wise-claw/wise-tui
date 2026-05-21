//! 四个新的远程入口实现：飞书自建机器人 Webhook、企业微信群机器人 Webhook、
//! Telegram Bot sendMessage 以及通用 WebSocket 客户端长连接。
//!
//! 所有命令以 `feishu_webhook_*` / `wecom_webhook_*` / `telegram_bot_*` /
//! `generic_ws_*` 前缀注册，对应前端 `src/services/remoteChannels.ts`。

use std::sync::Mutex;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64_STANDARD;
use base64::Engine;
use chrono::{SecondsFormat, Utc};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::http::{header, HeaderValue, Request, Uri};
use tokio_tungstenite::tungstenite::Message;

// ──────────────────── 公共工具 ────────────────────

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn trim_to_string(value: &str, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        value.to_string()
    } else {
        value.chars().take(max_chars).collect()
    }
}

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn fail<S: Into<String>>(msg: S) -> String {
    msg.into()
}

// ──────────────────── 飞书自建机器人 Webhook ────────────────────
//
// 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
// 必填：webhook URL；可选「签名校验」时需要 secret，按 `${ts}\n${secret}` HMAC-SHA256
// 后再 Base64。这里直接走 HMAC + SHA256，使用 `sha2` crate 实现简化版。

fn feishu_sign(secret: &str, ts: i64) -> Result<String, String> {
    // 飞书签名算法：sign = base64(HMACSHA256(key=`${ts}\n${secret}`, data=""))
    // 用 std 实现 HMAC-SHA256 即可避免引入新依赖。
    let key = format!("{}\n{}", ts, secret);
    let mut mac = HmacSha256::new(key.as_bytes());
    mac.update(b"");
    let result = mac.finalize();
    Ok(B64_STANDARD.encode(result))
}

#[derive(Debug, Deserialize)]
pub struct FeishuSendArgs {
    pub webhook_url: String,
    #[serde(default)]
    pub secret: Option<String>,
    #[serde(default)]
    pub msg_type: Option<String>,
    pub content: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSendResult {
    pub ok: bool,
    pub code: Option<String>,
    pub message: Option<String>,
    pub raw: Value,
}

async fn feishu_post(args: &FeishuSendArgs) -> Result<ChannelSendResult, String> {
    if args.webhook_url.trim().is_empty() {
        return Err(fail("飞书 Webhook URL 不能为空"));
    }
    let msg_type = args
        .msg_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("text");
    let mut body = json!({
        "msg_type": msg_type,
    });
    match msg_type {
        "text" => {
            body["content"] = json!({ "text": args.content.clone() });
        }
        "post" => {
            let title = args
                .title
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Wise 通知");
            body["content"] = json!({
                "post": {
                    "zh_cn": {
                        "title": title,
                        "content": [[{ "tag": "text", "text": args.content.clone() }]]
                    }
                }
            });
        }
        other => return Err(fail(format!("暂不支持的飞书消息类型: {}", other))),
    }

    if let Some(secret) = args.secret.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let ts = Utc::now().timestamp();
        let sign = feishu_sign(secret, ts)?;
        body["timestamp"] = json!(ts.to_string());
        body["sign"] = json!(sign);
    }

    let resp = http_client()
        .post(args.webhook_url.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| fail(format!("请求飞书 Webhook 失败: {}", e)))?;
    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| fail(format!("读取飞书响应失败: {}", e)))?;
    let value: Value = serde_json::from_str(&raw_text).unwrap_or_else(|_| json!({ "raw": raw_text.clone() }));
    let code = value
        .get("code")
        .and_then(|c| c.as_i64())
        .map(|n| n.to_string())
        .or_else(|| value.get("StatusCode").and_then(|c| c.as_i64()).map(|n| n.to_string()));
    let msg = value
        .get("msg")
        .or_else(|| value.get("StatusMessage"))
        .or_else(|| value.get("message"))
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());

    let ok = status.is_success()
        && code.as_deref().map(|c| c == "0").unwrap_or(true)
        && msg
            .as_deref()
            .map(|m| m.eq_ignore_ascii_case("ok") || m.is_empty())
            .unwrap_or(true);

    if !ok {
        return Ok(ChannelSendResult {
            ok: false,
            code,
            message: Some(format!(
                "飞书返回 HTTP {} {}",
                status,
                msg.clone().unwrap_or_default()
            )),
            raw: value,
        });
    }
    Ok(ChannelSendResult {
        ok: true,
        code,
        message: msg,
        raw: value,
    })
}

/// 发送一条飞书机器人消息（支持 text/post）。
#[tauri::command]
pub async fn feishu_webhook_send(args: FeishuSendArgs) -> Result<ChannelSendResult, String> {
    feishu_post(&args).await
}

/// 校验飞书 Webhook 是否可用（发送一条「Wise 联通性测试」文本）。
#[tauri::command]
pub async fn feishu_webhook_test(
    webhook_url: String,
    secret: Option<String>,
) -> Result<ChannelSendResult, String> {
    feishu_post(&FeishuSendArgs {
        webhook_url,
        secret,
        msg_type: Some("text".to_string()),
        content: format!("Wise 联通性测试 · {}", now_iso()),
        title: None,
    })
    .await
}

// ──────────────────── 企业微信群机器人 Webhook ────────────────────
//
// 文档：https://developer.work.weixin.qq.com/document/path/91770
// 仅需 webhook key；body 形如 { msgtype, text|markdown: { content } }
// 应用号（双向）需要 access_token，本轮仅占位接口，后续 PR 接入。

#[derive(Debug, Deserialize)]
pub struct WecomWebhookArgs {
    pub webhook_url: String,
    #[serde(default)]
    pub msg_type: Option<String>,
    pub content: String,
}

async fn wecom_post(args: &WecomWebhookArgs) -> Result<ChannelSendResult, String> {
    if args.webhook_url.trim().is_empty() {
        return Err(fail("企业微信 Webhook URL 不能为空"));
    }
    let msg_type = args
        .msg_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("markdown");

    let body = match msg_type {
        "text" => json!({
            "msgtype": "text",
            "text": { "content": args.content.clone() }
        }),
        "markdown" => json!({
            "msgtype": "markdown",
            "markdown": { "content": args.content.clone() }
        }),
        other => return Err(fail(format!("暂不支持的企微消息类型: {}", other))),
    };

    let resp = http_client()
        .post(args.webhook_url.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| fail(format!("请求企微 Webhook 失败: {}", e)))?;
    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| fail(format!("读取企微响应失败: {}", e)))?;
    let value: Value = serde_json::from_str(&raw_text).unwrap_or_else(|_| json!({ "raw": raw_text.clone() }));
    let code = value
        .get("errcode")
        .and_then(|c| c.as_i64())
        .map(|n| n.to_string());
    let msg = value
        .get("errmsg")
        .and_then(|m| m.as_str())
        .map(|s| s.to_string());
    let ok = status.is_success() && code.as_deref().map(|c| c == "0").unwrap_or(false);
    if !ok {
        return Ok(ChannelSendResult {
            ok: false,
            code,
            message: msg.or(Some(format!("HTTP {}", status))),
            raw: value,
        });
    }
    Ok(ChannelSendResult {
        ok: true,
        code,
        message: msg,
        raw: value,
    })
}

#[tauri::command]
pub async fn wecom_webhook_send(args: WecomWebhookArgs) -> Result<ChannelSendResult, String> {
    wecom_post(&args).await
}

#[tauri::command]
pub async fn wecom_webhook_test(webhook_url: String) -> Result<ChannelSendResult, String> {
    wecom_post(&WecomWebhookArgs {
        webhook_url,
        msg_type: Some("markdown".to_string()),
        content: format!("**Wise 联通性测试**\n时间: {}", now_iso()),
    })
    .await
}

// ──────────────────── Telegram Bot ────────────────────
//
// sendMessage 文档：https://core.telegram.org/bots/api#sendmessage
// 必填：bot_token、chat_id；可选 parse_mode（Markdown / HTML）。

#[derive(Debug, Deserialize)]
pub struct TelegramSendArgs {
    pub bot_token: String,
    pub chat_id: String,
    pub text: String,
    #[serde(default)]
    pub parse_mode: Option<String>,
    #[serde(default)]
    pub disable_notification: Option<bool>,
}

fn telegram_api(bot_token: &str, method: &str) -> String {
    format!("https://api.telegram.org/bot{}/{}", bot_token.trim(), method)
}

#[tauri::command]
pub async fn telegram_bot_send_message(
    args: TelegramSendArgs,
) -> Result<ChannelSendResult, String> {
    if args.bot_token.trim().is_empty() {
        return Err(fail("Telegram bot_token 不能为空"));
    }
    if args.chat_id.trim().is_empty() {
        return Err(fail("Telegram chat_id 不能为空"));
    }
    let mut body = json!({
        "chat_id": args.chat_id.trim(),
        "text": args.text.clone(),
    });
    if let Some(mode) = args.parse_mode.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["parse_mode"] = json!(mode);
    }
    if let Some(silent) = args.disable_notification {
        body["disable_notification"] = json!(silent);
    }
    let resp = http_client()
        .post(telegram_api(&args.bot_token, "sendMessage"))
        .json(&body)
        .send()
        .await
        .map_err(|e| fail(format!("请求 Telegram 失败: {}", e)))?;
    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| fail(format!("读取 Telegram 响应失败: {}", e)))?;
    let value: Value = serde_json::from_str(&raw_text).unwrap_or_else(|_| json!({ "raw": raw_text.clone() }));
    let ok_flag = value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let description = value
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let error_code = value
        .get("error_code")
        .and_then(|v| v.as_i64())
        .map(|n| n.to_string());
    if !status.is_success() || !ok_flag {
        return Ok(ChannelSendResult {
            ok: false,
            code: error_code,
            message: description.or(Some(format!("HTTP {}", status))),
            raw: value,
        });
    }
    Ok(ChannelSendResult {
        ok: true,
        code: None,
        message: None,
        raw: value,
    })
}

/// 调用 Telegram `getMe`：用于验证 bot_token 是否有效。
#[tauri::command]
pub async fn telegram_bot_test(bot_token: String) -> Result<ChannelSendResult, String> {
    if bot_token.trim().is_empty() {
        return Err(fail("Telegram bot_token 不能为空"));
    }
    let resp = http_client()
        .get(telegram_api(&bot_token, "getMe"))
        .send()
        .await
        .map_err(|e| fail(format!("请求 Telegram 失败: {}", e)))?;
    let status = resp.status();
    let raw_text = resp
        .text()
        .await
        .map_err(|e| fail(format!("读取 Telegram 响应失败: {}", e)))?;
    let value: Value = serde_json::from_str(&raw_text).unwrap_or_else(|_| json!({ "raw": raw_text.clone() }));
    let ok_flag = value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !status.is_success() || !ok_flag {
        let description = value.get("description").and_then(|v| v.as_str()).map(String::from);
        return Ok(ChannelSendResult {
            ok: false,
            code: value.get("error_code").and_then(|v| v.as_i64()).map(|n| n.to_string()),
            message: description.or(Some(format!("HTTP {}", status))),
            raw: value,
        });
    }
    Ok(ChannelSendResult {
        ok: true,
        code: None,
        message: None,
        raw: value,
    })
}

// ──────────────────── 通用 WebSocket 客户端 ────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericWsStatus {
    pub running: bool,
    pub url: Option<String>,
    pub phase: String,
    pub started_at: Option<String>,
    pub connected_at: Option<String>,
    pub last_inbound_at: Option<String>,
    pub last_error_at: Option<String>,
    pub last_error: Option<String>,
    pub last_stopped_at: Option<String>,
}

impl Default for GenericWsStatus {
    fn default() -> Self {
        Self {
            running: false,
            url: None,
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

pub struct GenericWsControl {
    inner: std::sync::Arc<Mutex<GenericWsInner>>,
}

struct GenericWsInner {
    status: GenericWsStatus,
    outbound_tx: Option<mpsc::UnboundedSender<Message>>,
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
    join: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Default for GenericWsControl {
    fn default() -> Self {
        Self {
            inner: std::sync::Arc::new(Mutex::new(GenericWsInner {
                status: GenericWsStatus::default(),
                outbound_tx: None,
                cancel_tx: None,
                join: None,
            })),
        }
    }
}

impl GenericWsControl {
    fn snapshot(&self) -> GenericWsStatus {
        self.inner.lock().unwrap().status.clone()
    }

    fn stop_locked(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(tx) = guard.cancel_tx.take() {
            let _ = tx.send(());
        }
        guard.outbound_tx = None;
        if let Some(join) = guard.join.take() {
            join.abort();
        }
        guard.status.running = false;
        guard.status.phase = "stopped".to_string();
        guard.status.last_stopped_at = Some(now_iso());
    }
}

fn ws_update_status<F: FnOnce(&mut GenericWsStatus)>(inner: &std::sync::Arc<Mutex<GenericWsInner>>, f: F) {
    let mut guard = inner.lock().unwrap();
    f(&mut guard.status);
}

fn ws_snapshot(inner: &std::sync::Arc<Mutex<GenericWsInner>>) -> GenericWsStatus {
    inner.lock().unwrap().status.clone()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenericWsStartArgs {
    pub url: String,
    #[serde(default)]
    pub bearer_token: Option<String>,
    /// 可选自定义协议名（Sec-WebSocket-Protocol）
    #[serde(default)]
    pub protocol: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenericWsInboundEvent {
    pub at: String,
    pub kind: String,
    pub text: Option<String>,
    pub binary_size: Option<usize>,
}

fn build_ws_request(args: &GenericWsStartArgs) -> Result<Request<()>, String> {
    let uri: Uri = args.url.trim().parse().map_err(|e: tokio_tungstenite::tungstenite::http::uri::InvalidUri| {
        format!("WebSocket URL 无效: {}", e)
    })?;
    let mut b = Request::builder().method("GET").uri(uri);
    if let Some(t) = args
        .bearer_token
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let hv = HeaderValue::from_str(&format!("Bearer {}", t))
            .map_err(|e| format!("Authorization 头无效: {}", e))?;
        b = b.header(header::AUTHORIZATION, hv);
    }
    if let Some(proto) = args
        .protocol
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let hv = HeaderValue::from_str(proto).map_err(|e| format!("Sec-WebSocket-Protocol 无效: {}", e))?;
        b = b.header("Sec-WebSocket-Protocol", hv);
    }
    b.body(()).map_err(|e| e.to_string())
}

async fn generic_ws_session(
    app: AppHandle,
    inner: std::sync::Arc<Mutex<GenericWsInner>>,
    args: GenericWsStartArgs,
    mut outbound_rx: mpsc::UnboundedReceiver<Message>,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) {
    let url = args.url.trim().to_string();
    ws_update_status(&inner, |s| {
        s.running = true;
        s.url = Some(url.clone());
        s.phase = "connecting".to_string();
        s.started_at = Some(now_iso());
        s.last_error = None;
        s.last_error_at = None;
    });
    let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));

    let request = match build_ws_request(&args) {
        Ok(r) => r,
        Err(e) => {
            ws_update_status(&inner, |s| {
                s.running = false;
                s.phase = "stopped".to_string();
                s.last_error = Some(e.clone());
                s.last_error_at = Some(now_iso());
                s.last_stopped_at = Some(now_iso());
            });
            let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
            return;
        }
    };

    let (ws, _) = match connect_async(request).await {
        Ok(v) => v,
        Err(err) => {
            ws_update_status(&inner, |s| {
                s.running = false;
                s.phase = "stopped".to_string();
                s.last_error = Some(err.to_string());
                s.last_error_at = Some(now_iso());
                s.last_stopped_at = Some(now_iso());
            });
            let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
            return;
        }
    };

    ws_update_status(&inner, |s| {
        s.phase = "connected".to_string();
        s.connected_at = Some(now_iso());
    });
    let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));

    let (mut writer, mut reader) = ws.split();
    loop {
        tokio::select! {
            biased;
            _ = &mut cancel => {
                let _ = writer.send(Message::Close(None)).await;
                break;
            }
            outbound = outbound_rx.recv() => {
                match outbound {
                    Some(msg) => {
                        if let Err(err) = writer.send(msg).await {
                            ws_update_status(&inner, |s| {
                                s.last_error = Some(format!("发送失败: {}", err));
                                s.last_error_at = Some(now_iso());
                            });
                            let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
                            break;
                        }
                    }
                    None => break,
                }
            }
            inbound = reader.next() => {
                match inbound {
                    Some(Ok(Message::Text(text))) => {
                        let trimmed = trim_to_string(&text, 8000);
                        ws_update_status(&inner, |s| {
                            s.last_inbound_at = Some(now_iso());
                        });
                        let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
                        let _ = app.emit(
                            "wise:generic-ws:message",
                            GenericWsInboundEvent {
                                at: now_iso(),
                                kind: "text".to_string(),
                                text: Some(trimmed),
                                binary_size: None,
                            },
                        );
                    }
                    Some(Ok(Message::Binary(data))) => {
                        ws_update_status(&inner, |s| {
                            s.last_inbound_at = Some(now_iso());
                        });
                        let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
                        let _ = app.emit(
                            "wise:generic-ws:message",
                            GenericWsInboundEvent {
                                at: now_iso(),
                                kind: "binary".to_string(),
                                text: None,
                                binary_size: Some(data.len()),
                            },
                        );
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = writer.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                    Some(Err(err)) => {
                        ws_update_status(&inner, |s| {
                            s.last_error = Some(err.to_string());
                            s.last_error_at = Some(now_iso());
                        });
                        let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
                        break;
                    }
                }
            }
        }
    }

    ws_update_status(&inner, |s| {
        s.running = false;
        s.phase = "stopped".to_string();
        s.last_stopped_at = Some(now_iso());
    });
    let _ = app.emit("wise:generic-ws:status", ws_snapshot(&inner));
}

#[tauri::command]
pub async fn generic_ws_start(
    app: AppHandle,
    control: State<'_, GenericWsControl>,
    args: GenericWsStartArgs,
) -> Result<GenericWsStatus, String> {
    if args.url.trim().is_empty() {
        return Err(fail("WebSocket URL 不能为空"));
    }
    if !(args.url.trim_start().starts_with("ws://") || args.url.trim_start().starts_with("wss://")) {
        return Err(fail("URL 必须以 ws:// 或 wss:// 开头"));
    }
    control.stop_locked();

    let inner = std::sync::Arc::clone(&control.inner);
    let (outbound_tx, outbound_rx) = mpsc::unbounded_channel();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    {
        let mut guard = inner.lock().unwrap();
        guard.outbound_tx = Some(outbound_tx);
        guard.cancel_tx = Some(cancel_tx);
        guard.status.running = true;
        guard.status.url = Some(args.url.trim().to_string());
        guard.status.phase = "connecting".to_string();
        guard.status.started_at = Some(now_iso());
        guard.status.last_error = None;
        guard.status.last_error_at = None;
    }

    let app_clone = app.clone();
    let inner_for_task = std::sync::Arc::clone(&inner);
    let args_clone = GenericWsStartArgs {
        url: args.url.clone(),
        bearer_token: args.bearer_token.clone(),
        protocol: args.protocol.clone(),
    };
    let join = tauri::async_runtime::spawn(async move {
        generic_ws_session(app_clone, inner_for_task, args_clone, outbound_rx, cancel_rx).await;
    });
    inner.lock().unwrap().join = Some(join);

    Ok(control.snapshot())
}

#[tauri::command]
pub fn generic_ws_stop(control: State<GenericWsControl>) -> Result<GenericWsStatus, String> {
    control.stop_locked();
    Ok(control.snapshot())
}

#[tauri::command]
pub fn generic_ws_status(control: State<GenericWsControl>) -> Result<GenericWsStatus, String> {
    Ok(control.snapshot())
}

#[tauri::command]
pub fn generic_ws_send_text(
    control: State<GenericWsControl>,
    text: String,
) -> Result<(), String> {
    let guard = control.inner.lock().unwrap();
    if !guard.status.running {
        return Err(fail("WebSocket 未运行，无法发送"));
    }
    let Some(tx) = guard.outbound_tx.clone() else {
        return Err(fail("发送通道不可用，请重新启动"));
    };
    drop(guard);
    tx.send(Message::Text(text))
        .map_err(|e| fail(format!("发送通道已关闭: {}", e)))
}

// ──────────────────── HMAC-SHA256（飞书签名用）────────────────────
//
// 没有引入 `hmac` crate；这里用 sha2 + RFC2104 自实现，避免新增依赖。

struct HmacSha256 {
    inner: Sha256,
    outer: Sha256,
}

impl HmacSha256 {
    fn new(key: &[u8]) -> Self {
        const BLOCK_SIZE: usize = 64;
        let mut key_block = [0u8; BLOCK_SIZE];
        if key.len() > BLOCK_SIZE {
            let mut hasher = Sha256::new();
            hasher.update(key);
            let result = hasher.finalize();
            key_block[..result.len()].copy_from_slice(&result);
        } else {
            key_block[..key.len()].copy_from_slice(key);
        }
        let mut ipad = [0x36u8; BLOCK_SIZE];
        let mut opad = [0x5cu8; BLOCK_SIZE];
        for i in 0..BLOCK_SIZE {
            ipad[i] ^= key_block[i];
            opad[i] ^= key_block[i];
        }
        let mut inner = Sha256::new();
        inner.update(ipad);
        let mut outer = Sha256::new();
        outer.update(opad);
        Self { inner, outer }
    }

    fn update(&mut self, data: &[u8]) {
        self.inner.update(data);
    }

    fn finalize(self) -> Vec<u8> {
        let inner_hash = self.inner.finalize();
        let mut outer = self.outer;
        outer.update(&inner_hash);
        outer.finalize().to_vec()
    }
}
