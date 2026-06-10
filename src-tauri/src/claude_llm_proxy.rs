//! Claude Code → LLM API 本地 HTTP 代理：转发上游并捕获请求/响应供前端展示。

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_LENGTH, HOST};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

pub const CLAUDE_LLM_PROXY_RECORD_EVENT: &str = "claude-llm-proxy-record";

const DEFAULT_UPSTREAM: &str = "https://api.anthropic.com";
const CONFIG_SETTINGS_KEY: &str = "claude_llm_proxy_config";
const MAX_RECORDS: usize = 200;
const MAX_BODY_CAPTURE: usize = 512 * 1024;
const READ_BUF: usize = 64 * 1024;

static PROXY: OnceLock<Mutex<Option<Arc<ProxyInner>>>> = OnceLock::new();
static LISTENER_TASK: OnceLock<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> = OnceLock::new();
static PERSISTED_CONFIG: OnceLock<Mutex<ClaudeLlmProxyPersisted>> = OnceLock::new();

fn proxy_cell() -> &'static Mutex<Option<Arc<ProxyInner>>> {
    PROXY.get_or_init(|| Mutex::new(None))
}

fn listener_task_cell() -> &'static Mutex<Option<tauri::async_runtime::JoinHandle<()>>> {
    LISTENER_TASK.get_or_init(|| Mutex::new(None))
}

