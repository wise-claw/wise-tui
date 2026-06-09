//! Anthropic Messages SSE → Codex Responses SSE（参考 ocgo streamResponsesFromAnthropic）。

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use reqwest::Response as ReqwestResponse;
use serde_json::{json, Value};
use uuid::Uuid;

use super::codex_convert::openai_error;
use super::stream_codex::{
    finalize_codex_responses_stream, write_responses_sse_event, CodexResponsesStreamState,
};
use super::traces::TraceCapture;

pub async fn stream_anthropic_to_responses(
    upstream: ReqwestResponse,
    model: &str,
    trace: Option<TraceCapture>,
) -> Response {
    let model = model.to_string();
    let resp_id = format!("resp_{}", Uuid::new_v4().simple());
    let resp_id_chunk = resp_id.clone();
    let resp_id_finalize = resp_id.clone();
    let model_chunk = model.clone();
    let model_finalize = model.clone();
    let trace_map = trace.clone();
    let trace_finalize = trace;
    let state = Arc::new(Mutex::new(CodexResponsesStreamState::default()));
    let state_chunk = state.clone();

    let stream = upstream
        .bytes_stream()
        .map(move |chunk_result| {
            let chunk = match chunk_result {
                Ok(c) => c,
                Err(e) => {
                    return Ok::<_, std::convert::Infallible>(format!(
                        "event: error\ndata: {}\n\n",
                        json!({ "error": format!("流读取失败: {e}") })
                    ));
                }
            };
            let text = String::from_utf8_lossy(&chunk);
            let formatted = {
                let Ok(mut st) = state_chunk.lock() else {
                    return Ok(String::new());
                };
                process_anthropic_sse_chunk(&text, &resp_id_chunk, &model_chunk, &mut st)
            };
            if let Some(ref t) = trace_map {
                t.push_sse_text(&formatted);
            }
            Ok(formatted)
        })
        .chain(futures_util::stream::once(async move {
            let tail = {
                let Ok(mut st) = state.lock() else {
                    return Ok::<_, std::convert::Infallible>(String::new());
                };
                finalize_codex_responses_stream(&mut st, &resp_id_finalize, &model_finalize)
            };
            if let Some(t) = trace_finalize {
                t.push_sse_text(&tail);
                t.finalize_stream(200);
            }
            Ok(tail)
        }));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(openai_error(500, "构建流响应失败")),
            )
                .into_response()
        })
}

fn process_anthropic_sse_chunk(
    text: &str,
    resp_id: &str,
    model: &str,
    state: &mut CodexResponsesStreamState,
) -> String {
    let mut out = String::new();
    let mut event_type = String::new();
    let mut data_lines: Vec<String> = Vec::new();

    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            flush_anthropic_sse_event(&event_type, &data_lines.join("\n"), resp_id, model, state, &mut out);
            event_type.clear();
            data_lines.clear();
            continue;
        }
        if let Some(ev) = line.strip_prefix("event:") {
            event_type = ev.trim().to_string();
        } else if let Some(d) = line.strip_prefix("data:") {
            data_lines.push(d.trim().to_string());
        }
    }
    flush_anthropic_sse_event(&event_type, &data_lines.join("\n"), resp_id, model, state, &mut out);
    out
}

fn flush_anthropic_sse_event(
    event_type: &str,
    data: &str,
    resp_id: &str,
    model: &str,
    state: &mut CodexResponsesStreamState,
    out: &mut String,
) {
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return;
    };
    for line in map_anthropic_event(event_type, &v, resp_id, model, state) {
        out.push_str(&line);
    }
}

