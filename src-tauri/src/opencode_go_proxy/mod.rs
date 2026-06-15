//! Wise 内置 OpenCode Go / Zen 代理：Anthropic Messages API → OpenCode（参考 oc-go-cc）。
//! Codex CLI 桥接：`/v1/chat/completions` 与 `/v1/responses`（参考 ocgo）。

mod circuit;
mod codex_bridge;
mod codex_convert;
mod models;
mod router;
mod routing;
mod stream_anthropic_responses;
mod stream_codex;
mod tokens;
mod traces;
mod usage;
mod stream_alt;
mod stream_common;
mod stream_openai;
mod stream_passthrough_repair;
mod tool_call_extract;
mod transform;
mod transform_alt;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
const CONFIG_SETTINGS_KEY: &str = "opencode_go_proxy_config";
const DEFAULT_PORT: u16 = 9876;
const DEFAULT_MODEL: &str = "kimi-k2.6";
/// Codex `config.toml` 中注册的 Wise 内置代理 provider ID。
pub const CODEX_PROVIDER_ID: &str = "wise-opencode";
/// Codex 档案名（`profiles.<name>`）。
pub const CODEX_PROFILE_ID: &str = "wise-opencode-go";
/// Codex 侧占位 API Key，真实 Key 由内置代理注入上游。
pub const CODEX_PLACEHOLDER_API_KEY: &str = "wise-ocgo";

static SERVER_STATE: OnceLock<Mutex<Option<Arc<ServerInner>>>> = OnceLock::new();
static SHUTDOWN_TX: OnceLock<Mutex<Option<oneshot::Sender<()>>>> = OnceLock::new();
static PERSISTED: OnceLock<Mutex<OpencodeGoProxyConfig>> = OnceLock::new();
static CLIENT_SETTINGS_SYNC: Mutex<()> = Mutex::new(());

fn client_settings_sync_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CLIENT_SETTINGS_SYNC
        .lock()
        .map_err(|e| format!("客户端配置同步锁异常: {e}"))
}

fn server_cell() -> &'static Mutex<Option<Arc<ServerInner>>> {
    SERVER_STATE.get_or_init(|| Mutex::new(None))
}

fn shutdown_cell() -> &'static Mutex<Option<oneshot::Sender<()>>> {
    SHUTDOWN_TX.get_or_init(|| Mutex::new(None))
}

