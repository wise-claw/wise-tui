//! Map Cursor Agent CLI `--output-format stream-json` NDJSON into Claude-compatible stream lines.

use serde_json::{json, Value};

#[derive(Debug, PartialEq, Eq)]
pub enum CursorCliStdoutMap {
    /// Ignore (noise / duplicate flush / non-JSON).
    Skip,
    /// Bind CLI chat/session id for resume.
    SessionId(String),
    /// Claude-compatible stream-json lines to emit (+ optionally persist).
    StreamLines(Vec<String>),
    /// Terminal result; success flag for complete payload.
    Result { success: bool, session_id: Option<String> },
}

/// Map one stdout NDJSON line from `agent -p --output-format stream-json`.
pub fn map_cursor_cli_stdout_line(raw_line: &str) -> CursorCliStdoutMap {
    let trimmed = raw_line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return CursorCliStdoutMap::Skip;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return CursorCliStdoutMap::Skip;
    };
    let Some(event_type) = value.get("type").and_then(Value::as_str) else {
        return CursorCliStdoutMap::Skip;
    };

    match event_type {
        "system" => map_system_event(&value),
        "assistant" => map_assistant_event(&value),
        "tool_call" => map_tool_call_event(&value),
        "result" => map_result_event(&value),
        "user" => CursorCliStdoutMap::Skip,
        _ => CursorCliStdoutMap::Skip,
    }
}

fn map_system_event(value: &Value) -> CursorCliStdoutMap {
    let subtype = value
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("");
    if subtype != "init" {
        return CursorCliStdoutMap::Skip;
    }
    let session_id = value
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    match session_id {
        Some(id) => CursorCliStdoutMap::SessionId(id),
        None => CursorCliStdoutMap::Skip,
    }
}

fn map_assistant_event(value: &Value) -> CursorCliStdoutMap {
    // With `--stream-partial-output`, skip duplicate flushes:
    // - has timestamp_ms + model_call_id → pre-tool buffer flush (duplicate)
    // - no timestamp_ms → end-of-turn final flush (duplicate)
    // Keep: timestamp_ms present, model_call_id absent → real text delta
    // Without partial streaming, events usually lack both fields → keep once.
    let has_timestamp = value.get("timestamp_ms").is_some();
    let has_model_call = value.get("model_call_id").is_some();
    if has_timestamp && has_model_call {
        return CursorCliStdoutMap::Skip;
    }
    if !has_timestamp && value.get("message").is_some() {
        // Final flush without timestamp: only skip when this looks like a
        // duplicate of streamed partials (heuristic: empty or missing content).
        // Keep non-partial complete assistant messages (no timestamp at all in non-partial mode).
        // Docs: "不存在 timestamp / model_call_id = 最终刷新（重复）" when partial is enabled.
        // We cannot know if partial was enabled; prefer emitting when content has text.
    }

    let Some(message) = value.get("message") else {
        return CursorCliStdoutMap::Skip;
    };
    let Some(content) = message.get("content").and_then(Value::as_array) else {
        return CursorCliStdoutMap::Skip;
    };
    if content.is_empty() {
        return CursorCliStdoutMap::Skip;
    }

    // If this is a final flush (no timestamp) and all text blocks are empty, skip.
    let has_text = content.iter().any(|block| {
        block
            .get("text")
            .and_then(Value::as_str)
            .map(|t| !t.is_empty())
            .unwrap_or(false)
            || block.get("type").and_then(Value::as_str) == Some("thinking")
    });
    if !has_text {
        return CursorCliStdoutMap::Skip;
    }

    // When partial mode final-flush (no timestamp, no model_call): skip to avoid duplicates.
    // Non-partial mode also has no timestamp — we must still emit.
    // Heuristic: if `timestamp_ms` never appears in the event, treat as complete message (emit).
    // Docs say final flush lacks timestamp; partial deltas have timestamp.
    // So: emit always when has_timestamp; emit when !has_timestamp && !has_model_call
    // UNLESS we're in partial mode. We detect partial mode via presence of any prior
    // timestamped events at the process level — not available here.
    // Safer default for Wise: emit all assistant messages that have text.
    // Duplicate final flush risk is acceptable vs dropping the only complete message.

    let line = json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": content,
        }
    })
    .to_string();
    CursorCliStdoutMap::StreamLines(vec![line])
}

