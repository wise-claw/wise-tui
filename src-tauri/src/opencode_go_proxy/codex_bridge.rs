//! Codex CLI 本地桥接：`/v1/chat/completions` 与 `/v1/responses`（参考 ocgo）。

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::StreamExt;
use serde_json::{json, Value};

use super::circuit;
use super::codex_convert::{
    chat_response_to_responses, openai_error, patch_model_in_body, responses_to_chat,
};
use super::router;
use super::routing;
use super::models;
use super::stream_anthropic_responses;
use super::stream_codex;
use super::traces;
use super::{attach_opencode_upstream_auth, upstream_auth_error_message, AppState, ServerInner};

pub async fn chat_completions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    handle_openai_protocol(
        &state,
        &headers,
        &body,
        "/v1/chat/completions",
        OpenAiWire::ChatCompletions,
    )
    .await
}

pub async fn responses_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    handle_openai_protocol(&state, &headers, &body, "/v1/responses", OpenAiWire::Responses).await
}

pub async fn models_handler(State(state): State<AppState>) -> Response {
    let config = state
        .inner
        .config
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if config.api_key.trim().is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(openai_error(401, "OpenCode API Key 未配置")),
        )
            .into_response();
    }
    let provider = config.effective_provider();
    match models::fetch_model_ids(&state.inner.client, provider, &config.api_key).await {
        Ok(ids) => {
            let data: Vec<Value> = ids
                .iter()
                .map(|id| {
                    json!({
                        "id": id,
                        "object": "model",
                        "created": 0,
                        "owned_by": routing::provider_label(provider),
                    })
                })
                .collect();
            (StatusCode::OK, Json(json!({ "object": "list", "data": data }))).into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(openai_error(502, &e)),
        )
            .into_response(),
    }
}

enum OpenAiWire {
    ChatCompletions,
    Responses,
}

async fn handle_openai_protocol(
    state: &AppState,
    headers: &HeaderMap,
    body: &Value,
    path: &str,
    wire: OpenAiWire,
) -> Response {
    let config = state
        .inner
        .config
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone();

    let requested_model = body
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let client_model = if requested_model.is_empty() {
        config.effective_model()
    } else {
        requested_model.clone()
    };

    if config.api_key.trim().is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(openai_error(
                401,
                "OpenCode API Key 未配置，请在 OpenCode 代理设置中填写并重启代理",
            )),
        )
            .into_response();
    }

    let mut provider = config.effective_provider();
    if let Some(ov) = router::lookup_model_override(&client_model, &config.model_overrides) {
        if let Some(p) = ov.provider.as_deref() {
            provider = routing::parse_provider(p);
        }
    }

    let primary = router::resolve_codex_upstream_model(
        &client_model,
        &config.effective_model(),
        &config.model_overrides,
    );
    let chain = circuit::filter_available_models(router::build_model_chain(
        &primary,
        &config.fallback_models,
    ));
    let is_stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);

    if config.debug {
        eprintln!(
            "[opencode_go_proxy] POST {path} client={client_model} primary={primary} chain={chain:?} stream={is_stream}"
        );
    }

    let mut last_error: Option<Response> = None;
    for upstream_model in chain {
        let resolved = routing::resolve_upstream(provider, &upstream_model, &config.upstream_url);
        let trace = traces::TraceCapture::begin(
            path,
            client_model.clone(),
            upstream_model.clone(),
            resolved.url.clone(),
            body,
            is_stream,
        );

        let result = match wire {
            OpenAiWire::ChatCompletions => {
                dispatch_chat_completions(
                    &state.inner,
                    &config,
                    body,
                    &client_model,
                    &upstream_model,
                    provider,
                    headers,
                    &trace,
                )
                .await
            }
            OpenAiWire::Responses => {
                dispatch_responses(
                    &state.inner,
                    &config,
                    body,
                    &client_model,
                    &upstream_model,
                    provider,
                    headers,
                    &trace,
                )
                .await
            }
        };

        match result {
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
            Json(openai_error(502, "所有模型均请求失败")),
        )
            .into_response()
    })
}

