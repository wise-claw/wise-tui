//! Adapt Codex App-Server `ServerNotification` events into the unified
//! Claude-compatible stream JSON that the Wise frontend already consumes
//! via `claude-output` / `claude-complete` Tauri events.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_COMPLETE, CLAUDE_STREAM_EVENT_OUTPUT,
};
use crate::codex_commands::strip_benign_noise;
use crate::codex_rpc_types::{ServerNotification, ServerRequest};

/// Per-turn adapt state so token deltas and `item/completed` snapshots do not double-paint.
#[derive(Debug, Default)]
pub struct CodexRpcStreamAdaptState {
    /// `agentMessage` item ids that already received non-whitespace deltas.
    streamed_agent_message_ids: HashSet<String>,
}

impl CodexRpcStreamAdaptState {
    fn note_agent_message_delta(&mut self, item_id: &str) {
        let id = item_id.trim();
        if !id.is_empty() {
            self.streamed_agent_message_ids.insert(id.to_string());
        }
    }

    fn take_agent_message_already_streamed(&mut self, item_id: &str, fallback_id: &str) -> bool {
        let primary = item_id.trim();
        let fallback = fallback_id.trim();
        if !primary.is_empty() && self.streamed_agent_message_ids.remove(primary) {
            return true;
        }
        if !fallback.is_empty() && fallback != primary {
            return self.streamed_agent_message_ids.remove(fallback);
        }
        false
    }
}

/// Split emit vs persist: token deltas must stream live but must not bloat JSONL.
#[derive(Debug, Default, Clone)]
pub struct CodexRpcAdaptOutput {
    pub emit: Vec<String>,
    pub persist: Vec<String>,
}

impl CodexRpcAdaptOutput {
    fn both(lines: Vec<String>) -> Self {
        Self {
            emit: lines.clone(),
            persist: lines,
        }
    }

    fn emit_only(lines: Vec<String>) -> Self {
        Self {
            emit: lines,
            persist: Vec::new(),
        }
    }

    fn split(emit: Vec<String>, persist: Vec<String>) -> Self {
        Self { emit, persist }
    }
}

/// Adapt a single [`ServerNotification`] into emit/persist stream lines.
pub fn adapt_notification_to_stream_lines(
    notification: &ServerNotification,
    session_id: &str,
    state: &mut CodexRpcStreamAdaptState,
) -> CodexRpcAdaptOutput {
    map_notification_to_stream_lines(notification, session_id, state)
}

