//! Anthropic SSE 事件格式化与流式状态机（对齐 oc-go-cc）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use uuid::Uuid;

use super::usage::zero_usage;

#[derive(Debug, Default)]
pub struct AnthropicStreamState {
    pub message_started: bool,
    pub content_started: bool,
    pub reasoning_started: bool,
    pub stop_sent: bool,
    pub content_index: i32,
    /// OpenAI `tool_calls[].index` → Anthropic content block index
    pub started_tool_calls: HashMap<i32, i32>,
    /// Responses API `call_id` → Anthropic content block index
    pub responses_fc_blocks: HashMap<String, i32>,
    /// Responses `function_call_arguments` 已发送字符数（按 call_id）
    pub responses_fc_args_sent: HashMap<String, usize>,
    /// Gemini `functionCall.args` 已发送的 JSON 前缀长度
    pub gemini_fc_args_sent: usize,
}

pub fn has_tool_blocks(state: &AnthropicStreamState) -> bool {
    !state.started_tool_calls.is_empty() || !state.responses_fc_blocks.is_empty()
}

const GEMINI_FC_INDEX: i32 = 0;

pub fn format_sse_events(events: &[Value]) -> String {
    let mut out = String::new();
    for ev in events {
        let ty = ev.get("type").and_then(|t| t.as_str()).unwrap_or("message");
        if let Ok(s) = serde_json::to_string(ev) {
            out.push_str("event: ");
            out.push_str(ty);
            out.push_str("\ndata: ");
            out.push_str(&s);
            out.push_str("\n\n");
        }
    }
    out
}

pub fn ensure_message_start(
    state: &mut AnthropicStreamState,
    msg_id: &str,
    model: &str,
) -> Vec<Value> {
    if state.message_started {
        return Vec::new();
    }
    state.message_started = true;
    vec![json!({
        "type": "message_start",
        "message": {
            "id": msg_id,
            "type": "message",
            "role": "assistant",
            "content": [],
            "model": model,
            "stop_reason": null,
            "stop_sequence": null,
            "usage": { "input_tokens": 0, "output_tokens": 0 }
        }
    })]
}

fn close_active_text_or_thinking(state: &mut AnthropicStreamState) -> Vec<Value> {
    if !state.content_started && !state.reasoning_started {
        return Vec::new();
    }
    let idx = state.content_index;
    state.content_started = false;
    state.reasoning_started = false;
    vec![json!({
        "type": "content_block_stop",
        "index": idx
    })]
}

fn begin_text_block(state: &mut AnthropicStreamState) -> Vec<Value> {
    if state.content_started {
        return Vec::new();
    }
    if state.reasoning_started {
        let mut events = close_active_text_or_thinking(state);
        state.content_index += 1;
        state.content_started = true;
        events.push(json!({
            "type": "content_block_start",
            "index": state.content_index,
            "content_block": { "type": "text", "text": "" }
        }));
        return events;
    }
    state.content_started = true;
    vec![json!({
        "type": "content_block_start",
        "index": state.content_index,
        "content_block": { "type": "text", "text": "" }
    })]
}

fn begin_thinking_block(state: &mut AnthropicStreamState) -> Vec<Value> {
    if state.reasoning_started {
        return Vec::new();
    }
    if state.content_started {
        let mut events = close_active_text_or_thinking(state);
        state.content_index += 1;
        state.reasoning_started = true;
        events.push(json!({
            "type": "content_block_start",
            "index": state.content_index,
            "content_block": { "type": "thinking", "thinking": "" }
        }));
        return events;
    }
    state.reasoning_started = true;
    vec![json!({
        "type": "content_block_start",
        "index": state.content_index,
        "content_block": { "type": "thinking", "thinking": "" }
    })]
}

pub fn text_delta(state: &mut AnthropicStreamState, text: &str) -> Vec<Value> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut events = begin_text_block(state);
    events.push(json!({
        "type": "content_block_delta",
        "index": state.content_index,
        "delta": { "type": "text_delta", "text": text }
    }));
    events
}

