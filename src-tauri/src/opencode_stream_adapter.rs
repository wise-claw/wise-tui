//! Map OpenCode CLI `run --format json` JSONL stdout into Claude Code stream-json lines.

use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, PartialEq, Eq)]
pub enum OpencodeStdoutMap {
    PlainText,
    StreamLines(Vec<String>),
}

#[derive(Default)]
pub struct OpencodeStdoutMapper {
    text_by_part_id: HashMap<String, String>,
    tool_output_by_call_id: HashMap<String, String>,
    emitted_session_id: Option<String>,
    /// 最近一次 `error` 事件解析到的真实错误文本，供等待任务复用，避免兜底提示遮蔽真实错误。
    last_error: Option<String>,
}

impl OpencodeStdoutMapper {
    pub fn map_line(&mut self, raw_line: &str) -> OpencodeStdoutMap {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            return OpencodeStdoutMap::StreamLines(vec![]);
        }
        if !trimmed.starts_with('{') {
            return OpencodeStdoutMap::PlainText;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return OpencodeStdoutMap::PlainText;
        };
        if !value.is_object() {
            return OpencodeStdoutMap::PlainText;
        }
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !looks_like_opencode_run_event(event_type) {
            return OpencodeStdoutMap::PlainText;
        }
        OpencodeStdoutMap::StreamLines(self.map_event(event_type, &value))
    }
}

fn looks_like_opencode_run_event(event_type: &str) -> bool {
    matches!(
        event_type,
        "step_start" | "text" | "reasoning" | "tool_use" | "step_finish" | "error"
    )
}

fn opencode_session_stream_line(session_id: &str) -> String {
    json!({
        "type": "opencode_session",
        "sessionId": session_id,
    })
    .to_string()
}

fn opencode_session_clear_stream_line() -> String {
    opencode_session_stream_line("")
}

