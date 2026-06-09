//! OpenAI Chat Completions SSE → Anthropic SSE。

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use reqwest::Response as ReqwestResponse;
use serde_json::{json, Value};
use uuid::Uuid;

use super::stream_common::{
    ensure_message_start, finalize_stream, finish_stream, format_sse_events, map_finish_reason,
    new_stream_state, text_delta, thinking_delta, tool_call_delta, usage_only_delta,
    SharedStreamState,
};
use super::traces::TraceCapture;
use super::transform;
use super::usage::{self, openai_usage_to_anthropic};

pub async fn stream_openai_to_anthropic(
    upstream: ReqwestResponse,
    original_model: &str,
    trace: Option<TraceCapture>,
) -> Response {
    let msg_id = format!("msg_{}", Uuid::new_v4().simple());
    let model = original_model.to_string();
    let state = new_stream_state();
    let state_finalize = state.clone();
    let trace_map = trace.clone();
    let trace_finalize = trace;

    let stream = upstream
        .bytes_stream()
        .map(move |chunk_result| {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    return Ok::<_, std::convert::Infallible>(format_sse_events(&[json!({
                        "type": "error",
                        "error": { "type": "api_error", "message": format!("流读取失败: {e}") }
                    })]));
                }
            };

            let mut events = Vec::new();
            let text = String::from_utf8_lossy(&chunk);
            for line in text.lines() {
                let line = line.trim();
                if !line.starts_with("data:") {
                    continue;
                }
                let data = line.trim_start_matches("data:").trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                    continue;
                };
                events.extend(process_openai_chunk(&parsed, &msg_id, &model, &state));
            }
            let formatted = format_sse_events(&events);
            if let Some(ref t) = trace_map {
                t.push_sse_text(&formatted);
            }
            Ok(formatted)
        })
        .chain(futures_util::stream::once(async move {
            let mut st = state_finalize.lock().unwrap_or_else(|e| e.into_inner());
            let tail = format_sse_events(&finalize_stream(&mut st));
            if let Some(t) = trace_finalize {
                t.push_sse_text(&tail);
                t.finalize_stream(200);
            }
            Ok(tail)
        }));

    sse_response(Body::from_stream(stream))
}

pub fn process_openai_chunk(
    chunk: &Value,
    msg_id: &str,
    model: &str,
    shared: &SharedStreamState,
) -> Vec<Value> {
    let Ok(mut state) = shared.lock() else {
        return Vec::new();
    };

    let mut events = ensure_message_start(&mut state, msg_id, model);

    let choices = match chunk.get("choices").and_then(|c| c.as_array()) {
        Some(c) if !c.is_empty() => c,
        _ => {
            if let Some(usage) = chunk.get("usage") {
                let anthropic_usage = openai_usage_to_anthropic(usage);
                if state.stop_sent {
                    events.extend(usage_only_delta(anthropic_usage));
                } else {
                    events.extend(finish_stream(&mut state, "end_turn", Some(anthropic_usage)));
                }
            }
            return events;
        }
    };

    let choice = &choices[0];
    let delta = choice.get("delta").unwrap_or(&Value::Null);

    if let Some(thinking) = delta.get("reasoning_content").and_then(|v| v.as_str()) {
        events.extend(thinking_delta(&mut state, thinking));
    }

    if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
        events.extend(text_delta(&mut state, content));
    }

    if let Some(tool_calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tool_calls {
            events.extend(tool_call_delta(&mut state, tc));
        }
    }

    if let Some(finish) = choice.get("finish_reason").and_then(|v| v.as_str()) {
        if !finish.is_empty() {
            let anthropic_usage = chunk
                .get("usage")
                .map(openai_usage_to_anthropic)
                .or_else(|| {
                    if state.stop_sent {
                        None
                    } else {
                        Some(usage::zero_usage())
                    }
                });
            if state.stop_sent {
                if let Some(u) = chunk.get("usage") {
                    events.extend(usage_only_delta(openai_usage_to_anthropic(u)));
                }
            } else {
                events.extend(finish_stream(
                    &mut state,
                    map_finish_reason(finish),
                    anthropic_usage,
                ));
            }
        }
    } else if state.stop_sent {
        if let Some(u) = chunk.get("usage") {
            events.extend(usage_only_delta(openai_usage_to_anthropic(u)));
        }
    }

    events
}

fn sse_response(body: Body) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(body)
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(transform::anthropic_error(500, "构建流响应失败")),
            )
                .into_response()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::stream_common::AnthropicStreamState;

    #[test]
    fn processes_finish_reason() {
        let state = new_stream_state();
        let chunk = json!({
            "choices": [{
                "delta": { "content": "done" },
                "finish_reason": "stop"
            }]
        });
        let ev = process_openai_chunk(&chunk, "msg_x", "claude", &state);
        assert!(ev.iter().any(|e| e.get("type") == Some(&json!("message_stop"))));
    }

    #[test]
    fn finalize_after_partial_stream() {
        let mut st = AnthropicStreamState::default();
        ensure_message_start(&mut st, "msg_1", "claude");
        text_delta(&mut st, "partial");
        let ev = finalize_stream(&mut st);
        assert!(ev.iter().any(|e| e.get("type") == Some(&json!("message_stop"))));
    }
}