pub fn thinking_delta(state: &mut AnthropicStreamState, thinking: &str) -> Vec<Value> {
    if thinking.is_empty() {
        return Vec::new();
    }
    let mut events = begin_thinking_block(state);
    events.push(json!({
        "type": "content_block_delta",
        "index": state.content_index,
        "delta": { "type": "thinking_delta", "thinking": thinking }
    }));
    events
}

pub fn tool_call_delta(state: &mut AnthropicStreamState, tc: &Value) -> Vec<Value> {
    let oi = tc.get("index").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let function = tc.get("function").and_then(|f| f.as_object());
    let name = function
        .and_then(|f| f.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let args = function
        .and_then(|f| f.get("arguments"))
        .and_then(|a| a.as_str())
        .unwrap_or("");
    let tool_id = tc
        .get("id")
        .and_then(|id| id.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("toolu_{}", Uuid::new_v4().simple()));

    let mut events = Vec::new();

    if !state.started_tool_calls.contains_key(&oi) {
        if name.is_empty() {
            return events;
        }
        events.extend(close_active_text_or_thinking(state));
        state.content_index += 1;
        let block_idx = state.content_index;
        state.started_tool_calls.insert(oi, block_idx);
        events.push(json!({
            "type": "content_block_start",
            "index": block_idx,
            "content_block": {
                "type": "tool_use",
                "id": tool_id,
                "name": name,
                "input": {}
            }
        }));
    }

    let block_idx = match state.started_tool_calls.get(&oi) {
        Some(&idx) => idx,
        None => return events,
    };

    if !args.is_empty() {
        events.push(json!({
            "type": "content_block_delta",
            "index": block_idx,
            "delta": { "type": "input_json_delta", "partial_json": args }
        }));
    }
    events
}

fn close_tool_blocks(state: &mut AnthropicStreamState) -> Vec<Value> {
    if !has_tool_blocks(state) {
        return Vec::new();
    }
    let mut block_indices: Vec<i32> = state
        .started_tool_calls
        .values()
        .copied()
        .chain(state.responses_fc_blocks.values().copied())
        .collect();
    block_indices.sort_unstable();
    block_indices.dedup();
    let mut events = Vec::new();
    for block_idx in block_indices {
        events.push(json!({
            "type": "content_block_stop",
            "index": block_idx
        }));
    }
    state.started_tool_calls.clear();
    state.responses_fc_blocks.clear();
    state.responses_fc_args_sent.clear();
    events
}

/// Responses `response.output_item.added` 中的 `function_call` 项。
pub fn responses_function_call_item_added(
    state: &mut AnthropicStreamState,
    item: &Value,
) -> Vec<Value> {
    if item.get("type").and_then(|t| t.as_str()) != Some("function_call") {
        return Vec::new();
    }
    let call_id = item.get("call_id").and_then(|c| c.as_str()).unwrap_or("");
    let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("");
    if call_id.is_empty() || name.is_empty() || state.responses_fc_blocks.contains_key(call_id) {
        return Vec::new();
    }

    let mut events = close_active_text_or_thinking(state);
    state.content_index += 1;
    let block_idx = state.content_index;
    state
        .responses_fc_blocks
        .insert(call_id.to_string(), block_idx);

    let tool_id = item
        .get("id")
        .and_then(|id| id.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("toolu_{}", Uuid::new_v4().simple()));

    events.push(json!({
        "type": "content_block_start",
        "index": block_idx,
        "content_block": {
            "type": "tool_use",
            "id": tool_id,
            "name": name,
            "input": {}
        }
    }));
    events
}

/// Responses `response.function_call_arguments.delta`。
pub fn responses_function_call_args_delta(
    state: &mut AnthropicStreamState,
    call_id: &str,
    delta: &str,
) -> Vec<Value> {
    if call_id.is_empty() || delta.is_empty() {
        return Vec::new();
    }
    let Some(&block_idx) = state.responses_fc_blocks.get(call_id) else {
        return Vec::new();
    };
    *state
        .responses_fc_args_sent
        .entry(call_id.to_string())
        .or_insert(0) += delta.len();
    vec![json!({
        "type": "content_block_delta",
        "index": block_idx,
        "delta": { "type": "input_json_delta", "partial_json": delta }
    })]
}

/// Responses `response.function_call_arguments.done`：补齐尚未下发的参数后缀。
pub fn responses_function_call_args_done(
    state: &mut AnthropicStreamState,
    call_id: &str,
    arguments: &str,
) -> Vec<Value> {
    if call_id.is_empty() || arguments.is_empty() {
        return Vec::new();
    }
    let sent = state
        .responses_fc_args_sent
        .get(call_id)
        .copied()
        .unwrap_or(0);
    if arguments.len() <= sent {
        return Vec::new();
    }
    responses_function_call_args_delta(state, call_id, &arguments[sent..])
}

pub fn map_finish_reason(reason: &str) -> &'static str {
    match reason {
        "length" => "max_tokens",
        "tool_calls" => "tool_use",
        _ => "end_turn",
    }
}