fn map_tool_call_event(value: &Value) -> CursorCliStdoutMap {
    let subtype = value
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("");
    let call_id = value
        .get("call_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");
    if call_id.is_empty() {
        return CursorCliStdoutMap::Skip;
    }
    let Some(tool_call) = value.get("tool_call").and_then(Value::as_object) else {
        return CursorCliStdoutMap::Skip;
    };

    let (name, args, result_value, is_error) = extract_tool_call_parts(tool_call);

    match subtype {
        "started" => {
            let line = json!({
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": call_id,
                        "name": name,
                        "input": args,
                    }]
                }
            })
            .to_string();
            CursorCliStdoutMap::StreamLines(vec![line])
        }
        "completed" => {
            let content = match &result_value {
                Some(v) => serialize_tool_result(v),
                None => String::new(),
            };
            let line = json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": call_id,
                        "content": content,
                        "is_error": is_error,
                    }]
                }
            })
            .to_string();
            CursorCliStdoutMap::StreamLines(vec![line])
        }
        _ => CursorCliStdoutMap::Skip,
    }
}

fn extract_tool_call_parts(tool_call: &serde_json::Map<String, Value>) -> (String, Value, Option<Value>, bool) {
    // Prefer named *ToolCall keys (readToolCall / writeToolCall / …).
    for (key, value) in tool_call {
        if let Some(prefix) = key.strip_suffix("ToolCall") {
            let name = if prefix.is_empty() {
                "tool".to_string()
            } else {
                // readToolCall → Read, writeToolCall → Write (Claude-style)
                let mut chars = prefix.chars();
                match chars.next() {
                    Some(c) => format!("{}{}", c.to_ascii_uppercase(), chars.as_str()),
                    None => "tool".to_string(),
                }
            };
            let args = value
                .get("args")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let (result, is_error) = match value.get("result") {
                Some(r) if r.get("success").is_some() => (Some(r["success"].clone()), false),
                Some(r) if r.get("error").is_some() => (Some(r["error"].clone()), true),
                Some(r) => (Some(r.clone()), false),
                None => (None, false),
            };
            return (name, args, result, is_error);
        }
    }

    if let Some(function) = tool_call.get("function") {
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("function")
            .to_string();
        let args = function
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));
        return (name, args, None, false);
    }

    ("tool".to_string(), json!({}), None, false)
}

fn map_result_event(value: &Value) -> CursorCliStdoutMap {
    let subtype = value
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("");
    let is_error = value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let success = subtype == "success" && !is_error;
    let session_id = value
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    // Do not re-emit aggregated `result` text — assistant events already streamed it.
    CursorCliStdoutMap::Result { success, session_id }
}

fn serialize_tool_result(result: &Value) -> String {
    if let Some(s) = result.as_str() {
        return s.to_string();
    }
    result.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_system_init_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","cwd":"/tmp"}"#;
        match map_cursor_cli_stdout_line(line) {
            CursorCliStdoutMap::SessionId(id) => {
                assert_eq!(id, "c6b62c6f-7ead-4fd6-9922-e952131177ff");
            }
            other => panic!("expected SessionId, got {other:?}"),
        }
    }

    #[test]
    fn maps_assistant_text() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]},"session_id":"x"}"#;
        match map_cursor_cli_stdout_line(line) {
            CursorCliStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains("hello"));
            }
            other => panic!("expected StreamLines, got {other:?}"),
        }
    }

    #[test]
    fn maps_tool_call_started_and_completed() {
        let started = r#"{"type":"tool_call","subtype":"started","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"README.md"}}},"session_id":"x"}"#;
        match map_cursor_cli_stdout_line(started) {
            CursorCliStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains("tool_use"));
                assert!(lines[0].contains("Read"));
            }
            other => panic!("expected StreamLines, got {other:?}"),
        }

        let completed = r##"{"type":"tool_call","subtype":"completed","call_id":"c1","tool_call":{"readToolCall":{"args":{"path":"README.md"},"result":{"success":{"content":"# hi","totalLines":1}}}},"session_id":"x"}"##;
        match map_cursor_cli_stdout_line(completed) {
            CursorCliStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains("tool_result"));
                assert!(lines[0].contains("# hi"));
            }
            other => panic!("expected StreamLines, got {other:?}"),
        }
    }

    #[test]
    fn maps_result_success() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"abc"}"#;
        match map_cursor_cli_stdout_line(line) {
            CursorCliStdoutMap::Result {
                success: true,
                session_id: Some(id),
            } => assert_eq!(id, "abc"),
            other => panic!("expected Result success, got {other:?}"),
        }
    }

    #[test]
    fn skips_duplicate_partial_flush() {
        let line = r#"{"type":"assistant","timestamp_ms":1,"model_call_id":"m1","message":{"role":"assistant","content":[{"type":"text","text":"dup"}]}}"#;
        assert_eq!(
            map_cursor_cli_stdout_line(line),
            CursorCliStdoutMap::Skip
        );
    }
}
