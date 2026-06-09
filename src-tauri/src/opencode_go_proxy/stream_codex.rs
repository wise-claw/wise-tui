//! OpenAI Chat Completions SSE → Codex Responses SSE（参考 ocgo）。

use std::collections::HashMap;
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
use super::traces::TraceCapture;

pub async fn stream_chat_to_responses(
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
    let state = Arc::new(Mutex::new(CodexResponsesStreamState::default()));
    let state_chunk = state.clone();
    let state_finalize = state.clone();
    let trace_map = trace.clone();
    let trace_finalize = trace;

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
            let mut events = Vec::new();
            let Ok(mut st) = state_chunk.lock() else {
                return Ok(String::new());
            };

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
                events.extend(process_chunk(
                    &parsed,
                    &resp_id_chunk,
                    &model_chunk,
                    &mut st,
                ));
            }

            let formatted = events.join("");
            if let Some(ref t) = trace_map {
                t.push_sse_text(&formatted);
            }
            Ok(formatted)
        })
        .chain(futures_util::stream::once(async move {
            let tail = {
                let Ok(mut st) = state_finalize.lock() else {
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

#[derive(Default)]
pub(crate) struct CodexResponsesStreamState {
    pub response_created: bool,
    pub message_started: bool,
    pub message_done: bool,
    pub message_output_index: i32,
    pub next_output_index: i32,
    pub text: String,
    pub tool_indexes: HashMap<i64, usize>,
    pub tools: Vec<ToolState>,
    pub usage: Option<Value>,
}

pub(crate) struct ToolState {
    pub output_index: i32,
    pub id: String,
    pub name: String,
    pub arguments: String,
}

fn process_chunk(
    chunk: &Value,
    resp_id: &str,
    model: &str,
    state: &mut CodexResponsesStreamState,
) -> Vec<String> {
    let mut out = Vec::new();

    if let Some(usage) = chunk.get("usage") {
        if !usage.is_null() {
            state.usage = Some(usage.clone());
        }
    }

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

    let choices = chunk.get("choices").and_then(|c| c.as_array());
    let Some(choice) = choices.and_then(|c| c.first()) else {
        return out;
    };
    let delta = choice.get("delta").unwrap_or(&Value::Null);

    if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
        if !content.is_empty() {
            if !state.message_started {
                state.message_started = true;
                state.message_output_index = state.next_output_index;
                state.next_output_index += 1;
                out.push(write_responses_sse_event(
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
                ));
                out.push(write_responses_sse_event(
                    "response.content_part.added",
                    json!({
                        "type": "response.content_part.added",
                        "item_id": "msg_wise_proxy",
                        "output_index": state.message_output_index,
                        "content_index": 0,
                        "part": { "type": "output_text", "text": "" },
                    }),
                ));
            }
            state.text.push_str(content);
            out.push(write_responses_sse_event(
                "response.output_text.delta",
                json!({
                    "type": "response.output_text.delta",
                    "item_id": "msg_wise_proxy",
                    "output_index": state.message_output_index,
                    "content_index": 0,
                    "delta": content,
                }),
            ));
        }
    }

    if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tool_calls {
            let index = tc.get("index").and_then(|v| v.as_i64()).unwrap_or(0);
            let pos = if let Some(&p) = state.tool_indexes.get(&index) {
                p
            } else {
                let id = tc
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("call_wise");
                let name = tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let output_index = state.next_output_index;
                state.next_output_index += 1;
                let p = state.tools.len();
                state.tool_indexes.insert(index, p);
                state.tools.push(ToolState {
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
                p
            };

            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                state.tools[pos].id = id.to_string();
            }
            if let Some(name) = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
            {
                state.tools[pos].name = name.to_string();
            }
            if let Some(args) = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
            {
                state.tools[pos].arguments.push_str(args);
                out.push(write_responses_sse_event(
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "item_id": state.tools[pos].id,
                        "output_index": state.tools[pos].output_index,
                        "delta": args,
                    }),
                ));
            }
        }
    }

    out
}

pub(crate) fn finalize_codex_responses_stream(
    state: &mut CodexResponsesStreamState,
    resp_id: &str,
    model: &str,
) -> String {
    let mut out = Vec::new();

    if state.message_started && !state.message_done {
        state.message_done = true;
        out.push(write_responses_sse_event(
            "response.output_text.done",
            json!({
                "type": "response.output_text.done",
                "item_id": "msg_wise_proxy",
                "output_index": state.message_output_index,
                "content_index": 0,
                "text": state.text,
            }),
        ));
        out.push(write_responses_sse_event(
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "output_index": state.message_output_index,
                "item": {
                    "id": "msg_wise_proxy",
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": state.text }],
                }
            }),
        ));
    }

    let mut output: Vec<Value> = Vec::new();
    if state.message_started {
        output.push(json!({
            "id": "msg_wise_proxy",
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": state.text }],
        }));
    }

    for tool in &state.tools {
        let item = json!({
            "id": tool.id,
            "type": "function_call",
            "call_id": tool.id,
            "name": tool.name,
            "arguments": tool.arguments,
        });
        out.push(write_responses_sse_event(
            "response.function_call_arguments.done",
            json!({
                "type": "response.function_call_arguments.done",
                "item_id": tool.id,
                "output_index": tool.output_index,
                "arguments": tool.arguments,
            }),
        ));
        out.push(write_responses_sse_event(
            "response.output_item.done",
            json!({
                "type": "response.output_item.done",
                "output_index": tool.output_index,
                "item": item,
            }),
        ));
        output.push(item);
    }

    let usage = state
        .usage
        .as_ref()
        .map(|u| super::codex_convert::chat_usage_from_openai(u))
        .unwrap_or_else(|| {
            json!({
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
            })
        });

    out.push(write_responses_sse_event(
        "response.completed",
        json!({
            "type": "response.completed",
            "response": {
                "id": resp_id,
                "object": "response",
                "model": model,
                "status": "completed",
                "output": output,
                "usage": usage,
            }
        }),
    ));

    out.join("")
}

pub(crate) fn write_responses_sse_event(event: &str, payload: Value) -> String {
    format!(
        "event: {event}\ndata: {}\n\n",
        serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_state_accumulates_text_across_chunks() {
        let mut state = CodexResponsesStreamState::default();
        let chunk1 = json!({
            "choices": [{ "delta": { "content": "hel" } }]
        });
        let chunk2 = json!({
            "choices": [{ "delta": { "content": "lo" } }]
        });
        process_chunk(&chunk1, "resp_test", "kimi-k2.6", &mut state);
        process_chunk(&chunk2, "resp_test", "kimi-k2.6", &mut state);
        assert_eq!(state.text, "hello");
        assert!(state.message_started);
        let tail = finalize_codex_responses_stream(&mut state, "resp_test", "kimi-k2.6");
        assert!(tail.contains("response.completed"));
        assert!(tail.contains("hello"));
    }
}