pub fn gemini_function_call_delta(
    state: &mut AnthropicStreamState,
    function_call: &Value,
) -> Vec<Value> {
    let name = function_call
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let mut events = Vec::new();

    if !state.started_tool_calls.contains_key(&GEMINI_FC_INDEX) {
        if name.is_empty() {
            return events;
        }
        events.extend(close_active_text_or_thinking(state));
        state.content_index += 1;
        let block_idx = state.content_index;
        state.started_tool_calls.insert(GEMINI_FC_INDEX, block_idx);
        state.gemini_fc_args_sent = 0;
        events.push(json!({
            "type": "content_block_start",
            "index": block_idx,
            "content_block": {
                "type": "tool_use",
                "id": format!("toolu_{}", Uuid::new_v4().simple()),
                "name": name,
                "input": {}
            }
        }));
    }

    let Some(block_idx) = state.started_tool_calls.get(&GEMINI_FC_INDEX).copied() else {
        return events;
    };

    if let Some(args) = function_call.get("args") {
        if let Ok(serialized) = serde_json::to_string(args) {
            if serialized.len() > state.gemini_fc_args_sent {
                let partial = &serialized[state.gemini_fc_args_sent..];
                state.gemini_fc_args_sent = serialized.len();
                if !partial.is_empty() {
                    events.push(json!({
                        "type": "content_block_delta",
                        "index": block_idx,
                        "delta": { "type": "input_json_delta", "partial_json": partial }
                    }));
                }
            }
        }
    }
    events
}

pub fn usage_only_delta(usage: Value) -> Vec<Value> {
    vec![json!({
        "type": "message_delta",
        "delta": {},
        "usage": usage
    })]
}

pub fn finish_stream(
    state: &mut AnthropicStreamState,
    stop_reason: &str,
    usage: Option<Value>,
) -> Vec<Value> {
    if state.stop_sent {
        return Vec::new();
    }
    state.stop_sent = true;
    let mut events = close_active_text_or_thinking(state);
    events.extend(close_tool_blocks(state));
    let usage_obj = usage.unwrap_or_else(zero_usage);
    events.push(json!({
        "type": "message_delta",
        "delta": { "stop_reason": stop_reason, "stop_sequence": null },
        "usage": usage_obj
    }));
    events.push(json!({ "type": "message_stop" }));
    events
}

/// 流结束时若上游未发送 finish_reason，补齐收尾事件。
pub fn finalize_stream(state: &mut AnthropicStreamState) -> Vec<Value> {
    if state.stop_sent {
        return Vec::new();
    }
    let stop = if has_tool_blocks(state) {
        "tool_use"
    } else {
        "end_turn"
    };
    finish_stream(state, stop, None)
}

pub type SharedStreamState = Arc<Mutex<AnthropicStreamState>>;

