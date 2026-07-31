//! Adapt Cursor ACP `session/update` notifications into Claude-compatible stream JSON.

use serde_json::{json, Value};

use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_COMPLETE, CLAUDE_STREAM_EVENT_OUTPUT,
};

/// Map one ACP notification into zero or more Claude-compatible stream lines.
pub fn adapt_acp_notification_to_stream_lines(
    method: &str,
    params: Option<&Value>,
    wise_session_id: &str,
) -> Vec<String> {
    if method != "session/update" {
        return vec![];
    }
    let Some(params) = params else {
        return vec![];
    };
    let Some(update) = params.get("update") else {
        return vec![];
    };
    let Some(kind) = update.get("sessionUpdate").and_then(|v| v.as_str()) else {
        return vec![];
    };

    match kind {
        "agent_message_chunk" => map_text_chunk(update, "assistant"),
        "agent_thought_chunk" => map_thought_chunk(update),
        "user_message_chunk" => vec![],
        "tool_call" => map_tool_call(update, "running"),
        "tool_call_update" => map_tool_call_update(update),
        "available_commands_update" | "session_info_update" => vec![],
        "plan" => map_plan_update(update),
        other => {
            if std::env::var("WISE_CURSOR_ACP_DEBUG").ok().as_deref() == Some("1") {
                eprintln!("[cursor_acp] unhandled sessionUpdate: {other}");
            }
            let _ = wise_session_id;
            vec![]
        }
    }
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(t) = content.as_str() {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            return None;
        }
        return Some(t.to_string());
    }
    if content.get("type").and_then(|v| v.as_str()) == Some("text") {
        let t = content.get("text").and_then(|v| v.as_str())?;
        if t.is_empty() {
            return None;
        }
        return Some(t.to_string());
    }
    None
}

fn map_text_chunk(update: &Value, role: &str) -> Vec<String> {
    let Some(content) = update.get("content") else {
        return vec![];
    };
    let Some(text) = content_text(content) else {
        return vec![];
    };
    vec![json!({
        "type": "assistant",
        "message": {
            "role": role,
            "content": [{ "type": "text", "text": text }]
        }
    })
    .to_string()]
}

fn map_thought_chunk(update: &Value) -> Vec<String> {
    let Some(content) = update.get("content") else {
        return vec![];
    };
    let Some(text) = content_text(content) else {
        return vec![];
    };
    vec![json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{ "type": "thinking", "thinking": text }]
        }
    })
    .to_string()]
}

fn map_tool_call(update: &Value, status: &str) -> Vec<String> {
    let tool_call_id = update
        .get("toolCallId")
        .or_else(|| update.get("tool_call_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool");
    let title = update
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Tool");
    let kind = update
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let name = map_tool_name(kind, title);
    let input = update
        .get("rawInput")
        .cloned()
        .or_else(|| update.get("input").cloned())
        .unwrap_or_else(|| json!({ "title": title }));

    vec![json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{
                "type": "tool_use",
                "id": tool_call_id,
                "name": name,
                "input": input,
                "status": status,
            }]
        }
    })
    .to_string()]
}

fn map_tool_call_update(update: &Value) -> Vec<String> {
    let status = update
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("completed");
    let mapped_status = match status {
        "pending" | "in_progress" | "running" => "running",
        "failed" | "error" => "error",
        _ => "completed",
    };

    let mut lines = map_tool_call(update, mapped_status);

    // Emit tool_result when completed with content.
    if mapped_status == "completed" || mapped_status == "error" {
        let tool_call_id = update
            .get("toolCallId")
            .or_else(|| update.get("tool_call_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("tool");
        let output = extract_tool_output_text(update).or_else(|| {
            update
                .get("rawOutput")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

        if let Some(out) = output {
            lines.push(
                json!({
                    "type": "user",
                    "message": {
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": tool_call_id,
                            "content": out,
                            "is_error": mapped_status == "error",
                        }]
                    }
                })
                .to_string(),
            );
        }
    }
    lines
}

fn extract_tool_output_text(update: &Value) -> Option<String> {
    let content = update.get("content")?;
    if let Some(arr) = content.as_array() {
        let mut parts = Vec::new();
        for item in arr {
            if let Some(inner) = item.get("content") {
                if let Some(t) = content_text(inner) {
                    parts.push(t);
                }
            } else if let Some(t) = content_text(item) {
                parts.push(t);
            } else if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                parts.push(t.to_string());
            }
        }
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("\n"))
        }
    } else {
        content_text(content)
    }
}

