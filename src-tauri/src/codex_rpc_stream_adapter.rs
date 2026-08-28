//! Adapt Codex App-Server `ServerNotification` events into the unified
//! Claude-compatible stream JSON that the Wise frontend already consumes
//! via `claude-output` / `claude-complete` Tauri events.

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_COMPLETE, CLAUDE_STREAM_EVENT_OUTPUT,
};
use crate::codex_commands::{
    codex_line_is_benign_noise, format_codex_rpc_error_line, strip_benign_noise,
};
use crate::codex_rpc_types::{ServerNotification, ServerRequest};

/// Per-turn adapt state so token deltas and `item/completed` snapshots do not double-paint.
#[derive(Debug, Default)]
pub struct CodexRpcStreamAdaptState {
    /// `agentMessage` item ids that already received non-whitespace deltas.
    streamed_agent_message_ids: HashSet<String>,
    /// `reasoning` / `plan` item ids whose deltas already streamed live.
    /// On `item/completed` these fall back to persist-only to avoid double paint.
    streamed_thinking_ids: HashSet<String>,
    /// Latest `turn/tokenUsage/updated` for the current turn; summarized on turn end.
    turn_token_usage: Option<Value>,
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

    fn reset_turn_token_usage(&mut self) {
        self.turn_token_usage = None;
    }

    fn record_turn_token_usage(&mut self, usage: Value) {
        self.turn_token_usage = Some(usage);
    }