fn persisted_cell() -> &'static Mutex<OpencodeGoProxyConfig> {
    PERSISTED.get_or_init(|| Mutex::new(OpencodeGoProxyConfig::default()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoProxyConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_model")]
    pub default_model: String,
    #[serde(default)]
    pub upstream_url: String,
    /// `opencode-go` | `opencode-zen`
    #[serde(default = "default_provider")]
    pub provider: String,
    /// 主模型失败时依次尝试的备用模型 ID
    #[serde(default)]
    pub fallback_models: Vec<String>,
    /// Claude 模型名 → 上游覆盖（可选 provider + modelId）
    #[serde(default)]
    pub model_overrides: HashMap<String, ModelOverride>,
    /// 为 true 时在 stderr 打印路由与错误详情（对齐 oc-go-cc debug）。
    #[serde(default)]
    pub debug: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOverride {
    #[serde(default)]
    pub provider: Option<String>,
    pub model_id: String,
}

fn default_provider() -> String {
    "opencode-go".to_string()
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_model() -> String {
    DEFAULT_MODEL.to_string()
}

impl OpencodeGoProxyConfig {
    fn effective_provider(&self) -> routing::Provider {
        routing::parse_provider(&self.provider)
    }

    fn effective_model(&self) -> String {
        let m = self.default_model.trim();
        if m.is_empty() {
            DEFAULT_MODEL.to_string()
        } else {
            m.to_string()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoProxyStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub proxy_base_url: Option<String>,
    pub default_model: String,
    pub upstream_url: String,
    pub custom_upstream_url: String,
    pub default_upstream_url: String,
    pub provider: String,
    pub fallback_models: Vec<String>,
    pub model_overrides: HashMap<String, ModelOverride>,
    pub has_api_key: bool,
    pub claude_settings_aligned: bool,
    pub codex_settings_aligned: bool,
    pub trace_count: usize,
    pub debug: bool,
}

pub(crate) struct ServerInner {
    port: u16,
    config: RwLock<OpencodeGoProxyConfig>,
    client: reqwest::Client,
}

#[derive(Clone)]
pub(crate) struct AppState {
    inner: Arc<ServerInner>,
}

fn proxy_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn effective_upstream_url(cfg: &OpencodeGoProxyConfig) -> String {
    let custom = cfg.upstream_url.trim();
    if custom.is_empty() {
        routing::default_chat_upstream(cfg.effective_provider()).to_string()
    } else {
        custom.to_string()
    }
}

fn load_persisted(db: &crate::wise_db::WiseDb) -> OpencodeGoProxyConfig {
    let Ok(Some(raw)) = db.get_setting(CONFIG_SETTINGS_KEY) else {
        return OpencodeGoProxyConfig::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_persisted(db: &crate::wise_db::WiseDb, cfg: &OpencodeGoProxyConfig) -> Result<(), String> {
    let raw = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
    db.set_setting(CONFIG_SETTINGS_KEY, &raw)
}

fn codex_base_url_matches(actual: &str, port: u16) -> bool {
    let expected = format!("{}/v1", proxy_base_url(port).trim_end_matches('/'));
    let a = actual.trim().trim_matches('"').trim_end_matches('/');
    a == expected || a == format!("{expected}/")
}

fn parse_toml_kv_line(trimmed: &str, key: &str) -> Option<String> {
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let rest = trimmed
        .strip_prefix(key)
        .and_then(|s| s.trim_start().strip_prefix('='))
        .map(str::trim)?;
    let unquoted = rest.trim_matches('"').trim_matches('\'').trim();
    if unquoted.is_empty() {
        None
    } else {
        Some(unquoted.to_string())
    }
}

fn read_toml_section_value(config: &str, section: &str, key: &str) -> Option<String> {
    if section.is_empty() {
        for line in config.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                break;
            }
            if let Some(v) = parse_toml_kv_line(trimmed, key) {
                return Some(v);
            }
        }
        return None;
    }
    let header = format!("[{section}]");
    let mut in_section = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_section = trimmed == header;
            continue;
        }
        if !in_section {
            continue;
        }
        if let Some(v) = parse_toml_kv_line(trimmed, key) {
            return Some(v);
        }
    }
    None
}

fn codex_bridge_present_in_config(config: &str) -> bool {
    config.contains(&format!("[model_providers.{CODEX_PROVIDER_ID}]"))
}

fn codex_legacy_wise_profile_present(config: &str) -> bool {
    config.contains(&format!("profile = \"{CODEX_PROFILE_ID}\""))
        || config.contains(&format!("[profiles.{CODEX_PROFILE_ID}]"))
}

fn codex_settings_aligned(port: u16, default_model: &str) -> bool {
    let config_path = crate::codex_config_dir::user_codex_dir().join("config.toml");
    let text = std::fs::read_to_string(&config_path).unwrap_or_default();
    if !codex_bridge_present_in_config(&text) || codex_legacy_wise_profile_present(&text) {
        return false;
    }
    let provider_section = format!("model_providers.{CODEX_PROVIDER_ID}");
    let base_url = read_toml_section_value(&text, &provider_section, "base_url")
        .unwrap_or_default();
    let wire_api = read_toml_section_value(&text, &provider_section, "wire_api")
        .unwrap_or_default();
    let no_ws = read_toml_section_value(&text, &provider_section, "supports_websockets")
        .map(|v| v == "false")
        .unwrap_or(false);
    let top_profile = read_toml_section_value(&text, "", "profile").unwrap_or_default();
    if !top_profile.is_empty() {
        return false;
    }
    let model_provider =
        read_toml_section_value(&text, "", "model_provider").unwrap_or_default();
    let model = read_toml_section_value(&text, "", "model").unwrap_or_default();

    codex_base_url_matches(&base_url, port)
        && wire_api == "responses"
        && no_ws
        && model_provider == CODEX_PROVIDER_ID
        && model == default_model
}

fn remove_toml_section(config: &str, section: &str) -> String {
    let header = format!("[{section}]");
    let mut out = Vec::new();
    let mut skipping = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            skipping = trimmed == header;
            if skipping {
                continue;
            }
        }
        if !skipping {
            out.push(line);
        }
    }
    let mut result = out.join("\n");
    if config.ends_with('\n') && !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

fn remove_top_level_profile_line(config: &str, profile_id: &str) -> String {
    let needle = format!("profile = \"{profile_id}\"");
    config
        .lines()
        .filter(|line| line.trim() != needle)
        .collect::<Vec<_>>()
        .join("\n")
}

fn line_assigns_toml_key(line: &str, key: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with(&format!("{key} =")) || trimmed.starts_with(&format!("{key}="))
}

/// 删除全文件中的 `model_provider = ...`（仅 Wise 桥接使用）。
fn remove_global_toml_key(config: &str, key: &str) -> String {
    config
        .lines()
        .filter(|line| !line_assigns_toml_key(line, key))
        .collect::<Vec<_>>()
        .join("\n")
}

/// 删除非 `[profiles.*]` 段内的 `model = ...`，保留用户其它供应商档案。
fn remove_model_assignment_except_profiles(config: &str) -> String {
    let mut out = Vec::new();
    let mut in_profiles = false;
    for line in config.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_profiles = trimmed.starts_with("[profiles.");
            out.push(line);
            continue;
        }
        if line_assigns_toml_key(line, "model") && !in_profiles {
            continue;
        }
        out.push(line);
    }
    let mut result = out.join("\n");
    if config.ends_with('\n') && !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

fn merge_codex_bridge_into_config(existing: &str, port: u16, default_model: &str) -> String {
    let mut stripped = remove_toml_section(existing, &format!("model_providers.{CODEX_PROVIDER_ID}"));
    stripped = remove_toml_section(&stripped, &format!("profiles.{CODEX_PROFILE_ID}"));
    stripped = remove_top_level_profile_line(&stripped, CODEX_PROFILE_ID);
    stripped = remove_global_toml_key(&stripped, "model_provider");
    stripped = remove_global_toml_key(&stripped, "profile");
    stripped = remove_model_assignment_except_profiles(&stripped);
    let bridge = build_codex_bridge_config_toml(port, default_model);
    let rest = stripped.trim();
    let mut out = bridge;
    if !rest.is_empty() {
        out.push_str("\n\n");
        out.push_str(rest);
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn claude_settings_aligned(port: u16) -> bool {
    let settings_path = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let env = crate::claude_config_dir::read_claude_json_env_block(&settings_path);
    let expected = proxy_base_url(port);
    env.get("ANTHROPIC_BASE_URL")
        .map(|s| s.trim().trim_end_matches('/'))
        == Some(expected.trim_end_matches('/'))
        && env
            .get("ANTHROPIC_AUTH_TOKEN")
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
}

async fn build_status(cfg: &OpencodeGoProxyConfig) -> OpencodeGoProxyStatus {
    let running = server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some();
    let port = if running {
        server_cell()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|s| s.port)
            .unwrap_or(cfg.port)
    } else {
        cfg.port
    };
    OpencodeGoProxyStatus {
        enabled: cfg.enabled || running,
        running,
        port,
        proxy_base_url: if running {
            Some(proxy_base_url(port))
        } else {
            None
        },
        default_model: cfg.effective_model(),
        default_upstream_url: routing::default_chat_upstream(cfg.effective_provider()).to_string(),
        custom_upstream_url: cfg.upstream_url.clone(),
        upstream_url: effective_upstream_url(&cfg),
        provider: routing::provider_label(cfg.effective_provider()).to_string(),
        fallback_models: cfg.fallback_models.clone(),
        model_overrides: cfg.model_overrides.clone(),
        has_api_key: !cfg.api_key.trim().is_empty(),
        claude_settings_aligned: claude_settings_aligned(port),
        codex_settings_aligned: codex_settings_aligned(port, &cfg.effective_model()),
        trace_count: traces::trace_store().len(),
        debug: cfg.debug,
    }
}

fn stop_server() {
    if let Some(tx) = shutdown_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        let _ = tx.send(());
    }
    *server_cell().lock().unwrap_or_else(|e| e.into_inner()) = None;
}

async fn start_server(cfg: OpencodeGoProxyConfig) -> Result<Arc<ServerInner>, String> {
    stop_server();

    if cfg.api_key.trim().is_empty() {
        return Err("请先配置 OpenCode API Key".into());
    }

    let port = if cfg.port == 0 { DEFAULT_PORT } else { cfg.port };
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|e| format!("无法绑定端口 {port}: {e}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let inner = Arc::new(ServerInner {
        port,
        config: RwLock::new(cfg),
        client,
    });

    let app_state = AppState {
        inner: inner.clone(),
    };

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/v1/messages", post(messages_handler))
        .route("/v1/messages/count_tokens", post(count_tokens_handler))
        .route(
            "/v1/chat/completions",
            post(codex_bridge::chat_completions_handler),
        )
        .route("/v1/responses", post(codex_bridge::responses_handler))
        .route("/v1/models", get(codex_bridge::models_handler))
        .with_state(app_state);

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    *shutdown_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(shutdown_tx);

    let serve = axum::serve(listener, app).with_graceful_shutdown(async {
        let _ = shutdown_rx.await;
    });

    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve.await {
            eprintln!("[opencode_go_proxy] server error: {e}");
        }
    });

    *server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(inner.clone());

    Ok(inner)
}

