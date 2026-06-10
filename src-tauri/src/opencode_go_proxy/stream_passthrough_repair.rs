//! Anthropic passthrough 流式/非流式修复：Qwen 等上游偶发 `stop_reason=tool_use` 但无 `tool_use` 块，
//! 或 tool JSON 不完整，会导致 Claude Code 报 "The model's tool call could not be parsed (retry also failed)."

use std::collections::HashMap;

use serde_json::{json, Value};

use super::tool_call_extract::{extract_first_tool_call_from_text, new_tool_use_id, ExtractedToolCall};

#[derive(Debug, Default)]
pub struct PassthroughRepairState {
    pub saw_tool_use_block: bool,
    pub text_by_index: HashMap<i32, String>,
    pub tool_json_by_index: HashMap<i32, String>,
    pub next_synthetic_index: i32,
    pub message_started: bool,
}

pub fn repair_passthrough_sse_chunk(chunk: &str, state: &mut PassthroughRepairState) -> String {
    let mut out = String::new();
    let mut event_type = String::new();
    let mut data_lines: Vec<String> = Vec::new();

    for line in chunk.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if !data_lines.is_empty() {
                out.push_str(&flush_sse_event(&event_type, &data_lines, state));
                out.push('\n');
                event_type.clear();
                data_lines.clear();
            }
            out.push('\n');
            continue;
        }
        if let Some(ev) = line.strip_prefix("event:") {
            if !data_lines.is_empty() {
                out.push_str(&flush_sse_event(&event_type, &data_lines, state));
                out.push('\n');
                data_lines.clear();
            }
            event_type = ev.trim().to_string();
            continue;
        }
        if let Some(data) = line.strip_prefix("data:") {
            data_lines.push(data.trim_start().to_string());
            continue;
        }
        if !data_lines.is_empty() {
            out.push_str(&flush_sse_event(&event_type, &data_lines, state));
            out.push('\n');
            event_type.clear();
            data_lines.clear();
        }
        out.push_str(line);
        out.push('\n');
    }

    if !data_lines.is_empty() {
        out.push_str(&flush_sse_event(&event_type, &data_lines, state));
        out.push('\n');
    }
    out
}

fn flush_sse_event(event_type: &str, data_lines: &[String], state: &mut PassthroughRepairState) -> String {
    let data = data_lines.join("\n");
    if data.is_empty() {
        return String::new();
    }
    let (prefix, repaired) = repair_passthrough_sse_data(&data, state);
    let mut block = prefix;
    if !event_type.is_empty() {
        block.push_str("event: ");
        block.push_str(event_type);
        block.push('\n');
    }
    block.push_str("data: ");
    block.push_str(&repaired);
    block.push_str("\n\n");
    block
}

fn repair_passthrough_sse_data(data: &str, state: &mut PassthroughRepairState) -> (String, String) {
    let Ok(mut parsed) = serde_json::from_str::<Value>(data) else {
        return (String::new(), data.to_string());
    };
    let ty = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match ty {
        "message_start" => {
            state.saw_tool_use_block = false;
            state.text_by_index.clear();
            state.tool_json_by_index.clear();
            state.message_started = true;
            state.next_synthetic_index = parsed
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|a| a.len() as i32)
                .unwrap_or(0);
        }
        "content_block_start" => {
            if let Some(idx) = parsed.get("index").and_then(|i| i.as_i64()) {
                state.next_synthetic_index = state.next_synthetic_index.max(idx as i32 + 1);
            }
            if parsed
                .get("content_block")
                .and_then(|b| b.get("type"))
                .and_then(|t| t.as_str())
                == Some("tool_use")
            {
                state.saw_tool_use_block = true;
            }
        }
        "content_block_delta" => {
            if let Some(idx) = parsed.get("index").and_then(|i| i.as_i64()) {
                let idx = idx as i32;
                if let Some(delta) = parsed.get("delta") {
                    if delta.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                            state.text_by_index.entry(idx).or_default().push_str(text);
                        }
                    }
                    if delta.get("type").and_then(|t| t.as_str()) == Some("input_json_delta") {
                        if let Some(partial) = delta.get("partial_json").and_then(|p| p.as_str()) {
                            state.tool_json_by_index.entry(idx).or_default().push_str(partial);
                        }
                    }
                }
            }
        }
        "content_block_stop" => {
            if let Some(idx) = parsed.get("index").and_then(|i| i.as_i64()) {
                let idx = idx as i32;
                if let Some(repair_delta) = repair_incomplete_tool_json_delta(idx, state) {
                    let prefix = format_sse_data(&repair_delta);
                    let repaired = repair_passthrough_sse_data_inner(&mut parsed, state);
                    return (prefix, repaired);
                }
            }
        }
        "message_delta" => {
            if let Some(delta) = parsed.get_mut("delta").and_then(|d| d.as_object_mut()) {
                if delta.get("stop_reason").and_then(|s| s.as_str()) == Some("tool_use")
                    && !state.saw_tool_use_block
                {
                    if let Some(prefix) = try_synthesize_tool_use_from_text(state) {
                        patch_orphan_tool_use_stop_reason(delta, true);
                        let repaired = parsed.to_string();
                        return (prefix, repaired);
                    }
                    patch_orphan_tool_use_stop_reason(delta, false);
                }
            }
        }
        _ => {}
    }
    (String::new(), parsed.to_string())
}