    fn take_turn_token_usage(&mut self) -> Option<Value> {
        self.turn_token_usage.take()
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
            state.reset_turn_token_usage();
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
            let usage_line = state
                .take_turn_token_usage()
                .and_then(|usage| format_token_usage_summary(&usage))
                .map(|summary| assistant_text_line(&summary));
            if failed {
                let detail = error_message
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(status.as_str());
                if let Some(cleaned) = strip_benign_noise(detail) {
                    let mut lines = vec![assistant_text_line(&format_codex_rpc_error_line(&cleaned))];
                    if let Some(line) = usage_line {
                        lines.push(line);
                    }
                    CodexRpcAdaptOutput::both(lines)
                } else {
                    usage_line
                        .map(|line| CodexRpcAdaptOutput::both(vec![line]))
                        .unwrap_or_default()
                }
            } else {
                // Success completion is signalled via `claude-complete`; token usage is
                // the only per-turn summary line emitted here.
                usage_line
                    .map(|line| CodexRpcAdaptOutput::both(vec![line]))
                    .unwrap_or_default()
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
                        vec![assistant_text_line_with_stream_id(&text, item_id)],
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
                CodexRpcAdaptOutput::emit_only(vec![assistant_text_line_with_stream_id(
                    delta, item_id,
                )])
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
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&format_codex_rpc_error_line(
                    &cleaned,
                ))])
            } else {
                CodexRpcAdaptOutput::default()
            }
        }

        ServerNotification::ServerRequestResolved { .. } => CodexRpcAdaptOutput::default(),

        ServerNotification::McpServerStatusUpdated { name, status, error } => {
            if is_chatgpt_apps_mcp_noise(name, error.as_deref()) {
                CodexRpcAdaptOutput::default()
            } else {
                CodexRpcAdaptOutput::both(vec![json!({
                    "type": "system",
                    "subtype": "mcp_status",
                    "server": name,
                    "status": status,
                    "error": error,
                })
                .to_string()])
            }
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
                CodexRpcAdaptOutput::emit_only(vec![assistant_thinking_line_with_stream_id(
                    delta, item_id,
                )])
            }
        }

        ServerNotification::PlanDelta { item_id, delta } => {
            if delta.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                if delta.chars().any(|c| !c.is_whitespace()) {
                    state.note_thinking_delta(item_id);
                }
                CodexRpcAdaptOutput::emit_only(vec![assistant_thinking_line_with_stream_id(
                    delta, item_id,
                )])
            }
        }

        ServerNotification::FileChangePatchUpdated { item_id, changes } => {
            // 补丁实时更新：复用 map_file_change_changes 以 running 状态刷出变更文件卡。
            let raw = json!({ "changes": changes });
            CodexRpcAdaptOutput::emit_only(map_file_change_changes(item_id, &raw, "running"))
        }

        ServerNotification::Warning { message, .. } => {
            // 模型元数据回退等一次性噪音警告（codex 未识别自定义模型元数据）不展示，
            // 与 exec 链路的 benign-noise 过滤保持一致。
            if message.trim().is_empty() || codex_line_is_benign_noise(&message) {
                CodexRpcAdaptOutput::default()
            } else {
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&format!(
                    "Codex 警告：{message}"
                ))])
            }
        }

        ServerNotification::HookStarted { run, .. } => {
            let event_name = hook_event_name(run);
            if event_name.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                let run_id = run
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                CodexRpcAdaptOutput::both(vec![json!({
                    "type": "system",
                    "subtype": "hook_started",
                    "hook_name": event_name,
                    "hook_event": event_name,
                    "run_id": run_id,
                })
                .to_string()])
            }
        }

        ServerNotification::HookCompleted { run, .. } => {
            let event_name = hook_event_name(run);
            if event_name.is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                let status = run
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("completed")
                    .to_string();
                let status_message = run
                    .get("statusMessage")
                    .or_else(|| run.get("status_message"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                let failed = status.eq_ignore_ascii_case("failed")
                    || status.eq_ignore_ascii_case("blocked")
                    || status.eq_ignore_ascii_case("stopped")
                    || status.eq_ignore_ascii_case("error");
                // entries：kind 为 Error/Warning/Stop 的输出归到 stderr，其余归到 stdout。
                let mut stdout_parts = Vec::new();
                let mut stderr_parts = Vec::new();
                if let Some(entries) = run.get("entries").and_then(Value::as_array) {
                    for entry in entries {
                        let kind = entry
                            .get("kind")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let text = entry
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim();
                        if text.is_empty() {
                            continue;
                        }
                        if kind.eq_ignore_ascii_case("error")
                            || kind.eq_ignore_ascii_case("warning")
                            || kind.eq_ignore_ascii_case("stop")
                        {
                            stderr_parts.push(text.to_string());
                        } else {
                            stdout_parts.push(text.to_string());
                        }
                    }
                }
                let stdout = stdout_parts.join("\n");
                let stderr = if stderr_parts.is_empty() {
                    if failed && !status_message.is_empty() {
                        status_message.clone()
                    } else {
                        String::new()
                    }
                } else {
                    stderr_parts.join("\n")
                };
                let duration_ms = run
                    .get("durationMs")
                    .or_else(|| run.get("duration_ms"))
                    .and_then(Value::as_i64);
                let mut line = json!({
                    "type": "system",
                    "subtype": "hook_response",
                    "hook_event": event_name,
                    "event": event_name,
                    "outcome": if failed { "error" } else { "success" },
                    "output": stdout,
                    "stderr": stderr,
                });
                if let Some(ms) = duration_ms {
                    line["duration_ms"] = json!(ms);
                }
                CodexRpcAdaptOutput::both(vec![line.to_string()])
            }
        }

        ServerNotification::ConfigWarning {
            summary,
            details,
            path,
        } => {
            if summary.trim().is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                let mut msg = format!("Codex 配置警告：{summary}");
                if let Some(p) = path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    msg.push_str(&format!("\n配置：{p}"));
                }
                if let Some(d) = details.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    msg.push_str(&format!("\n{d}"));
                }
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&msg)])
            }
        }

        ServerNotification::DeprecationNotice { summary, details } => {
            if summary.trim().is_empty() {
                CodexRpcAdaptOutput::default()
            } else {
                let mut msg = format!("Codex 弃用提醒：{summary}");
                if let Some(d) = details.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                    msg.push_str(&format!("\n{d}"));
                }
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&msg)])
            }
        }

        ServerNotification::ThreadStatusChanged {
            thread_id, status, ..
        } => {
            // 线程状态只做「提升」映射：Active → running、SystemError → error；
            // Idle / NotLoaded 不覆盖应用自身的 completed / cancelled 状态机。
            match thread_status_to_session_status(status) {
                Some(session_status) => {
                    let mut line = json!({
                        "type": "system",
                        "subtype": "thread_status_changed",
                        "status": session_status,
                    });
                    if !thread_id.is_empty() {
                        line["thread_id"] = json!(thread_id);
                    }
                    CodexRpcAdaptOutput::emit_only(vec![line.to_string()])
                }
                None => CodexRpcAdaptOutput::default(),
            }
        }

        ServerNotification::ThreadNameUpdated { thread_name, .. } => {
            match thread_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(name) => CodexRpcAdaptOutput::emit_only(vec![json!({
                    "type": "system",
                    "subtype": "thread_name_updated",
                    "name": name,
                })
                .to_string()]),
                None => CodexRpcAdaptOutput::default(),
            }
        }

        ServerNotification::ThreadCompacted { .. } => CodexRpcAdaptOutput::both(vec![
            assistant_text_line("Codex 上下文已压缩，后续对话将基于压缩后的上下文继续。"),
        ]),

        ServerNotification::AutoApprovalReviewStarted {
            review_id,
            target_item_id,
            action,
            review,
        } => {
            // 自动审批进行中：以 running 工具卡展示，completed 同 id 合并。
            let action_text = guardian_action_summary(action);
            let (_status, risk, _rationale) = guardian_review_parts(review);
            let mut input = json!({
                "description": if action_text.is_empty() {
                    "正在自动审批".to_string()
                } else {
                    format!("正在自动审批：{action_text}")
                },
                "risk_level": risk,
            });
            if let Some(tid) = target_item_id {
                input["target_item_id"] = json!(tid);
            }
            CodexRpcAdaptOutput::both(vec![assistant_tool_use_line(
                review_id,
                "approval_review",
                input,
                "running",
                None,
                None,
            )])
        }

        ServerNotification::AutoApprovalReviewCompleted {
            review_id,
            target_item_id,
            action,
            review,
            ..
        } => {
            let action_text = guardian_action_summary(action);
            let (status, risk, rationale) = guardian_review_parts(review);
            let status_label = match status.as_str() {
                "approved" => "已自动批准",
                "denied" => "已自动拒绝",
                "timedOut" => "自动审批超时",
                "aborted" => "自动审批中止",
                _ => "自动审批完成",
            };
            let failed = matches!(status.as_str(), "denied" | "timedOut" | "aborted");
            let risk_label = if risk.is_empty() {
                "未知".to_string()
            } else {
                risk.clone()
            };
            let outcome = format!("{status_label} · 风险：{risk_label}");
            let detail = if rationale.is_empty() {
                outcome
            } else {
                format!("{outcome}\n{rationale}")
            };
            let mut input = json!({
                "description": if action_text.is_empty() {
                    status_label.to_string()
                } else {
                    format!("{status_label}：{action_text}")
                },
                "risk_level": risk,
            });
            if let Some(tid) = target_item_id {
                input["target_item_id"] = json!(tid);
            }
            let output = if failed { None } else { Some(detail.clone()) };
            let error = if failed { Some(detail) } else { None };
            CodexRpcAdaptOutput::both(vec![assistant_tool_use_line(
                review_id,
                "approval_review",
                input,
                if failed { "error" } else { "completed" },
                output.as_deref(),
                error,
            )])
        }

        ServerNotification::ThreadTokenUsageUpdated { token_usage, .. } => {
            // 实时 token 更新不逐条展示（避免刷屏）；轮末由 TurnCompleted 汇总输出。
            state.record_turn_token_usage(token_usage.clone());
            CodexRpcAdaptOutput::default()
        }

        ServerNotification::ModelRerouted {
            from_model,
            to_model,
            reason,
            ..
        } => {
            let reason_label = match reason.as_deref() {
                Some("highRiskCyberActivity") => "（高风险网络活动防护）".to_string(),
                Some(other) if !other.is_empty() => format!("（{other}）"),
                _ => String::new(),
            };
            if from_model.is_empty() && to_model.is_empty() {
                CodexRpcAdaptOutput::default()
            } else if from_model.is_empty() || to_model.is_empty() {
                let model = if to_model.is_empty() { from_model } else { to_model };
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&format!(
                    "Codex 模型已切换：{model}{reason_label}"
                ))])
            } else {
                CodexRpcAdaptOutput::both(vec![assistant_text_line(&format!(
                    "Codex 模型已切换：{from_model} → {to_model}{reason_label}"
                ))])
            }
        }

        // --- Phase 5 notifications ---

        ServerNotification::TurnPlanUpdated {
            thread_id: _,
            turn_id: _,
            plan,
            explanation,
        } => {
            // `plan` 是 `TurnPlanStep[]`；格式化为可读计划文本并以 thinking 卡展示，
            // 前端 reasoning 块可折叠查看。缺失时保持原有 system 行兼容。
            match plan.as_ref().and_then(format_turn_plan_steps) {
                Some(mut text) if !text.trim().is_empty() => {
                    if let Some(explanation) = explanation.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                        text = format!("{text}\n\n说明：{explanation}");
                    }
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

/// 将 `webSearch.action` 对象（search / openPage / findInPage）格式化为可读文本。
/// `action` 在 wire 上是对象，直接 `as_str` 拿不到——这里显式解析各变体。
fn web_search_action_text(action: &Value) -> String {
    if let Some(text) = action.as_str() {
        return text.to_string();
    }
    let Some(obj) = action.as_object() else {
        return String::new();
    };
    let action_type = obj
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("other");
    match action_type {
        "search" => {
            if let Some(query) = obj.get("query").and_then(Value::as_str) {
                if !query.is_empty() {
                    return query.to_string();
                }
            }
            if let Some(queries) = obj.get("queries").and_then(Value::as_array) {
                let joined = queries
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(" | ");
                if !joined.is_empty() {
                    return joined;
                }
            }
            "搜索".to_string()
        }
        "openPage" => obj
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("打开页面")
            .to_string(),
        "findInPage" => {
            let url = obj.get("url").and_then(Value::as_str).unwrap_or("");
            let pattern = obj.get("pattern").and_then(Value::as_str).unwrap_or("");
            [url, pattern]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ")
        }
        _ => String::new(),
    }
}

/// 从 `HookRunSummary` 提取 hook 事件名（如 `PreToolUse` / `PostToolUse`）。
fn hook_event_name(run: &Value) -> String {
    run.get("eventName")
        .or_else(|| run.get("event_name"))
        .or_else(|| run.get("event"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string()
}

fn is_chatgpt_apps_mcp_noise(name: &str, error: Option<&str>) -> bool {
    if !name.eq_ignore_ascii_case("codex_apps") {
        return false;
    }
    let Some(error) = error.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let lower = error.to_lowercase();
    lower.contains("no_biscuit_no_service")
        || lower.contains("http 451")
        || lower.contains("handshaking with mcp server failed")
}

/// 把 Codex `ThreadStatus` 归一化为前端 `ClaudeSession.status`。
/// 仅映射明确的活跃/错误状态；Idle / NotLoaded 返回 None（不覆盖应用状态机）。
fn thread_status_to_session_status(status: &Value) -> Option<String> {
    if let Some(s) = status.as_str() {
        return match s {
            "Active" | "active" => Some("running".to_string()),
            "SystemError" | "systemError" => Some("error".to_string()),
            _ => None,
        };
    }
    if status.get("Active").is_some() || status.get("active").is_some() {
        return Some("running".to_string());
    }
    None
}

/// 提取 dynamicToolCall 的 `contentItems`（`inputText`/`inputImage` 对象数组）为文本。
fn dynamic_tool_output_text(content_items: &Value) -> String {
    let Some(items) = content_items.as_array() else {
        return content_items
            .as_str()
            .map(str::to_string)
            .unwrap_or_default();
    };
    let mut parts = Vec::new();
    for item in items {
        let Some(obj) = item.as_object() else {
            if let Some(s) = item.as_str() {
                parts.push(s.to_string());
            }
            continue;
        };
        if let Some(text) = obj.get("text").and_then(Value::as_str) {
            if !text.is_empty() {
                parts.push(text.to_string());
                continue;
            }
        }
        if let Some(url) = obj.get("imageUrl").or_else(|| obj.get("image_url")) {
            parts.push(url.to_string());
        }
    }
    parts.join("\n")
}

/// 组装 mcpToolCall 卡片的 input：参数 + 插件/应用上下文（供前端 subtitle 与展开查看）。
fn mcp_tool_call_input(raw: &Value) -> Value {
    let mut input = raw
        .get("arguments")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    if let Some(obj) = input.as_object_mut() {
        if let Some(ctx) = raw.get("appContext") {
            obj.insert("app_context".to_string(), ctx.clone());
        }
        if let Some(plugin_id) = raw.get("pluginId") {
            obj.insert("plugin_id".to_string(), plugin_id.clone());
        }
        if let Some(app_name) = raw
            .get("appContext")
            .and_then(|c| c.get("appName"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            obj.insert("description".to_string(), json!(app_name));
        }
    }
    input
}

/// 提取 guardian 自动审批 `action`（command / execve / applyPatch / networkAccess /
/// mcpToolCall / requestPermissions）的可读摘要，用于审批卡片 subtitle。
fn guardian_action_summary(action: &Value) -> String {
    let Some(obj) = action.as_object() else {
        return String::new();
    };
    let action_type = obj
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    match action_type {
        "command" => obj
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        "execve" => {
            let program = obj.get("program").and_then(Value::as_str).unwrap_or("");
            let argv = obj
                .get("argv")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            [program, argv.as_str()]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        }
        "applyPatch" => obj
            .get("files")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "文件变更".to_string()),
        "networkAccess" => {
            let host = obj.get("host").and_then(Value::as_str).unwrap_or("");
            let port = obj.get("port").and_then(Value::as_i64).unwrap_or(0);
            let protocol = obj.get("protocol").and_then(Value::as_str).unwrap_or("");
            format!("{protocol} {host}:{port}")
        }
        "mcpToolCall" => {
            let server = obj.get("server").and_then(Value::as_str).unwrap_or("");
            let tool = obj
                .get("toolName")
                .or_else(|| obj.get("tool_name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("{server}:{tool}")
        }
        "requestPermissions" => obj
            .get("reason")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("请求权限")
            .to_string(),
        _ => String::new(),
    }
}

/// 提取 guardian `review` 的 (status, risk_level, rationale)。
fn guardian_review_parts(review: &Value) -> (String, String, String) {
    let status = review
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let risk = review
        .get("riskLevel")
        .or_else(|| review.get("risk_level"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let rationale = review
        .get("rationale")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    (status, risk, rationale)
}

/// 从 `ThreadTokenUsage` 提取可读的轮次用量摘要（total breakdown）。
fn format_token_usage_summary(usage: &Value) -> Option<String> {
    let total = usage.get("total")?;
    let total_tokens = total.get("totalTokens").and_then(Value::as_u64)?;
    let input = total
        .get("inputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = total
        .get("outputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let reasoning = total
        .get("reasoningOutputTokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let mut parts = vec![format!("输入 {input}")];
    if reasoning > 0 {
        parts.push(format!("思考 {reasoning}"));
    }
    parts.push(format!("输出 {output}"));
    Some(format!(
        "Codex 本轮用量：{} · 总计 {total_tokens} tokens",
        parts.join(" · ")
    ))
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
            let action = item.raw.get("action").map(web_search_action_text).unwrap_or_default();
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
            let input = mcp_tool_call_input(&item.raw);
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
                Some(text) if !text.trim().is_empty() => {
                    vec![assistant_text_line_with_stream_id(&text, &item.id)]
                }
                _ => vec![],
            }
        }
        "reasoning" => {
            let text = extract_item_text(&item.raw);
            text.map(|t| assistant_thinking_line_with_stream_id(&t, &item.id))
                .into_iter()
                .collect()
        }
        "plan" => {
            // 计划文本以 thinking 块展示（前端可折叠查看）。
            let text = extract_item_text(&item.raw);
            text.map(|t| assistant_thinking_line_with_stream_id(&t, &item.id))
                .into_iter()
                .collect()
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
                || status.eq_ignore_ascii_case("error")
                || status.eq_ignore_ascii_case("declined");
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
                || status.eq_ignore_ascii_case("error")
                || status.eq_ignore_ascii_case("declined");
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
            let action = item.raw.get("action").map(web_search_action_text).unwrap_or_default();
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
            let input = mcp_tool_call_input(&item.raw);
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
                .map(dynamic_tool_output_text)
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

/// 带 Codex item id 的正文流。前端据此将被 reasoning / tool 交错的同一 agentMessage
/// 合回一个逻辑 part，而不是按到达顺序堆成许多碎片。
fn assistant_text_line_with_stream_id(text: &str, stream_id: &str) -> String {
    let mut block = json!({ "type": "text", "text": text });
    if !stream_id.trim().is_empty() {
        block["stream_id"] = json!(stream_id);
    }
    assistant_content_line(vec![block])
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

/// 与正文一致，为 reasoning / plan 流保留稳定 item id。
fn assistant_thinking_line_with_stream_id(text: &str, stream_id: &str) -> String {
    let mut block = json!({ "type": "thinking", "thinking": text });
    if !stream_id.trim().is_empty() {
        block["stream_id"] = json!(stream_id);
    }
    assistant_content_line(vec![block])
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
        assert!(out.emit[0].contains(r#""stream_id":"itm_1""#));
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
    fn command_execution_declined_maps_to_error() {
        let mut state = CodexRpcStreamAdaptState::default();
        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_3".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_3".to_string(),
                item_type: "commandExecution".to_string(),
                raw: json!({
                    "command": "rm -rf /tmp/x",
                    "status": "declined",
                    "output": "user declined",
                }),
            },
        };
        let out = adapt(&completed, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"Bash""#));
        assert!(out.emit[0].contains(r#""status":"error""#));
        assert!(out.emit[0].contains("user declined"));
    }

    #[test]
    fn file_change_declined_maps_to_error() {
        let mut state = CodexRpcStreamAdaptState::default();
        let completed = ServerNotification::ItemCompleted {
            item_id: "itm_fc3".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_fc3".to_string(),
                item_type: "fileChange".to_string(),
                raw: json!({
                    "status": "declined",
                    "reason": "user declined patch",
                }),
            },
        };
        let out = adapt(&completed, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"FileChange""#));
        assert!(out.emit[0].contains(r#""status":"error""#));
        assert!(out.emit[0].contains("user declined patch"));
    }

    #[test]
    fn hook_started_emits_hook_started_system_line() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::HookStarted {
            thread_id: "thr".to_string(),
            run: json!({
                "id": "hook_1",
                "eventName": "PreToolUse",
                "status": "running",
            }),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""subtype":"hook_started""#));
        assert!(out.emit[0].contains("PreToolUse"));
        assert_eq!(out.persist, out.emit);
    }

    #[test]
    fn hook_completed_failed_maps_to_error_outcome_with_stderr() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::HookCompleted {
            thread_id: "thr".to_string(),
            run: json!({
                "id": "hook_1",
                "eventName": "PostToolUse",
                "status": "failed",
                "statusMessage": "hook timed out",
                "durationMs": 1234,
                "entries": [
                    { "kind": "error", "text": "boom" },
                    { "kind": "context", "text": "cwd=/repo" },
                ],
            }),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""subtype":"hook_response""#));
        assert!(out.emit[0].contains(r#""outcome":"error""#));
        assert!(out.emit[0].contains("cwd=/repo"));
        assert!(out.emit[0].contains("boom"));
        assert_eq!(out.persist, out.emit);
    }

    #[test]
    fn hook_completed_success_maps_to_success_outcome() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::HookCompleted {
            thread_id: "thr".to_string(),
            run: json!({
                "id": "hook_2",
                "eventName": "PostToolUse",
                "status": "completed",
                "entries": [{ "kind": "feedback", "text": "done" }],
            }),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""outcome":"success""#));
        assert!(out.emit[0].contains("done"));
        assert!(!out.emit[0].contains(r#""outcome":"error""#));
    }

    #[test]
    fn config_warning_and_deprecation_emit_text_lines() {
        let mut state = CodexRpcStreamAdaptState::default();
        let warning = ServerNotification::ConfigWarning {
            summary: "未知配置项".to_string(),
            details: Some("请检查拼写".to_string()),
            path: Some("/Users/x/.codex/config.toml".to_string()),
        };
        let out = adapt(&warning, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("Codex 配置警告：未知配置项"));
        assert!(out.emit[0].contains("config.toml"));
        assert!(out.emit[0].contains("请检查拼写"));

        let deprecation = ServerNotification::DeprecationNotice {
            summary: "experimental_feature 已废弃".to_string(),
            details: Some("迁移到新 API".to_string()),
        };
        let out2 = adapt(&deprecation, &mut state);
        assert_eq!(out2.emit.len(), 1);
        assert!(out2.emit[0].contains("Codex 弃用提醒：experimental_feature 已废弃"));
        assert!(out2.emit[0].contains("迁移到新 API"));
    }

    #[test]
    fn chatgpt_apps_mcp_handshake_noise_is_dropped() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::McpServerStatusUpdated {
            name: "codex_apps".to_string(),
            status: "error".to_string(),
            error: Some(
                "MCP startup failed: handshaking with MCP server failed: unexpected server response: HTTP 451: {\"message\":\"no_biscuit_no_service\"}"
                    .to_string(),
            ),
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());
    }

    #[test]
    fn hook_without_event_name_is_dropped() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::HookStarted {
            thread_id: "thr".to_string(),
            run: json!({ "id": "hook_0", "status": "running" }),
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());
    }

    #[test]
    fn thread_status_active_maps_to_running() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ThreadStatusChanged {
            thread_id: "thr".to_string(),
            status: json!({ "Active": { "activeFlags": ["WaitingOnApproval"] } }),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""subtype":"thread_status_changed""#));
        assert!(out.emit[0].contains(r#""status":"running""#));
        assert!(out.emit[0].contains(r#""thread_id":"thr""#));
        assert!(out.persist.is_empty(), "状态行不应落盘");
    }

    #[test]
    fn thread_status_system_error_maps_to_error() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ThreadStatusChanged {
            thread_id: "thr".to_string(),
            status: json!("SystemError"),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""status":"error""#));
    }

    #[test]
    fn thread_status_idle_does_not_clobber_completed_state() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ThreadStatusChanged {
            thread_id: "thr".to_string(),
            status: json!("Idle"),
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty(), "Idle 不应覆盖应用状态机");
        assert!(out.persist.is_empty());
    }

    #[test]
    fn thread_name_updated_emits_name_line() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ThreadNameUpdated {
            thread_id: "thr".to_string(),
            thread_name: Some("优化搜索速度".to_string()),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""subtype":"thread_name_updated""#));
        assert!(out.emit[0].contains("优化搜索速度"));
        assert!(out.persist.is_empty());
    }

    #[test]
    fn thread_name_empty_is_dropped() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::ThreadNameUpdated {
            thread_id: "thr".to_string(),
            thread_name: None,
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());
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
    fn reconnect_progress_error_is_not_shown() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::Error {
            code: -1,
            message: "Reconnecting... 3/5".to_string(),
            data: None,
        };
        let out = adapt(&notif, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());
    }

    #[test]
    fn payment_required_error_is_humanized() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::Error {
            code: -1,
            message: "unexpected status 402 Payment Required: Insufficient Balance, url: https://api.deepseek.com/responses".to_string(),
            data: None,
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("DeepSeek"));
        assert!(out.emit[0].contains("账户额度不足"));
        assert!(!out.emit[0].contains("Codex error:"));
    }

    #[test]
    fn invalid_api_key_error_is_humanized() {
        let mut state = CodexRpcStreamAdaptState::default();
        let notif = ServerNotification::Error {
            code: -1,
            message: "unexpected status 401 Unauthorized: Incorrect API key provided: sk-test, url: https://api.openai.com/v1/responses, auth error code: invalid_api_key".to_string(),
            data: None,
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("OpenAI API Key 无效"));
        assert!(out.emit[0].contains("openAI default"));
        assert!(!out.emit[0].contains("Codex error:"));
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
        assert!(out.emit[0].contains(r#""stream_id":"itm_r""#));
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
    fn warning_metadata_noise_is_suppressed() {
        let mut state = CodexRpcStreamAdaptState::default();
        let noise = ServerNotification::Warning {
            message: "Model metadata for deepseek-v4-flash not found. Defaulting to fallback metadata; this can degrade performance and cause issues."
                .to_string(),
            thread_id: None,
        };
        let out = adapt(&noise, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());

        let websocket = ServerNotification::Warning {
            message: "Falling back from WebSockets to HTTPS transport.".to_string(),
            thread_id: None,
        };
        let out = adapt(&websocket, &mut state);
        assert!(out.emit.is_empty());
        assert!(out.persist.is_empty());

        // 真实可行动警告仍需展示。
        let actionable = ServerNotification::Warning {
            message: "API key 无效".to_string(),
            thread_id: None,
        };
        let out = adapt(&actionable, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("Codex 警告：API key 无效"));
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
            explanation: Some("按优先级推进".to_string()),
        };
        let out = adapt(&notif, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""type":"thinking""#));
        assert!(out.emit[0].contains("调研需求"));
        assert!(out.emit[0].contains("[进行中]"));
        assert!(out.emit[0].contains("[待处理]"));
        assert!(out.emit[0].contains("说明：按优先级推进"));
    }

    #[test]
    fn web_search_action_object_is_parsed() {
        let mut state = CodexRpcStreamAdaptState::default();
        // search 变体：action 是对象，query 在 action.query 里。
        let search = ServerNotification::ItemCompleted {
            item_id: "itm_w".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_w".to_string(),
                item_type: "webSearch".to_string(),
                raw: json!({
                    "query": "wise",
                    "action": { "type": "search", "query": "rust async", "queries": null },
                }),
            },
        };
        let out = adapt(&search, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("rust async"), "action.query should be surfaced");

        // openPage 变体：url 在 action.url 里。
        let open = ServerNotification::ItemCompleted {
            item_id: "itm_w2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_w2".to_string(),
                item_type: "webSearch".to_string(),
                raw: json!({
                    "query": "",
                    "action": { "type": "openPage", "url": "https://example.com/docs" },
                }),
            },
        };
        let out = adapt(&open, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("https://example.com/docs"));
    }

    #[test]
    fn dynamic_tool_call_content_items_objects_are_extracted() {
        let mut state = CodexRpcStreamAdaptState::default();
        let call = ServerNotification::ItemCompleted {
            item_id: "itm_d2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_d2".to_string(),
                item_type: "dynamicToolCall".to_string(),
                raw: json!({
                    "namespace": "local",
                    "tool": "grep",
                    "status": "completed",
                    "arguments": {},
                    "contentItems": [
                        { "type": "inputText", "text": "a.rs:1 TODO" },
                        { "type": "inputImage", "imageUrl": "https://img.example/a.png" },
                    ],
                }),
            },
        };
        let out = adapt(&call, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("a.rs:1 TODO"));
        assert!(out.emit[0].contains("https://img.example/a.png"));
    }

    #[test]
    fn mcp_tool_call_carries_app_context_and_plugin_id() {
        let mut state = CodexRpcStreamAdaptState::default();
        let call = ServerNotification::ItemCompleted {
            item_id: "itm_m2".to_string(),
            turn_id: "t1".to_string(),
            item: crate::codex_rpc_types::ThreadItem {
                id: "itm_m2".to_string(),
                item_type: "mcpToolCall".to_string(),
                raw: json!({
                    "server": "connector",
                    "tool": "search",
                    "status": "completed",
                    "arguments": { "query": "wise" },
                    "appContext": { "appName": "Wise 文档", "connectorId": "wise-docs" },
                    "pluginId": "openai-docs",
                    "result": { "content": [{ "type": "text", "text": "ok" }] },
                }),
            },
        };
        let out = adapt(&call, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""description":"Wise 文档""#));
        assert!(out.emit[0].contains(r#""plugin_id":"openai-docs""#));
        assert!(out.emit[0].contains(r#""connectorId":"wise-docs""#));
    }

    #[test]
    fn auto_approval_review_started_and_completed_merge_by_review_id() {
        let mut state = CodexRpcStreamAdaptState::default();
        let action = json!({ "type": "command", "command": "npm test", "cwd": "/repo", "source": "unifiedExec" });

        let started = ServerNotification::AutoApprovalReviewStarted {
            review_id: "rev_1".to_string(),
            target_item_id: Some("itm_cmd".to_string()),
            action: action.clone(),
            review: json!({ "status": "inProgress", "riskLevel": "low", "rationale": null }),
        };
        let out = adapt(&started, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""name":"approval_review""#));
        assert!(out.emit[0].contains(r#""status":"running""#));
        assert!(out.emit[0].contains("正在自动审批：npm test"));
        assert!(out.emit[0].contains(r#""risk_level":"low""#));
        assert!(out.emit[0].contains(r#""target_item_id":"itm_cmd""#));

        let completed = ServerNotification::AutoApprovalReviewCompleted {
            review_id: "rev_1".to_string(),
            target_item_id: Some("itm_cmd".to_string()),
            action,
            review: json!({
                "status": "approved",
                "riskLevel": "low",
                "rationale": "测试命令，风险低",
            }),
            decision_source: Some("agent".to_string()),
        };
        let out = adapt(&completed, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""id":"rev_1""#), "same id so frontend merges");
        assert!(out.emit[0].contains(r#""status":"completed""#));
        assert!(out.emit[0].contains("已自动批准 · 风险：low"));
        assert!(out.emit[0].contains("测试命令，风险低"));
        assert!(out.emit[0].contains("已自动批准：npm test"));
    }

    #[test]
    fn auto_approval_review_denied_maps_to_error() {
        let mut state = CodexRpcStreamAdaptState::default();
        let completed = ServerNotification::AutoApprovalReviewCompleted {
            review_id: "rev_2".to_string(),
            target_item_id: None,
            action: json!({ "type": "networkAccess", "host": "1.2.3.4", "port": 443, "protocol": "tcp", "target": "outbound" }),
            review: json!({
                "status": "denied",
                "riskLevel": "high",
                "rationale": "未知目标主机",
            }),
            decision_source: Some("agent".to_string()),
        };
        let out = adapt(&completed, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains(r#""status":"error""#));
        assert!(out.emit[0].contains("已自动拒绝 · 风险：high"));
        assert!(out.emit[0].contains("未知目标主机"));
        assert!(out.emit[0].contains("tcp 1.2.3.4:443"));
    }

    #[test]
    fn token_usage_is_summarized_on_turn_completed() {
        let mut state = CodexRpcStreamAdaptState::default();
        let usage = ServerNotification::ThreadTokenUsageUpdated {
            thread_id: "thr".to_string(),
            turn_id: "t1".to_string(),
            token_usage: json!({
                "total": {
                    "inputTokens": 1200,
                    "outputTokens": 300,
                    "reasoningOutputTokens": 80,
                    "totalTokens": 1580,
                },
                "last": { "inputTokens": 20, "outputTokens": 10, "totalTokens": 30 },
            }),
        };
        // 更新本身不展示（避免刷屏）。
        assert!(adapt(&usage, &mut state).emit.is_empty());

        let completed = ServerNotification::TurnCompleted {
            turn_id: "t1".to_string(),
            thread_id: "thr".to_string(),
            status: "completed".to_string(),
            error_message: None,
        };
        let out = adapt(&completed, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("Codex 本轮用量"));
        assert!(out.emit[0].contains("输入 1200"));
        assert!(out.emit[0].contains("思考 80"));
        assert!(out.emit[0].contains("输出 300"));
        assert!(out.emit[0].contains("总计 1580 tokens"));

        // 下一轮没有用量更新时不输出摘要。
        let out = adapt(&completed, &mut state);
        assert!(out.emit.is_empty());
    }

    #[test]
    fn token_usage_summary_is_kept_on_turn_failure() {
        let mut state = CodexRpcStreamAdaptState::default();
        let usage = ServerNotification::ThreadTokenUsageUpdated {
            thread_id: "thr".to_string(),
            turn_id: "t1".to_string(),
            token_usage: json!({
                "total": { "inputTokens": 10, "outputTokens": 5, "totalTokens": 15 },
                "last": { "inputTokens": 1, "outputTokens": 1, "totalTokens": 2 },
            }),
        };
        assert!(adapt(&usage, &mut state).emit.is_empty());

        let failed = ServerNotification::TurnCompleted {
            turn_id: "t1".to_string(),
            thread_id: "thr".to_string(),
            status: "failed".to_string(),
            error_message: Some("network error".to_string()),
        };
        let out = adapt(&failed, &mut state);
        assert_eq!(out.emit.len(), 2);
        assert!(out.emit[0].contains("Codex error"));
        assert!(out.emit[1].contains("Codex 本轮用量"));
    }

    #[test]
    fn model_rerouted_emits_text_hint() {
        let mut state = CodexRpcStreamAdaptState::default();
        let rerouted = ServerNotification::ModelRerouted {
            thread_id: "thr".to_string(),
            turn_id: "t1".to_string(),
            from_model: "gpt-5.4".to_string(),
            to_model: "gpt-5.4-mini".to_string(),
            reason: Some("highRiskCyberActivity".to_string()),
        };
        let out = adapt(&rerouted, &mut state);
        assert_eq!(out.emit.len(), 1);
        assert!(out.emit[0].contains("Codex 模型已切换：gpt-5.4 → gpt-5.4-mini"));
        assert!(out.emit[0].contains("高风险网络活动防护"));
    }
}