/// Adapt a single [`ServerNotification`] and emit it to the frontend.
///
/// The produced JSON lines use the same envelope structure as
/// [`codex_stream_adapter`](crate::codex_stream_adapter) /
/// [`claude_events`](crate::claude_events), so the existing frontend
/// `claudeStreamParser.ts` can consume them without changes.
#[allow(dead_code)]
pub fn adapt_and_emit_notification(
    notification: &ServerNotification,
    app: &tauri::AppHandle,
    invocation_key: Option<&str>,
    session_id: &str,
    state: &mut CodexRpcStreamAdaptState,
) {
    let output = adapt_notification_to_stream_lines(notification, session_id, state);
    for line in output.emit {
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
    state: &mut CodexRpcStreamAdaptState,
) -> CodexRpcAdaptOutput {
    match notification {
        ServerNotification::ThreadStarted { thread } => {
            // Emit a codex_session marker so the frontend can track the session id.
            CodexRpcAdaptOutput::both(vec![serde_json::json!({
                "type": "codex_session",
                "sessionId": if thread.id.is_empty() { session_id } else { &thread.id },
            })
            .to_string()])
        }

        ServerNotification::ThreadClosed { .. } => CodexRpcAdaptOutput::default(),

        ServerNotification::TurnStarted { thread_id, .. } => {
            // Map to a system/init line so the frontend knows a new turn started.
            CodexRpcAdaptOutput::both(vec![json!({
                "type": "system",
                "subtype": "init",
                "session_id": if thread_id.is_empty() { session_id } else { thread_id },
            })
            .to_string()])
        }

        ServerNotification::TurnCompleted {
            status,
            error_message,
            ..
        } => {
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("errored")
                || status.eq_ignore_ascii_case("error");
            if failed {
                let detail = error_message
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(status.as_str());
                if let Some(cleaned) = strip_benign_noise(detail) {
                    CodexRpcAdaptOutput::both(vec![assistant_text_line(&format!(
                        "Codex error: {cleaned}"
                    ))])
                } else {
                    CodexRpcAdaptOutput::default()
                }
            } else {
                // Success completion is signalled via `claude-complete`.
                CodexRpcAdaptOutput::default()
            }
        }

        ServerNotification::ItemStarted { item, .. } => {
            CodexRpcAdaptOutput::both(map_item_started(item))
        }

        ServerNotification::ItemCompleted {
            item_id,
            item,
            ..
        } => {
            let is_agent_message = matches!(
                item.item_type.as_str(),
                "agentMessage" | "assistantMessage"
            );
            if is_agent_message
                && state.take_agent_message_already_streamed(item_id, &item.id)
            {
                // Deltas already painted the reply. Emit Claude `result` so the frontend
                // can reconcile formatting without appending a duplicate assistant bubble.
                // Persist the full assistant text once so disk hydrate still has Markdown.
                match extract_item_text(&item.raw) {
                    Some(text) if !text.trim().is_empty() => CodexRpcAdaptOutput::split(
                        vec![result_full_text_line(&text)],
                        vec![assistant_text_line(&text)],
                    ),
                    _ => CodexRpcAdaptOutput::default(),
                }
            } else {
                CodexRpcAdaptOutput::both(map_item_completed(item))
            }
        }

        ServerNotification::AgentMessageDelta { item_id, delta } => {
            // Pass deltas through verbatim. `strip_benign_noise` uses `str::lines()`, which
            // drops newline-only chunks and trailing `\n` — that flattens Markdown.
            // Do NOT persist token deltas: one turn can be 1000+ JSONL lines and a 320-line
            // tail reload then drops the leading user echo.
            if delta.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                if delta.chars().any(|c| !c.is_whitespace()) {
                    state.note_agent_message_delta(item_id);
                }
                CodexRpcAdaptOutput::emit_only(vec![assistant_text_line(delta)])
            }
        }

        ServerNotification::CommandExecutionOutputDelta { item_id, delta, stream: _ } => {
            if delta.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                // Live tool output only — completed commandExecution already persists aggregated output.
                CodexRpcAdaptOutput::emit_only(vec![assistant_tool_use_line(
                    item_id,
                    "Bash",
                    json!({}),
                    "running",
                    Some(delta),
                    None,
                )])
            }
        }

        ServerNotification::Error { message, .. } => {
            if let Some(cleaned) = strip_benign_noise(message) {
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&format!(
                    "Codex error: {cleaned}"
                ))])
            } else {
                CodexRpcAdaptOutput::default()
            }
        }

        ServerNotification::ServerRequestResolved { .. } => CodexRpcAdaptOutput::default(),

        ServerNotification::McpServerStatusUpdated { name, status, error } => {
            CodexRpcAdaptOutput::both(vec![json!({
                "type": "system",
                "subtype": "mcp_status",
                "server": name,
                "status": status,
                "error": error,
            })
            .to_string()])
        }

        ServerNotification::McpOAuthLoginCompleted { name, success, error } => {
            CodexRpcAdaptOutput::both(vec![json!({
                "type": "system",
                "subtype": "mcp_oauth_completed",
                "server": name,
                "success": success,
                "error": error,
            })
            .to_string()])
        }

        ServerNotification::Unknown { method, .. } => {
            // Log and skip — unknown notifications are not forwarded.
            eprintln!("[codex_rpc_stream] Unknown notification: {method}");
            CodexRpcAdaptOutput::default()
        }

        // --- Phase 4 notifications ---

        ServerNotification::CommandExecOutputDeltaNotification { process_id, stream: _, delta_base64, .. } => {
            if delta_base64.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                CodexRpcAdaptOutput::emit_only(vec![assistant_tool_use_line(
                    process_id,
                    "Bash",
                    json!({}),
                    "running",
                    Some(delta_base64),
                    None,
                )])
            }
        }

        ServerNotification::FsChanged { watch_id, changed_paths } => {
            CodexRpcAdaptOutput::both(vec![json!({
                "type": "system",
                "subtype": "fs_changed",
                "watch_id": watch_id,
                "changed_paths": changed_paths,
            })
            .to_string()])
        }

        // --- Phase 5 notifications ---

        ServerNotification::TurnPlanUpdated { thread_id: _, turn_id: _, plan } => {
            CodexRpcAdaptOutput::both(vec![json!({
                "type": "system",
                "subtype": "plan_updated",
                "plan": plan,
            })
            .to_string()])
        }

        ServerNotification::TurnDiffUpdated { thread_id: _, turn_id: _, diff } => {
            CodexRpcAdaptOutput::both(vec![json!({
                "type": "system",
                "subtype": "diff_updated",
                "diff": diff,
            })
            .to_string()])
        }
    }
}