fn map_tool_name(kind: &str, title: &str) -> String {
    let k = kind.to_ascii_lowercase();
    match k.as_str() {
        "read" | "read_file" => "Read".to_string(),
        "edit" | "write" | "edit_file" | "write_file" => "Edit".to_string(),
        "execute" | "shell" | "bash" | "terminal" => "Bash".to_string(),
        "search" | "grep" => "Grep".to_string(),
        "list" | "glob" => "Glob".to_string(),
        _ => {
            if title.is_empty() {
                "Tool".to_string()
            } else {
                // Keep a short stable name for UI grouping.
                title.chars().take(48).collect()
            }
        }
    }
}

fn map_plan_update(update: &Value) -> Vec<String> {
    let entries = update
        .get("entries")
        .cloned()
        .unwrap_or(Value::Array(vec![]));
    vec![json!({
        "type": "system",
        "subtype": "plan_update",
        "entries": entries,
    })
    .to_string()]
}

pub fn cursor_agent_bind_line(agent_id: &str) -> String {
    json!({
        "type": "cursor_agent",
        "agentId": agent_id,
    })
    .to_string()
}

pub fn cursor_acp_init_line(session_id: &str) -> String {
    json!({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
    })
    .to_string()
}

pub fn emit_acp_complete(
    app: &tauri::AppHandle,
    invocation_key: Option<&str>,
    session_id: &str,
    success: bool,
    cursor_agent_id: Option<&str>,
) {
    let payload = json!({
        "session_id": session_id,
        "success": success,
        "cursorAgentId": cursor_agent_id,
    });
    emit_adapted_stream_payload(
        app,
        CLAUDE_STREAM_EVENT_COMPLETE,
        session_id,
        &payload,
        invocation_key,
    );
}

pub fn emit_acp_output_line(
    app: &tauri::AppHandle,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    emit_adapted_stream_payload(app, CLAUDE_STREAM_EVENT_OUTPUT, session_id, &line, invocation_key);
}

/// Map ACP permission params into a Claude-like PermissionRequest payload for the Hub.
pub fn permission_event_payload(
    wise_session_id: &str,
    request_id: &str,
    params: &Value,
) -> Value {
    let tool_name = params
        .get("toolCall")
        .and_then(|t| t.get("title"))
        .and_then(|v| v.as_str())
        .or_else(|| params.get("title").and_then(|v| v.as_str()))
        .unwrap_or("Tool");
    let description = params
        .get("toolCall")
        .and_then(|t| t.get("rawInput"))
        .map(|v| v.to_string())
        .or_else(|| {
            params
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    let options = params
        .get("options")
        .cloned()
        .unwrap_or_else(|| {
            json!([
                { "optionId": "allow-once", "name": "允许一次", "kind": "allow_once" },
                { "optionId": "allow-always", "name": "始终允许", "kind": "allow_always" },
                { "optionId": "reject-once", "name": "拒绝", "kind": "reject_once" },
            ])
        });

    json!({
        "sessionId": wise_session_id,
        "requestId": request_id,
        "toolName": tool_name,
        "description": description,
        "options": options,
        "raw": params,
    })
}

pub fn ask_question_event_payload(
    wise_session_id: &str,
    request_id: &str,
    params: &Value,
) -> Value {
    json!({
        "sessionId": wise_session_id,
        "requestId": request_id,
        "title": params.get("title").cloned().unwrap_or(Value::Null),
        "questions": params.get("questions").cloned().unwrap_or(Value::Array(vec![])),
        "toolCallId": params.get("toolCallId").cloned().unwrap_or(Value::Null),
        "raw": params,
    })
}

pub fn create_plan_event_payload(
    wise_session_id: &str,
    request_id: &str,
    params: &Value,
) -> Value {
    json!({
        "sessionId": wise_session_id,
        "requestId": request_id,
        "name": params.get("name").cloned().unwrap_or(Value::Null),
        "overview": params.get("overview").cloned().unwrap_or(Value::Null),
        "plan": params.get("plan").cloned().unwrap_or(Value::Null),
        "todos": params.get("todos").cloned().unwrap_or(Value::Array(vec![])),
        "raw": params,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_agent_message_chunk() {
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "pong" }
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("pong"));
        assert!(lines[0].contains("assistant"));
    }

    #[test]
    fn maps_thought_chunk() {
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "agent_thought_chunk",
                "content": { "type": "text", "text": "thinking..." }
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("thinking"));
    }

    #[test]
    fn maps_tool_call() {
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "tc1",
                "title": "Reading file",
                "kind": "read",
                "rawInput": { "path": "a.rs" }
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("tool_use"));
        assert!(lines[0].contains("Read"));
        assert!(lines[0].contains("tc1"));
    }

    #[test]
    fn skips_available_commands() {
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "available_commands_update",
                "availableCommands": []
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert!(lines.is_empty());
    }
}
