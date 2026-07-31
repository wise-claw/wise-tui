//! Adapt Codex App-Server `ServerNotification` events into the unified
//! Claude-compatible stream JSON that the Wise frontend already consumes
//! via `claude-output` / `claude-complete` Tauri events.

use serde_json::{json, Value};

use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_COMPLETE, CLAUDE_STREAM_EVENT_OUTPUT,
};
use crate::codex_commands::strip_benign_noise;
use crate::codex_rpc_types::{ServerNotification, ServerRequest};

/// Adapt a single [`ServerNotification`] and emit it to the frontend.
///
/// The produced JSON lines use the same envelope structure as
/// [`codex_stream_adapter`](crate::codex_stream_adapter) /
/// [`claude_events`](crate::claude_events), so the existing frontend
/// `claudeStreamParser.ts` can consume them without changes.
pub fn adapt_and_emit_notification(
    notification: &ServerNotification,
    app: &tauri::AppHandle,
    invocation_key: Option<&str>,
    session_id: &str,
) {
    let lines = map_notification_to_stream_lines(notification, session_id);
    for line in lines {
        emit_adapted_stream_payload(app, CLAUDE_STREAM_EVENT_OUTPUT, session_id, &line, invocation_key);
    }
}

/// Emit the `claude-complete` event signalling that the turn (or session) has finished.
pub fn emit_rpc_complete(
    app: &tauri::AppHandle,
    invocation_key: Option<&str>,
    session_id: &str,
    success: bool,
) {
    let payload = json!({
        "session_id": session_id,
        "success": success,
    });
    emit_adapted_stream_payload(app, CLAUDE_STREAM_EVENT_COMPLETE, session_id, &payload, invocation_key);
}

// ---------------------------------------------------------------------------
// Internal mapping
// ---------------------------------------------------------------------------

fn map_notification_to_stream_lines(
    notification: &ServerNotification,
    session_id: &str,
) -> Vec<String> {
    match notification {
        ServerNotification::ThreadStarted { thread } => {
            // Emit a codex_session marker so the frontend can track the session id.
            vec![serde_json::json!({
                "type": "codex_session",
                "sessionId": if thread.id.is_empty() { session_id } else { &thread.id },
            })
            .to_string()]
        }

        ServerNotification::ThreadClosed { .. } => {
            // No visual representation; skip.
            vec![]
        }

        ServerNotification::TurnStarted { thread_id, .. } => {
            // Map to a system/init line so the frontend knows a new turn started.
            vec![json!({
                "type": "system",
                "subtype": "init",
                "session_id": if thread_id.is_empty() { session_id } else { thread_id },
            })
            .to_string()]
        }

        ServerNotification::TurnCompleted { .. } => {
            // Completion is signalled via `claude-complete`, not stream lines.
            // The command loop handles the actual emit.
            vec![]
        }

        ServerNotification::ItemStarted { item, .. } => {
            map_item_started(item)
        }

        ServerNotification::ItemCompleted { item, .. } => {
            map_item_completed(item)
        }

        ServerNotification::AgentMessageDelta { delta, .. } => {
            if delta.is_empty() {
                vec![]
            } else if let Some(cleaned) = strip_benign_noise(delta) {
                vec![assistant_text_line(&cleaned)]
            } else {
                vec![]
            }
        }

        ServerNotification::CommandExecutionOutputDelta { item_id, delta, stream: _ } => {
            if delta.is_empty() {
                vec![]
            } else {
                // Emit the output delta as tool output for the running command item.
                vec![assistant_tool_use_line(
                    item_id,
                    "Bash",
                    json!({}),
                    "running",
                    Some(delta),
                    None,
                )]
            }
        }

        ServerNotification::Error { message, .. } => {
            if let Some(cleaned) = strip_benign_noise(message) {
                vec![assistant_text_line(&format!("Codex error: {cleaned}"))]
            } else {
                vec![]
            }
        }

        ServerNotification::ServerRequestResolved { .. } => {
            // Approval/request resolution is handled at the session layer; no stream output.
            vec![]
        }

        ServerNotification::McpServerStatusUpdated { name, status, error } => {
            vec![json!({
                "type": "system",
                "subtype": "mcp_status",
                "server": name,
                "status": status,
                "error": error,
            })
            .to_string()]
        }

        ServerNotification::McpOAuthLoginCompleted { name, success, error } => {
            vec![json!({
                "type": "system",
                "subtype": "mcp_oauth_completed",
                "server": name,
                "success": success,
                "error": error,
            })
            .to_string()]
        }

        ServerNotification::Unknown { method, .. } => {
            // Log and skip — unknown notifications are not forwarded.
            eprintln!("[codex_rpc_stream] Unknown notification: {method}");
            vec![]
        }

        // --- Phase 4 notifications ---

        ServerNotification::CommandExecOutputDeltaNotification { process_id, stream: _, delta_base64, .. } => {
            if delta_base64.is_empty() {
                vec![]
            } else {
                // Emit streamed command output as a tool output delta.
                vec![assistant_tool_use_line(
                    process_id,
                    "Bash",
                    json!({}),
                    "running",
                    Some(delta_base64),
                    None,
                )]
            }
        }

        ServerNotification::FsChanged { watch_id, changed_paths } => {
            vec![json!({
                "type": "system",
                "subtype": "fs_changed",
                "watch_id": watch_id,
                "changed_paths": changed_paths,
            })
            .to_string()]
        }

        // --- Phase 5 notifications ---

        ServerNotification::TurnPlanUpdated { thread_id: _, turn_id: _, plan } => {
            vec![json!({
                "type": "system",
                "subtype": "plan_updated",
                "plan": plan,
            })
            .to_string()]
        }

        ServerNotification::TurnDiffUpdated { thread_id: _, turn_id: _, diff } => {
            vec![json!({
                "type": "system",
                "subtype": "diff_updated",
                "diff": diff,
            })
            .to_string()]
        }
    }
}

