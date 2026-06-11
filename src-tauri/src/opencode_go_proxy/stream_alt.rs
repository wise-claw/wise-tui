//! Responses / Gemini 上游 SSE → Anthropic SSE。

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::StreamExt;
use reqwest::Response as ReqwestResponse;
use serde_json::{json, Value};
use uuid::Uuid;

use std::sync::{Arc, Mutex};

use super::stream_common::{
    ensure_message_start, finalize_stream, finish_stream, format_sse_events_parts,
    gemini_function_call_delta, has_tool_blocks, new_stream_state,
    responses_function_call_args_delta, responses_function_call_args_done,
    responses_function_call_item_added, text_delta,
    SharedStreamState, SseDataLineBuffer,
};
use super::traces::TraceCapture;
use super::transform;
use super::usage::{gemini_usage_to_anthropic, responses_usage_to_anthropic};

pub async fn stream_responses_to_anthropic(
    upstream: ReqwestResponse,
    original_model: &str,
    trace: Option<TraceCapture>,
) -> Response {
    let msg_id = format!("msg_{}", Uuid::new_v4().simple());
    let model = original_model.to_string();
    let state = new_stream_state();
    let state_finalize = state.clone();
    let line_buffer = Arc::new(Mutex::new(SseDataLineBuffer::default()));
    let line_buffer_finalize = line_buffer.clone();
    let trace_map = trace.clone();
    let trace_finalize = trace;
    let msg_id_stream = msg_id.clone();
    let model_stream = model.clone();

    let stream = upstream
        .bytes_stream()
        .flat_map(move |chunk_result| {
            let parts = process_sse_bytes(
                chunk_result,
                &msg_id_stream,
                &model_stream,
                &state,
                &line_buffer,
                process_responses_chunk,
            );
            if let Some(ref t) = trace_map {
                t.push_sse_text(&parts.join(""));
            }
            futures_util::stream::iter(
                parts
                    .into_iter()
                    .map(|s| Ok::<_, std::convert::Infallible>(s)),
            )
        })
        .chain(
            futures_util::stream::once(async move {
                let mut st = state_finalize.lock().unwrap_or_else(|e| e.into_inner());
                let mut tail_events = Vec::new();
                if let Some(line) = line_buffer_finalize
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .drain_remaining()
                {
                    tail_events.extend(process_sse_line(
                        &line,
                        &msg_id,
                        &model,
                        &state_finalize,
                        process_responses_chunk,
                    ));
                }
                tail_events.extend(finalize_stream(&mut st));
                let tail_parts = format_sse_events_parts(&tail_events);
                if let Some(t) = trace_finalize {
                    t.push_sse_text(&tail_parts.join(""));
                    t.finalize_stream(200);
                }
                tail_parts
            })
            .flat_map(|parts| {
                futures_util::stream::iter(
                    parts
                        .into_iter()
                        .map(|s| Ok::<_, std::convert::Infallible>(s)),
                )
            }),
        );

    sse_response(Body::from_stream(stream))
}

pub async fn stream_gemini_to_anthropic(
    upstream: ReqwestResponse,
    original_model: &str,
    trace: Option<TraceCapture>,
) -> Response {
    let msg_id = format!("msg_{}", Uuid::new_v4().simple());
    let model = original_model.to_string();
    let state = new_stream_state();
    let state_finalize = state.clone();
    let line_buffer = Arc::new(Mutex::new(SseDataLineBuffer::default()));
    let line_buffer_finalize = line_buffer.clone();
    let trace_map = trace.clone();
    let trace_finalize = trace;
    let msg_id_stream = msg_id.clone();
    let model_stream = model.clone();

    let stream = upstream
        .bytes_stream()
        .flat_map(move |chunk_result| {
            let parts = process_sse_bytes(
                chunk_result,
                &msg_id_stream,
                &model_stream,
                &state,
                &line_buffer,
                process_gemini_chunk,
            );
            if let Some(ref t) = trace_map {
                t.push_sse_text(&parts.join(""));
            }
            futures_util::stream::iter(
                parts
                    .into_iter()
                    .map(|s| Ok::<_, std::convert::Infallible>(s)),
            )
        })
        .chain(
            futures_util::stream::once(async move {
                let mut st = state_finalize.lock().unwrap_or_else(|e| e.into_inner());
                let mut tail_events = Vec::new();
                if let Some(line) = line_buffer_finalize
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .drain_remaining()
                {
                    tail_events.extend(process_sse_line(
                        &line,
                        &msg_id,
                        &model,
                        &state_finalize,
                        process_gemini_chunk,
                    ));
                }
                tail_events.extend(finalize_stream(&mut st));
                let tail_parts = format_sse_events_parts(&tail_events);
                if let Some(t) = trace_finalize {
                    t.push_sse_text(&tail_parts.join(""));
                    t.finalize_stream(200);
                }
                tail_parts
            })
            .flat_map(|parts| {
                futures_util::stream::iter(
                    parts
                        .into_iter()
                        .map(|s| Ok::<_, std::convert::Infallible>(s)),
                )
            }),
        );

    sse_response(Body::from_stream(stream))
}

