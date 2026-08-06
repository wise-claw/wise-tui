//! Adapt OpenCode ACP `session/update` notifications into Claude-compatible stream JSON.

use serde_json::{json, Value};

use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_COMPLETE, CLAUDE_STREAM_EVENT_OUTPUT,
};

/// Map one OpenCode ACP notification into zero or more Claude-compatible stream lines.
///
/// Known `session/update` kinds (verified against opencode 1.18.4):
/// agent_thought_chunk / agent_message_chunk / tool_call / tool_call_update /
/// available_commands_update / usage_update.
pub fn adapt_opencode_acp_notification_to_stream_lines(
    method: &str,
    params: Option<&Value>,
    wise_session_id: &str,
) -> Vec<String> {
    let _ = wise_session_id;
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
        "tool_call" => map_tool_call(update, "running"),
        "tool_call_update" => map_tool_call_update(update),
        "available_commands_update" | "usage_update" | "session_info_update" => vec![],
        other => {
            if std::env::var("WISE_OPENCODE_ACP_DEBUG").ok().as_deref() == Some("1") {
                eprintln!("[opencode_acp] unhandled sessionUpdate: {other}");
            }
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

fn extract_locations(update: &Value) -> Option<Value> {
    let locs = update.get("locations")?.as_array()?;
    let mut out = Vec::new();
    for item in locs {
        let Some(path) = item
            .get("path")
            .or_else(|| item.get("file_path"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let mut loc = json!({ "path": path });
        if let Some(obj) = loc.as_object_mut() {
            if let Some(line) = item.get("line").and_then(|v| v.as_i64()) {
                obj.insert("line".to_string(), json!(line));
            }
            if let Some(end_line) = item
                .get("endLine")
                .or_else(|| item.get("end_line"))
                .and_then(|v| v.as_i64())
            {
                obj.insert("endLine".to_string(), json!(end_line));
            }
        }
        out.push(loc);
    }
    if out.is_empty() {
        None
    } else {
        Some(Value::Array(out))
    }
}

fn is_placeholder_tool_label(label: &str) -> bool {
    let t = label.trim();
    t.is_empty() || t.eq_ignore_ascii_case("tool") || t.eq_ignore_ascii_case("unknown")
}

fn map_tool_call(update: &Value, status: &str) -> Vec<String> {
    let tool_call_id = update
        .get("toolCallId")
        .or_else(|| update.get("tool_call_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool");
    // ACP patch semantics: omitted title/kind must NOT become fabricated "Tool",
    // otherwise tool_call_update overwrites a good earlier title on merge.
    let title_opt = update
        .get("title")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let title = title_opt.unwrap_or("");
    let kind = update
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let locations = extract_locations(update);
    let mut input = update
        .get("rawInput")
        .cloned()
        .or_else(|| update.get("input").cloned())
        .unwrap_or_else(|| json!({}));
    if !input.is_object() {
        input = json!({ "value": input });
    }
    if let Some(t) = title_opt {
        if !is_placeholder_tool_label(t) {
            if let Some(obj) = input.as_object_mut() {
                obj.entry("title".to_string())
                    .or_insert_with(|| Value::String(t.to_string()));
            }
        }
    }
    enrich_input_from_locations(&mut input, locations.as_ref());

    let name = map_tool_name(kind, title);
    let mut tool_use = json!({
        "type": "tool_use",
        "id": tool_call_id,
        "name": name,
        "input": input,
        "status": status,
    });
    if let Some(locs) = locations {
        if let Some(obj) = tool_use.as_object_mut() {
            obj.insert("locations".to_string(), locs);
        }
    }

    vec![json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [tool_use]
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
        let output = extract_tool_output_text(update).or_else(|| extract_raw_output_text(update));
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

fn extract_raw_output_text(update: &Value) -> Option<String> {
    let raw = update.get("rawOutput")?;
    if let Some(s) = raw.as_str() {
        let t = s.trim();
        return if t.is_empty() {
            None
        } else {
            Some(s.to_string())
        };
    }
    if raw.is_null() {
        return None;
    }
    Some(raw.to_string())
}

fn enrich_input_from_locations(input: &mut Value, locations: Option<&Value>) {
    let Some(obj) = input.as_object_mut() else {
        return;
    };
    let has_path = ["path", "file_path", "target_file", "target_directory"]
        .iter()
        .any(|k| {
            obj.get(*k)
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        });
    if has_path {
        return;
    }
    let Some(first_path) = locations
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("path"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    obj.insert("path".to_string(), Value::String(first_path.to_string()));
}

fn map_tool_name(kind: &str, title: &str) -> String {
    let k = kind.to_ascii_lowercase();
    match k.as_str() {
        "read" | "read_file" => "Read".to_string(),
        "edit" | "write" | "edit_file" | "write_file" => "Edit".to_string(),
        "delete" => "Delete".to_string(),
        "move" => "Move".to_string(),
        "execute" | "shell" | "bash" | "terminal" => "Bash".to_string(),
        "search" | "grep" => "Grep".to_string(),
        "list" | "glob" => "Glob".to_string(),
        "fetch" | "web_fetch" => "WebFetch".to_string(),
        "think" => "Think".to_string(),
        _ => {
            // Empty name lets frontend merge keep a previously good tool name when
            // tool_call_update omits title/kind (ACP patch semantics).
            if is_placeholder_tool_label(title) {
                String::new()
            } else {
                title.chars().take(48).collect()
            }
        }
    }
}

/// Bind line carrying the OpenCode ACP session id — the frontend stores it in
/// `session.claudeSessionId` via `extractOpencodeResumeSessionIdFromParsed`.
pub fn opencode_acp_bind_line(agent_id: &str) -> String {
    json!({
        "type": "opencode_session",
        "sessionId": agent_id,
    })
    .to_string()
}

pub fn opencode_acp_init_line(session_id: &str) -> String {
    json!({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
    })
    .to_string()
}

pub fn emit_opencode_acp_complete(
    app: &tauri::AppHandle,
    invocation_key: Option<&str>,
    session_id: &str,
    success: bool,
    opencode_session_id: Option<&str>,
) {
    let payload = json!({
        "session_id": session_id,
        "success": success,
        "opencodeSessionId": opencode_session_id,
    });
    emit_adapted_stream_payload(
        app,
        CLAUDE_STREAM_EVENT_COMPLETE,
        session_id,
        &payload,
        invocation_key,
    );
}

pub fn emit_opencode_acp_output_line(
    app: &tauri::AppHandle,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    emit_adapted_stream_payload(app, CLAUDE_STREAM_EVENT_OUTPUT, session_id, &line, invocation_key);
}

/// Map OpenCode ACP permission params into a Claude-like PermissionRequest payload for the Hub.
/// Option ids are `once` / `always` / `reject` (opencode), unlike Cursor's hyphenated ids.
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
    let options = params.get("options").cloned().unwrap_or_else(|| {
        json!([
            { "optionId": "once", "name": "允许一次", "kind": "allow_once" },
            { "optionId": "always", "name": "始终允许", "kind": "allow_always" },
            { "optionId": "reject", "name": "拒绝", "kind": "reject_once" },
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

/// Pick the best option id for auto-approve: prefer `always`/`allow-always`,
/// then `once`/`allow-once`, then any first option.
pub fn auto_approve_option_id(params: &Value) -> String {
    let options = params
        .get("options")
        .and_then(|o| o.as_array())
        .cloned()
        .unwrap_or_default();
    for needle in ["always", "allow-always", "allow_always", "once", "allow-once", "allow_once"] {
        if let Some(id) = options.iter().find_map(|opt| {
            let id = opt.get("optionId").and_then(|v| v.as_str())?;
            if id == needle {
                Some(id.to_string())
            } else {
                None
            }
        }) {
            return id;
        }
    }
    options
        .first()
        .and_then(|opt| opt.get("optionId").and_then(|v| v.as_str()))
        .unwrap_or("once")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_agent_message_chunk() {
        let params = json!({
            "sessionId": "s",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "messageId": "m1",
                "content": { "type": "text", "text": "hi" },
            }
        });
        let lines = adapt_opencode_acp_notification_to_stream_lines(
            "session/update",
            Some(&params),
            "tab",
        );
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""text":"hi""#));
    }

    #[test]
    fn maps_tool_call_update_completed() {
        let params = json!({
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "call_1",
                "status": "completed",
                "title": "echo hi",
                "kind": "execute",
                "content": [{ "type": "content", "content": { "type": "text", "text": "hi\n" } }],
            }
        });
        let lines = adapt_opencode_acp_notification_to_stream_lines(
            "session/update",
            Some(&params),
            "tab",
        );
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains(r#""name":"Bash""#));
        assert!(lines[1].contains(r#""type":"tool_result""#));
    }

    #[test]
    fn auto_approve_prefers_always() {
        let params = json!({
            "options": [
                { "optionId": "once", "kind": "allow_once" },
                { "optionId": "always", "kind": "allow_always" },
                { "optionId": "reject", "kind": "reject_once" },
            ]
        });
        assert_eq!(auto_approve_option_id(&params), "always");
    }

    #[test]
    fn bind_line_uses_opencode_session_type() {
        let line = opencode_acp_bind_line("ses_abc");
        assert!(line.contains(r#""type":"opencode_session""#));
        assert!(line.contains(r#""sessionId":"ses_abc""#));
    }
}