async fn dispatch_chat_completions(
    inner: &ServerInner,
    config: &super::OpencodeGoProxyConfig,
    body: &Value,
    original_model: &str,
    upstream_model: &str,
    provider: routing::Provider,
    headers: &HeaderMap,
    trace: &traces::TraceCapture,
) -> Result<Response, Response> {
    let resolved = routing::resolve_upstream(provider, upstream_model, &config.upstream_url);
    let is_stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let api_key = config.api_key.trim();

    match resolved.endpoint {
        routing::EndpointKind::AnthropicPassthrough => {
            let chat = patch_model_in_body(body, upstream_model);
            let anthropic = openai_chat_to_anthropic_request(&chat, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(openai_error(400, &e)),
                )
                    .into_response()
            })?;
            return Ok(forward_anthropic_as_openai_chat(
                &inner.client,
                &resolved.url,
                api_key,
                &anthropic,
                original_model,
                is_stream,
                trace,
            )
            .await);
        }
        routing::EndpointKind::Responses | routing::EndpointKind::Gemini => {
            // Codex chat 端点遇到 Zen Responses/Gemini 上游：转为 responses 再转发
            let responses_body = chat_body_to_responses_request(body, upstream_model);
            return dispatch_responses(
                inner,
                config,
                &responses_body,
                original_model,
                upstream_model,
                provider,
                headers,
                trace,
            )
            .await;
        }
        routing::EndpointKind::ChatCompletions => {
            let upstream_body = patch_model_in_body(body, upstream_model);
            forward_openai_passthrough(
                &inner.client,
                &resolved.url,
                api_key,
                &upstream_body,
                is_stream,
                headers,
                resolved.endpoint,
                trace,
            )
            .await
        }
    }
}

async fn dispatch_responses(
    inner: &ServerInner,
    config: &super::OpencodeGoProxyConfig,
    body: &Value,
    original_model: &str,
    upstream_model: &str,
    provider: routing::Provider,
    headers: &HeaderMap,
    trace: &traces::TraceCapture,
) -> Result<Response, Response> {
    let resolved = routing::resolve_upstream(provider, upstream_model, &config.upstream_url);
    let is_stream = body.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let api_key = config.api_key.trim();

    match resolved.endpoint {
        routing::EndpointKind::Responses => {
            let upstream_body = patch_model_in_body(body, upstream_model);
            forward_openai_passthrough(
                &inner.client,
                &resolved.url,
                api_key,
                &upstream_body,
                is_stream,
                headers,
                resolved.endpoint,
                trace,
            )
            .await
        }
        routing::EndpointKind::AnthropicPassthrough => {
            let chat = responses_to_chat(body, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(openai_error(400, &e)),
                )
                    .into_response()
            })?;
            let anthropic = openai_chat_to_anthropic_request(&chat, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(openai_error(400, &e)),
                )
                    .into_response()
            })?;
            Ok(forward_anthropic_as_responses(
                &inner.client,
                &resolved.url,
                api_key,
                &anthropic,
                original_model,
                is_stream,
                trace,
            )
            .await)
        }
        routing::EndpointKind::Gemini => Err((
            StatusCode::BAD_REQUEST,
            Json(openai_error(
                400,
                "Codex 桥接暂不支持 Gemini 上游，请换用 Chat Completions 模型",
            )),
        )
            .into_response()),
        routing::EndpointKind::ChatCompletions => {
            let chat = responses_to_chat(body, upstream_model).map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(openai_error(400, &e)),
                )
                    .into_response()
            })?;

            let upstream_resp = post_upstream_json(
                &inner.client,
                &resolved.url,
                api_key,
                &chat,
                is_stream,
                headers,
                routing::EndpointKind::ChatCompletions,
            )
            .await?;

            let status = upstream_resp.status();
            if !status.is_success() {
                return Err(upstream_error_response(status, upstream_resp, trace).await);
            }

            if is_stream {
                return Ok(stream_codex::stream_chat_to_responses(
                    upstream_resp,
                    original_model,
                    Some(trace.clone()),
                )
                .await);
            }

            let chat_body: Value = upstream_resp.json().await.map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    Json(openai_error(502, &format!("解析上游响应失败: {e}"))),
                )
                    .into_response()
            })?;
            let responses = chat_response_to_responses(&chat_body, original_model);
            trace.finish_success(200, traces::preview_json(&responses));
            Ok((StatusCode::OK, Json(responses)).into_response())
        }
    }
}