/// 对齐 oc-go-cc：Anthropic 直通端点同时发送 Bearer 与 x-api-key。
pub(crate) fn attach_opencode_upstream_auth(
    builder: reqwest::RequestBuilder,
    api_key: &str,
    endpoint: routing::EndpointKind,
) -> reqwest::RequestBuilder {
    let key = api_key.trim();
    match endpoint {
        routing::EndpointKind::AnthropicPassthrough => builder
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .header("x-api-key", key),
        _ => builder.header(header::AUTHORIZATION, format!("Bearer {key}")),
    }
}

pub(crate) fn upstream_auth_error_message(status: u16, body: &str) -> String {
    if status == 401 {
        return format!(
            "OpenCode 上游认证失败，请检查代理配置中的 API Key 是否有效：{body}"
        );
    }
    body.to_string()
}

async fn health_handler() -> impl IntoResponse {
    Json(json!({ "status": "ok" }))
}

async fn count_tokens_handler(Json(body): Json<Value>) -> impl IntoResponse {
    let count = tokens::count_tokens_for_body(&body).max(1);
    Json(json!({ "input_tokens": count }))
}

async fn messages_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let original_model = body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("claude-sonnet-4-8")
        .to_string();

    let config = state
        .inner
        .config
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if config.api_key.trim().is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(transform::anthropic_error(
                401,
                "OpenCode API Key 未配置，请在 OpenCode 代理设置中填写并重启代理",
            )),
        )
            .into_response();
    }
    let mut provider = config.effective_provider();
    if let Some(ov) = router::lookup_model_override(&original_model, &config.model_overrides) {
        if let Some(p) = ov.provider.as_deref() {
            provider = routing::parse_provider(p);
        }
    }

    let primary = router::resolve_upstream_model(
        &original_model,
        &config.effective_model(),
        provider,
        &body,
        &config.model_overrides,
    );
    let chain = circuit::filter_available_models(router::build_model_chain(
        &primary,
        &config.fallback_models,
    ));
    let is_stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);

    if config.debug {
        eprintln!(
            "[opencode_go_proxy] POST /v1/messages claude={original_model} primary={primary} chain={chain:?} stream={is_stream}"
        );
    }

    let mut last_error: Option<Response> = None;
    for upstream_model in chain {
        let resolved = routing::resolve_upstream(provider, &upstream_model, &config.upstream_url);
        let trace = traces::TraceCapture::begin(
            "/v1/messages",
            original_model.clone(),
            upstream_model.clone(),
            resolved.url.clone(),
            &body,
            is_stream,
        );

        match dispatch_upstream(
            &state.inner,
            &config,
            &body,
            &original_model,
            &upstream_model,
            provider,
            &headers,
            &trace,
        )
        .await
        {
            Ok(resp) => {
                circuit::record_success(&upstream_model);
                return resp;
            }
            Err(resp)
                if resp.status().is_server_error()
                    || resp.status() == StatusCode::TOO_MANY_REQUESTS =>
            {
                circuit::record_failure(&upstream_model);
                last_error = Some(resp);
            }
            Err(resp) => return resp,
        }
    }

    last_error.unwrap_or_else(|| {
        (
            StatusCode::BAD_GATEWAY,
            Json(transform::anthropic_error(502, "所有模型均请求失败")),
        )
            .into_response()
    })
}