fn repair_passthrough_sse_data_inner(parsed: &mut Value, state: &mut PassthroughRepairState) -> String {
    let ty = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if ty == "message_delta" {
        if let Some(delta) = parsed.get_mut("delta").and_then(|d| d.as_object_mut()) {
            if delta.get("stop_reason").and_then(|s| s.as_str()) == Some("tool_use")
                && !state.saw_tool_use_block
            {
                patch_orphan_tool_use_stop_reason(delta, false);
            }
        }
    }
    parsed.to_string()
}

fn repair_incomplete_tool_json_delta(idx: i32, state: &mut PassthroughRepairState) -> Option<Value> {
    let raw = state.tool_json_by_index.get(&idx)?;
    if raw.trim().is_empty() {
        return Some(json!({
            "type": "content_block_delta",
            "index": idx,
            "delta": { "type": "input_json_delta", "partial_json": "{}" }
        }));
    }
    if serde_json::from_str::<Value>(raw).is_ok() {
        return None;
    }
    let suffix = json_closing_suffix(raw);
    if suffix.is_empty() {
        return None;
    }
    Some(json!({
        "type": "content_block_delta",
        "index": idx,
        "delta": { "type": "input_json_delta", "partial_json": suffix }
    }))
}

fn json_closing_suffix(raw: &str) -> String {
    let mut brace_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for ch in raw.chars() {
        if in_string {
            if escape {
                escape = false;
                continue;
            }
            if ch == '\\' {
                escape = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => brace_depth += 1,
            '}' => brace_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            _ => {}
        }
    }
    let mut suffix = String::new();
    for _ in 0..bracket_depth.max(0) {
        suffix.push(']');
    }
    for _ in 0..brace_depth.max(0) {
        suffix.push('}');
    }
    suffix
}

fn try_synthesize_tool_use_from_text(state: &mut PassthroughRepairState) -> Option<String> {
    let combined = state
        .text_by_index
        .values()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let call = extract_first_tool_call_from_text(&combined)?;
    state.saw_tool_use_block = true;
    Some(build_synthetic_tool_use_sse(&call, state))
}

fn build_synthetic_tool_use_sse(call: &ExtractedToolCall, state: &mut PassthroughRepairState) -> String {
    let block_idx = state.next_synthetic_index;
    state.next_synthetic_index += 1;
    let tool_id = new_tool_use_id();
    let args = serde_json::to_string(&call.input).unwrap_or_else(|_| "{}".to_string());
    let events = vec![
        json!({
            "type": "content_block_start",
            "index": block_idx,
            "content_block": {
                "type": "tool_use",
                "id": tool_id,
                "name": call.name,
                "input": {}
            }
        }),
        json!({
            "type": "content_block_delta",
            "index": block_idx,
            "delta": { "type": "input_json_delta", "partial_json": args }
        }),
        json!({
            "type": "content_block_stop",
            "index": block_idx
        }),
    ];
    events.into_iter().map(|e| format_sse_data(&e)).collect()
}

fn format_sse_data(value: &Value) -> String {
    format!("data: {}\n\n", value)
}

fn patch_orphan_tool_use_stop_reason(delta: &mut serde_json::Map<String, Value>, saw_tool_use: bool) {
    if saw_tool_use {
        return;
    }
    if delta.get("stop_reason").and_then(|s| s.as_str()) != Some("tool_use") {
        return;
    }
    delta.insert("stop_reason".to_string(), json!("end_turn"));
}

/// 非流式 Anthropic Message：尝试从 text 提取 tool_use，或降级 orphan stop_reason。
pub fn repair_passthrough_message_json(body: &Value) -> Value {
    let mut out = body.clone();
    let Some(obj) = out.as_object_mut() else {
        return out;
    };

    let stop_is_tool_use = obj.get("stop_reason").and_then(|s| s.as_str()) == Some("tool_use");
    let mut has_tool_use = false;
    let mut combined_text = String::new();

    if let Some(blocks) = obj.get_mut("content").and_then(|c| c.as_array_mut()) {
        blocks.retain(|b| b.get("type").and_then(|t| t.as_str()) != Some("tool_reference"));
        for block in blocks.iter() {
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                has_tool_use = true;
            }
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                    combined_text.push_str(t);
                    combined_text.push('\n');
                }
            }
            if block.get("type").and_then(|t| t.as_str()) == Some("thinking") {
                if let Some(t) = block.get("thinking").and_then(|x| x.as_str()) {
                    combined_text.push_str(t);
                    combined_text.push('\n');
                }
            }
        }

        if stop_is_tool_use && !has_tool_use {
            if let Some(call) = extract_first_tool_call_from_text(&combined_text) {
                blocks.retain(|b| {
                    let ty = b.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if ty != "text" && ty != "thinking" {
                        return true;
                    }
                    let text = b
                        .get("text")
                        .or_else(|| b.get("thinking"))
                        .and_then(|x| x.as_str())
                        .unwrap_or("");
                    extract_first_tool_call_from_text(text).is_none()
                });
                blocks.push(json!({
                    "type": "tool_use",
                    "id": new_tool_use_id(),
                    "name": call.name,
                    "input": call.input,
                }));
                has_tool_use = true;
            }
        }

        for block in blocks.iter_mut() {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                continue;
            }
            let input = block.get("input").cloned().unwrap_or(json!({}));
            if input.is_object() {
                continue;
            }
            block.as_object_mut().map(|o| {
                o.insert("input".to_string(), json!({}));
            });
        }
    }

    if stop_is_tool_use && !has_tool_use {
        obj.insert("stop_reason".to_string(), json!("end_turn"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn repairs_orphan_tool_use_stop_in_message_delta() {
        let mut state = PassthroughRepairState::default();
        let chunk = r#"event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null}}

"#;
        let out = repair_passthrough_sse_chunk(chunk, &mut state);
        assert!(out.contains(r#""stop_reason":"end_turn""#));
        assert!(!out.contains(r#""stop_reason":"tool_use""#));
    }

    #[test]
    fn keeps_tool_use_stop_when_block_started() {
        let mut state = PassthroughRepairState::default();
        let chunk = r#"event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"Bash","input":{}}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null}}

"#;
        let out = repair_passthrough_sse_chunk(chunk, &mut state);
        assert!(out.contains(r#""stop_reason":"tool_use""#));
    }

    #[test]
    fn synthesizes_tool_use_from_text_before_orphan_stop() {
        let mut state = PassthroughRepairState::default();
        let chunk = r#"event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"<tool_call>{\"name\":\"Bash\",\"arguments\":{\"command\":\"ls\"}}</tool_call>"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null}}

"#;
        let out = repair_passthrough_sse_chunk(chunk, &mut state);
        assert!(out.contains(r#""type":"tool_use""#));
        assert!(out.contains(r#""name":"Bash""#));
        assert!(out.contains(r#""stop_reason":"tool_use""#));
    }

    #[test]
    fn repairs_non_stream_message_json_with_text_tool_call() {
        let body = json!({
            "type": "message",
            "role": "assistant",
            "content": [{
                "type": "text",
                "text": "<function=Read>{\"file_path\":\"a.txt\"}</function>"
            }],
            "stop_reason": "tool_use",
        });
        let fixed = repair_passthrough_message_json(&body);
        assert_eq!(fixed["stop_reason"], "tool_use");
        let blocks = fixed["content"].as_array().unwrap();
        assert!(blocks.iter().any(|b| b["type"] == "tool_use" && b["name"] == "Read"));
    }

    #[test]
    fn repairs_non_stream_orphan_stop_to_end_turn() {
        let body = json!({
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "text", "text": "ok" }],
            "stop_reason": "tool_use",
        });
        let fixed = repair_passthrough_message_json(&body);
        assert_eq!(fixed["stop_reason"], "end_turn");
    }
}