async fn forward_openai_passthrough(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    is_stream: bool,
    headers: &HeaderMap,
    endpoint: routing::EndpointKind,
    trace: &traces::TraceCapture,
) -> Result<Response, Response> {
    let upstream_resp = post_upstream_json(client, url, api_key, body, is_stream, headers, endpoint).await?;
    let status = upstream_resp.status();
    if !status.is_success() {
        return Err(upstream_error_response(status, upstream_resp, trace).await);
    }

    if is_stream {
        let trace_capture = trace.clone();
        let stream = upstream_resp.bytes_stream().map(move |chunk| {
            if let Ok(ref bytes) = chunk {
                trace_capture.push_sse_text(&String::from_utf8_lossy(bytes));
            }
            chunk.map_err(std::io::Error::other)
        });
        let trace_finalize = trace.clone();
        let stream = stream.chain(futures_util::stream::once(async move {
            trace_finalize.finalize_stream(status.as_u16());
            Ok::<_, std::io::Error>(axum::body::Bytes::new())
        }));
        return Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from_stream(stream))
            .unwrap_or_else(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(openai_error(500, "构建流响应失败")),
                )
                    .into_response()
            }));
    }

    let bytes = upstream_resp.bytes().await.unwrap_or_default();
    trace.finish_success(
        status.as_u16(),
        traces::preview_text(&String::from_utf8_lossy(&bytes)),
    );
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(bytes))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(openai_error(500, "构建响应失败")),
            )
                .into_response()
        }))
}

async fn post_upstream_json(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    is_stream: bool,
    headers: &HeaderMap,
    endpoint: routing::EndpointKind,
) -> Result<reqwest::Response, Response> {
    let mut req_builder = attach_opencode_upstream_auth(
        client
            .post(url)
            .header(header::CONTENT_TYPE, "application/json")
            .json(body),
        api_key,
        endpoint,
    );
    if is_stream {
        req_builder = req_builder.header(header::ACCEPT, "text/event-stream");
    } else if let Some(accept) = headers.get(header::ACCEPT) {
        req_builder = req_builder.header(header::ACCEPT, accept);
    }
    req_builder.send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(openai_error(502, &format!("上游请求失败: {e}"))),
        )
            .into_response()
    })
}

async fn upstream_error_response(
    status: reqwest::StatusCode,
    upstream_resp: reqwest::Response,
    trace: &traces::TraceCapture,
) -> Response {
    let code = status.as_u16();
    let text = upstream_resp.text().await.unwrap_or_default();
    let message = upstream_auth_error_message(code, &text);
    trace.finish_error(Some(code), message.clone());
    let resp = (
        StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_GATEWAY),
        Json(openai_error(code, &message)),
    )
        .into_response();
    if router::should_retry_upstream(code) {
        return resp;
    }
    resp
}

fn chat_body_to_responses_request(body: &Value, upstream_model: &str) -> Value {
    let mut out = body.clone();
    if let Some(obj) = out.as_object_mut() {
        obj.insert("model".to_string(), json!(upstream_model));
        if !obj.contains_key("input") {
            if let Some(messages) = obj.get("messages").cloned() {
                obj.insert("input".to_string(), messages);
                obj.remove("messages");
            }
        }
    }
    out
}