pub fn new_stream_state() -> SharedStreamState {
    Arc::new(Mutex::new(AnthropicStreamState::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_block_lifecycle() {
        let mut st = AnthropicStreamState::default();
        let mut ev = ensure_message_start(&mut st, "msg_1", "claude");
        assert_eq!(ev.len(), 1);
        ev = text_delta(&mut st, "hi");
        assert!(ev.iter().any(|e| e.get("type") == Some(&json!("content_block_start"))));
        ev = finish_stream(&mut st, "end_turn", None);
        assert!(ev.iter().any(|e| e.get("type") == Some(&json!("message_stop"))));
    }

    #[test]
    fn gemini_function_call_incremental_args() {
        let mut st = AnthropicStreamState::default();
        ensure_message_start(&mut st, "msg_1", "claude");
        let ev1 = gemini_function_call_delta(
            &mut st,
            &json!({ "name": "get_weather", "args": { "city": "NY" } }),
        );
        assert!(ev1.iter().any(|e| e.get("type") == Some(&json!("content_block_start"))));
        let ev2 = gemini_function_call_delta(
            &mut st,
            &json!({ "name": "get_weather", "args": { "city": "NY", "unit": "c" } }),
        );
        assert!(ev2.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("type"))
                .and_then(|t| t.as_str())
                == Some("input_json_delta")
        }));
    }

    #[test]
    fn responses_function_call_args_done_fills_gap() {
        let mut st = AnthropicStreamState::default();
        ensure_message_start(&mut st, "msg_1", "claude");
        responses_function_call_item_added(
            &mut st,
            &json!({
                "type": "function_call",
                "call_id": "call_x",
                "name": "search",
                "arguments": ""
            }),
        );
        responses_function_call_args_delta(&mut st, "call_x", "{\"q\":");
        let ev = responses_function_call_args_done(&mut st, "call_x", "{\"q\":\"wise\"}");
        assert!(ev.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("partial_json"))
                .and_then(|p| p.as_str())
                == Some("\"wise\"}")
        }));
    }

    #[test]
    fn responses_function_call_stream() {
        let mut st = AnthropicStreamState::default();
        ensure_message_start(&mut st, "msg_1", "claude");
        let ev1 = responses_function_call_item_added(
            &mut st,
            &json!({
                "type": "function_call",
                "call_id": "call_abc",
                "name": "get_weather",
                "arguments": ""
            }),
        );
        assert!(ev1.iter().any(|e| e.get("type") == Some(&json!("content_block_start"))));
        let ev2 = responses_function_call_args_delta(&mut st, "call_abc", "{\"city\":");
        assert!(ev2.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("partial_json"))
                .and_then(|p| p.as_str())
                == Some("{\"city\":")
        }));
        let ev3 = responses_function_call_args_delta(&mut st, "call_abc", "\"NYC\"}");
        assert_eq!(ev3.len(), 1);
        let ev4 = finish_stream(&mut st, "tool_use", None);
        assert!(ev4.iter().any(|e| e.get("type") == Some(&json!("content_block_stop"))));
        assert!(ev4.iter().any(|e| e.get("type") == Some(&json!("message_stop"))));
    }

    #[test]
    fn tool_call_stream_emits_blocks() {
        let mut st = AnthropicStreamState::default();
        ensure_message_start(&mut st, "msg_1", "claude");
        let tc = json!({
            "index": 0,
            "id": "call_1",
            "function": { "name": "get_weather", "arguments": "{\"city\":" }
        });
        let ev = tool_call_delta(&mut st, &tc);
        assert!(ev.iter().any(|e| {
            e.get("type") == Some(&json!("content_block_start"))
                && e.get("content_block")
                    .and_then(|b| b.get("type"))
                    .and_then(|t| t.as_str())
                    == Some("tool_use")
        }));
        let ev2 = tool_call_delta(
            &mut st,
            &json!({
                "index": 0,
                "function": { "arguments": "\"NYC\"}" }
            }),
        );
        assert!(ev2.iter().any(|e| {
            e.get("delta")
                .and_then(|d| d.get("type"))
                .and_then(|t| t.as_str())
                == Some("input_json_delta")
        }));
    }
}
