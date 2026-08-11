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
    /// `reasoning` / `plan` item ids whose deltas already streamed live.
    /// On `item/completed` these fall back to persist-only to avoid double paint.
    streamed_thinking_ids: HashSet<String>,
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

    fn note_thinking_delta(&mut self, item_id: &str) {
        let id = item_id.trim();
        if !id.is_empty() {
            self.streamed_thinking_ids.insert(id.to_string());
        }
    }

    fn take_thinking_already_streamed(&mut self, item_id: &str) -> bool {
        let id = item_id.trim();
        !id.is_empty() && self.streamed_thinking_ids.remove(id)
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
            } else if matches!(item.item_type.as_str(), "reasoning" | "plan")
                && state.take_thinking_already_streamed(item_id)
            {
                // 推理/计划 deltas 已直播；completed 仅持久化完整内容，避免重复绘制。
                CodexRpcAdaptOutput::split(vec![], map_item_completed(item))
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

        ServerNotification::ProcessOutputDeltaNotification {
            process_id,
            stream: _,
            delta_base64,
            cap_reached: _,
        } => {
            // `process/spawn` 与 `command/exec` 共用 Bash 实时输出流。
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

        ServerNotification::ProcessExited {
            process_id,
            exit_code,
            stdout,
            stderr,
        } => {
            let output = [stdout.trim(), stderr.trim()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            let output = if output.is_empty() { None } else { Some(output) };
            CodexRpcAdaptOutput::both(vec![assistant_tool_use_line(
                process_id,
                "Bash",
                json!({ "exit_code": exit_code }),
                if *exit_code == 0 { "completed" } else { "error" },
                output.as_deref(),
                if *exit_code == 0 { None } else { Some(format!("exit code {exit_code}")) },
            )])
        }

        ServerNotification::ReasoningTextDelta { item_id, delta } => {
            if delta.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                if delta.chars().any(|c| !c.is_whitespace()) {
                    state.note_thinking_delta(item_id);
                }
                // 推理增量只直播不落盘：completed 时持久化完整内容，避免 JSONL 膨胀。
                CodexRpcAdaptOutput::emit_only(vec![assistant_thinking_line(delta)])
            }
        }

        ServerNotification::PlanDelta { item_id, delta } => {
            if delta.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                if delta.chars().any(|c| !c.is_whitespace()) {
                    state.note_thinking_delta(item_id);
                }
                CodexRpcAdaptOutput::emit_only(vec![assistant_thinking_line(delta)])
            }
        }

        ServerNotification::FileChangePatchUpdated { item_id, changes } => {
            // 补丁实时更新：复用 map_file_change_changes 以 running 状态刷出变更文件卡。
            let raw = json!({ "changes": changes });
            CodexRpcAdaptOutput::emit_only(map_file_change_changes(item_id, &raw, "running"))
        }

        ServerNotification::Warning { message, .. } => {
            if message.trim().is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&format!(
                    "Codex 警告：{message}"
                ))])
            }
        }

        ServerNotification::ThreadCompacted { .. } => CodexRpcAdaptOutput::both(vec![
            assistant_text_line("Codex 上下文已压缩，后续对话将基于压缩后的上下文继续。"),
        ]),

        // --- Phase 5 notifications ---

        ServerNotification::TurnPlanUpdated { thread_id: _, turn_id: _, plan } => {
            // `plan` 是 `TurnPlanStep[]`；格式化为可读计划文本并以 thinking 卡展示，
            // 前端 reasoning 块可折叠查看。缺失时保持原有 system 行兼容。
            match plan.as_ref().and_then(format_turn_plan_steps) {
                Some(text) if !text.trim().is_empty() => {
                    CodexRpcAdaptOutput::both(vec![assistant_thinking_line(&text)])
                }
                _ => CodexRpcAdaptOutput::both(vec![json!({
                    "type": "system",
                    "subtype": "plan_updated",
                    "plan": plan,
                })
                .to_string()]),
            }
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

/// 将 `turn/plan/updated` 的 `TurnPlanStep[]` 格式化为可读计划文本。
/// 兼容旧版字符串 plan；无法解析时返回 `None`。
fn format_turn_plan_steps(plan: &Value) -> Option<String> {
    if let Some(text) = plan.as_str() {
        return Some(text.to_string());
    }
    let steps = plan.as_array()?;
    let mut lines = Vec::new();
    for step in steps {
        let Some(obj) = step.as_object() else {
            continue;
        };
        let step_text = obj
            .get("step")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if step_text.is_empty() {
            continue;
        }
        let status = obj
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();
        let status_label = match status.as_str() {
            "in_progress" | "inprogress" => "进行中",
            "completed" | "done" => "完成",
            "pending" | "todo" => "待处理",
            "failed" | "error" => "失败",
            _ => "",
        };
        let prefix = if status_label.is_empty() {
            "• ".to_string()
        } else {
            format!("• [{status_label}] ")
        };
        lines.push(format!("{prefix}{step_text}"));
    }
    if lines.is_empty() {
        None
    } else {
        Some(format!("计划：\n{}", lines.join("\n")))
    }
}

/// 从 MCP `result.content[]` 提取文本；无法提取时回落 JSON 序列化。
fn mcp_result_text(result: &Value) -> Option<String> {
    if let Some(content) = result.get("content").and_then(Value::as_array) {
        let text = content
            .iter()
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| item.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return Some(text);
        }
    }
    let s = result.to_string();
    if s.is_empty() || s == "null" {
        None
    } else {
        Some(s)
    }
}