fn openai_chat_to_anthropic_request(chat: &Value, upstream_model: &str) -> Result<Value, String> {
    let obj = chat
        .as_object()
        .ok_or_else(|| "请求体必须是 JSON 对象".to_string())?;
    let messages = obj
        .get("messages")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "缺少 messages".to_string())?;

    let mut system_parts: Vec<String> = Vec::new();
    let mut anthropic_messages: Vec<Value> = Vec::new();

    for msg in messages {
        let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("user");
        match role {
            "system" | "developer" => {
                if let Some(text) = msg.get("content").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        system_parts.push(text.to_string());
                    }
                }
            }
            "tool" => {
                let call_id = msg.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or("");
                let content = msg
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                anthropic_messages.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": content,
                    }]
                }));
            }
            "assistant" => {
                let mut blocks: Vec<Value> = Vec::new();
                if let Some(text) = msg.get("content").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        blocks.push(json!({ "type": "text", "text": text }));
                    }
                }
                if let Some(tool_calls) = msg.get("tool_calls").and_then(|v| v.as_array()) {
                    for tc in tool_calls {
                        let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let func = tc.get("function").unwrap_or(&Value::Null);
                        let name = func.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let args = func
                            .get("arguments")
                            .and_then(|v| v.as_str())
                            .unwrap_or("{}");
                        let input: Value = serde_json::from_str(args).unwrap_or(json!({}));
                        blocks.push(json!({
                            "type": "tool_use",
                            "id": id,
                            "name": name,
                            "input": input,
                        }));
                    }
                }
                anthropic_messages.push(json!({ "role": "assistant", "content": blocks }));
            }
            _ => {
                let content = msg
                    .get("content")
                    .cloned()
                    .unwrap_or(json!(""));
                anthropic_messages.push(json!({ "role": "user", "content": content }));
            }
        }
    }

    let stream = obj.get("stream").and_then(|v| v.as_bool()).unwrap_or(false);
    let mut out = json!({
        "model": upstream_model,
        "max_tokens": obj.get("max_tokens").and_then(|v| v.as_u64()).unwrap_or(4096),
        "messages": anthropic_messages,
        "stream": stream,
    });
    if !system_parts.is_empty() {
        out["system"] = json!(system_parts.join("\n\n"));
    }
    if let Some(tools) = obj.get("tools").and_then(|v| v.as_array()) {
        let anthropic_tools: Vec<Value> = tools
            .iter()
            .filter_map(|t| {
                let func = t.get("function")?;
                let name = func.get("name")?.as_str()?;
                Some(json!({
                    "name": name,
                    "description": func.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                    "input_schema": func.get("parameters").cloned().unwrap_or(json!({"type":"object","properties":{}})),
                }))
            })
            .collect();
        if !anthropic_tools.is_empty() {
            out["tools"] = json!(anthropic_tools);
        }
    }
    Ok(out)
}

