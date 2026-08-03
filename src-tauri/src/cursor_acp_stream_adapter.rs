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
    let _ = wise_session_id;
    if method == "cursor/task" {
        return map_cursor_task(params);
    }
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
    // Only inject title when the update actually carried one (never invent "Tool").
    if let Some(t) = title_opt {
        if !is_placeholder_tool_label(t) {
            if let Some(obj) = input.as_object_mut() {
                obj.entry("title".to_string())
                    .or_insert_with(|| Value::String(t.to_string()));
            }
        }
    }
    // When rawInput is empty, surface first location path so UI can show a file subtitle.
    enrich_input_from_locations(&mut input, locations.as_ref());

    let name = map_tool_name(kind, title, &input);
    let progress_output = if status == "running" || status == "pending" {
        extract_tool_output_text(update)
    } else {
        None
    };

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
    if let Some(out) = progress_output {
        if let Some(obj) = tool_use.as_object_mut() {
            obj.insert("output".to_string(), Value::String(out));
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

fn input_looks_like_task(input: &Value) -> bool {
    let Some(obj) = input.as_object() else {
        return false;
    };
    let has_subagent = obj
        .get("subagent_type")
        .or_else(|| obj.get("subagentType"))
        .or_else(|| obj.get("agent_type"))
        .map(|v| match v {
            Value::String(s) => !s.trim().is_empty(),
            Value::Object(_) => true,
            _ => false,
        })
        .unwrap_or(false);
    if has_subagent {
        return true;
    }
    let has_description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let has_prompt = obj
        .get("prompt")
        .or_else(|| obj.get("instructions"))
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    has_description && has_prompt
}

fn title_looks_like_task(title: &str) -> bool {
    let t = title.trim();
    if t.is_empty() {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    lower.ends_with("explorer")
        || lower.contains("subagent")
        || t.contains("子代理")
        || t.contains("Explorer")
}

fn normalize_subagent_type(raw: &Value) -> Option<String> {
    if let Some(s) = raw.as_str() {
        let t = s.trim();
        return if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        };
    }
    if let Some(obj) = raw.as_object() {
        if let Some(custom) = obj.get("custom").and_then(|v| v.as_str()) {
            let t = custom.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// Cursor extension `cursor/task` → assistant Task tool_use.
pub fn map_cursor_task(params: Option<&Value>) -> Vec<String> {
    let Some(params) = params else {
        return vec![];
    };
    let tool_call_id = params
        .get("toolCallId")
        .or_else(|| params.get("tool_call_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("task");
    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let prompt = params
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let model = params
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let agent_id = params
        .get("agentId")
        .or_else(|| params.get("agent_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let subagent_type = params
        .get("subagentType")
        .or_else(|| params.get("subagent_type"))
        .and_then(normalize_subagent_type);

    let mut input = json!({
        "description": description,
        "prompt": prompt,
        "title": if description.is_empty() { "Task" } else { description },
    });
    if let Some(obj) = input.as_object_mut() {
        if let Some(st) = subagent_type {
            obj.insert("subagent_type".to_string(), Value::String(st));
        }
        if let Some(m) = model {
            obj.insert("model".to_string(), Value::String(m.to_string()));
        }
        if let Some(aid) = agent_id {
            obj.insert("agentId".to_string(), Value::String(aid.to_string()));
        }
    }

    vec![json!({
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [{
                "type": "tool_use",
                "id": tool_call_id,
                "name": "Task",
                "input": input,
                "status": "running",
            }]
        }
    })
    .to_string()]
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

fn map_tool_name(kind: &str, title: &str, input: &Value) -> String {
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
            if input_looks_like_task(input) || title_looks_like_task(title) {
                return "Task".to_string();
            }
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
        assert!(lines[0].contains("Reading file"));
    }

    #[test]
    fn maps_tool_call_locations() {
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc-exp",
                "title": "审计源↔产物差异 Explorer",
                "kind": "other",
                "status": "in_progress",
                "rawInput": {
                    "description": "审计源↔产物差异",
                    "prompt": "compare modules",
                    "subagent_type": "explore"
                },
                "locations": [
                    { "path": "src/index.tsx", "line": 1, "endLine": 239 },
                    { "path": "src/EditTable.tsx", "line": 1 }
                ]
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("\"name\":\"Task\""));
        assert!(lines[0].contains("locations"));
        assert!(lines[0].contains("index.tsx"));
        assert!(lines[0].contains("endLine"));
    }

    #[test]
    fn tool_call_update_without_title_does_not_fabricate_tool_placeholder() {
        // ACP patch: updates often omit title/kind/rawInput. Fabricating title="Tool"
        // used to overwrite a good earlier title on frontend merge ("Tool · Tool").
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tc1",
                "status": "completed",
                "content": [
                    {
                        "type": "content",
                        "content": { "type": "text", "text": "found 3 files" }
                    }
                ]
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert!(!lines.is_empty());
        let tool_use = &lines[0];
        assert!(tool_use.contains("\"name\":\"\"") || !tool_use.contains("\"name\":\"Tool\""));
        assert!(!tool_use.contains("\"title\":\"Tool\""));
        assert!(tool_use.contains("found 3 files") || lines.len() > 1);
    }

    #[test]
    fn tool_call_locations_enrich_empty_input_path() {
        let params = json!({
            "sessionId": "s1",
            "update": {
                "sessionUpdate": "tool_call",
                "toolCallId": "tc-loc",
                "title": "Reading configuration",
                "kind": "read",
                "locations": [{ "path": "/home/user/project/src/main.py", "line": 42 }]
            }
        });
        let lines = adapt_acp_notification_to_stream_lines("session/update", Some(&params), "tab1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("\"name\":\"Read\""));
        assert!(lines[0].contains("main.py"));
        assert!(lines[0].contains("\"path\""));
    }

    #[test]
    fn maps_cursor_task_explore() {
        let params = json!({
            "toolCallId": "call_126",
            "description": "Explore codebase",
            "prompt": "Find auth handlers",
            "subagentType": "explore",
            "model": "composer-2"
        });
        let lines = adapt_acp_notification_to_stream_lines("cursor/task", Some(&params), "tab1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("\"name\":\"Task\""));
        assert!(lines[0].contains("call_126"));
        assert!(lines[0].contains("subagent_type"));
        assert!(lines[0].contains("explore"));
        assert!(lines[0].contains("Explore codebase"));
    }

    #[test]
    fn maps_cursor_task_custom_subagent_type() {
        let params = json!({
            "toolCallId": "call_custom",
            "description": "Custom agent",
            "prompt": "do work",
            "subagentType": { "custom": "trellis-research" }
        });
        let lines = map_cursor_task(Some(&params));
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("trellis-research"));
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