async fn dispatch_upstream(
    inner: &ServerInner,
    config: &OpencodeGoProxyConfig,
    body: &Value,
    original_model: &str,
    upstream_model: &str,
    provider: routing::Provider,
    headers: &HeaderMap,
    trace: &traces::TraceCapture,
) -> Result<Response, Response> {
    let mut working_body = body.clone();
    if routing::is_third_party_upstream_model(upstream_model) {
        transform::sanitize_third_party_anthropic_request(&mut working_body);
    }
    let body = &working_body;

    let resolved = routing::resolve_upstream(provider, upstream_model, &config.upstream_url);

    let is_stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);

    let api_key = config.api_key.trim().to_string();

    if resolved.endpoint == routing::EndpointKind::AnthropicPassthrough {
        return Ok(forward_anthropic_passthrough(
            &inner.client,
            &resolved.url,
            &api_key,
            body,
            upstream_model,
            is_stream,
            headers,
            Some(trace.clone()),
        )
        .await);
    }

    let (upstream_json, endpoint) = match resolved.endpoint {
        routing::EndpointKind::Responses => {
            let req = transform_alt::anthropic_to_responses(body, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(transform::anthropic_error(400, &e)),
                )
                    .into_response()
            })?;
            (req, routing::EndpointKind::Responses)
        }
        routing::EndpointKind::Gemini => {
            let req = transform_alt::anthropic_to_gemini(body, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(transform::anthropic_error(400, &e)),
                )
                    .into_response()
            })?;
            (req, routing::EndpointKind::Gemini)
        }
        routing::EndpointKind::ChatCompletions => {
            let req = transform::anthropic_to_openai(body, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(transform::anthropic_error(400, &e)),
                )
                    .into_response()
            })?;
            (req, routing::EndpointKind::ChatCompletions)
        }
        routing::EndpointKind::AnthropicPassthrough => unreachable!(),
    };

    let mut req_builder = inner
        .client
        .post(&resolved.url)
        .header(header::CONTENT_TYPE, "application/json")
        .json(&upstream_json);

    req_builder = attach_opencode_upstream_auth(req_builder, &api_key, resolved.endpoint);

    if is_stream {
        req_builder = req_builder.header(header::ACCEPT, "text/event-stream");
    } else if let Some(accept) = headers.get(header::ACCEPT) {
        req_builder = req_builder.header(header::ACCEPT, accept);
    }

    let upstream_resp = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            trace.finish_error(Some(502), format!("上游请求失败: {e}"));
            return Err((
                StatusCode::BAD_GATEWAY,
                Json(transform::anthropic_error(502, &format!("上游请求失败: {e}"))),
            )
                .into_response());
        }
    };

    let status = upstream_resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        let text = upstream_resp.text().await.unwrap_or_default();
        let message = upstream_auth_error_message(code, &text);
        trace.finish_error(Some(code), message.clone());
        let resp = (
            StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(transform::anthropic_error(code, &message)),
        )
            .into_response();
        if router::should_retry_upstream(code) {
            return Err(resp);
        }
        return Ok(resp);
    }

    if is_stream {
        let trace_capture = trace.clone();
        return Ok(match endpoint {
            routing::EndpointKind::Responses => {
                stream_alt::stream_responses_to_anthropic(
                    upstream_resp,
                    original_model,
                    Some(trace_capture),
                )
                .await
            }
            routing::EndpointKind::Gemini => {
                stream_alt::stream_gemini_to_anthropic(
                    upstream_resp,
                    original_model,
                    Some(trace_capture),
                )
                .await
            }
            routing::EndpointKind::ChatCompletions => {
                stream_openai::stream_openai_to_anthropic(
                    upstream_resp,
                    original_model,
                    Some(trace_capture),
                )
                .await
            }
            routing::EndpointKind::AnthropicPassthrough => unreachable!(),
        });
    }

    let upstream_body: Value = match upstream_resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Err((
                StatusCode::BAD_GATEWAY,
                Json(transform::anthropic_error(502, &format!("解析上游响应失败: {e}"))),
            )
                .into_response());
        }
    };

    let anthropic = match endpoint {
        routing::EndpointKind::Responses => {
            transform_alt::responses_to_anthropic(&upstream_body, original_model)
        }
        routing::EndpointKind::Gemini => {
            transform_alt::gemini_to_anthropic(&upstream_body, original_model)
        }
        routing::EndpointKind::ChatCompletions => {
            transform::openai_to_anthropic(&upstream_body, original_model)
        }
        routing::EndpointKind::AnthropicPassthrough => unreachable!(),
    };

    match anthropic {
        Ok(v) => {
            trace.finish_success(200, traces::preview_json(&v));
            Ok((StatusCode::OK, Json(v)).into_response())
        }
        Err(e) => {
            trace.finish_error(Some(502), e.clone());
            Err((
                StatusCode::BAD_GATEWAY,
                Json(transform::anthropic_error(502, &e)),
            )
                .into_response())
        }
    }
}

async fn forward_anthropic_passthrough(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    upstream_model: &str,
    is_stream: bool,
    headers: &HeaderMap,
    trace: Option<traces::TraceCapture>,
) -> Response {
    let mut patched = body.clone();
    if let Some(obj) = patched.as_object_mut() {
        obj.insert("model".to_string(), json!(upstream_model));
    }

    let mut req_builder = attach_opencode_upstream_auth(
        client
            .post(url)
            .header("anthropic-version", "2023-06-01")
            .header(header::CONTENT_TYPE, "application/json")
            .json(&patched),
        api_key,
        routing::EndpointKind::AnthropicPassthrough,
    );

    if is_stream {
        req_builder = req_builder.header(header::ACCEPT, "text/event-stream");
    } else if let Some(accept) = headers.get(header::ACCEPT) {
        req_builder = req_builder.header(header::ACCEPT, accept);
    }

    let upstream_resp = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(transform::anthropic_error(502, &format!("上游请求失败: {e}"))),
            )
                .into_response();
        }
    };

    let status = upstream_resp.status();
    if !status.is_success() {
        let text = upstream_resp.text().await.unwrap_or_default();
        let message = upstream_auth_error_message(status.as_u16(), &text);
        if let Some(t) = &trace {
            t.finish_error(Some(status.as_u16()), message.clone());
        }
        return (
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(transform::anthropic_error(status.as_u16(), &message)),
        )
            .into_response();
    }

    let repair_passthrough = routing::is_third_party_upstream_model(upstream_model);

    if is_stream {
        let trace_capture = trace.clone();
        let repair_state = std::sync::Arc::new(std::sync::Mutex::new(
            stream_passthrough_repair::PassthroughRepairState::default(),
        ));
        let repair_state_chunk = repair_state.clone();
        let frame_buffer = std::sync::Arc::new(std::sync::Mutex::new(
            stream_common::SseFrameBuffer::default(),
        ));
        let frame_buffer_chunk = frame_buffer.clone();
        let frame_buffer_finalize = frame_buffer.clone();
        let stream = upstream_resp.bytes_stream().flat_map(move |chunk| {
            let parts: Vec<String> = match chunk {
                Ok(bytes) => {
                    let Ok(mut fb) = frame_buffer_chunk.lock() else {
                        return futures_util::stream::empty::<
                            Result<axum::body::Bytes, std::io::Error>,
                        >()
                        .boxed();
                    };
                    let frames = fb.extend(&bytes);
                    drop(fb);
                    if repair_passthrough {
                        let Ok(mut st) = repair_state_chunk.lock() else {
                            return futures_util::stream::empty::<
                                Result<axum::body::Bytes, std::io::Error>,
                            >()
                            .boxed();
                        };
                        frames
                            .into_iter()
                            .filter_map(|frame| {
                                stream_passthrough_repair::repair_passthrough_sse_frame(
                                    &frame, &mut st,
                                )
                            })
                            .collect()
                    } else {
                        frames
                    }
                }
                Err(e) => {
                    return futures_util::stream::once(async move {
                        Err::<axum::body::Bytes, std::io::Error>(std::io::Error::other(e))
                    })
                    .boxed();
                }
            };
            if let Some(ref t) = trace_capture {
                t.push_sse_text(&parts.join(""));
            }
            futures_util::stream::iter(
                parts
                    .into_iter()
                    .map(|s| Ok(axum::body::Bytes::from(s))),
            )
            .boxed()
        });
        let stream = stream.chain(futures_util::stream::once(async move {
            let tail_parts: Vec<String> = {
                let Ok(mut fb) = frame_buffer_finalize.lock() else {
                    return Ok::<_, std::io::Error>(Vec::new());
                };
                let mut frames = fb.drain_remaining();
                if repair_passthrough {
                    let Ok(mut st) = repair_state.lock() else {
                        return Ok(Vec::new());
                    };
                    frames = frames
                        .into_iter()
                        .filter_map(|frame| {
                            stream_passthrough_repair::repair_passthrough_sse_frame(&frame, &mut st)
                        })
                        .collect();
                }
                frames
            };
            if let Some(t) = trace {
                if !tail_parts.is_empty() {
                    t.push_sse_text(&tail_parts.join(""));
                }
                t.finalize_stream(status.as_u16());
            }
            Ok(tail_parts)
        }).flat_map(|result| {
            match result {
                Ok(parts) => futures_util::stream::iter(
                    parts
                        .into_iter()
                        .map(|s| Ok(axum::body::Bytes::from(s))),
                )
                .boxed(),
                Err(e) => futures_util::stream::once(async move { Err(e) }).boxed(),
            }
        }));
        let body = Body::from_stream(stream);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(body)
            .unwrap_or_else(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(transform::anthropic_error(500, "构建流响应失败")),
                )
                    .into_response()
            });
    }

    let bytes = upstream_resp.bytes().await.unwrap_or_default();
    let body_bytes = if repair_passthrough {
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(json) => {
                let fixed = stream_passthrough_repair::repair_passthrough_message_json(&json);
                serde_json::to_vec(&fixed).unwrap_or_else(|_| bytes.to_vec())
            }
            Err(_) => bytes.to_vec(),
        }
    } else {
        bytes.to_vec()
    };
    if let Some(t) = &trace {
        t.finish_success(
            status.as_u16(),
            traces::preview_text(&String::from_utf8_lossy(&body_bytes)),
        );
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body_bytes))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(transform::anthropic_error(500, "构建响应失败")),
            )
                .into_response()
        })
}