// ---------------------------------------------------------------------------
// Item mapping helpers
// ---------------------------------------------------------------------------

fn map_item_started(item: &crate::codex_rpc_types::ThreadItem) -> Vec<String> {
    match item.item_type.as_str() {
        "agentMessage" | "assistantMessage" => {
            // Agent message started — no content yet; deltas will follow.
            vec![]
        }
        "commandExecution" => {
            let command = item
                .raw
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("");
            if command.is_empty() {
                vec![]
            } else {
                vec![assistant_tool_use_line(
                    &item.id,
                    "Bash",
                    json!({ "command": command }),
                    "running",
                    None,
                    None,
                )]
            }
        }
        "fileChange" => {
            let reason = item
                .raw
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                "FileChange",
                json!({ "reason": reason }),
                "running",
                None,
                None,
            )]
        }
        "mcpToolCall" => {
            let server = item
                .raw
                .get("server")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let tool = item
                .raw
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let name = format!("{server}:{tool}");
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                json!({}),
                "running",
                None,
                None,
            )]
        }
        "dynamicToolCall" => {
            let namespace = item
                .raw
                .get("namespace")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let tool = item
                .raw
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let name = format!("{namespace}:{tool}");
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                json!({}),
                "running",
                None,
                None,
            )]
        }
        other => {
            // Generic tool-like item start marker.
            vec![json!({
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": item.id,
                        "name": other,
                        "status": "running",
                    }]
                }
            })
            .to_string()]
        }
    }
}

fn map_item_completed(item: &crate::codex_rpc_types::ThreadItem) -> Vec<String> {
    match item.item_type.as_str() {
        "agentMessage" | "assistantMessage" => {
            let text = extract_item_text(&item.raw);
            text.and_then(|t| strip_benign_noise(&t))
                .map(|t| assistant_text_line(&t))
                .into_iter()
                .collect()
        }
        "reasoning" => {
            let text = extract_item_text(&item.raw);
            text.map(|t| assistant_thinking_line(&t)).into_iter().collect()
        }
        "commandExecution" => {
            let command = item
                .raw
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("");
            let status = item
                .raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let output = item
                .raw
                .get("output")
                .or_else(|| item.raw.get("aggregated_output"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            vec![assistant_tool_use_line(
                &item.id,
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
        }
        "fileChange" => {
            let status = item
                .raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let reason = item
                .raw
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("");
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            vec![assistant_tool_use_line(
                &item.id,
                "FileChange",
                json!({ "reason": reason }),
                if failed { "error" } else { "completed" },
                None,
                None,
            )]
        }
        "mcpToolCall" => {
            let server = item
                .raw
                .get("server")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let tool = item
                .raw
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let name = format!("{server}:{tool}");
            let status = item
                .raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                json!({}),
                if failed { "error" } else { "completed" },
                None,
                None,
            )]
        }
        "dynamicToolCall" => {
            let namespace = item
                .raw
                .get("namespace")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let tool = item
                .raw
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let name = format!("{namespace}:{tool}");
            let status = item
                .raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                json!({}),
                if failed { "error" } else { "completed" },
                None,
                None,
            )]
        }
        "error" => {
            let text = extract_item_text(&item.raw)
                .unwrap_or_else(|| "Codex 执行出错".to_string());
            match strip_benign_noise(&text) {
                Some(cleaned) => vec![assistant_text_line(&cleaned)],
                None => vec![],
            }
        }
        _ => {
            // For unknown item completions, try to extract text and emit as assistant text.
            let text = extract_item_text(&item.raw);
            text.and_then(|t| strip_benign_noise(&t))
                .map(|t| assistant_text_line(&t))
                .into_iter()
                .collect()
        }
    }
}

// ---------------------------------------------------------------------------
// JSON envelope helpers (mirror codex_stream_adapter.rs)
// ---------------------------------------------------------------------------

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

