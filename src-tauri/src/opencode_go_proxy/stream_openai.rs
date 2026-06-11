//! OpenAI Chat Completions SSE → Anthropic SSE。

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use reqwest::Response as ReqwestResponse;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use super::stream_common::{
    ensure_message_start, finalize_stream, finish_stream, format_sse_events_parts, has_tool_blocks,
    map_finish_reason,
    new_stream_state, text_delta, thinking_delta, tool_call_delta, usage_only_delta,
    SharedStreamState, SseDataLineBuffer,
};
use super::traces::TraceCapture;
use super::transform;
use super::usage::{self, openai_usage_to_anthropic};
use super::tool_call_extract::{extract_first_tool_call_from_text, new_tool_use_id, ExtractedToolCall};

pub async fn stream_openai_to_anthropic(
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
            let parts: Vec<String> = match chunk_result {
                Ok(c) => {
                    let mut events = Vec::new();
                    let lines = line_buffer
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .extend(&c);
                    for line in lines {
                        events.extend(process_openai_sse_line(
                            &line,
                            &msg_id_stream,
                            &model_stream,
                            &state,
                        ));
                    }
                    format_sse_events_parts(&events)
                }
                Err(e) => format_sse_events_parts(&[json!({
                    "type": "error",
                    "error": { "type": "api_error", "message": format!("流读取失败: {e}") }
                })]),
            };
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
                    tail_events.extend(process_openai_sse_line(
                        &line,
                        &msg_id,
                        &model,
                        &state_finalize,
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

fn process_openai_sse_line(
    line: &str,
    msg_id: &str,
    model: &str,
    shared: &SharedStreamState,
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
    process_openai_chunk(&parsed, msg_id, model, shared)
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
                } else if !has_streamed_openai_body(&state)
                    && usage_completion_tokens(usage) > 0
                {
                    // 仅有 usage、无正文：上游 token 已产生但 delta 未到达，勿提前 end_turn。
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

    if let Some(thinking) = openai_text_field(delta.get("reasoning_content")) {
        state.openai_reasoning_buffer.push_str(&thinking);
        events.extend(thinking_delta(&mut state, &thinking));
    }

    if let Some(content) = openai_text_field(delta.get("content")) {
        state.openai_text_buffer.push_str(&content);
        events.extend(text_delta(&mut state, &content));
    }

    if let Some(tool_calls) = delta.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tool_calls {
            events.extend(tool_call_delta(&mut state, tc));
        }
    }

    if let Some(finish) = choice.get("finish_reason").and_then(|v| v.as_str()) {
        if !finish.is_empty() {
            if !has_streamed_openai_body(&state) {
                if let Some(message) = choice.get("message") {
                    events.extend(flush_openai_message_fields(message, &mut state));
                }
            }
            let mapped = map_finish_reason(finish);
            let mut stop = mapped;
            if stop == "tool_use" && !has_tool_blocks(&state) {
                let combined = format!(
                    "{}{}",
                    state.openai_reasoning_buffer, state.openai_text_buffer
                );
                if let Some(call) = extract_first_tool_call_from_text(&combined) {
                    events.extend(emit_synthetic_tool_use(&mut state, &call));
                }
                if !has_tool_blocks(&state) {
                    stop = "end_turn";
                }
            }
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
                    stop,
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

fn has_streamed_openai_body(state: &super::stream_common::AnthropicStreamState) -> bool {
    !state.openai_text_buffer.is_empty()
        || !state.openai_reasoning_buffer.is_empty()
        || has_tool_blocks(state)
        || state.content_started
        || state.reasoning_started
}

fn usage_completion_tokens(usage: &Value) -> u64 {
    usage
        .get("completion_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
}

fn openai_text_field(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Array(parts) => {
            let joined: String = parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(|t| t.as_str())
                        .or_else(|| part.as_str())
                })
                .collect();
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        }
        _ => None,
    }
}

fn flush_openai_message_fields(
    message: &Value,
    state: &mut super::stream_common::AnthropicStreamState,
) -> Vec<Value> {
    let mut events = Vec::new();
    if let Some(thinking) = openai_text_field(message.get("reasoning_content")) {
        state.openai_reasoning_buffer.push_str(&thinking);
        events.extend(thinking_delta(state, &thinking));
    }
    if let Some(content) = openai_text_field(message.get("content")) {
        state.openai_text_buffer.push_str(&content);
        events.extend(text_delta(state, &content));
    }
    if let Some(tool_calls) = message.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tool_calls {
            events.extend(tool_call_delta(state, tc));
        }
    }
    events
}

fn emit_synthetic_tool_use(state: &mut super::stream_common::AnthropicStreamState, call: &ExtractedToolCall) -> Vec<Value> {
    use super::stream_common::{close_active_text_or_thinking, has_tool_blocks};
    let mut events = Vec::new();
    if has_tool_blocks(state) {
        return events;
    }
    events.extend(close_active_text_or_thinking(state));
    state.content_index += 1;
    let block_idx = state.content_index;
    let tool_id = new_tool_use_id();
    let args = serde_json::to_string(&call.input).unwrap_or_else(|_| "{}".to_string());
    events.push(json!({
        "type": "content_block_start",
        "index": block_idx,
        "content_block": {
            "type": "tool_use",
            "id": tool_id,
            "name": call.name,
            "input": {}
        }
    }));
    events.push(json!({
        "type": "content_block_delta",
        "index": block_idx,
        "delta": { "type": "input_json_delta", "partial_json": args }
    }));
    events.push(json!({
        "type": "content_block_stop",
        "index": block_idx
    }));
    state.started_tool_calls.insert(0, block_idx);
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

    #[test]
    fn reassembles_sse_data_line_split_across_chunks() {
        let state = new_stream_state();
        let mut buf = SseDataLineBuffer::default();
        let mut events = Vec::new();
        for line in buf.extend(br#"data: {"choices":[{"delta":{"content":"hel"#) {
            events.extend(process_openai_sse_line(&line, "msg_x", "claude", &state));
        }
        for line in buf.extend(b"lo\"}}]}\n") {
            events.extend(process_openai_sse_line(&line, "msg_x", "claude", &state));
        }
        assert!(events.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
                == Some("hello")
        }));
    }

    #[test]
    fn flushes_message_field_when_finish_has_no_delta() {
        let state = new_stream_state();
        let chunk = json!({
            "choices": [{
                "delta": {},
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "analysis complete"
                }
            }],
            "usage": { "prompt_tokens": 100, "completion_tokens": 5 }
        });
        let ev = process_openai_chunk(&chunk, "msg_x", "claude", &state);
        assert!(ev.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
                == Some("analysis complete")
        }));
        assert!(ev.iter().any(|e| e.get("type") == Some(&json!("message_stop"))));
    }

    #[test]
    fn usage_only_with_missing_body_does_not_end_turn_early() {
        let state = new_stream_state();
        let chunk = json!({
            "choices": [],
            "usage": { "prompt_tokens": 40181, "completion_tokens": 417 }
        });
        let ev = process_openai_chunk(&chunk, "msg_x", "claude", &state);
        assert!(!ev.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(|s| s.as_str())
                == Some("end_turn")
        }));
    }
}
