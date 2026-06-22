//! Map Codex CLI `exec --json` JSONL stdout into Claude Code stream-json lines for the Wise UI.

use serde_json::{json, Value};

/// Result of mapping one Codex stdout line for session streaming.
#[derive(Debug, PartialEq, Eq)]
pub enum CodexStdoutMap {
    /// Line is not Codex JSONL; caller may wrap as plain assistant text.
    PlainText,
    /// Zero or more Claude-compatible stream-json lines to emit.
    StreamLines(Vec<String>),
}

pub fn map_codex_exec_stdout_line(raw_line: &str) -> CodexStdoutMap {
    let trimmed = raw_line.trim();
    if trimmed.is_empty() {
        return CodexStdoutMap::StreamLines(vec![]);
    }
    if !trimmed.starts_with('{') {
        return CodexStdoutMap::PlainText;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return CodexStdoutMap::PlainText;
    };
    if !value.is_object() {
        return CodexStdoutMap::PlainText;
    }
    let obj = value.as_object().expect("object");
    if obj.contains_key("msg") {
        return CodexStdoutMap::StreamLines(map_codex_msg_envelope(&value));
    }
    let Some(event_type) = obj.get("type").and_then(Value::as_str) else {
        return CodexStdoutMap::PlainText;
    };
    if !looks_like_codex_exec_event(event_type) {
        return CodexStdoutMap::PlainText;
    }
    CodexStdoutMap::StreamLines(map_codex_exec_event(event_type, &value))
}

fn looks_like_codex_exec_event(event_type: &str) -> bool {
    event_type.starts_with("thread.")
        || event_type.starts_with("turn.")
        || event_type.starts_with("item.")
        || event_type.starts_with("session.")
        || event_type.starts_with("response_item")
        || event_type == "error"
}

fn codex_session_stream_line(session_id: &str) -> String {
    serde_json::json!({
        "type": "codex_session",
        "sessionId": session_id,
    })
    .to_string()
}