/// OpenCode Go 代理运行中时，覆盖 Claude 子进程 `ANTHROPIC_BASE_URL`。
pub(crate) fn claude_spawn_anthropic_base_url_override() -> Option<String> {
    let inner = server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .cloned()?;
    let cfg = persisted_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if !cfg.enabled {
        return None;
    }
    Some(proxy_base_url(inner.port))
}

pub(crate) fn bootstrap_from_db(app: &AppHandle) {
    let Some(db) = app.try_state::<crate::wise_db::WiseDb>() else {
        return;
    };
    let cfg = load_persisted(&db);
    *persisted_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = cfg.clone();
    if cfg.enabled && !cfg.api_key.trim().is_empty() {
        let cfg_clone = cfg.clone();
        tauri::async_runtime::spawn(async move {
            let model = cfg_clone.effective_model();
            match start_server(cfg_clone).await {
                Ok(inner) => {
                    let port = inner.port;
                    let _ = tokio::task::spawn_blocking(move || {
                        if !claude_settings_aligned(port) {
                            let _ = apply_claude_settings_sync(port);
                        }
                        if !codex_settings_aligned(port, &model) {
                            let _ = apply_codex_settings_sync(port, &model);
                        }
                        Ok::<(), String>(())
                    })
                    .await;
                }
                Err(e) => eprintln!("[opencode_go_proxy] bootstrap start failed: {e}"),
            }
        });
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOpencodeGoProxyConfigInput {
    pub enabled: bool,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub upstream_url: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub fallback_models: Option<Vec<String>>,
    #[serde(default)]
    pub model_overrides: Option<HashMap<String, ModelOverride>>,
    #[serde(default)]
    pub debug: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoProxyPrefsInput {
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub upstream_url: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub fallback_models: Option<Vec<String>>,
    #[serde(default)]
    pub model_overrides: Option<HashMap<String, ModelOverride>>,
    #[serde(default)]
    pub debug: Option<bool>,
}

fn apply_prefs_patch(cfg: &mut OpencodeGoProxyConfig, input: &OpencodeGoProxyPrefsInput) {
    if let Some(key) = input.api_key.as_ref() {
        let t = key.trim();
        if !t.is_empty() {
            cfg.api_key = t.to_string();
        }
    }
    if let Some(port) = input.port {
        if port > 0 {
            cfg.port = port;
        }
    }
    if let Some(model) = input.default_model.as_ref() {
        cfg.default_model = model.clone();
    }
    if let Some(url) = input.upstream_url.as_ref() {
        cfg.upstream_url = url.clone();
    }
    if let Some(provider) = input.provider.as_ref() {
        let t = provider.trim();
        if !t.is_empty() {
            cfg.provider = t.to_string();
        }
    }
    if let Some(fallbacks) = input.fallback_models.as_ref() {
        cfg.fallback_models = fallbacks
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    if let Some(overrides) = input.model_overrides.as_ref() {
        cfg.model_overrides = overrides
            .iter()
            .filter(|(_, v)| !v.model_id.trim().is_empty())
            .map(|(k, v)| (k.trim().to_string(), v.clone()))
            .collect();
    }
    if let Some(debug) = input.debug {
        cfg.debug = debug;
    }
}

fn load_persisted_into_cell(db: &crate::wise_db::WiseDb) -> OpencodeGoProxyConfig {
    let cfg = load_persisted(db);
    *persisted_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = cfg.clone();
    cfg
}

fn apply_runtime_config(db: &crate::wise_db::WiseDb, cfg: OpencodeGoProxyConfig) -> Result<(), String> {
    *persisted_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = cfg.clone();
    save_persisted(db, &cfg)?;
    if let Some(inner) = server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        *inner
            .config
            .write()
            .unwrap_or_else(|e| e.into_inner()) = cfg;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_opencode_go_proxy_status(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
) -> Result<OpencodeGoProxyStatus, String> {
    let cfg = load_persisted_into_cell(&db);
    Ok(build_status(&cfg).await)
}

/// 切换默认上游模型；运行中代理会热更新，无需重启。
#[tauri::command]
pub async fn switch_opencode_go_proxy_model(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
    model: String,
) -> Result<OpencodeGoProxyStatus, String> {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return Err("模型 ID 不能为空".into());
    }
    let mut cfg = load_persisted(&db);
    cfg.default_model = trimmed.to_string();
    apply_runtime_config(&db, cfg)?;
    let cfg = load_persisted_into_cell(&db);
    if server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
    {
        let port = resolve_active_port(&cfg);
        let model = cfg.effective_model();
        let provider = routing::provider_label(cfg.effective_provider()).to_string();
        tokio::task::spawn_blocking(move || {
            sync_opencode_proxy_client_settings(port, &model)?;
            mirror_proxy_model_to_opencode_json(&provider, &model)?;
            Ok::<(), String>(())
        })
            .await
            .map_err(|e| e.to_string())??;
    }
    Ok(build_status(&cfg).await)
}

/// 仅持久化配置字段，不改变代理启停状态（运行中代理会热更新内存配置）。
#[tauri::command]
pub async fn save_opencode_go_proxy_prefs(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
    input: OpencodeGoProxyPrefsInput,
) -> Result<OpencodeGoProxyStatus, String> {
    let prev_cfg = load_persisted(&db);
    let mut cfg = prev_cfg.clone();
    apply_prefs_patch(&mut cfg, &input);
    apply_runtime_config(&db, cfg)?;
    let cfg = load_persisted_into_cell(&db);
    if server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
    {
        let port_changed = prev_cfg.port != cfg.port;
        let model_changed = prev_cfg.effective_model() != cfg.effective_model();
        if port_changed || model_changed {
            let port = resolve_active_port(&cfg);
            let model = cfg.effective_model();
            let provider = routing::provider_label(cfg.effective_provider()).to_string();
            tokio::task::spawn_blocking(move || {
                sync_opencode_proxy_client_settings(port, &model)?;
                mirror_proxy_model_to_opencode_json(&provider, &model)?;
                Ok::<(), String>(())
            })
            .await
            .map_err(|e| e.to_string())??;
        }
    }
    Ok(build_status(&cfg).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListOpencodeGoProxyModelsInput {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
}

/// 从 OpenCode 上游拉取可用模型 ID（对齐 oc-go-cc models）。
#[tauri::command]
pub async fn list_opencode_go_proxy_models(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
    input: ListOpencodeGoProxyModelsInput,
) -> Result<Vec<String>, String> {
    let cfg = load_persisted(&db);
    let api_key = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(cfg.api_key.trim());
    if api_key.is_empty() {
        return Err("请先配置 OpenCode API Key".into());
    }
    let provider = input
        .provider
        .as_deref()
        .map(routing::parse_provider)
        .unwrap_or_else(|| cfg.effective_provider());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    models::fetch_model_ids(&client, provider, api_key).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeGoProxyValidation {
    pub ok: bool,
    pub api_key_valid: bool,
    pub model_count: usize,
    pub default_model_available: bool,
    pub messages: Vec<String>,
}

/// 校验 API Key 与默认模型是否可用（对齐 oc-go-cc validate）。
#[tauri::command]
pub async fn validate_opencode_go_proxy_config(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
) -> Result<OpencodeGoProxyValidation, String> {
    let cfg = load_persisted(&db);
    let mut messages = Vec::new();
    if cfg.api_key.trim().is_empty() {
        return Ok(OpencodeGoProxyValidation {
            ok: false,
            api_key_valid: false,
            model_count: 0,
            default_model_available: false,
            messages: vec!["未配置 OpenCode API Key".into()],
        });
    }

    let provider = cfg.effective_provider();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let models = match models::fetch_model_ids(&client, provider, &cfg.api_key).await {
        Ok(ids) => {
            messages.push(format!("API Key 有效，拉取到 {} 个模型", ids.len()));
            ids
        }
        Err(e) => {
            return Ok(OpencodeGoProxyValidation {
                ok: false,
                api_key_valid: false,
                model_count: 0,
                default_model_available: false,
                messages: vec![e],
            });
        }
    };

    let default_model = cfg.effective_model();
    let default_model_available = models.iter().any(|m| m == &default_model);
    if default_model_available {
        messages.push(format!("默认模型 {default_model} 可用"));
    } else {
        messages.push(format!("默认模型 {default_model} 不在上游列表中"));
    }

    let port = if cfg.port == 0 {
        DEFAULT_PORT
    } else {
        cfg.port
    };
    if cfg.enabled {
        let running = server_cell()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();
        if running {
            messages.push(format!("本地代理运行中：{}", proxy_base_url(port)));
        } else {
            messages.push("代理已启用但未运行，请检查端口占用".into());
        }
    }

    Ok(OpencodeGoProxyValidation {
        ok: default_model_available,
        api_key_valid: true,
        model_count: models.len(),
        default_model_available,
        messages,
    })
}

#[tauri::command]
pub fn list_opencode_go_proxy_traces(
    limit: Option<usize>,
    since_ms: Option<i64>,
) -> Vec<traces::OpencodeGoProxyTraceEntry> {
    traces::trace_store()
        .list(limit.unwrap_or(200).min(200), since_ms)
}

#[tauri::command]
pub fn clear_opencode_go_proxy_traces() -> usize {
    traces::trace_store().clear()
}

#[tauri::command]
pub async fn set_opencode_go_proxy_config(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
    input: SetOpencodeGoProxyConfigInput,
) -> Result<OpencodeGoProxyStatus, String> {
    let mut cfg = load_persisted(&db);
    cfg.enabled = input.enabled;
    apply_prefs_patch(
        &mut cfg,
        &OpencodeGoProxyPrefsInput {
            api_key: input.api_key,
            port: input.port,
            default_model: input.default_model,
            upstream_url: input.upstream_url,
            provider: input.provider,
            fallback_models: input.fallback_models,
            model_overrides: input.model_overrides,
            debug: input.debug,
        },
    );

    if cfg.enabled {
        start_server(cfg.clone()).await?;
        let port = resolve_active_port(&cfg);
        let model = cfg.effective_model();
        let provider = routing::provider_label(cfg.effective_provider()).to_string();
        tokio::task::spawn_blocking(move || {
            sync_opencode_proxy_client_settings(port, &model)?;
            mirror_proxy_model_to_opencode_json(&provider, &model)?;
            Ok::<(), String>(())
        })
        .await
        .map_err(|e| e.to_string())??;
    } else {
        stop_server();
    }

    *persisted_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = cfg.clone();
    save_persisted(&db, &cfg)?;

    Ok(build_status(&cfg).await)
}

fn proxy_server_running() -> bool {
    server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
}

/// 一次性同步 Claude settings.json 与 Codex config.toml。
#[tauri::command]
pub async fn apply_opencode_go_proxy_client_settings(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
) -> Result<bool, String> {
    let cfg = load_persisted(&db);
    if !proxy_server_running() {
        if !cfg.enabled {
            return Err("OpenCode Go 代理未启用".into());
        }
        return Ok(false);
    }
    let port = resolve_active_port(&cfg);
    let model = cfg.effective_model();
    tokio::task::spawn_blocking(move || sync_opencode_proxy_client_settings(port, &model))
        .await
        .map_err(|e| e.to_string())?
        .map(|(claude, codex)| claude || codex)
}

#[tauri::command]
pub async fn apply_opencode_go_proxy_claude_settings(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
) -> Result<bool, String> {
    let cfg = load_persisted(&db);
    if !proxy_server_running() {
        if !cfg.enabled {
            return Err("OpenCode Go 代理未启用".into());
        }
        return Ok(false);
    }
    let port = resolve_active_port(&cfg);
    tokio::task::spawn_blocking(move || apply_claude_settings_sync(port))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn apply_opencode_go_proxy_codex_settings(
    db: tauri::State<'_, crate::wise_db::WiseDb>,
) -> Result<bool, String> {
    let cfg = load_persisted(&db);
    if !proxy_server_running() {
        if !cfg.enabled {
            return Err("OpenCode Go 代理未启用".into());
        }
        return Ok(false);
    }
    let port = resolve_active_port(&cfg);
    let model = cfg.effective_model();
    tokio::task::spawn_blocking(move || apply_codex_settings_sync(port, &model))
        .await
        .map_err(|e| e.to_string())?
}

fn resolve_active_port(cfg: &OpencodeGoProxyConfig) -> u16 {
    if let Some(inner) = server_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        return inner.port;
    }
    if cfg.port == 0 {
        DEFAULT_PORT
    } else {
        cfg.port
    }
}

fn proxy_running_with_key(cfg: &OpencodeGoProxyConfig) -> bool {
    cfg.enabled
        && !cfg.api_key.trim().is_empty()
        && server_cell()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
}

/// `provider/model` 或裸模型 ID → 代理上游模型 ID。
pub(crate) fn proxy_upstream_model_from_opencode_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    trimmed
        .rsplit_once('/')
        .map(|(_, id)| id.trim())
        .filter(|id| !id.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn opencode_model_selection_for_proxy(cfg: &OpencodeGoProxyConfig, upstream: &str) -> String {
    format!(
        "{}/{}",
        routing::provider_label(cfg.effective_provider()),
        upstream.trim()
    )
}

fn mirror_proxy_model_to_opencode_json(provider: &str, upstream_model: &str) -> Result<bool, String> {
    let selection = format!("{}/{}", provider.trim(), upstream_model.trim());
    crate::opencode_config_dir::mirror_opencode_global_model(&selection)
}

fn sync_opencode_proxy_client_settings(
    port: u16,
    default_model: &str,
) -> Result<(bool, bool), String> {
    let _guard = client_settings_sync_lock()?;
    let claude_changed = apply_claude_settings_sync_inner(port)?;
    let codex_changed = apply_codex_settings_sync_inner(port, default_model)?;
    Ok((claude_changed, codex_changed))
}

/// OpenCode 全局 model 变更后：热更新代理默认模型，并在代理运行中时同步 Claude/Codex 与 opencode.json。
pub(crate) fn sync_opencode_proxy_clients_after_model_change(
    db: &crate::wise_db::WiseDb,
    opencode_model: &str,
) -> Result<(), String> {
    let upstream = proxy_upstream_model_from_opencode_model(opencode_model);
    if upstream.is_empty() {
        return Ok(());
    }
    let mut cfg = load_persisted(db);
    if !cfg.enabled || cfg.api_key.trim().is_empty() {
        return Ok(());
    }
    if cfg.effective_model() != upstream {
        cfg.default_model = upstream.clone();
        apply_runtime_config(db, cfg)?;
    }
    let cfg = load_persisted(db);
    if !proxy_running_with_key(&cfg) {
        return Ok(());
    }
    let port = resolve_active_port(&cfg);
    let model = cfg.effective_model();
    sync_opencode_proxy_client_settings(port, &model)?;
    let mirror_selection = if opencode_model.contains('/') {
        opencode_model.trim().to_string()
    } else {
        opencode_model_selection_for_proxy(&cfg, &model)
    };
    crate::opencode_config_dir::mirror_opencode_global_model(&mirror_selection)?;
    Ok(())
}

/// Codex `exec` 前：若内置代理运行中，覆盖 `~/.codex` 桥接配置并返回应使用的上游模型 ID。
pub(crate) fn apply_codex_bridge_for_spawn(db: &crate::wise_db::WiseDb) -> Result<Option<String>, String> {
    let cfg = load_persisted(db);
    if !proxy_running_with_key(&cfg) {
        return Ok(None);
    }
    let port = resolve_active_port(&cfg);
    let model = cfg.effective_model();
    apply_codex_settings_sync(port, &model)?;
    Ok(Some(model))
}

/// Codex 子进程环境：指向本地桥接（占位 Key，真实 Key 由代理注入上游）。
pub(crate) fn codex_spawn_env_overrides(db: &crate::wise_db::WiseDb) -> Option<(String, String)> {
    let cfg = load_persisted(db);
    if !proxy_running_with_key(&cfg) {
        return None;
    }
    let port = resolve_active_port(&cfg);
    let base = format!("{}/v1", proxy_base_url(port).trim_end_matches('/'));
    Some((CODEX_PLACEHOLDER_API_KEY.to_string(), base))
}

fn build_codex_bridge_config_toml(port: u16, default_model: &str) -> String {
    let base_url = format!("{}/v1", proxy_base_url(port).trim_end_matches('/'));
    format!(
        r#"model_provider = "{CODEX_PROVIDER_ID}"
model = "{default_model}"

[model_providers.{CODEX_PROVIDER_ID}]
name = "Wise OpenCode"
base_url = "{base_url}"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
supports_websockets = false
requires_openai_auth = false
"#
    )
}

fn patch_codex_auth_for_bridge(
    auth: &serde_json::Map<String, Value>,
) -> serde_json::Map<String, Value> {
    use serde_json::json;

    let mut out = auth.clone();
    let existing = out
        .get("OPENAI_API_KEY")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if existing.is_empty() || existing == CODEX_PLACEHOLDER_API_KEY {
        out.insert(
            "OPENAI_API_KEY".to_string(),
            json!(CODEX_PLACEHOLDER_API_KEY),
        );
    }
    if !out.contains_key("auth_mode") {
        out.insert("auth_mode".to_string(), json!("apikey"));
    }
    out
}

fn apply_codex_settings_sync(port: u16, default_model: &str) -> Result<bool, String> {
    let _guard = client_settings_sync_lock()?;
    apply_codex_settings_sync_inner(port, default_model)
}

fn apply_codex_settings_sync_inner(port: u16, default_model: &str) -> Result<bool, String> {
    if codex_settings_aligned(port, default_model) {
        return Ok(false);
    }
    let current = crate::codex_config_dir::read_codex_profile_envelope();
    let config = merge_codex_bridge_into_config(&current.config, port, default_model);
    // 弃用 v2 profile 文件，避免 `--profile` 与根级 `model_provider` 双轨不一致。
    let stale_profile = crate::codex_config_dir::codex_profile_v2_path(CODEX_PROFILE_ID);
    if stale_profile.is_file() {
        let _ = std::fs::remove_file(&stale_profile);
    }
    let auth = patch_codex_auth_for_bridge(&current.auth);
    let envelope = crate::codex_config_dir::CodexProfileEnvelope { auth, config };
    crate::codex_config_dir::apply_codex_profile_envelope(&envelope)?;
    Ok(true)
}

fn apply_claude_settings_sync(port: u16) -> Result<bool, String> {
    let _guard = client_settings_sync_lock()?;
    apply_claude_settings_sync_inner(port)
}

fn apply_claude_settings_sync_inner(port: u16) -> Result<bool, String> {
    if claude_settings_aligned(port) {
        return Ok(false);
    }

    let settings_path = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let mut root: Value = if settings_path.is_file() {
        let text = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())?
    } else {
        json!({})
    };

    let root_obj = root
        .as_object_mut()
        .ok_or_else(|| "settings.json 根节点必须是对象".to_string())?;
    if !root_obj
        .get("env")
        .map(|value| value.is_object())
        .unwrap_or(true)
    {
        root_obj.insert("env".to_string(), json!({}));
    }
    let env_obj = root_obj
        .entry("env")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "env 必须是对象".to_string())?;

    env_obj.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        json!(proxy_base_url(port)),
    );
    env_obj.insert("ANTHROPIC_AUTH_TOKEN".to_string(), json!("unused"));
    env_obj.insert(
        "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY".to_string(),
        json!("1"),
    );
    env_obj.insert(
        "CLAUDE_CODE_AUTO_COMPACT_WINDOW".to_string(),
        json!("190000"),
    );
    env_obj.remove("ANTHROPIC_API_KEY");
    crate::claude_config_dir::apply_local_proxy_claude_model_env(env_obj);
    crate::claude_config_dir::apply_local_proxy_claude_tool_compat_json_env(env_obj);
    if let Some(model) = root_obj.get_mut("model") {
        *model = json!("claude-sonnet-4-8");
    } else {
        root_obj.insert("model".to_string(), json!("claude-sonnet-4-8"));
    }

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&settings_path, &serialized)?;
    Ok(true)
}

#[cfg(test)]
mod codex_bridge_config_tests {
    use super::*;

    #[test]
    fn merge_preserves_unrelated_codex_sections() {
        let existing = r#"model = "gpt-5.4"
model_reasoning_effort = "medium"

[profiles.other]
model = "gpt-5.4"
"#;
        let merged = merge_codex_bridge_into_config(existing, 9876, "kimi-k2.6");
        assert!(merged.contains("model_reasoning_effort"));
        assert!(merged.contains("[profiles.other]"));
        assert!(merged.contains("[model_providers.wise-opencode]"));
        assert!(!merged.contains("profile = \"wise-opencode-go\""));
        assert!(!merged.contains("[profiles.wise-opencode-go]"));
        assert!(merged.contains("model_provider = \"wise-opencode\""));
        assert!(merged.contains("model = \"kimi-k2.6\""));
        assert!(merged.contains("http://127.0.0.1:9876/v1"));
        assert!(merged.contains("supports_websockets = false"));
    }

    #[test]
    fn merge_dedupes_model_keys_under_projects_section() {
        let existing = r#"
[projects."/repo"]
trust_level = "trusted"
model_provider = "wise-opencode"
model = "old-model"

model_provider = "wise-opencode"
model = "old-model"

[model_providers.wise-opencode]
base_url = "http://127.0.0.1:1111/v1"
"#;
        let merged = merge_codex_bridge_into_config(existing, 9876, "kimi-k2.6");
        assert_eq!(
            merged.matches("model_provider = ").count(),
            1,
            "expected single model_provider, got:\n{merged}"
        );
        assert_eq!(merged.matches("model = ").count(), 1);
        assert!(!merged.contains("1111"));
        assert!(merged.starts_with("model_provider = \"wise-opencode\""));
    }

    #[test]
    fn merge_replaces_stale_wise_sections() {
        let existing = r#"[model_providers.wise-opencode]
base_url = "http://127.0.0.1:1111/v1"

[profiles.wise-opencode-go]
model = "old-model"
"#;
        let merged = merge_codex_bridge_into_config(existing, 9876, "kimi-k2.6");
        assert!(!merged.contains("1111"));
        assert!(!merged.contains("[profiles.wise-opencode-go]"));
        assert!(merged.contains("model = \"kimi-k2.6\""));
        assert!(merged.contains("127.0.0.1:9876"));
    }

    #[test]
    fn merge_strips_top_level_codex_profile_for_bridge() {
        let existing = r#"profile = "default"
model = "gpt-5.4"

[profiles.default]
model = "gpt-5.4"
"#;
        let merged = merge_codex_bridge_into_config(existing, 9876, "kimi-k2.6");
        assert!(!merged.contains("profile = \"default\""));
        assert!(merged.contains("[profiles.default]"));
        assert!(merged.contains("model_provider = \"wise-opencode\""));
        assert!(merged.contains("model = \"kimi-k2.6\""));
    }

    #[test]
    fn reads_bridge_model_from_top_level() {
        let config = r#"model_provider = "wise-opencode"
model = "qwen3.7-plus"
"#;
        assert_eq!(
            read_toml_section_value(config, "", "model").as_deref(),
            Some("qwen3.7-plus")
        );
    }

    #[test]
    fn codex_base_url_normalizes_trailing_slash() {
        assert!(codex_base_url_matches("http://127.0.0.1:9876/v1/", 9876));
        assert!(codex_base_url_matches("http://127.0.0.1:9876/v1", 9876));
    }

    #[test]
    fn extracts_upstream_model_from_provider_slash_model() {
        assert_eq!(
            proxy_upstream_model_from_opencode_model("opencode-go/kimi-k2.6"),
            "kimi-k2.6"
        );
        assert_eq!(
            proxy_upstream_model_from_opencode_model("kimi-k2.6"),
            "kimi-k2.6"
        );
    }
}