/// 将 RPC `fileChange` item 的 `changes[]`（path + kind + diff）映射为 `apply_patch`
/// 工具卡片，前端据此渲染文件编辑预览并在轮末汇总「变更文件」。
///
/// 每个 change 用独立 id（`{item_id}:{idx}`）展开为一张卡片，started/completed
/// 事件同 id 复用，前端按 id 合并状态。无 `changes` 时退回占位卡，避免丢信息。
fn map_file_change_changes(item_id: &str, raw: &Value, status: &str) -> Vec<String> {
    let Some(changes) = raw.get("changes").and_then(Value::as_array) else {
        let reason = raw.get("reason").and_then(Value::as_str).unwrap_or("");
        return vec![assistant_tool_use_line(
            item_id,
            "FileChange",
            json!({ "reason": reason }),
            status,
            None,
            None,
        )];
    };

    let mut lines = Vec::new();
    for (idx, change) in changes.iter().enumerate() {
        let Some(obj) = change.as_object() else {
            continue;
        };
        let path = obj
            .get("path")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if path.is_empty() {
            continue;
        }
        let patch = obj.get("diff").and_then(Value::as_str).unwrap_or("");
        lines.push(assistant_tool_use_line(
            &format!("{item_id}:{idx}"),
            "apply_patch",
            json!({
                "file_path": path,
                "patch": patch,
                "kind": obj.get("kind"),
            }),
            status,
            None,
            None,
        ));
    }

    if lines.is_empty() {
        // 没有可解析的 changes 时仍给出一张占位卡，保持「有工具活动」的可见性。
        lines.push(assistant_tool_use_line(
            item_id,
            "FileChange",
            json!({}),
            status,
            None,
            None,
        ));
    }
    lines
}

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
            let cwd = item
                .raw
                .get("cwd")
                .and_then(Value::as_str)
                .unwrap_or("");
            if command.is_empty() {
                vec![]
            } else {
                vec![assistant_tool_use_line(
                    &item.id,
                    "Bash",
                    json!({ "command": command, "cwd": cwd }),
                    "running",
                    None,
                    None,
                )]
            }
        }
        "fileChange" => map_file_change_changes(&item.id, &item.raw, "running"),
        // 计划 / hook 提示在 completed 时输出；started 静默避免空卡。
        "plan" | "hookPrompt" => vec![],
        "webSearch" => {
            let query = item
                .raw
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("");
            let action = item
                .raw
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                "web_search",
                json!({ "query": query, "action": action }),
                "running",
                None,
                None,
            )]
        }
        "subAgentActivity" => {
            let agent_path = item
                .raw
                .get("agentPath")
                .or_else(|| item.raw.get("agent_path"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let kind = item
                .raw
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                "subagent_activity",
                json!({
                    "agent_path": agent_path,
                    "kind": kind,
                    "description": if agent_path.is_empty() {
                        "子代理活动".to_string()
                    } else if kind.is_empty() {
                        format!("子代理 {agent_path}")
                    } else {
                        format!("子代理 {agent_path}（{kind}）")
                    },
                }),
                "running",
                None,
                None,
            )]
        }
        "collabAgentToolCall" => {
            let tool = item
                .raw
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("collab_agent");
            let prompt = item
                .raw
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                &format!("collab_{tool}"),
                json!({
                    "prompt": prompt,
                    "description": format!("协作代理调用：{tool}"),
                }),
                "running",
                None,
                None,
            )]
        }
        "imageGeneration" => {
            let revised_prompt = item
                .raw
                .get("revisedPrompt")
                .or_else(|| item.raw.get("revised_prompt"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let saved_path = item
                .raw
                .get("savedPath")
                .or_else(|| item.raw.get("saved_path"))
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                "image_generation",
                json!({
                    "revised_prompt": revised_prompt,
                    "saved_path": saved_path,
                    "description": if saved_path.is_empty() {
                        "生成图片".to_string()
                    } else {
                        format!("生成图片 → {saved_path}")
                    },
                }),
                "running",
                None,
                None,
            )]
        }
        "sleep" => {
            let duration_ms = item
                .raw
                .get("durationMs")
                .or_else(|| item.raw.get("duration_ms"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            vec![assistant_tool_use_line(
                &item.id,
                "sleep",
                json!({
                    "duration_ms": duration_ms,
                    "description": format!("睡眠 {} 秒", duration_ms / 1000),
                }),
                "running",
                None,
                None,
            )]
        }
        // 状态切换类 item：completed 时以文本提示。
        "enteredReviewMode" | "exitedReviewMode" | "contextCompaction" => vec![],
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
            let input = item
                .raw
                .get("arguments")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                input,
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
            let input = item
                .raw
                .get("arguments")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                input,
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
        "plan" => {
            // 计划文本以 thinking 块展示（前端可折叠查看）。
            let text = extract_item_text(&item.raw);
            text.map(|t| assistant_thinking_line(&t)).into_iter().collect()
        }
        "hookPrompt" => vec![],
        "commandExecution" => {
            let command = item
                .raw
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("");
            let cwd = item
                .raw
                .get("cwd")
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
            let exit_code = item
                .raw
                .get("exitCode")
                .or_else(|| item.raw.get("exit_code"));
            vec![assistant_tool_use_line(
                &item.id,
                "Bash",
                json!({ "command": command, "cwd": cwd, "exit_code": exit_code }),
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
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            map_file_change_changes(
                &item.id,
                &item.raw,
                if failed { "error" } else { "completed" },
            )
        }
        "webSearch" => {
            let query = item
                .raw
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("");
            let action = item
                .raw
                .get("action")
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                "web_search",
                json!({ "query": query, "action": action }),
                "completed",
                None,
                None,
            )]
        }
        "subAgentActivity" => {
            let agent_path = item
                .raw
                .get("agentPath")
                .or_else(|| item.raw.get("agent_path"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let kind = item
                .raw
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("");
            vec![assistant_tool_use_line(
                &item.id,
                "subagent_activity",
                json!({
                    "agent_path": agent_path,
                    "kind": kind,
                    "description": if agent_path.is_empty() {
                        "子代理活动".to_string()
                    } else if kind.is_empty() {
                        format!("子代理 {agent_path}")
                    } else {
                        format!("子代理 {agent_path}（{kind}）")
                    },
                }),
                "completed",
                None,
                None,
            )]
        }
        "collabAgentToolCall" => {
            let tool = item
                .raw
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("collab_agent");
            let prompt = item
                .raw
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("");
            let status = item
                .raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            vec![assistant_tool_use_line(
                &item.id,
                &format!("collab_{tool}"),
                json!({
                    "prompt": prompt,
                    "description": format!("协作代理调用：{tool}"),
                }),
                if failed { "error" } else { "completed" },
                None,
                if failed {
                    Some(format!("协作代理调用失败：{tool}"))
                } else {
                    None
                },
            )]
        }
        "imageGeneration" => {
            let revised_prompt = item
                .raw
                .get("revisedPrompt")
                .or_else(|| item.raw.get("revised_prompt"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let saved_path = item
                .raw
                .get("savedPath")
                .or_else(|| item.raw.get("saved_path"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let status = item
                .raw
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            let failed = status.eq_ignore_ascii_case("failed")
                || status.eq_ignore_ascii_case("error");
            vec![assistant_tool_use_line(
                &item.id,
                "image_generation",
                json!({
                    "revised_prompt": revised_prompt,
                    "saved_path": saved_path,
                    "description": if saved_path.is_empty() {
                        "生成图片".to_string()
                    } else {
                        format!("生成图片 → {saved_path}")
                    },
                }),
                if failed { "error" } else { "completed" },
                None,
                if failed {
                    Some("图片生成失败".to_string())
                } else {
                    None
                },
            )]
        }
        "sleep" => {
            let duration_ms = item
                .raw
                .get("durationMs")
                .or_else(|| item.raw.get("duration_ms"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            vec![assistant_tool_use_line(
                &item.id,
                "sleep",
                json!({
                    "duration_ms": duration_ms,
                    "description": format!("睡眠 {} 秒", duration_ms / 1000),
                }),
                "completed",
                None,
                None,
            )]
        }
        "enteredReviewMode" => vec![assistant_text_line("Codex 已进入代码评审模式。")],
        "exitedReviewMode" => vec![assistant_text_line("Codex 已退出代码评审模式。")],
        "contextCompaction" => vec![assistant_text_line(
            "Codex 上下文已压缩，后续对话将基于压缩后的上下文继续。",
        )],
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
            let input = item
                .raw
                .get("arguments")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let output = item
                .raw
                .get("result")
                .and_then(mcp_result_text)
                .filter(|s| !s.is_empty());
            let error = item
                .raw
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|s| !s.is_empty());
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                input,
                if failed { "error" } else { "completed" },
                output.as_deref(),
                if failed { error } else { None },
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
            let input = item
                .raw
                .get("arguments")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or_else(|| json!({}));
            let output = item
                .raw
                .get("contentItems")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .filter(|s| !s.is_empty());
            vec![assistant_tool_use_line(
                &item.id,
                &name,
                input,
                if failed { "error" } else { "completed" },
                output.as_deref(),
                if failed { Some("动态工具调用失败".to_string()) } else { None },
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
        // reasoning 的 content/summary 是字符串数组；逐段拼接（保留段间换行）。
        if let Some(arr) = raw.get(key).and_then(Value::as_array) {
            let parts: Vec<&str> = arr
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect();
            if !parts.is_empty() {
                return Some(parts.join("\n"));
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
    fn file_change_item_emits_apply_patch_cards_with_paths() {
        let mut state = CodexRpcStreamAdaptState::default();
        let raw = json!({
            "status": "completed",
            "changes": [
                {
                    "path": "/tmp/repo/src/a.ts",
                    "kind": { "type": "update", "move_path": null },
                    "diff": "@@ -1,3 +1,4 @@\n-old\n+new\n same"
                },
                {
                    "path": "/tmp/repo/README.md",
                    "kind": { "type": "add" },
                    "diff": "+# Hello"
                }
            ]
        });
        let started = ServerNotification::ItemStarted {
            item_id: "itm_fc".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_fc".to_string(),
                item_type: "fileChange".to_string(),
                raw: raw.clone(),
            },
        };
        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_fc".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_fc".to_string(),
                item_type: "fileChange".to_string(),
                raw,
            },
        };

        let started_out = adapt(&started, &mut state);
        assert_eq!(started_out.emit.len(), 2, "one apply_patch card per change");
        assert!(started_out.emit[0].contains(r#""name":"apply_patch""#));
        assert!(started_out.emit[0].contains(r#""file_path":"/tmp/repo/src/a.ts""#));
        assert!(started_out.emit[0].contains(r#""status":"running""#));
        assert!(started_out.emit[1].contains(r#""file_path":"/tmp/repo/README.md""#));

        let completed_out = adapt(&completed, &mut state);
        assert_eq!(completed_out.emit.len(), 2);
        assert!(completed_out.emit[0].contains(r#""status":"completed""#));
        assert!(
            completed_out.emit[0].contains("itm_fc:0"),
            "same id as started so frontend can merge"
        );
    }

    #[test]
    fn file_change_item_without_changes_falls_back_to_placeholder() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ItemCompleted {
            item_id: "itm_fc2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_fc2".to_string(),
                item_type: "fileChange".to_string(),
                raw: json!({ "status": "completed" }),
            },
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"FileChange""#));
        assert!(out.emit[0].contains(r#""status":"completed""#));
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

    #[test]
    fn reasoning_delta_streams_live_then_completed_persists_only() {
        let mut state = CodexRpcStreamAdaptState::default();
        let delta = ServerNotification::ReasoningTextDelta {
            item_id: "itm_r".to_string(),
            delta: "先分析需求".to_string(),
        };
        let out = adapt(&delta, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""type":"thinking""#));
        assert!(out.emit[0].contains("先分析需求"));
        assert!(out.persist.is_empty(), "reasoning deltas must not persist");

        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_r".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_r".to_string(),
                item_type: "reasoning".to_string(),
                raw: json!({ "content": ["先分析需求，再写代码。"] }),
            },
        };
        let out = adapt(&completed, &mut state);
        assert!(out.emit.is_empty(), "delta already streamed → no re-emit");
        assert_eq!(out.persist.len(), 1);
        assert!(out.persist[0].contains("先分析需求，再写代码。"));
    }

    #[test]
    fn plan_delta_and_plan_item_map_to_thinking() {
        let mut state = CodexRpcStreamAdaptState::default();
        let delta = ServerNotification::PlanDelta {
            item_id: "itm_p".to_string(),
            delta: "步骤 1".to_string(),
        };
        let out = adapt(&delta, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""type":"thinking""#));
        assert!(out.emit[0].contains("步骤 1"));

        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_p".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_p".to_string(),
                item_type: "plan".to_string(),
                raw: json!({ "text": "完整计划" }),
            },
        };
        let out = adapt(&completed, &mut state);
        assert!(out.emit.is_empty(), "plan delta already streamed → no re-emit");
        assert_eq!(out.persist.len(), 1);
        assert!(out.persist[0].contains("完整计划"));
    }

    #[test]
    fn process_output_delta_and_exited_map_to_bash() {
        let mut state = CodexRpcStreamAdaptState::default();
        let delta = ServerNotification::ProcessOutputDeltaNotification {
            process_id: "p1".to_string(),
            stream: "stdout".to_string(),
            delta_base64: "aGVsbG8=".to_string(),
            cap_reached: false,
        };
        let out = adapt(&delta, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"Bash""#));
        assert!(out.emit[0].contains("aGVsbG8="));

        let exited = ServerNotification::ProcessExited {
            process_id: "p1".to_string(),
            exit_code: 0,
            stdout: "done".to_string(),
            stderr: "".to_string(),
        };
        let out = adapt(&exited, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""status":"completed""#));
        assert!(out.emit[0].contains("done"));
    }

    #[test]
    fn warning_and_compaction_emit_text() {
        let mut state = CodexRpcStreamAdaptState::default();
        let warning = ServerNotification::Warning {
            message: "磁盘空间不足".to_string(),
            thread_id: None,
        };
        let out = adapt(&warning, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("Codex 警告：磁盘空间不足"));

        let compacted = ServerNotification::ThreadCompacted {
            thread_id: "thr".to_string(),
        };
        let out = adapt(&compacted, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("上下文已压缩"));
    }

    #[test]
    fn file_change_patch_updated_emits_running_apply_patch_cards() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::FileChangePatchUpdated {
            item_id: "itm_fc".to_string(),
            changes: json!([
                {
                    "path": "/tmp/a.ts",
                    "kind": { "type": "update" },
                    "diff": "@@ -1 +1 @@\n-old\n+new",
                }
            ]),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"apply_patch""#));
        assert!(out.emit[0].contains(r#""file_path":"/tmp/a.ts""#));
        assert!(out.emit[0].contains(r#""status":"running""#));
        assert!(out.persist.is_empty(), "patch updates are live-only");
    }

    #[test]
    fn new_thread_item_types_map_to_tool_cards() {
        let mut state = CodexRpcStreamAdaptState::default();
        let cases: Vec<(&str, &str, serde_json::Value, &str)> = vec![
            ("webSearch", "web_search", json!({ "query": "rust async", "action": "search" }), "rust async"),
            ("subAgentActivity", "subagent_activity", json!({ "agentPath": "executor", "kind": "started" }), "executor"),
            ("collabAgentToolCall", "collab_spawnAgent", json!({ "tool": "spawnAgent", "prompt": "帮忙查文档" }), "协作代理调用"),
            ("imageGeneration", "image_generation", json!({ "status": "completed", "savedPath": "/tmp/a.png" }), "生成图片"),
            ("sleep", "sleep", json!({ "durationMs": 5000 }), "睡眠 5 秒"),
        ];
        for (item_type, tool_name, raw, needle) in cases {
            let started = ServerNotification::ItemStarted {
                item_id: "itm_x".to_string(),
                turn_id: "t1".to_string(),
                item: crate::codex_rpc_types::ThreadItem {
                    id: "itm_x".to_string(),
                    item_type: item_type.to_string(),
                    raw: raw.clone(),
                },
            };
            let completed = ServerNotification::ItemCompleted {
                item_id: "itm_x".to_string(),
                turn_id: "t1".to_string(),
                item: crate::codex_rpc_types::ThreadItem {
                    id: "itm_x".to_string(),
                    item_type: item_type.to_string(),
                    raw,
                },
            };
            let out = adapt(&started, &mut state);
            assert_eq!(out.emit.len(), 1, "{item_type} started");
            assert!(
                out.emit[0].contains(&format!(r#""name":"{tool_name}""#)),
                "{item_type}: {}",
                out.emit[0]
            );
            assert!(out.emit[0].contains(r#""status":"running""#));
            let out = adapt(&completed, &mut state);
            assert_eq!(out.emit.len(), 1, "{item_type} completed");
            assert!(out.emit[0].contains(r#""status":"completed""#));
            assert!(out.emit[0].contains(needle), "{item_type}: {}", out.emit[0]);
        }
    }

    #[test]
    fn review_compaction_items_emit_text_and_hook_prompt_is_silent() {
        let mut state = CodexRpcStreamAdaptState::default();
        for (item_type, needle) in [
            ("enteredReviewMode", "已进入代码评审模式"),
            ("exitedReviewMode", "已退出代码评审模式"),
            ("contextCompaction", "上下文已压缩"),
        ] {
            let completed = ServerNotification::ItemCompleted {
                item_id: "itm_s".to_string(),
                turn_id: "t1".to_string(),
                item: crate::codex_rpc_types::ThreadItem {
                    id: "itm_s".to_string(),
                    item_type: item_type.to_string(),
                    raw: json!({ "review": "x" }),
                },
            };
            let out = adapt(&completed, &mut state);
            assert_eq!(out.emit.len(), 1, "{item_type}");
            assert!(out.emit[0].contains(needle), "{item_type}: {}", out.emit[0]);
        }

        // hookPrompt：用户侧不可见的模型侧注入，保持静默。
        let started = ServerNotification::ItemStarted {
            item_id: "itm_h".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_h".to_string(),
                item_type: "hookPrompt".to_string(),
                raw: json!({ "fragments": [] }),
            },
        };
        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_h".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_h".to_string(),
                item_type: "hookPrompt".to_string(),
                raw: json!({ "fragments": [] }),
            },
        };
        assert!(adapt(&started, &mut state).emit.is_empty());
        assert!(adapt(&completed, &mut state).emit.is_empty());
    }

    #[test]
    fn mcp_and_dynamic_tool_calls_carry_arguments_and_output() {
        let mut state = CodexRpcStreamAdaptState::default();
        let mcp = ServerNotification::ItemCompleted {
            item_id: "itm_m".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_m".to_string(),
                item_type: "mcpToolCall".to_string(),
                raw: json!({
                    "server": "github",
                    "tool": "search",
                    "status": "completed",
                    "arguments": { "query": "wise" },
                    "result": { "content": [{ "type": "text", "text": "找到 2 个仓库" }] },
                }),
            },
        };
        let out = adapt(&mcp, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"github:search""#));
        assert!(out.emit[0].contains(r#""query":"wise""#));
        assert!(out.emit[0].contains("找到 2 个仓库"));

        let dyn_call = ServerNotification::ItemCompleted {
            item_id: "itm_d".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_d".to_string(),
                item_type: "dynamicToolCall".to_string(),
                raw: json!({
                    "namespace": "local",
                    "tool": "grep",
                    "status": "completed",
                    "arguments": { "pattern": "TODO" },
                    "contentItems": ["a.rs:1 TODO"],
                }),
            },
        };
        let out = adapt(&dyn_call, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"local:grep""#));
        assert!(out.emit[0].contains(r#""pattern":"TODO""#));
        assert!(out.emit[0].contains("a.rs:1 TODO"));
    }

    #[test]
    fn turn_plan_updated_formats_steps_to_thinking() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::TurnPlanUpdated {
            thread_id: "thr".to_string(),
            turn_id: "t1".to_string(),
            plan: Some(json!([
                { "status": "in_progress", "step": "调研需求" },
                { "status": "pending", "step": "实现" },
            ])),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""type":"thinking""#));
        assert!(out.emit[0].contains("调研需求"));
        assert!(out.emit[0].contains("[进行中]"));
        assert!(out.emit[0].contains("[待处理]"));
    }
}