/// Emit a Tauri event for an approval request so the frontend can show a dialog.
pub fn emit_approval_request(
    app: &tauri::AppHandle,
    session_id: &str,
    request: &ServerRequest,
) {
    use tauri::Emitter;
    let payload = match request {
        ServerRequest::CommandExecutionRequestApproval { request_id, params } => {
            serde_json::json!({
                "session_id": session_id,
                "request_id": request_id,
                "type": "commandExecution",
                "command": params.command,
                "cwd": params.cwd,
                "reason": params.reason,
                "available_decisions": params.available_decisions,
            })
        }
        ServerRequest::FileChangeRequestApproval { request_id, params } => {
            serde_json::json!({
                "session_id": session_id,
                "request_id": request_id,
                "type": "fileChange",
                "reason": params.reason,
                "available_decisions": ["accept", "acceptForSession", "decline", "cancel"],
            })
        }
        ServerRequest::Unknown { request_id, method, .. } => {
            serde_json::json!({
                "session_id": session_id,
                "request_id": request_id,
                "type": "unknown",
                "method": method,
            })
        }
        // MCP elicitation requests are handled via emit_mcp_elicitation_request, not here.
        ServerRequest::McpServerElicitationRequest { request_id, .. } => {
            serde_json::json!({
                "session_id": session_id,
                "request_id": request_id,
                "type": "mcpElicitation",
            })
        }
        // Dynamic tool call requests are handled via emit_dynamic_tool_request, not here.
        ServerRequest::DynamicToolCall { request_id, .. } => {
            serde_json::json!({
                "session_id": session_id,
                "request_id": request_id,
                "type": "dynamicToolCall",
            })
        }
    };

    let _ = app.emit("codex-rpc:approval-request", payload);
}

/// Emit a Tauri event for an MCP elicitation request so the frontend can prompt the user.
pub fn emit_mcp_elicitation_request(
    app: &tauri::AppHandle,
    session_id: &str,
    request_id: u64,
    params: &crate::codex_rpc_types::McpElicitationParams,
) {
    use tauri::Emitter;
    let payload = serde_json::json!({
        "session_id": session_id,
        "request_id": request_id,
        "server_name": params.server_name,
        "thread_id": params.thread_id,
        "turn_id": params.turn_id,
        "message": params.message,
        "requested_schema": params.requested_schema,
    });
    let _ = app.emit("codex-rpc:mcp-elicitation-request", payload);
}

/// Emit a Tauri event for a dynamic tool call server request.
pub fn emit_dynamic_tool_request(
    app: &tauri::AppHandle,
    session_id: &str,
    request_id: u64,
    params: &crate::codex_rpc_types::DynamicToolCallRequestParams,
) {
    use tauri::Emitter;
    let payload = serde_json::json!({
        "session_id": session_id,
        "request_id": request_id,
        "thread_id": params.thread_id,
        "turn_id": params.turn_id,
        "item_id": params.item_id,
        "namespace": params.namespace,
        "tool": params.tool,
        "arguments": params.arguments,
    });
    let _ = app.emit("codex-rpc:dynamic-tool-request", payload);
}

/// Best-effort text extraction from a thread item's raw JSON.
fn extract_item_text(raw: &Value) -> Option<String> {
    for key in ["text", "message", "content", "summary"] {
        if let Some(s) = raw.get(key).and_then(Value::as_str) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_message_delta_produces_text_line() {
        let notif = ServerNotification::AgentMessageDelta {
            item_id: "itm_1".to_string(),
            delta: "Hello world".to_string(),
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""type":"text""#));
        assert!(lines[0].contains("Hello world"));
    }

    #[test]
    fn turn_started_produces_init_line() {
        let notif = ServerNotification::TurnStarted {
            turn_id: "t1".to_string(),
            thread_id: "thread-abc".to_string(),
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""subtype":"init""#));
    }

    #[test]
    fn turn_completed_produces_no_stream_lines() {
        let notif = ServerNotification::TurnCompleted {
            turn_id: "t1".to_string(),
            thread_id: "thread-abc".to_string(),
            status: "completed".to_string(),
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert!(lines.is_empty());
    }

    #[test]
    fn item_completed_agent_message_emits_text() {
        let notif = ServerNotification::ItemCompleted {
            item_id: "itm_2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_2".to_string(),
                item_type: "agentMessage".to_string(),
                raw: json!({ "text": "Done." }),
            },
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("Done."));
    }

    #[test]
    fn item_started_command_execution_emits_tool_use() {
        let notif = ServerNotification::ItemStarted {
            item_id: "itm_3".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_3".to_string(),
                item_type: "commandExecution".to_string(),
                raw: json!({ "command": "ls -la" }),
            },
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains(r#""name":"Bash""#));
        assert!(lines[0].contains(r#""status":"running""#));
    }

    #[test]
    fn error_notification_emits_error_text() {
        let notif = ServerNotification::Error {
            code: -1,
            message: "API key invalid".to_string(),
            data: None,
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("API key invalid"));
    }

    #[test]
    fn empty_delta_produces_no_lines() {
        let notif = ServerNotification::AgentMessageDelta {
            item_id: "itm_4".to_string(),
            delta: "".to_string(),
        };
        let lines = map_notification_to_stream_lines(&notif, "sess-1");
        assert!(lines.is_empty());
    }
}