fn map_codex_exec_event(event_type: &str, value: &Value) -> Vec<String> {
    match event_type {
        "thread.started" => {
            let thread_id = value
                .get("thread_id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            thread_id
                .map(codex_session_stream_line)
                .into_iter()
                .collect()
        }
        "error" => {
            let message = extract_codex_error_text(value)
                .unwrap_or_else(|| "Codex 执行出错".to_string());
            vec![assistant_text_line(&message)]
        }
        "turn.failed" => {
            let message = extract_codex_error_text(value)
                .unwrap_or_else(|| "Codex turn 失败".to_string());
            vec![assistant_text_line(&message)]
        }
        et if et.starts_with("item.") => {
            let Some(item) = value.get("item") else {
                return vec![];
            };
            map_codex_item_event(et, item)
        }
        "response_item" => map_codex_response_item(value),
        _ => vec![],
    }
}

fn map_codex_msg_envelope(value: &Value) -> Vec<String> {
    let Some(msg) = value.get("msg").and_then(Value::as_object) else {
        return vec![];
    };
    let msg_type = msg.get("type").and_then(Value::as_str).unwrap_or("");
    match msg_type {
        "text" => {
            let content = msg
                .get("content")
                .or_else(|| msg.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if content.trim().is_empty() {
                vec![]
            } else {
                vec![assistant_text_line(content)]
            }
        }
        "reasoning" | "thinking" => {
            let text = msg
                .get("content")
                .or_else(|| msg.get("text"))
                .or_else(|| msg.get("thinking"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if text.trim().is_empty() {
                vec![]
            } else {
                vec![assistant_thinking_line(text)]
            }
        }
        "error" => {
            // 直接将 msg 作为 Value 传入，extract_codex_error_text 内部会处理对象
            let msg_value = serde_json::Value::Object(msg.clone());
            let message = extract_codex_error_text(&msg_value)
                .or_else(|| {
                    msg.get("content")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "Codex 执行出错".to_string());
            vec![assistant_text_line(&message)]
        }
        _ => vec![],
    }
}

/// Codex `response_item` 事件：例如 `function_call`（apply_patch、update_plan、view_image 等）。
/// 老逻辑会落入 `_ => vec![]` 把这些工具调用完全丢掉，主会话里就看不到文件编辑。
/// 这里把 `function_call` 映射成 `tool_use` 流式行，让前端按既有工具渲染。
fn map_codex_response_item(value: &Value) -> Vec<String> {
    let Some(payload) = value.get("payload").and_then(Value::as_object) else {
        return vec![];
    };
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("");
    if payload_type != "function_call" {
        return vec![];
    }
    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("codex_function_call");
    let call_id = payload
        .get("call_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("codex-fn-{}", uuid::Uuid::new_v4().simple()));
    let raw_args = payload
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or("");
    let input = parse_codex_function_call_arguments(name, raw_args);
    vec![assistant_tool_use_line(
        &call_id,
        name,
        input,
        "completed",
        None,
        None,
    )]
}

/// Codex `function_call.arguments` 是 JSON 字符串；尽量原样解析后透传，
/// `apply_patch` 同时把首个文件路径提取到 `file_path` 方便前端 file-edit 渲染。
fn parse_codex_function_call_arguments(name: &str, raw_args: &str) -> Value {
    let parsed: Value = serde_json::from_str(raw_args.trim())
        .unwrap_or_else(|_| Value::String(raw_args.to_string()));
    if name == "apply_patch" {
        if let Some(cmd) = parsed.get("command").and_then(Value::as_str) {
            if let Some(file_path) = first_apply_patch_file_path(cmd) {
                if let Some(obj) = parsed.as_object() {
                    let mut obj = obj.clone();
                    obj.insert("file_path".to_string(), Value::String(file_path));
                    obj.insert(
                        "command".to_string(),
                        Value::String(cmd.to_string()),
                    );
                    return Value::Object(obj);
                }
            }
        }
    }
    parsed
}

/// 从 `apply_patch` 文本中取第一个 `*** Update File:`/`Add File:` 后的路径。
fn first_apply_patch_file_path(command: &str) -> Option<String> {
    for line in command.lines() {
        let trimmed = line.trim_start_matches("\r");
        let rest = trimmed
            .strip_prefix("***")
            .map(str::trim_start)
            .unwrap_or(trimmed);
        for marker in ["Update File:", "Add File:", "Delete File:"] {
            if let Some(path) = rest.strip_prefix(marker) {
                let path = path.trim();
                if !path.is_empty() {
                    return Some(path.to_string());
                }
            }
        }
    }
    None
}

fn map_codex_item_event(event_type: &str, item: &Value) -> Vec<String> {
    let kind = codex_item_kind(item).unwrap_or("");
    match kind {
        "reasoning" => map_reasoning_item(item),
        "agent_message" | "assistant_message" => map_agent_message_item(item),
        "command_execution" => map_command_execution_item(event_type, item),
        "error" => map_error_item(item),
        "mcp_tool_call" | "web_search" | "file_change" | "plan_update" | "todo_list" => {
            map_generic_item_summary(kind, item)
        }
        _ => vec![],
    }
}

fn map_reasoning_item(item: &Value) -> Vec<String> {
    let Some(text) = codex_item_text(item) else {
        return vec![];
    };
    vec![assistant_thinking_line(&text)]
}

fn map_agent_message_item(item: &Value) -> Vec<String> {
    let Some(text) = codex_item_text(item) else {
        return vec![];
    };
    vec![assistant_text_line(&text)]
}

fn map_error_item(item: &Value) -> Vec<String> {
    let message = extract_codex_error_text(item)
        .or_else(|| codex_item_text(item))
        .unwrap_or_else(|| "Codex 执行出错".to_string());
    vec![assistant_text_line(&message)]
}

fn map_command_execution_item(event_type: &str, item: &Value) -> Vec<String> {
    let id = codex_item_id(item);
    let command = item
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if command.is_empty() {
        return vec![];
    }
    let status = item
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("");
    let output = item
        .get("output")
        .or_else(|| item.get("aggregated_output"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let completed = event_type == "item.completed"
        || status.eq_ignore_ascii_case("completed")
        || status.eq_ignore_ascii_case("success");
    let failed = status.eq_ignore_ascii_case("failed") || status.eq_ignore_ascii_case("error");
    let in_progress = event_type == "item.updated"
        || status.eq_ignore_ascii_case("in_progress")
        || status.eq_ignore_ascii_case("running");

    if completed || failed {
        vec![assistant_tool_use_line(
            &id,
            "Bash",
            json!({ "command": command }),
            if failed { "error" } else { "completed" },
            output,
            if failed {
                output.map(str::to_string)
            } else {
                None
            },
        )]
    } else if in_progress && output.is_some() {
        vec![assistant_tool_use_line(
            &id,
            "Bash",
            json!({ "command": command }),
            "running",
            output,
            None,
        )]
    } else {
        vec![assistant_tool_use_line(
            &id,
            "Bash",
            json!({ "command": command }),
            "running",
            None,
            None,
        )]
    }
}

fn map_generic_item_summary(kind: &str, item: &Value) -> Vec<String> {
    let label = match kind {
        "mcp_tool_call" => "MCP 工具",
        "web_search" => "网页搜索",
        "file_change" => "文件变更",
        "plan_update" => "计划更新",
        _ => "Codex 步骤",
    };
    let detail = codex_item_text(item)
        .or_else(|| {
            item.get("command")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            item.get("query")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if detail.trim().is_empty() {
        vec![assistant_text_line(&format!("**{label}**"))]
    } else {
        vec![assistant_text_line(&format!("**{label}**\n\n{detail}"))]
    }
}

fn codex_item_kind(item: &Value) -> Option<&str> {
    item.get("item_type")
        .or_else(|| item.get("type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn codex_item_id(item: &Value) -> String {
    item.get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("codex-item-{}", uuid::Uuid::new_v4().simple()))
}

fn codex_item_text(item: &Value) -> Option<String> {
    for key in ["text", "message", "content", "summary"] {
        if let Some(text) = item.get(key).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 从 Codex 错误事件中递归提取可读错误文本。
///
/// 处理格式如 `{"error":{"message":"..."}}` 或 `{"error":{"data":{"message":"..."}}}`，
/// 比直接读顶层 `message` 字段更健壮（与 opencode 的 extract_opencode_error_text_inner 对应）。
const CODEX_ERROR_TEXT_MAX_DEPTH: usize = 4;

fn extract_codex_error_text_inner(value: &Value, depth: usize) -> Option<String> {
    if depth > CODEX_ERROR_TEXT_MAX_DEPTH {
        return None;
    }
    if let Some(s) = value.as_str() {
        let trimmed = s.trim();
        return if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    }
    let Some(obj) = value.as_object() else {
        return None;
    };
    for key in ["message", "error", "details", "reason", "text", "msg"] {
        if let Some(s) = obj.get(key).and_then(Value::as_str) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    for key in ["error", "message", "details", "reason", "data", "part", "cause"] {
        if let Some(inner) = obj.get(key) {
            if inner.is_object() {
                if let Some(text) = extract_codex_error_text_inner(inner, depth + 1) {
                    return Some(text);
                }
            }
        }
    }
    // 回退：error.name（如 APIError），仅在上述都失败时使用。
    if let Some(s) = obj.get("name").and_then(Value::as_str) {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

fn extract_codex_error_text(value: &Value) -> Option<String> {
    extract_codex_error_text_inner(value, 0)
}

/// 公开的提取入口（供 codex_commands 在 stdout 行处理时提前捕获错误文本）。
pub(crate) fn extract_codex_error_text_pub(value: &Value) -> Option<String> {
    extract_codex_error_text_inner(value, 0)
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
    fn maps_reasoning_item_completed_to_thinking() {
        let line = r#"{"type":"item.completed","item":{"id":"itm_1","item_type":"reasoning","text":"分析仓库结构"}}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains(r#""type":"thinking""#));
                assert!(lines[0].contains("分析仓库结构"));
            }
            other => panic!("expected stream lines, got {other:?}"),
        }
    }

    #[test]
    fn maps_agent_message_and_command_execution() {
        let agent = r#"{"type":"item.completed","item":{"id":"itm_2","type":"agent_message","text":"完成。"}}"#;
        match map_codex_exec_stdout_line(agent) {
            CodexStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains("完成。"));
            }
            other => panic!("{other:?}"),
        }

        let cmd = r#"{"type":"item.started","item":{"id":"itm_3","type":"command_execution","command":"ls","status":"in_progress"}}"#;
        match map_codex_exec_stdout_line(cmd) {
            CodexStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains(r#""name":"Bash""#));
                assert!(lines[0].contains(r#""status":"running""#));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_thread_started_to_codex_session_line() {
        let line = r#"{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains(r#""type":"codex_session""#));
                assert!(lines[0].contains("0199a213-81c0-7800-8aa1-bbab2a035a53"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn plain_non_json_line_stays_plain_text() {
        assert_eq!(
            map_codex_exec_stdout_line("hello"),
            CodexStdoutMap::PlainText
        );
    }

    #[test]
    fn maps_msg_envelope_reasoning() {
        let line = r#"{"msg":{"type":"reasoning","content":"逐步推理"},"timestamp":"2026-01-01T00:00:00Z"}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains("逐步推理"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_assistant_message_item_type() {
        let line = r#"{"type":"item.completed","item":{"id":"itm_4","item_type":"assistant_message","text":"你好。"}}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains("你好。"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_error_item_completed() {
        let line = r#"{"type":"item.completed","item":{"id":"itm_5","item_type":"error","text":"API key invalid"}}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert!(lines[0].contains("API key invalid"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_apply_patch_response_item_to_tool_use() {
        let line = r#"{"type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":"{\"command\":\"*** Begin Patch\\n*** Update File: src/foo.ts\\n@@\\n-old\\n+new\\n*** End Patch\"}","call_id":"call_1"}}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains(r#""name":"apply_patch""#));
                assert!(lines[0].contains(r#""file_path":"src/foo.ts""#));
                assert!(lines[0].contains("*** Begin Patch"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_update_plan_response_item_to_tool_use() {
        let line = r#"{"type":"response_item","payload":{"type":"function_call","name":"update_plan","arguments":"{\"plan\":[{\"status\":\"in_progress\",\"step\":\"读 spec\"}]}","call_id":"call_2"}}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains(r#""name":"update_plan""#));
                assert!(lines[0].contains("in_progress"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn maps_view_image_response_item_to_tool_use() {
        let line = r#"{"type":"response_item","payload":{"type":"function_call","name":"view_image","arguments":"{\"path\":\"/tmp/a.png\"}","call_id":"call_3"}}"#;
        match map_codex_exec_stdout_line(line) {
            CodexStdoutMap::StreamLines(lines) => {
                assert_eq!(lines.len(), 1);
                assert!(lines[0].contains(r#""name":"view_image""#));
                assert!(lines[0].contains("/tmp/a.png"));
            }
            other => panic!("{other:?}"),
        }
    }
}