async fn forward_anthropic_as_openai_chat(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    original_model: &str,
    is_stream: bool,
    trace: &traces::TraceCapture,
) -> Response {
    let upstream_resp = match attach_opencode_upstream_auth(
        client
            .post(url)
            .header("anthropic-version", "2023-06-01")
            .header(header::CONTENT_TYPE, "application/json")
            .json(body),
        api_key,
        routing::EndpointKind::AnthropicPassthrough,
    )
    .send()
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(openai_error(502, &format!("上游请求失败: {e}"))),
            )
                .into_response();
        }
    };

    let status = upstream_resp.status();
    if !status.is_success() {
        let text = upstream_resp.text().await.unwrap_or_default();
        let message = upstream_auth_error_message(status.as_u16(), &text);
        trace.finish_error(Some(status.as_u16()), message.clone());
        return (
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(openai_error(status.as_u16(), &message)),
        )
            .into_response();
    }

    if is_stream {
        // Anthropic 原生模型在 Codex chat 路径上流式直通 Anthropic SSE；
        // Codex 主要走 /v1/responses，此处为 chat 端点回退。
        let trace_capture = trace.clone();
        let stream = upstream_resp.bytes_stream().map(move |chunk| {
            if let Ok(ref bytes) = chunk {
                trace_capture.push_sse_text(&String::from_utf8_lossy(bytes));
            }
            chunk.map_err(std::io::Error::other)
        });
        let trace_finalize = trace.clone();
        let stream = stream.chain(futures_util::stream::once(async move {
            trace_finalize.finalize_stream(status.as_u16());
            Ok::<_, std::io::Error>(axum::body::Bytes::new())
        }));
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .body(Body::from_stream(stream))
            .unwrap_or_else(|_| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(openai_error(500, "构建流响应失败")),
                )
                    .into_response()
            });
    }

    let anthropic: Value = upstream_resp.json().await.unwrap_or(json!({}));
    let openai = anthropic_message_to_openai_chat(&anthropic, original_model);
    trace.finish_success(200, traces::preview_json(&openai));
    (StatusCode::OK, Json(openai)).into_response()
}

async fn forward_anthropic_as_responses(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    body: &Value,
    original_model: &str,
    is_stream: bool,
    trace: &traces::TraceCapture,
) -> Response {
    let upstream_resp = match attach_opencode_upstream_auth(
        client
            .post(url)
            .header("anthropic-version", "2023-06-01")
            .header(header::CONTENT_TYPE, "application/json")
            .json(body),
        api_key,
        routing::EndpointKind::AnthropicPassthrough,
    )
    .send()
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(openai_error(502, &format!("上游请求失败: {e}"))),
            )
                .into_response();
        }
    };

    let status = upstream_resp.status();
    if !status.is_success() {
        let text = upstream_resp.text().await.unwrap_or_default();
        let message = upstream_auth_error_message(status.as_u16(), &text);
        trace.finish_error(Some(status.as_u16()), message.clone());
        return (
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(openai_error(status.as_u16(), &message)),
        )
            .into_response();
    }

    if is_stream {
        return stream_anthropic_responses::stream_anthropic_to_responses(
            upstream_resp,
            original_model,
            Some(trace.clone()),
        )
        .await;
    }

    let anthropic: Value = upstream_resp.json().await.unwrap_or(json!({}));
    let chat = anthropic_message_to_openai_chat(&anthropic, original_model);
    let responses = chat_response_to_responses(&chat, original_model);
    trace.finish_success(200, traces::preview_json(&responses));
    (StatusCode::OK, Json(responses)).into_response()
}

fn anthropic_message_to_openai_chat(anthropic: &Value, model: &str) -> Value {
    let mut content = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    if let Some(blocks) = anthropic.get("content").and_then(|c| c.as_array()) {
        for block in blocks {
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        content.push_str(t);
                    }
                }
                Some("tool_use") => {
                    let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let input = block.get("input").cloned().unwrap_or(json!({}));
                    let args = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
                    tool_calls.push(json!({
                        "id": id,
                        "type": "function",
                        "function": { "name": name, "arguments": args },
                    }));
                }
                _ => {}
            }
        }
    }
    let stop = anthropic
        .get("stop_reason")
        .and_then(|v| v.as_str())
        .unwrap_or("end_turn");
    let finish = match stop {
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        _ => "stop",
    };
    let mut message = json!({ "role": "assistant", "content": content });
    if let Some(obj) = message.as_object_mut() {
        if !tool_calls.is_empty() {
            obj.insert("tool_calls".to_string(), json!(tool_calls));
        }
    }
    json!({
        "id": anthropic.get("id").and_then(|v| v.as_str()).unwrap_or("chatcmpl_wise"),
        "object": "chat.completion",
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish,
        }],
        "usage": anthropic.get("usage").cloned().unwrap_or(json!({})),
    })
}