impl OpencodeStdoutMapper {
    fn maybe_emit_session_id(&mut self, value: &Value) -> Vec<String> {
        let session_id = value
            .get("sessionID")
            .or_else(|| value.get("sessionId"))
            .or_else(|| value.get("session_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let Some(session_id) = session_id else {
            return vec![];
        };
        if self.emitted_session_id.as_deref() == Some(session_id) {
            return vec![];
        }
        self.emitted_session_id = Some(session_id.to_string());
        vec![opencode_session_stream_line(session_id)]
    }

    fn map_event(&mut self, event_type: &str, value: &Value) -> Vec<String> {
        let mut out = self.maybe_emit_session_id(value);
        match event_type {
            "step_start" => {}
            "text" => out.extend(self.map_text_event(value)),
            "reasoning" => out.extend(self.map_reasoning_event(value)),
            "tool_use" => out.extend(self.map_tool_use_event(value)),
            "error" => out.extend(self.map_error_event(value)),
            "step_finish" => {}
            _ => {}
        }
        out
    }

    fn map_text_event(&mut self, value: &Value) -> Vec<String> {
        let Some(part) = value.get("part").and_then(Value::as_object) else {
            return vec![];
        };
        let part_id = part
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("text");
        let full_text = part
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("");
        let prev = self
            .text_by_part_id
            .get(part_id)
            .map(String::as_str)
            .unwrap_or("");
        if full_text.len() <= prev.len() || !full_text.starts_with(prev) {
            self.text_by_part_id
                .insert(part_id.to_string(), full_text.to_string());
            if full_text.trim().is_empty() {
                return vec![];
            }
            return vec![assistant_text_line(full_text)];
        }
        let delta = &full_text[prev.len()..];
        self.text_by_part_id
            .insert(part_id.to_string(), full_text.to_string());
        if delta.trim().is_empty() {
            return vec![];
        }
        vec![assistant_text_line(delta)]
    }

    fn map_reasoning_event(&mut self, value: &Value) -> Vec<String> {
        let Some(part) = value.get("part").and_then(Value::as_object) else {
            return vec![];
        };
        let text = part
            .get("text")
            .or_else(|| part.get("thinking"))
            .or_else(|| part.get("content"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if text.trim().is_empty() {
            return vec![];
        }
        vec![assistant_thinking_line(text)]
    }

    fn map_tool_use_event(&mut self, value: &Value) -> Vec<String> {
        let Some(part) = value.get("part").and_then(Value::as_object) else {
            return vec![];
        };
        let call_id = part
            .get("callID")
            .or_else(|| part.get("id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("tool");
        let tool_name = part
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or("tool");
        let state = part.get("state").and_then(Value::as_object);
        let status = state
            .and_then(|s| s.get("status"))
            .and_then(Value::as_str)
            .unwrap_or("completed");
        let input = state
            .and_then(|s| s.get("input"))
            .cloned()
            .unwrap_or_else(|| json!({}));
        let output = state
            .and_then(|s| s.get("output"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if status != "completed" && output.is_none() {
            return vec![assistant_tool_use_line(
                call_id,
                tool_name,
                input,
                "running",
                None,
                None,
            )];
        }
        let prev = self
            .tool_output_by_call_id
            .get(call_id)
            .map(String::as_str)
            .unwrap_or("");
        if let Some(out) = output {
            if out == prev {
                return vec![];
            }
            let delta = if out.starts_with(prev) {
                &out[prev.len()..]
            } else {
                out
            };
            self.tool_output_by_call_id
                .insert(call_id.to_string(), out.to_string());
            if delta.trim().is_empty() {
                return vec![];
            }
            return vec![assistant_tool_use_line(
                call_id,
                tool_name,
                input,
                "completed",
                Some(delta),
                None,
            )];
        }
        if self.tool_output_by_call_id.contains_key(call_id) {
            return vec![];
        }
        self.tool_output_by_call_id
            .insert(call_id.to_string(), String::new());
        let title = state
            .and_then(|s| s.get("title"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty());
        vec![assistant_tool_use_line(
            call_id,
            tool_name,
            input,
            if status == "completed" {
                "completed"
            } else {
                "running"
            },
            title,
            None,
        )]
    }

    fn map_error_event(&mut self, value: &Value) -> Vec<String> {
        let extracted = extract_opencode_error_text(value);
        let message = extracted
            .clone()
            .unwrap_or_else(|| "OpenCode 执行出错".to_string());
        // 仅留存真正解析到的文本；回退占位符不写入，留给等待任务走兜底而非用占位符充当诊断。
        self.last_error = extracted;
        vec![assistant_text_line(&message)]
    }

    /// 取出最近一次 `error` 事件解析到的真实错误文本（供等待任务复用，避免兜底）。
    pub fn take_last_error(&mut self) -> Option<String> {
        self.last_error.take()
    }
}

/// 从 OpenCode `error` 事件中提取可读错误文本。
///
/// OpenCode 以 `--format json` 运行时，错误经 stdout 以 `{"type":"error",...}` 事件输出，
/// 其消息可能位于顶层字符串字段，也可能嵌套在 `error` / `part` / `cause` 等对象内。
/// 逐层尝试常见字段，避免因结构差异丢失真实错误而回退成无意义的「OpenCode 执行出错」。
fn extract_opencode_error_text(value: &Value) -> Option<String> {
    extract_opencode_error_text_inner(value, 0)
}

const OPENCODE_ERROR_TEXT_MAX_DEPTH: usize = 4;

fn extract_opencode_error_text_inner(value: &Value, depth: usize) -> Option<String> {
    if depth > OPENCODE_ERROR_TEXT_MAX_DEPTH {
        return None;
    }
    if let Some(s) = value.as_str() {
        let trimmed = s.trim();
        return if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    let Some(obj) = value.as_object() else {
        return None;
    };
    // 1. 顶层常见字符串字段（最常见形态）。
    // 注意：name 故意不放在这里，因为它通常只是泛化类型（如 APIError），
    // 而 data.message 更有用。name 作为最后的回退（见步骤 3）。
    for key in ["message", "error", "details", "reason", "text", "msg"] {
        if let Some(s) = obj.get(key).and_then(Value::as_str) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    // 2. 上述字段为对象时递归提取（如 {"error":{"message":"..."}} 或 {"part":{"text":"..."}}）。
    // OpenCode 真实格式：{"type":"error","error":{"name":"APIError","data":{"message":"..."}}}
    for key in ["error", "message", "details", "reason", "part", "cause", "data"] {
        if let Some(inner) = obj.get(key) {
            if inner.is_object() {
                if let Some(text) = extract_opencode_error_text_inner(inner, depth + 1) {
                    return Some(text);
                }
            }
        }
    }
    // 3. 回退：error.name（如 APIError），只在上述两种都失败时使用。
    if let Some(s) = obj.get("name").and_then(Value::as_str) {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

pub fn opencode_session_clear_line() -> String {
    opencode_session_clear_stream_line()
}

fn assistant_text_line(text: &str) -> String {
    assistant_content_line(vec![json!({ "type": "text", "text": text })])
}

fn assistant_thinking_line(text: &str) -> String {
    assistant_content_line(vec![json!({ "type": "thinking", "thinking": text })])
}

fn assistant_tool_use_line(
    id: &str,
    name: &str,
    input: Value,
    status: &str,
    output: Option<&str>,
    error: Option<String>,
) -> String {
    let mut block = json!({
        "type": "tool_use",
        "id": id,
        "name": name,
        "input": input,
        "status": status,
    });
    if let Some(out) = output {
        block["output"] = json!(out);
    }
    if let Some(err) = error {
        block["error"] = json!(err);
    }
    assistant_content_line(vec![block])
}

fn assistant_content_line(blocks: Vec<Value>) -> String {
    json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": blocks,
        }
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_step_start_session_id() {
        let mut mapper = OpencodeStdoutMapper::default();
        let line = r#"{"type":"step_start","sessionID":"ses_abc123","part":{"id":"prt_1","type":"step-start"}}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains(r#""type":"opencode_session""#));
                assert!(lines[0].contains("ses_abc123"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn diffs_cumulative_text_events() {
        let mut mapper = OpencodeStdoutMapper::default();
        let first = r#"{"type":"text","sessionID":"ses_1","part":{"id":"prt_t","type":"text","text":"Hel"}}"#;
        let second = r#"{"type":"text","sessionID":"ses_1","part":{"id":"prt_t","type":"text","text":"Hello"}}"#;
        match mapper.map_line(first) {
            OpencodeStdoutMap::StreamLines(lines) => assert!(lines.last().unwrap().contains("Hel")),
            other => panic!("{other:?}"),
        }
        match mapper.map_line(second) {
            OpencodeStdoutMap::StreamLines(lines) => assert!(lines.last().unwrap().contains("lo")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_error_event() {
        let mut mapper = OpencodeStdoutMapper::default();
        let line = r#"{"type":"error","sessionID":"ses_1","message":"API key missing"}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert!(lines.iter().any(|l| l.contains("API key missing")));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_error_event_extracts_nested_object_message() {
        let mut mapper = OpencodeStdoutMapper::default();
        // provider 凭据失败常以嵌套对象形态输出，旧逻辑会丢失真实消息。
        let line = r#"{"type":"error","sessionID":"ses_1","error":{"message":"provider returned 401 unauthorized"}}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert!(lines
                    .iter()
                    .any(|l| l.contains("provider returned 401 unauthorized")));
                assert!(!lines.iter().any(|l| l.contains("OpenCode 执行出错")));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            mapper.take_last_error().as_deref(),
            Some("provider returned 401 unauthorized")
        );
    }

    #[test]
    fn maps_error_event_extracts_part_text() {
        let mut mapper = OpencodeStdoutMapper::default();
        let line = r#"{"type":"error","sessionID":"ses_1","part":{"type":"error","text":"network unreachable"}}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert!(lines.iter().any(|l| l.contains("network unreachable")));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            mapper.take_last_error().as_deref(),
            Some("network unreachable")
        );
    }

    #[test]
    fn maps_error_event_falls_back_when_no_text() {
        let mut mapper = OpencodeStdoutMapper::default();
        let line = r#"{"type":"error","sessionID":"ses_1","error":{"code":42}}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert!(lines.iter().any(|l| l.contains("OpenCode 执行出错")));
            }
            other => panic!("{other:?}"),
        }
        // 无可读文本时不写入 last_error，留给等待任务走兜底。
        assert_eq!(mapper.take_last_error(), None);
    }

    #[test]
    fn maps_error_event_with_opencode_real_format() {
        // OpenCode 真实 error 事件格式：error.data.message
        // 参考 https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/
        let mut mapper = OpencodeStdoutMapper::default();
        let line = r#"{"type":"error","timestamp":1767036065000,"sessionID":"ses_1","error":{"name":"APIError","data":{"message":"Rate limit exceeded","statusCode":429,"isRetryable":true}}}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert!(lines.iter().any(|l| l.contains("Rate limit exceeded")));
                assert!(!lines.iter().any(|l| l.contains("OpenCode 执行出错")));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(
            mapper.take_last_error().as_deref(),
            Some("Rate limit exceeded")
        );
    }

    #[test]
    fn maps_error_event_extracts_error_name_when_data_message_missing() {
        // 当 error.data.message 不可用时，退而提取 error.name
        let mut mapper = OpencodeStdoutMapper::default();
        let line = r#"{"type":"error","sessionID":"ses_1","error":{"name":"AuthError","data":{"statusCode":401}}}"#;
        match mapper.map_line(line) {
            OpencodeStdoutMap::StreamLines(lines) => {
                assert!(lines.iter().any(|l| l.contains("AuthError")));
                assert!(!lines.iter().any(|l| l.contains("OpenCode 执行出错")));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(mapper.take_last_error().as_deref(), Some("AuthError"));
    }
}