fn map_anthropic_event(
    event_type: &str,
    data: &Value,
    resp_id: &str,
    model: &str,
    state: &mut CodexResponsesStreamState,
) -> Vec<String> {
    let ty = data
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or(event_type);
    let mut out = Vec::new();

    match ty {
        "message_start" => {
            if !state.response_created {
                state.response_created = true;
                out.push(write_responses_sse_event(
                    "response.created",
                    json!({
                        "type": "response.created",
                        "response": {
                            "id": resp_id,
                            "object": "response",
                            "model": model,
                            "status": "in_progress",
                            "output": [],
                        }
                    }),
                ));
            }
        }
        "content_block_start" => {
            let block = data.get("content_block").unwrap_or(&Value::Null);
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => out.extend(ensure_assistant_message_started(state)),
                Some("tool_use") => {
                    let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("call_wise");
                    let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let output_index = state.next_output_index;
                    state.next_output_index += 1;
                    state.tools.push(crate::opencode_go_proxy::stream_codex::ToolState {
                        output_index,
                        id: id.to_string(),
                        name: name.to_string(),
                        arguments: String::new(),
                    });
                    out.push(write_responses_sse_event(
                        "response.output_item.added",
                        json!({
                            "type": "response.output_item.added",
                            "output_index": output_index,
                            "item": {
                                "id": id,
                                "type": "function_call",
                                "call_id": id,
                                "name": name,
                                "arguments": "",
                            }
                        }),
                    ));
                }
                _ => {}
            }
        }
        "content_block_delta" => {
            let delta = data.get("delta").unwrap_or(&Value::Null);
            if delta.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        out.extend(ensure_assistant_message_started(state));
                        state.text.push_str(text);
                        out.push(write_responses_sse_event(
                            "response.output_text.delta",
                            json!({
                                "type": "response.output_text.delta",
                                "item_id": "msg_wise_proxy",
                                "output_index": state.message_output_index,
                                "content_index": 0,
                                "delta": text,
                            }),
                        ));
                    }
                }
            } else if delta.get("type").and_then(|t| t.as_str()) == Some("input_json_delta") {
                if let Some(partial) = delta.get("partial_json").and_then(|v| v.as_str()) {
                    if let Some(tool) = state.tools.last_mut() {
                        tool.arguments.push_str(partial);
                        out.push(write_responses_sse_event(
                            "response.function_call_arguments.delta",
                            json!({
                                "type": "response.function_call_arguments.delta",
                                "item_id": tool.id,
                                "output_index": tool.output_index,
                                "delta": partial,
                            }),
                        ));
                    }
                }
            }
        }
        "message_delta" => {
            if let Some(usage) = data.get("usage") {
                if !usage.is_null() {
                    state.usage = Some(usage.clone());
                }
            }
        }
        _ => {}
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_text_delta_emits_item_added_before_delta() {
        let mut state = CodexResponsesStreamState::default();
        let chunk = r#"event: message_start
data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[]}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}

"#;
        let out = process_anthropic_sse_chunk(chunk, "resp_test", "qwen3.7-plus", &mut state);
        assert!(out.contains("response.output_item.added"));
        assert!(out.contains("response.content_part.added"));
        assert!(out.contains("response.output_text.delta"));
        let tail = finalize_codex_responses_stream(&mut state, "resp_test", "qwen3.7-plus");
        assert!(tail.contains("response.output_text.done"));
        assert!(tail.contains("你好"));
    }
}

fn ensure_assistant_message_started(state: &mut CodexResponsesStreamState) -> Vec<String> {
    if state.message_started {
        return vec![];
    }
    state.message_started = true;
    state.message_output_index = state.next_output_index;
    state.next_output_index += 1;
    vec![
        write_responses_sse_event(
            "response.output_item.added",
            json!({
                "type": "response.output_item.added",
                "output_index": state.message_output_index,
                "item": {
                    "id": "msg_wise_proxy",
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                }
            }),
        ),
        write_responses_sse_event(
            "response.content_part.added",
            json!({
                "type": "response.content_part.added",
                "item_id": "msg_wise_proxy",
                "output_index": state.message_output_index,
                "content_index": 0,
                "part": { "type": "output_text", "text": "" },
            }),
        ),
    ]
}