fn process_sse_bytes(
    chunk_result: Result<impl AsRef<[u8]>, reqwest::Error>,
    msg_id: &str,
    model: &str,
    state: &SharedStreamState,
    line_buffer: &Arc<Mutex<SseDataLineBuffer>>,
    processor: fn(&Value, &str, &str, &SharedStreamState) -> Vec<Value>,
) -> Vec<String> {
    let chunk = match chunk_result {
        Ok(c) => c,
        Err(e) => {
            return format_sse_events_parts(&[json!({
                "type": "error",
                "error": { "type": "api_error", "message": format!("流读取失败: {e}") }
            })]);
        }
    };

    let mut events = Vec::new();
    let lines = line_buffer
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .extend(chunk.as_ref());
    for line in lines {
        events.extend(process_sse_line(line.as_str(), msg_id, model, state, processor));
    }
    format_sse_events_parts(&events)
}

fn process_sse_line(
    line: &str,
    msg_id: &str,
    model: &str,
    state: &SharedStreamState,
    processor: fn(&Value, &str, &str, &SharedStreamState) -> Vec<Value>,
) -> Vec<Value> {
    let line = line.trim();
    if !line.starts_with("data:") {
        return Vec::new();
    }
    let data = line.trim_start_matches("data:").trim();
    if data.is_empty() || data == "[DONE]" {
        return Vec::new();
    }
    let Ok(parsed) = serde_json::from_str::<Value>(data) else {
        return Vec::new();
    };
    processor(&parsed, msg_id, model, state)
}

pub(crate) fn process_responses_chunk(
    chunk: &Value,
    msg_id: &str,
    model: &str,
    shared: &SharedStreamState,
) -> Vec<Value> {
    let Ok(mut state) = shared.lock() else {
        return Vec::new();
    };
    let mut out = ensure_message_start(&mut state, msg_id, model);

    let ty = chunk.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match ty {
        "response.output_text.delta" => {
            if let Some(delta) = chunk.get("delta").and_then(|d| d.as_str()) {
                out.extend(text_delta(&mut state, delta));
            }
        }
        "response.output_item.added" => {
            if let Some(item) = chunk.get("item") {
                out.extend(responses_function_call_item_added(&mut state, item));
            }
        }
        "response.function_call_arguments.delta" => {
            let call_id = chunk.get("call_id").and_then(|c| c.as_str()).unwrap_or("");
            let delta = chunk.get("delta").and_then(|d| d.as_str()).unwrap_or("");
            out.extend(responses_function_call_args_delta(&mut state, call_id, delta));
        }
        "response.function_call_arguments.done" => {
            let call_id = chunk.get("call_id").and_then(|c| c.as_str()).unwrap_or("");
            let arguments = chunk
                .get("arguments")
                .and_then(|a| a.as_str())
                .unwrap_or("");
            out.extend(responses_function_call_args_done(
                &mut state,
                call_id,
                arguments,
            ));
        }
        "response.completed" | "response.done" => {
            let usage = chunk
                .get("response")
                .and_then(|r| r.get("usage"))
                .or_else(|| chunk.get("usage"))
                .map(responses_usage_to_anthropic);
            let stop = if has_tool_blocks(&state) {
                "tool_use"
            } else {
                "end_turn"
            };
            out.extend(finish_stream(&mut state, stop, usage));
        }
        "response.failed" => {
            let message = chunk
                .get("response")
                .and_then(|r| r.get("error"))
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .or_else(|| chunk.get("message").and_then(|m| m.as_str()))
                .unwrap_or("上游 Responses 请求失败");
            if !state.stop_sent {
                out.push(json!({
                    "type": "error",
                    "error": { "type": "api_error", "message": message }
                }));
                state.stop_sent = true;
            }
        }
        _ => {}
    }
    out
}

fn process_gemini_chunk(
    chunk: &Value,
    msg_id: &str,
    model: &str,
    shared: &SharedStreamState,
) -> Vec<Value> {
    let Ok(mut state) = shared.lock() else {
        return Vec::new();
    };
    let mut out = ensure_message_start(&mut state, msg_id, model);

    let Some(candidates) = chunk.get("candidates").and_then(|c| c.as_array()) else {
        return out;
    };
    if candidates.is_empty() {
        return out;
    }
    let candidate = &candidates[0];

    if let Some(parts) = candidate
        .get("content")
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
    {
        for part in parts {
            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                out.extend(text_delta(&mut state, text));
            }
            if let Some(fc) = part.get("functionCall") {
                out.extend(gemini_function_call_delta(&mut state, fc));
            }
        }
    }

    if let Some(reason) = candidate.get("finishReason").and_then(|r| r.as_str()) {
        let stop = if reason == "MAX_TOKENS" {
            "max_tokens"
        } else if has_tool_blocks(&state) {
            "tool_use"
        } else {
            "end_turn"
        };
        let usage = chunk
            .get("usageMetadata")
            .map(gemini_usage_to_anthropic);
        out.extend(finish_stream(&mut state, stop, usage));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn responses_chunk_text_and_function_call() {
        let state = new_stream_state();
        let ev = process_responses_chunk(
            &json!({
                "type": "response.output_item.added",
                "item": {
                    "type": "function_call",
                    "call_id": "call_1",
                    "name": "search",
                    "arguments": ""
                }
            }),
            "msg_1",
            "claude",
            &state,
        );
        assert!(ev.iter().any(|e| e.get("type") == Some(&json!("content_block_start"))));

        let ev2 = process_responses_chunk(
            &json!({
                "type": "response.function_call_arguments.delta",
                "call_id": "call_1",
                "delta": "{}"
            }),
            "msg_1",
            "claude",
            &state,
        );
        assert!(ev2.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("type"))
                .and_then(|t| t.as_str())
                == Some("input_json_delta")
        }));
    }
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
                axum::Json(transform::anthropic_error(500, "构建流响应失败")),
            )
                .into_response()
        })
}