fn persisted_config_cell() -> &'static Mutex<ClaudeLlmProxyPersisted> {
    PERSISTED_CONFIG.get_or_init(|| Mutex::new(ClaudeLlmProxyPersisted::default()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeLlmProxyPersisted {
    #[serde(default)]
    listening: bool,
    #[serde(default)]
    upstream: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLlmProxyConfigView {
    /// 用户是否开启监听（持久化）
    pub listening: bool,
    /// 用户配置的上游 base URL（持久化）
    pub upstream: String,
    /// 本地监听进程是否在运行
    pub running: bool,
    pub port: Option<u16>,
    pub local_proxy_url: Option<String>,
    pub record_count: usize,
    /// 上游为空时，从 Claude settings 推断的默认值（供 UI 占位）
    pub suggested_upstream: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLlmProxyRecord {
    pub id: String,
    pub timestamp_ms: i64,
    pub method: String,
    pub path: String,
    /// 实际转发到的完整 URL（便于区分 `/` 探测与 `/v1/messages` 等 API）
    pub upstream_url: String,
    pub status_code: Option<u16>,
    pub request_body_preview: String,
    pub response_body_preview: String,
    pub request_bytes: u64,
    pub response_bytes: u64,
    pub duration_ms: u64,
    /// 上游首字节到达代理的延迟（毫秒）；流式与非流式均可观测。
    #[serde(default)]
    pub first_byte_ms: Option<u64>,
    /// 流式 SSE 中首个模型输出 token（text/thinking delta）到达延迟（毫秒）。
    #[serde(default)]
    pub ttft_ms: Option<u64>,
    pub is_streaming: bool,
    pub request_truncated: bool,
    pub response_truncated: bool,
    pub upstream: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeLlmProxyStatus {
    pub listening: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub upstream: String,
    pub record_count: usize,
    pub local_proxy_url: Option<String>,
    pub suggested_upstream: String,
}

struct ProxyInner {
    port: u16,
    upstream: Mutex<String>,
    records: Mutex<VecDeque<ClaudeLlmProxyRecord>>,
    client: reqwest::Client,
}

fn find_headers_body_split(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

fn header_value<'a>(headers: &'a str, key: &str) -> Option<&'a str> {
    let lk = key.to_ascii_lowercase();
    for line in headers.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        if k.trim().to_ascii_lowercase() == lk {
            return Some(v.trim());
        }
    }
    None
}

fn parse_content_length(headers: &str) -> Option<usize> {
    header_value(headers, "content-length")?.parse().ok()
}

fn is_chunked(headers: &str) -> bool {
    header_value(headers, "transfer-encoding")
        .map(|v| v.to_ascii_lowercase().contains("chunked"))
        .unwrap_or(false)
}

fn read_claude_env_from_settings(path: &Path, key: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("env")?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn is_local_proxy_base_url(url: &str) -> bool {
    let t = url.trim().to_ascii_lowercase();
    t.starts_with("http://127.0.0.1:")
        || t.starts_with("http://localhost:")
        || t.starts_with("http://[::1]:")
}

fn resolve_upstream_base(project_path: Option<&str>) -> String {
    if let Ok(v) = std::env::var("ANTHROPIC_BASE_URL") {
        let t = v.trim();
        if !t.is_empty() && !is_local_proxy_base_url(t) {
            return t.to_string();
        }
    }
    let user_settings = crate::claude_config_dir::user_claude_dir().join("settings.json");
    if let Some(v) = read_claude_env_from_settings(&user_settings, "ANTHROPIC_BASE_URL") {
        return v;
    }
    if let Some(pp) = project_path.map(str::trim).filter(|s| !s.is_empty()) {
        let project_settings = PathBuf::from(pp).join(".claude").join("settings.json");
        if let Some(v) = read_claude_env_from_settings(&project_settings, "ANTHROPIC_BASE_URL") {
            return v;
        }
    }
    DEFAULT_UPSTREAM.to_string()
}

fn normalize_upstream_base(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn effective_upstream(persisted: &ClaudeLlmProxyPersisted, project_path: Option<&str>) -> String {
    let custom = normalize_upstream_base(&persisted.upstream);
    if !custom.is_empty() {
        return custom;
    }
    normalize_upstream_base(&resolve_upstream_base(project_path))
}

fn load_persisted_from_db(db: &crate::wise_db::WiseDb) -> ClaudeLlmProxyPersisted {
    let Ok(Some(raw)) = db.get_setting(CONFIG_SETTINGS_KEY) else {
        return ClaudeLlmProxyPersisted::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_persisted_to_db(db: &crate::wise_db::WiseDb, cfg: &ClaudeLlmProxyPersisted) -> Result<(), String> {
    let raw = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    db.set_setting(CONFIG_SETTINGS_KEY, &raw)
}

fn build_config_view(_app: &AppHandle, project_path: Option<&str>) -> ClaudeLlmProxyConfigView {
    let persisted = persisted_config_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let suggested = resolve_upstream_base(project_path);
    let cell = proxy_cell().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(inner) = cell.as_ref() {
        let count = inner
            .records
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .len();
        let upstream = inner
            .upstream
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let port = inner.port;
        return ClaudeLlmProxyConfigView {
            listening: persisted.listening,
            upstream: if persisted.upstream.trim().is_empty() {
                upstream.clone()
            } else {
                persisted.upstream.clone()
            },
            running: true,
            port: Some(port),
            local_proxy_url: Some(format!("http://127.0.0.1:{port}")),
            record_count: count,
            suggested_upstream: suggested,
        };
    }
    let upstream_display = effective_upstream(&persisted, project_path);
    ClaudeLlmProxyConfigView {
        listening: persisted.listening,
        upstream: if persisted.upstream.trim().is_empty() {
            upstream_display.clone()
        } else {
            persisted.upstream.clone()
        },
        running: false,
        port: None,
        local_proxy_url: None,
        record_count: 0,
        suggested_upstream: suggested,
    }
}

fn stop_proxy_listener() {
    if let Some(handle) = listener_task_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        handle.abort();
    }
    *proxy_cell().lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn start_proxy_listener(app: &AppHandle, upstream: String) -> Result<Arc<ProxyInner>, String> {
    stop_proxy_listener();

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let inner = Arc::new(ProxyInner {
        port,
        upstream: Mutex::new(upstream),
        records: Mutex::new(VecDeque::new()),
        client,
    });

    let app_clone = app.clone();
    let inner_c = inner.clone();
    let handle = tauri::async_runtime::spawn(run_proxy_listener(app_clone, inner_c));
    *listener_task_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(handle);
    *proxy_cell().lock().unwrap_or_else(|e| e.into_inner()) = Some(inner.clone());
    Ok(inner)
}

fn build_upstream_url(upstream: &str, path: &str) -> Result<String, String> {
    let base = upstream.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("upstream 为空".into());
    }
    let path = path.trim();
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    Ok(format!("{base}{path}"))
}

fn looks_like_gzip(raw: &[u8]) -> bool {
    raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b
}

/// 预览文本：优先 UTF-8；若仍为 gzip 魔数则尝试解压（reqwest 未解压时的兜底）。
fn decode_preview_bytes(raw: &[u8]) -> Vec<u8> {
    if !looks_like_gzip(raw) {
        return raw.to_vec();
    }
    use std::io::Read;
    let mut dec = flate2::read::GzDecoder::new(raw);
    let mut out = Vec::new();
    if dec.read_to_end(&mut out).is_ok() && !out.is_empty() {
        return out;
    }
    raw.to_vec()
}

fn preview_body(raw: &[u8], truncated: &mut bool) -> String {
    let decoded = decode_preview_bytes(raw);
    if decoded.len() > MAX_BODY_CAPTURE {
        *truncated = true;
        String::from_utf8_lossy(&decoded[..MAX_BODY_CAPTURE]).into_owned()
    } else {
        String::from_utf8_lossy(&decoded).into_owned()
    }
}

fn push_record(inner: &ProxyInner, app: &AppHandle, record: ClaudeLlmProxyRecord) {
    {
        let mut q = inner.records.lock().unwrap_or_else(|e| e.into_inner());
        q.push_front(record.clone());
        while q.len() > MAX_RECORDS {
            q.pop_back();
        }
    }
    let _ = app.emit(CLAUDE_LLM_PROXY_RECORD_EVENT, &record);
}

fn parse_request_line(first_line: &str) -> Option<(Method, String)> {
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?.to_string();
    let _ = parts.next()?;
    let method = Method::from_bytes(method.as_bytes()).ok()?;
    Some((method, target))
}

/// 从请求行 target（可能是 `/v1/messages` 或绝对 URL）提取用于展示的路径。
fn request_target_display_path(request_target: &str) -> String {
    let t = request_target.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        if let Ok(url) = reqwest::Url::parse(t) {
            let mut out = url.path().to_string();
            if out.is_empty() {
                out = "/".to_string();
            }
            if let Some(q) = url.query() {
                out.push('?');
                out.push_str(q);
            }
            return out;
        }
    }
    t.to_string()
}

/// 根路径连通性探测（HEAD/GET/OPTIONS `/`），不是 Anthropic Messages API。
fn is_proxy_noise_request(method: &Method, request_target: &str) -> bool {
    let path = request_target_display_path(request_target);
    let path_only = path.split('?').next().unwrap_or(path.as_str()).trim_end_matches('/');
    let is_root = path_only.is_empty() || path_only == "/";
    if !is_root {
        return false;
    }
    matches!(
        method.as_str(),
        "HEAD" | "GET" | "OPTIONS" | "TRACE"
    )
}

fn resolve_forward_url(inner: &ProxyInner, request_target: &str) -> Result<String, String> {
    let t = request_target.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        return Ok(t.to_string());
    }
    let upstream = inner
        .upstream
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    build_upstream_url(&upstream, t)
}

fn header_block_to_map(headers: &str) -> HeaderMap {
    let mut map = HeaderMap::new();
    for line in headers.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let name = k.trim();
        let value = v.trim();
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("keep-alive")
            || name.eq_ignore_ascii_case("proxy-connection")
        {
            continue;
        }
        if let (Ok(n), Ok(val)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            map.insert(n, val);
        }
    }
    map
}

async fn read_http_message(
    socket: &mut tokio::net::TcpStream,
    initial: &[u8],
) -> Result<(String, Vec<u8>), String> {
    let mut all = initial.to_vec();
    let mut buf = vec![0u8; READ_BUF];
    let split = find_headers_body_split(&all).ok_or_else(|| "无效 HTTP 头".to_string())?;
    let headers = String::from_utf8_lossy(&all[..split]).into_owned();
    let body_start = split + 4;

    if is_chunked(&headers) {
        while find_headers_body_split(&all).is_some() {
            let body = &all[body_start..];
            if body.ends_with(b"\r\n0\r\n\r\n") || body.ends_with(b"\r\n0\r\n") {
                break;
            }
            let n = socket
                .read(&mut buf)
                .await
                .map_err(|e| format!("读取 chunked body 失败: {e}"))?;
            if n == 0 {
                break;
            }
            all.extend_from_slice(&buf[..n]);
        }
        return Ok((headers, all[body_start..].to_vec()));
    }

    let cl = parse_content_length(&headers).unwrap_or(0);
    while all.len() < body_start + cl {
        let n = socket
            .read(&mut buf)
            .await
            .map_err(|e| format!("读取 body 失败: {e}"))?;
        if n == 0 {
            break;
        }
        all.extend_from_slice(&buf[..n]);
    }
    let end = (body_start + cl).min(all.len());
    Ok((headers, all[body_start..end].to_vec()))
}

fn http_response_prefix(status: u16, headers: &HeaderMap, body_len: usize) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status} OK\r\nConnection: close\r\n");
    for (k, v) in headers.iter() {
        if k == HOST || k == CONTENT_LENGTH {
            continue;
        }
        if let Ok(s) = v.to_str() {
            out.push_str(&format!("{k}: {s}\r\n"));
        }
    }
    out.push_str(&format!("Content-Length: {body_len}\r\n\r\n"));
    out.into_bytes()
}

fn sse_capture_has_first_token(capture: &[u8]) -> bool {
    let s = String::from_utf8_lossy(capture);
    if s.contains("text_delta") {
        return true;
    }
    if s.contains("thinking_delta") {
        return true;
    }
    if s.contains("content_block_delta")
        && (s.contains("\"text\"") || s.contains("thinking"))
    {
        return true;
    }
    // OpenAI 兼容流
    if s.contains(r#""delta":{"content""#) || s.contains(r#""delta": {"content""#) {
        return true;
    }
    // 兼容网关：thinking 块 type 命名差异
    if s.contains(r#""type":"thinking""#) || s.contains(r#""type": "thinking""#) {
        return true;
    }
    // message_delta 携带可见 text
    if s.contains("message_delta") && s.contains("\"text\"") {
        return true;
    }
    // text 内容块开始（早于首个 text_delta）
    if s.contains("content_block_start")
        && (s.contains(r#""type":"text""#) || s.contains(r#""type": "text""#))
    {
        return true;
    }
    // 部分国产模型 reasoning 字段
    if s.contains("reasoning_content") || s.contains("reasoning_delta") {
        return true;
    }
    false
}

async fn handle_proxy_connection(
    mut socket: tokio::net::TcpStream,
    inner: Arc<ProxyInner>,
    app: AppHandle,
) {
    let mut buf = vec![0u8; READ_BUF];
    let n = match socket.read(&mut buf).await {
        Ok(0) | Err(_) => return,
        Ok(n) => n,
    };
    let (headers, body) = match read_http_message(&mut socket, &buf[..n]).await {
        Ok(v) => v,
        Err(e) => {
            let msg = format!(r#"{{"error":"{}"}}"#, e.replace('"', "\\\""));
            let resp = http_response_prefix(400, &HeaderMap::new(), msg.len());
            let _ = socket.write_all(&resp).await;
            let _ = socket.write_all(msg.as_bytes()).await;
            return;
        }
    };

    // 计时从请求体读完后开始，不含本地 socket 收包；duration = 上游往返 + 整段流式传输。
    let started = Instant::now();

    let first_line = headers.lines().next().unwrap_or_default();
    let Some((method, path)) = parse_request_line(first_line) else {
        let body = br#"{"error":"bad request line"}"#;
        let resp = http_response_prefix(400, &HeaderMap::new(), body.len());
        let _ = socket.write_all(&resp).await;
        let _ = socket.write_all(body).await;
        return;
    };

    let upstream_url = match resolve_forward_url(&inner, &path) {
        Ok(u) => u,
        Err(e) => {
            let msg = format!(r#"{{"error":"{}"}}"#, e.replace('"', "\\\""));
            let resp = http_response_prefix(502, &HeaderMap::new(), msg.len());
            let _ = socket.write_all(&resp).await;
            let _ = socket.write_all(msg.as_bytes()).await;
            return;
        }
    };

    let header_map = header_block_to_map(&headers);
    let is_streaming_req = header_value(&headers, "accept")
        .map(|v| v.contains("text/event-stream"))
        .unwrap_or(false)
        || body.windows(b"\"stream\":true".len()).any(|w| w == b"\"stream\":true");

    let mut req = inner.client.request(method.clone(), &upstream_url);
    req = req.headers(header_map);
    if !body.is_empty() {
        req = req.body(body.clone());
    }

    let mut req_truncated = false;
    let request_preview = preview_body(&body, &mut req_truncated);
    let request_bytes = body.len() as u64;
    let display_path = request_target_display_path(&path);
    let skip_record = is_proxy_noise_request(&method, &path);

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            if !skip_record {
            let record = ClaudeLlmProxyRecord {
                id: Uuid::new_v4().to_string(),
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                method: method.to_string(),
                path: display_path.clone(),
                upstream_url: upstream_url.clone(),
                status_code: None,
                request_body_preview: request_preview,
                response_body_preview: format!("upstream error: {e}"),
                request_bytes,
                response_bytes: 0,
                duration_ms: started.elapsed().as_millis() as u64,
                first_byte_ms: None,
                ttft_ms: None,
                is_streaming: is_streaming_req,
                request_truncated: req_truncated,
                response_truncated: false,
                upstream: inner
                    .upstream
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone(),
            };
            push_record(&inner, &app, record);
            }
            let msg = format!(r#"{{"error":"{}"}}"#, e.to_string().replace('"', "\\\""));
            let resp = http_response_prefix(502, &HeaderMap::new(), msg.len());
            let _ = socket.write_all(&resp).await;
            let _ = socket.write_all(msg.as_bytes()).await;
            return;
        }
    };

    let upstream_label = inner
        .upstream
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    let status = resp.status().as_u16();
    let resp_headers = resp.headers().clone();
    let is_streaming_resp = resp_headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/event-stream"))
        .unwrap_or(false)
        || is_streaming_req;

    let mut capture: Vec<u8> = Vec::new();
    let mut resp_truncated = false;
    let mut total_response_bytes: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut status_line_written = false;
    let mut first_byte_ms: Option<u64> = None;
    let mut ttft_ms: Option<u64> = None;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                if !status_line_written {
                    let msg = format!(r#"{{"error":"{}"}}"#, e.to_string().replace('"', "\\\""));
                    let resp = http_response_prefix(502, &HeaderMap::new(), msg.len());
                    let _ = socket.write_all(&resp).await;
                    let _ = socket.write_all(msg.as_bytes()).await;
                }
                break;
            }
        };
        if first_byte_ms.is_none() {
            first_byte_ms = Some(started.elapsed().as_millis() as u64);
        }
        if capture.len() < MAX_BODY_CAPTURE {
            let remain = MAX_BODY_CAPTURE - capture.len();
            let take = chunk.len().min(remain);
            capture.extend_from_slice(&chunk[..take]);
            if chunk.len() > remain {
                resp_truncated = true;
            }
        } else {
            resp_truncated = true;
        }
        if ttft_ms.is_none() {
            if is_streaming_resp && sse_capture_has_first_token(&capture) {
                ttft_ms = Some(started.elapsed().as_millis() as u64);
            }
        }
        total_response_bytes += chunk.len() as u64;

        if !status_line_written {
            // 流式：先写头，再逐块写 body（不预知 Content-Length）
            let mut prefix = format!("HTTP/1.1 {status} OK\r\nConnection: close\r\n");
            for (k, v) in resp_headers.iter() {
                if k == HOST || k == CONTENT_LENGTH {
                    continue;
                }
                if let Ok(s) = v.to_str() {
                    prefix.push_str(&format!("{k}: {s}\r\n"));
                }
            }
            prefix.push_str("\r\n");
            let _ = socket.write_all(prefix.as_bytes()).await;
            status_line_written = true;
        }
        if let Err(_) = socket.write_all(&chunk).await {
            break;
        }
    }

    let response_preview = preview_body(&capture, &mut resp_truncated);

    if !skip_record {
        let record = ClaudeLlmProxyRecord {
            id: Uuid::new_v4().to_string(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
            method: method.to_string(),
            path: display_path,
            upstream_url: upstream_url.clone(),
            status_code: Some(status),
            request_body_preview: request_preview,
            response_body_preview: response_preview,
            request_bytes,
            response_bytes: total_response_bytes,
            duration_ms: started.elapsed().as_millis() as u64,
            first_byte_ms,
            ttft_ms,
            is_streaming: is_streaming_resp,
            request_truncated: req_truncated,
            response_truncated: resp_truncated,
            upstream: upstream_label,
        };
        push_record(&inner, &app, record);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::Method;

    #[test]
    fn display_path_from_absolute_target() {
        assert_eq!(
            request_target_display_path(
                "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages?beta=true"
            ),
            "/apps/anthropic/v1/messages?beta=true"
        );
    }

    #[test]
    fn noise_request_filters_root_head() {
        assert!(is_proxy_noise_request(&Method::HEAD, "/"));
        assert!(is_proxy_noise_request(&Method::GET, "/"));
        assert!(!is_proxy_noise_request(
            &Method::POST,
            "/v1/messages?beta=true"
        ));
        assert!(!is_proxy_noise_request(
            &Method::POST,
            "https://api.anthropic.com/v1/messages"
        ));
    }

    #[test]
    fn preview_body_decodes_gzip_payload() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(br#"{"type":"message","content":[]}"#)
            .unwrap();
        let gz = enc.finish().unwrap();

        let mut truncated = false;
        let preview = preview_body(&gz, &mut truncated);
        assert!(preview.contains("message"));
        assert!(!preview.contains('\u{FFFD}'));
    }
    #[test]
    fn sse_capture_detects_content_block_start_text() {
        let sample = br#"event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#;
        assert!(sse_capture_has_first_token(sample));
    }

    #[test]
    fn sse_capture_detects_text_delta() {
        let sample = br#"event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#;
        assert!(sse_capture_has_first_token(sample));
        assert!(!sse_capture_has_first_token(b"event: message_start\ndata: {}\n\n"));
    }
}

async fn run_proxy_listener(app: AppHandle, inner: Arc<ProxyInner>) {
    let port = inner.port;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("claude llm proxy bind failed: {e}");
            return;
        }
    };
    loop {
        let accept = listener.accept().await;
        let Ok((socket, _)) = accept else {
            continue;
        };
        let inner_c = inner.clone();
        let app_c = app.clone();
        tauri::async_runtime::spawn(async move {
            handle_proxy_connection(socket, inner_c, app_c).await;
        });
    }
}

/// 用户已开启 LLM 流量监听且本地代理进程在运行。
pub(crate) fn llm_proxy_listening_and_running() -> bool {
    let listening = persisted_config_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .listening;
    if !listening {
        return false;
    }
    proxy_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
}

/// LLM 流量监听开启时，将 `ANTHROPIC_BASE_URL` 指向 Wise 本地代理（由 `configure_claude_child_process` 消费）。
pub(crate) fn claude_spawn_anthropic_base_url_override() -> Option<String> {
    if !llm_proxy_listening_and_running() {
        return None;
    }
    let inner = {
        let cell = proxy_cell().lock().unwrap_or_else(|e| e.into_inner());
        cell.as_ref().cloned()
    };
    inner.map(|i| format!("http://127.0.0.1:{}", i.port))
}

#[tauri::command]
pub(crate) fn list_claude_llm_proxy_records() -> Vec<ClaudeLlmProxyRecord> {
    let inner = {
        let cell = proxy_cell().lock().unwrap_or_else(|e| e.into_inner());
        cell.as_ref().cloned()
    };
    let Some(inner) = inner else {
        return Vec::new();
    };
    let records = inner
        .records
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .cloned()
        .collect();
    records
}

#[tauri::command]
pub(crate) fn clear_claude_llm_proxy_records() -> Result<(), String> {
    let cell = proxy_cell().lock().unwrap_or_else(|e| e.into_inner());
    let Some(inner) = cell.as_ref() else {
        return Ok(());
    };
    inner
        .records
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    Ok(())
}

fn config_view_to_status(view: ClaudeLlmProxyConfigView) -> ClaudeLlmProxyStatus {
    ClaudeLlmProxyStatus {
        listening: view.listening,
        running: view.running,
        port: view.port,
        upstream: view.upstream,
        record_count: view.record_count,
        local_proxy_url: view.local_proxy_url,
        suggested_upstream: view.suggested_upstream,
    }
}

#[tauri::command]
pub(crate) fn get_claude_llm_proxy_status(
    app: AppHandle,
    project_path: Option<String>,
) -> ClaudeLlmProxyStatus {
    config_view_to_status(build_config_view(&app, project_path.as_deref()))
}

#[tauri::command]
pub(crate) fn get_claude_llm_proxy_config(
    app: AppHandle,
    project_path: Option<String>,
) -> ClaudeLlmProxyConfigView {
    build_config_view(&app, project_path.as_deref())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetClaudeLlmProxyConfigInput {
    pub listening: bool,
    #[serde(default)]
    pub upstream: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[tauri::command]
pub(crate) fn set_claude_llm_proxy_config(
    app: AppHandle,
    db: tauri::State<crate::wise_db::WiseDb>,
    input: SetClaudeLlmProxyConfigInput,
) -> Result<ClaudeLlmProxyConfigView, String> {
    let upstream_raw = input.upstream.unwrap_or_default();
    let upstream_persisted = normalize_upstream_base(&upstream_raw);
    let project_path = input.project_path.as_deref();

    if input.listening {
        let effective = effective_upstream(
            &ClaudeLlmProxyPersisted {
                listening: true,
                upstream: upstream_persisted.clone(),
            },
            project_path,
        );
        if effective.is_empty() {
            return Err("请填写上游地址，或确保 Claude settings 中已配置 ANTHROPIC_BASE_URL".into());
        }
        start_proxy_listener(&app, effective)?;
    } else {
        stop_proxy_listener();
    }

    let persisted = ClaudeLlmProxyPersisted {
        listening: input.listening,
        upstream: upstream_persisted,
    };
    *persisted_config_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = persisted.clone();
    save_persisted_to_db(&db, &persisted)?;

    Ok(build_config_view(&app, project_path))
}

pub(crate) fn bootstrap_from_db(app: &AppHandle) {
    let Some(db) = app.try_state::<crate::wise_db::WiseDb>() else {
        return;
    };
    let persisted = load_persisted_from_db(&db);
    *persisted_config_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = persisted.clone();
    if persisted.listening {
        let upstream = effective_upstream(&persisted, None);
        if !upstream.is_empty() {
            let _ = start_proxy_listener(app, upstream);
        }
    }
}