// ---------------------------------------------------------------------------
// Item mapping helpers
// ---------------------------------------------------------------------------

fn map_item_started(item: &crate::codex_rpc_types::ThreadItem) -> Vec<String> {
    match item.item_type.as_str() {
        // userMessage / imageView：用户侧已持久化气泡；图片像素由 app-server 消费，会话列表不展示。
        "userMessage" | "imageView" | "image_view" => vec![],
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
        // 勿把 userMessage（含 localImage 回显）或 imageView 当成助手文本/工具卡片。
        "userMessage" | "imageView" | "image_view" => vec![],
        "agentMessage" | "assistantMessage" => {
            // Keep Markdown whitespace intact (do not run strip_benign_noise / lines()).
            match extract_item_text(&item.raw) {
                Some(text) if !text.trim().is_empty() => vec![assistant_text_line(&text)],
                _ => vec![],
            }
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

/// Claude stream-json `result` — authoritative full-turn text for frontend reconcile.
fn result_full_text_line(text: &str) -> String {
    json!({
        "type": "result",
        "result": text,
    })
    .to_string()
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
        // Stable wall-clock for disk hydrate / sidebar sort; missing ts used to become Date.now()
        // on every click and jump the session to the top of the workspace list.
        "timestamp": chrono::Utc::now().timestamp_millis(),
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

    fn adapt(
        notif: &ServerNotification,
        state: &mut CodexRpcStreamAdaptState,
    ) -> CodexRpcAdaptOutput {
        map_notification_to_stream_lines(notif, "sess-1", state)
    }

    #[test]
    fn agent_message_delta_emits_but_does_not_persist() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::AgentMessageDelta {
            item_id: "itm_1".to_string(),
            delta: "Hello world".to_string(),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""type":"text""#));
        assert!(out.emit[0].contains("Hello world"));
        assert!(
            out.persist.is_empty(),
            "token deltas must not bloat JSONL"
        );
    }

    #[test]
    fn turn_started_produces_init_line() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::TurnStarted {
            turn_id: "t1".to_string(),
            thread_id: "thread-abc".to_string(),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""subtype":"init""#));
        assert_eq!(out.persist.len(), 1);
    }

    #[test]
    fn turn_completed_produces_no_stream_lines() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::TurnCompleted {
            turn_id: "t1".to_string(),
            thread_id: "thread-abc".to_string(),
            status: "completed".to_string(),
            error_message: None,
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());
    }

    #[test]
    fn item_completed_agent_message_emits_text_without_prior_delta() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ItemCompleted {
            item_id: "itm_2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_2".to_string(),
                item_type: "agentMessage".to_string(),
                raw: json!({ "text": "Done." }),
            },
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("Done."));
        assert_eq!(out.persist, out.emit);
    }

    #[test]
    fn item_completed_agent_message_emits_result_after_deltas() {
        let mut state = CodexRpcStreamAdaptState::default();
        let delta = ServerNotification::AgentMessageDelta {
            item_id: "itm_2".to_string(),
            delta: "这是一张浅色主题的界面截图".to_string(),
        };
        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_2".to_string(),
                item_type: "agentMessage".to_string(),
                raw: json!({
                    "text": "这是一张浅色主题的界面截图\n\n左侧栏\n- 工作区仓库列表"
                }),
            },
        };
        let delta_out = adapt(&delta, &mut state);
        assert_eq!(delta_out.emit.len(), 1);
        assert!(delta_out.persist.is_empty());
        let completed_out = adapt(&completed, &mut state);
        assert_eq!(completed_out.emit.len(), 1);
        assert!(
            completed_out.emit[0].contains(r#""type":"result""#),
            "after deltas, completed must emit result: {}",
            completed_out.emit[0]
        );
        assert!(!completed_out.emit[0].contains(r#""type":"assistant""#));
        assert_eq!(completed_out.persist.len(), 1);
        assert!(
            completed_out.persist[0].contains(r#""type":"assistant""#),
            "disk must keep one assistant snapshot: {}",
            completed_out.persist[0]
        );
        assert!(completed_out.persist[0].contains("左侧栏"));
    }

    #[test]
    fn newline_delta_is_preserved_for_markdown() {
        let mut state = CodexRpcStreamAdaptState::default();
        let newline = ServerNotification::AgentMessageDelta {
            item_id: "itm_fmt".to_string(),
            delta: "\n\n".to_string(),
        };
        let out = adapt(&newline, &mut state);
        assert_eq!(out.emit.len(), 1, "newline-only delta must not be dropped");
        assert!(
            out.emit[0].contains("\\n\\n") || out.emit[0].contains("\n\n"),
            "stream line should retain paragraph breaks: {}",
            out.emit[0]
        );
        // Whitespace-only must not suppress completed body.
        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_fmt".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_fmt".to_string(),
                item_type: "agentMessage".to_string(),
                raw: json!({ "text": "## 左侧栏\n\n- 工作区" }),
            },
        };
        let completed_out = adapt(&completed, &mut state);
        assert_eq!(completed_out.emit.len(), 1);
        assert!(completed_out.emit[0].contains("左侧栏"));
        assert!(
            completed_out.emit[0].contains(r#""type":"assistant""#),
            "whitespace-only deltas must not force result path"
        );
    }

    #[test]
    fn multiline_delta_keeps_blank_line_paragraph_breaks() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::AgentMessageDelta {
            item_id: "itm_md".to_string(),
            delta: "标题\n\n- 列表项".to_string(),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(
            out.emit[0].contains("标题\\n\\n- 列表项") || out.emit[0].contains("标题\n\n- 列表项"),
            "paragraph break must survive adapt: {}",
            out.emit[0]
        );
    }

    #[test]
    fn item_started_command_execution_emits_tool_use() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ItemStarted {
            item_id: "itm_3".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_3".to_string(),
                item_type: "commandExecution".to_string(),
                raw: json!({ "command": "ls -la" }),
            },
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"Bash""#));
        assert!(out.emit[0].contains(r#""status":"running""#));
    }

    #[test]
    fn error_notification_emits_error_text() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::Error {
            code: -1,
            message: "API key invalid".to_string(),
            data: None,
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("API key invalid"));
    }

    #[test]
    fn empty_delta_produces_no_lines() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::AgentMessageDelta {
            item_id: "itm_4".to_string(),
            delta: "".to_string(),
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty());
    }

    #[test]
    fn user_message_and_image_view_items_are_not_streamed() {
        let mut state = CodexRpcStreamAdaptState::default();
        for item_type in ["userMessage", "imageView", "image_view"] {
            let started = ServerNotification::ItemStarted {
                item_id: "itm_img".to_string(),
                turn_id: "t1".to_string(),
                item: crate::codex_rpc_types::ThreadItem {
                    id: "itm_img".to_string(),
                    item_type: item_type.to_string(),
                    raw: json!({ "path": "/tmp/shot.png", "text": "hi" }),
                },
            };
            let completed = ServerNotification::ItemCompleted {
                item_id: "itm_img".to_string(),
                turn_id: "t1".to_string(),
                item: crate::codex_rpc_types::ThreadItem {
                    id: "itm_img".to_string(),
                    item_type: item_type.to_string(),
                    raw: json!({ "path": "/tmp/shot.png", "text": "hi" }),
                },
            };
            assert!(
                adapt(&started, &mut state).emit.is_empty(),
                "{item_type} started should be silent"
            );
            assert!(
                adapt(&completed, &mut state).emit.is_empty(),
                "{item_type} completed should be silent"
            );
        }
    }
}
