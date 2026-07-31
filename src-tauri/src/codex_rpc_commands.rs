//! Tauri commands for the Codex App-Server JSON-RPC integration.
//!
//! These commands wire [`CodexRpcSession`] to the frontend, providing
//! `execute_codex_rpc`, `interrupt_codex_rpc`, and `shutdown_codex_rpc`.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::claude_events::{
    emit_adapted_stream_payload, CLAUDE_STREAM_EVENT_OUTPUT,
};
use crate::codex_binary::find_codex_binary;
use crate::codex_rpc_session::CodexRpcSession;
use crate::codex_rpc_stream_adapter::{adapt_notification_to_stream_lines, emit_approval_request, emit_dynamic_tool_request, emit_mcp_elicitation_request, emit_rpc_complete};
use crate::codex_rpc_types::{ApprovalDecision, CommandExecParams, CommandExecResponse, ServerNotification, ServerRequest};
use crate::wise_db::WiseDb;

// ---------------------------------------------------------------------------
// Shared state for active RPC sessions
// ---------------------------------------------------------------------------

/// Tauri-managed state holding active [`CodexRpcSession`] instances keyed by session id.
#[derive(Default, Clone)]
pub(crate) struct CodexRpcSessionStore {
    pub(crate) sessions: Arc<TokioMutex<HashMap<String, Arc<TokioMutex<CodexRpcSession>>>>>,
}

// ---------------------------------------------------------------------------
// Command parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteCodexRpcParams {
    prompt: String,
    #[serde(default)]
    project_path: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    invocation_key: Option<String>,
    #[serde(default)]
    tab_session_id: Option<String>,
    #[serde(default)]
    codex_resume_session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InterruptCodexRpcParams {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShutdownCodexRpcParams {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexRpcApprovalParams {
    pub session_id: String,
    pub request_id: u64,
    pub decision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCodexRpcMcpServersParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CallCodexRpcMcpToolParams {
    pub session_id: String,
    pub server: String,
    pub tool: String,
    #[serde(default)]
    pub arguments: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartCodexRpcMcpOAuthParams {
    pub session_id: String,
    pub server: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexRpcMcpElicitationParams {
    pub session_id: String,
    pub request_id: u64,
    pub action: String,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn codex_rpc_init_stream_line(session_id: &str) -> String {
    json!({
        "type": "system",
        "subtype": "init",
        "session_id": session_id,
    })
    .to_string()
}

fn emit_rpc_output_line(
    app: &AppHandle,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    emit_adapted_stream_payload(app, CLAUDE_STREAM_EVENT_OUTPUT, session_id, &line, invocation_key);
}

/// Persist a transcript line; log failures so silent disk miss doesn't look like a UI bug.
fn persist_codex_rpc_transcript_line(project_path: &str, tab_session_id: &str, line: &str) {
    if let Err(e) =
        crate::codex_rpc_disk::append_codex_rpc_session_line(project_path, tab_session_id, line)
    {
        eprintln!(
            "[codex_rpc] transcript append failed (tab={tab_session_id}): {e}"
        );
    }
}

fn emit_and_persist_rpc_output_line(
    app: &AppHandle,
    project_path: &str,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    persist_codex_rpc_transcript_line(project_path, session_id, line);
    emit_rpc_output_line(app, session_id, line, invocation_key);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Main command: start a conversation turn via JSON-RPC.
///
/// Flow:
/// 1. Resolve codex binary.
/// 2. Bootstrap a `CodexRpcSession` (spawn subprocess + initialize).
/// 3. Start or resume a thread.
/// 4. Start a turn with the user's prompt.
/// 5. Enter a notification loop: poll notifications, adapt each, emit to frontend.
/// 6. When `TurnCompleted` is received, emit completion.
#[tauri::command]
pub(crate) async fn execute_codex_rpc(
    app: AppHandle,
    db: tauri::State<'_, WiseDb>,
    params: ExecuteCodexRpcParams,
) -> Result<(), String> {
    let _ = &db; // DB available for proxy/credential bridging in future phases.

    let trimmed_prompt = params.prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Codex RPC 执行需要非空提示词".to_string());
    }

    let codex_path = find_codex_binary().map_err(|e| format!("codex binary: {e}"))?;

    let session_id = params
        .tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("codex-rpc-{}", Uuid::new_v4().simple()));

    let invocation_key = params
        .invocation_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);

    // Register in the session registry so the frontend can track it.
    {
        let registry = app.state::<ClaudeSessionRegistry>();
        let model_label = params.model.as_deref().unwrap_or("codex-rpc").to_string();
        registry.register(session_id.clone(), params.project_path.clone(), model_label);
    }

    // Emit + persist init line so reopen can hydrate even if the turn fails later.
    emit_and_persist_rpc_output_line(
        &app,
        &params.project_path,
        &session_id,
        &codex_rpc_init_stream_line(&session_id),
        invocation_key.as_deref(),
    );

    // Persist user prompt before thread/turn so a failed start still leaves recoverable history.
    let user_line = crate::cursor_disk::build_cursor_user_turn_line(trimmed_prompt, None);
    persist_codex_rpc_transcript_line(&params.project_path, &session_id, &user_line);

    // Bootstrap the session (spawn subprocess + initialize handshake).
    let mut session = match CodexRpcSession::bootstrap(&codex_path).await {
        Ok(s) => s,
        Err(e) => {
            let msg = format!("Codex app-server 启动失败: {e}");
            eprintln!("[codex_rpc] {msg}");
            emit_and_persist_rpc_output_line(
                &app,
                &params.project_path,
                &session_id,
                &json!({
                    "type": "assistant",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
                }).to_string(),
                invocation_key.as_deref(),
            );
            let registry = app.state::<ClaudeSessionRegistry>();
            registry.mark_completed(&session_id, false);
            emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
            return Err(msg);
        }
    };

    // Start or resume a thread.
    let resume_id = params
        .codex_resume_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let thread_result = if let Some(thread_id) = resume_id {
        session.resume_thread(thread_id).await
    } else {
        session
            .start_thread(
                Some(params.project_path.as_str()),
                params.model.as_deref(),
            )
            .await
            .map(|_| ())
    };

    if let Err(e) = thread_result {
        let msg = format!("Codex thread 创建失败: {e}");
        eprintln!("[codex_rpc] {msg}");
        emit_and_persist_rpc_output_line(
            &app,
            &params.project_path,
            &session_id,
            &json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
            }).to_string(),
            invocation_key.as_deref(),
        );
        let _ = session.shutdown().await;
        let registry = app.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id, false);
        emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
        return Err(msg);
    }

    // Start the turn.
    let turn_result = session.start_turn(trimmed_prompt).await;
    if let Err(e) = turn_result {
        let msg = format!("Codex turn 启动失败: {e}");
        eprintln!("[codex_rpc] {msg}");
        emit_and_persist_rpc_output_line(
            &app,
            &params.project_path,
            &session_id,
            &json!({
                "type": "assistant",
                "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
            }).to_string(),
            invocation_key.as_deref(),
        );
        let _ = session.shutdown().await;
        let registry = app.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id, false);
        emit_rpc_complete(&app, invocation_key.as_deref(), &session_id, false);
        return Err(msg);
    }

    // Store the session for potential interrupt/shutdown.
    let session_arc = Arc::new(TokioMutex::new(session));
    {
        let session_store = app.state::<CodexRpcSessionStore>();
        let mut store = session_store.sessions.lock().await;
        store.insert(session_id.clone(), session_arc.clone());
    }

    // Track in process state for cancellation support.
    if let Some(inv) = invocation_key.as_deref().filter(|s| !s.is_empty()) {
        let process_state = app.state::<ClaudeProcessState>();
        process_state
            .invocation_tab_session_by_key
            .lock()
            .await
            .insert(inv.to_string(), session_id.clone());
    }

    // Notification loop: consume server notifications until turn completes or channel closes.
    // The session lock is NOT held continuously — it is acquired per-iteration to poll
    // the next notification, then immediately dropped so interrupt_codex_rpc can proceed.
    let app_loop = app.clone();
    let session_id_loop = session_id.clone();
    let invocation_key_loop = invocation_key.clone();
    let project_path_loop = params.project_path.clone();

    tokio::spawn(async move {
        let mut success = true;

        loop {
            // Take the session lock only long enough to poll one notification
            // or one server request, then drop it so interrupt/approval can proceed.
            enum PollResult {
                Notification(Option<ServerNotification>),
                ServerRequest(Option<ServerRequest>),
            }

            let poll_result = {
                let mut session_guard = session_arc.lock().await;
                // Poll both channels non-blockingly; if neither has data,
                // sleep briefly (releasing the lock) before retrying.
                if let Some(notif) = session_guard.poll_notification() {
                    Some(PollResult::Notification(Some(notif)))
                } else if let Some(req) = session_guard.poll_server_request() {
                    Some(PollResult::ServerRequest(Some(req)))
                } else {
                    // Drop the lock before sleeping.
                    drop(session_guard);
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    None
                }
            }; // lock dropped here

            let Some(result) = poll_result else {
                continue;
            };

            match result {
                PollResult::Notification(Some(ServerNotification::TurnCompleted { .. })) => {
                    // Turn completed normally.
                    break;
                }
                PollResult::Notification(Some(notification)) => {
                    // Check for ServerRequestResolved — emit resolved event.
                    if let ServerNotification::ServerRequestResolved { request_id, .. } = &notification {
                        use tauri::Emitter;
                        let _ = app_loop.emit("codex-rpc:approval-resolved", json!({
                            "session_id": &session_id_loop,
                            "request_id": request_id,
                        }));
                    }
                    // Persist adapted lines to disk, then emit to frontend.
                    let lines = adapt_notification_to_stream_lines(&notification, &session_id_loop);
                    for line in &lines {
                        persist_codex_rpc_transcript_line(
                            &project_path_loop,
                            &session_id_loop,
                            line,
                        );
                        emit_adapted_stream_payload(
                            &app_loop,
                            crate::claude_events::CLAUDE_STREAM_EVENT_OUTPUT,
                            &session_id_loop,
                            line,
                            invocation_key_loop.as_deref(),
                        );
                    }
                }
                PollResult::Notification(None) => {
                    // Channel closed — subprocess likely exited.
                    success = false;
                    break;
                }
                PollResult::ServerRequest(Some(request)) => {
                    // Handle different server request types.
                    match &request {
                        ServerRequest::McpServerElicitationRequest { request_id, ref params } => {
                            emit_mcp_elicitation_request(&app_loop, &session_id_loop, *request_id, params);
                        }
                        ServerRequest::DynamicToolCall { request_id, ref params } => {
                            emit_dynamic_tool_request(&app_loop, &session_id_loop, *request_id, params);
                        }
                        _ => {
                            emit_approval_request(&app_loop, &session_id_loop, &request);
                        }
                    }
                }
                PollResult::ServerRequest(None) => {
                    // Server-request channel closed — not fatal, just continue
                    // waiting for notifications.
                }
            }
        }

        // Clean up session from store.
        {
            let session_store = app_loop.state::<CodexRpcSessionStore>();
            let mut store = session_store.sessions.lock().await;
            store.remove(&session_id_loop);
        }

        let registry = app_loop.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id_loop, success);
        emit_rpc_complete(
            &app_loop,
            invocation_key_loop.as_deref(),
            &session_id_loop,
            success,
        );
    });

    Ok(())
}

/// Interrupt the current in-flight turn for a session.
#[tauri::command]
pub(crate) async fn interrupt_codex_rpc(
    app: AppHandle,
    params: InterruptCodexRpcParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();

    // Clone the Arc and drop the store lock BEFORE locking the session,
    // matching the shutdown_codex_rpc pattern to avoid deadlocks.
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    }; // store lock dropped here

    let mut session = session_arc.lock().await;
    session
        .interrupt_turn()
        .await
        .map_err(|e| format!("interrupt failed: {e}"))
}

/// Respond to a server-initiated approval request with an approval decision.
#[tauri::command]
pub(crate) async fn respond_codex_rpc_approval(
    app: AppHandle,
    params: RespondCodexRpcApprovalParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let decision = match params.decision.as_str() {
        "accept" => ApprovalDecision::Accept,
        "acceptForSession" => ApprovalDecision::AcceptForSession,
        "decline" => ApprovalDecision::Decline,
        "cancel" => ApprovalDecision::Cancel,
        other => return Err(format!("Unknown decision: {other}")),
    };

    let mut session = session_arc.lock().await;
    session
        .respond_to_request(params.request_id, &decision)
        .await
        .map_err(|e| format!("Failed to send approval response: {e}"))
}

/// Shutdown a session: kill the subprocess and clean up state.
#[tauri::command]
pub(crate) async fn shutdown_codex_rpc(
    app: AppHandle,
    params: ShutdownCodexRpcParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();

    let session_arc = {
        let mut store = session_store.sessions.lock().await;
        store
            .remove(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
    };

    let mut session = session_arc.lock().await;
    session
        .shutdown()
        .await
        .map_err(|e| format!("shutdown failed: {e}"))
}

/// List MCP server statuses for an active session.
#[tauri::command]
pub(crate) async fn list_codex_rpc_mcp_servers(
    app: AppHandle,
    params: ListCodexRpcMcpServersParams,
) -> Result<Vec<crate::codex_rpc_types::McpServerStatusInfo>, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .list_mcp_server_statuses()
        .await
        .map_err(|e| format!("Failed to list MCP servers: {e}"))
}

/// Call an MCP tool directly.
#[tauri::command]
pub(crate) async fn call_codex_rpc_mcp_tool(
    app: AppHandle,
    params: CallCodexRpcMcpToolParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let result = session
        .call_mcp_tool(&params.server, &params.tool, params.arguments)
        .await
        .map_err(|e| format!("MCP tool call failed: {e}"))?;
    serde_json::to_value(result).map_err(|e| format!("Failed to serialize MCP tool result: {e}"))
}

/// Start MCP OAuth login for a server.
#[tauri::command]
pub(crate) async fn start_codex_rpc_mcp_oauth(
    app: AppHandle,
    params: StartCodexRpcMcpOAuthParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let result = session
        .start_mcp_oauth_login(&params.server)
        .await
        .map_err(|e| format!("MCP OAuth login failed: {e}"))?;
    serde_json::to_value(result).map_err(|e| format!("Failed to serialize OAuth response: {e}"))
}

/// Respond to an MCP elicitation request.
#[tauri::command]
pub(crate) async fn respond_codex_rpc_mcp_elicitation(
    app: AppHandle,
    params: RespondCodexRpcMcpElicitationParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .respond_to_mcp_elicitation(params.request_id, &params.action, params.content)
        .await
        .map_err(|e| format!("Failed to send MCP elicitation response: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 4: Command execution parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecCodexRpcCommandParams {
    pub session_id: String,
    pub command: Vec<String>,
    #[serde(default)]
    pub process_id: Option<String>,
    #[serde(default)]
    pub tty: bool,
    #[serde(default)]
    pub stream_stdin: bool,
    #[serde(default)]
    pub stream_stdout_stderr: bool,
    #[serde(default)]
    pub timeout_ms: Option<i64>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, Option<String>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminateCodexRpcCommandParams {
    pub session_id: String,
    pub process_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteCodexRpcCommandStdinParams {
    pub session_id: String,
    pub process_id: String,
    #[serde(default)]
    pub delta_base64: Option<String>,
    #[serde(default)]
    pub close_stdin: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResizeCodexRpcCommandParams {
    pub session_id: String,
    pub process_id: String,
    pub rows: u16,
    pub cols: u16,
}

// ---------------------------------------------------------------------------
// Phase 4: Filesystem operation parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsReadFileParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsWriteFileParams {
    pub session_id: String,
    pub path: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsCreateDirectoryParams {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsGetMetadataParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsReadDirectoryParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsRemoveParams {
    pub session_id: String,
    pub path: String,
    #[serde(default)]
    pub recursive: bool,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsCopyParams {
    pub session_id: String,
    pub source_path: String,
    pub destination_path: String,
    #[serde(default)]
    pub recursive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsWatchParams {
    pub session_id: String,
    pub watch_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcFsUnwatchParams {
    pub session_id: String,
    pub watch_id: String,
}

// ---------------------------------------------------------------------------
// Phase 4: Command execution Tauri commands
// ---------------------------------------------------------------------------

/// Execute a sandboxed command via the codex app-server.
#[tauri::command]
pub(crate) async fn exec_codex_rpc_command(
    app: AppHandle,
    params: ExecCodexRpcCommandParams,
) -> Result<CommandExecResponse, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let exec_params = CommandExecParams {
        command: params.command,
        process_id: params.process_id,
        tty: params.tty,
        stream_stdin: params.stream_stdin,
        stream_stdout_stderr: params.stream_stdout_stderr,
        timeout_ms: params.timeout_ms,
        cwd: params.cwd,
        env: params.env,
        size: None,
    };

    let mut session = session_arc.lock().await;
    session
        .exec_command(exec_params)
        .await
        .map_err(|e| format!("command/exec failed: {e}"))
}

/// Terminate a running command.
#[tauri::command]
pub(crate) async fn terminate_codex_rpc_command(
    app: AppHandle,
    params: TerminateCodexRpcCommandParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .terminate_command(&params.process_id)
        .await
        .map_err(|e| format!("command/exec/terminate failed: {e}"))
}

/// Write stdin bytes to a running command.
#[tauri::command]
pub(crate) async fn write_codex_rpc_command_stdin(
    app: AppHandle,
    params: WriteCodexRpcCommandStdinParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let write_params = crate::codex_rpc_types::CommandExecWriteParams {
        process_id: params.process_id,
        delta_base64: params.delta_base64,
        close_stdin: params.close_stdin,
    };

    let mut session = session_arc.lock().await;
    session
        .write_command_stdin(write_params)
        .await
        .map_err(|e| format!("command/exec/write failed: {e}"))
}

/// Resize a PTY-backed command.
#[tauri::command]
pub(crate) async fn resize_codex_rpc_command(
    app: AppHandle,
    params: ResizeCodexRpcCommandParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .resize_command(&params.process_id, params.rows, params.cols)
        .await
        .map_err(|e| format!("command/exec/resize failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 4: Filesystem Tauri commands
// ---------------------------------------------------------------------------

/// Read a file via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_read_file(
    app: AppHandle,
    params: CodexRpcFsReadFileParams,
) -> Result<String, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_read_file(&params.path)
        .await
        .map_err(|e| format!("fs/readFile failed: {e}"))?;
    Ok(resp.data_base64)
}

/// Write a file via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_write_file(
    app: AppHandle,
    params: CodexRpcFsWriteFileParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_write_file(&params.path, &params.data_base64)
        .await
        .map_err(|e| format!("fs/writeFile failed: {e}"))
}

/// Create a directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_create_directory(
    app: AppHandle,
    params: CodexRpcFsCreateDirectoryParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_create_directory(&params.path, params.recursive)
        .await
        .map_err(|e| format!("fs/createDirectory failed: {e}"))
}

/// Get metadata for a path via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_get_metadata(
    app: AppHandle,
    params: CodexRpcFsGetMetadataParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_get_metadata(&params.path)
        .await
        .map_err(|e| format!("fs/getMetadata failed: {e}"))?;
    serde_json::to_value(resp).map_err(|e| format!("Failed to serialize metadata: {e}"))
}

/// Read a directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_read_directory(
    app: AppHandle,
    params: CodexRpcFsReadDirectoryParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_read_directory(&params.path)
        .await
        .map_err(|e| format!("fs/readDirectory failed: {e}"))?;
    serde_json::to_value(resp).map_err(|e| format!("Failed to serialize directory entries: {e}"))
}

/// Remove a file or directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_remove(
    app: AppHandle,
    params: CodexRpcFsRemoveParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_remove(&params.path, params.recursive, params.force)
        .await
        .map_err(|e| format!("fs/remove failed: {e}"))
}

/// Copy a file or directory via the codex app-server filesystem API.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_copy(
    app: AppHandle,
    params: CodexRpcFsCopyParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_copy(&params.source_path, &params.destination_path, params.recursive)
        .await
        .map_err(|e| format!("fs/copy failed: {e}"))
}

/// Start a filesystem watch via the codex app-server.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_watch(
    app: AppHandle,
    params: CodexRpcFsWatchParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    let resp = session
        .fs_watch(&params.watch_id, &params.path)
        .await
        .map_err(|e| format!("fs/watch failed: {e}"))?;
    serde_json::to_value(resp).map_err(|e| format!("Failed to serialize watch response: {e}"))
}

/// Stop a filesystem watch via the codex app-server.
#[tauri::command]
pub(crate) async fn codex_rpc_fs_unwatch(
    app: AppHandle,
    params: CodexRpcFsUnwatchParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fs_unwatch(&params.watch_id)
        .await
        .map_err(|e| format!("fs/unwatch failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Thread management parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCodexRpcThreadsParams {
    pub session_id: String,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    #[serde(default)]
    pub archived: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnarchiveCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForkCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadCodexRpcThreadParams {
    pub session_id: String,
    pub thread_id: String,
}

// ---------------------------------------------------------------------------
// Phase 5: Turn steering parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteerCodexRpcTurnParams {
    pub session_id: String,
    pub turn_id: String,
    pub input: String,
}

// ---------------------------------------------------------------------------
// Phase 5: Code review parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartCodexRpcReviewParams {
    pub session_id: String,
    pub thread_id: String,
    #[serde(default)]
    pub instruction: Option<String>,
}

// ---------------------------------------------------------------------------
// Phase 5: Skills parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListCodexRpcSkillsParams {
    pub session_id: String,
    #[serde(default)]
    pub cwd: Option<String>,
}

// ---------------------------------------------------------------------------
// Phase 5: Dynamic tool response parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCodexRpcDynamicToolParams {
    pub session_id: String,
    pub request_id: u64,
    pub result: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Phase 5: Thread management Tauri commands
// ---------------------------------------------------------------------------

/// List threads via the codex app-server.
#[tauri::command]
pub(crate) async fn list_codex_rpc_threads(
    app: AppHandle,
    params: ListCodexRpcThreadsParams,
) -> Result<crate::codex_rpc_types::ThreadListResponse, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let list_params = crate::codex_rpc_types::ThreadListParams {
        limit: params.limit,
        offset: params.offset,
        archived: params.archived,
    };

    let mut session = session_arc.lock().await;
    session
        .list_threads(Some(list_params))
        .await
        .map_err(|e| format!("thread/list failed: {e}"))
}

/// Archive a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn archive_codex_rpc_thread(
    app: AppHandle,
    params: ArchiveCodexRpcThreadParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .archive_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/archive failed: {e}"))
}

/// Unarchive a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn unarchive_codex_rpc_thread(
    app: AppHandle,
    params: UnarchiveCodexRpcThreadParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .unarchive_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/unarchive failed: {e}"))
}

/// Delete a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn delete_codex_rpc_thread(
    app: AppHandle,
    params: DeleteCodexRpcThreadParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .delete_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/delete failed: {e}"))
}

/// Fork a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn fork_codex_rpc_thread(
    app: AppHandle,
    params: ForkCodexRpcThreadParams,
) -> Result<crate::codex_rpc_types::ThreadSummary, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .fork_thread(&params.thread_id, params.name.as_deref())
        .await
        .map_err(|e| format!("thread/fork failed: {e}"))
}

/// Read a thread via the codex app-server.
#[tauri::command]
pub(crate) async fn read_codex_rpc_thread(
    app: AppHandle,
    params: ReadCodexRpcThreadParams,
) -> Result<serde_json::Value, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .read_thread(&params.thread_id)
        .await
        .map_err(|e| format!("thread/read failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Turn steering Tauri commands
// ---------------------------------------------------------------------------

/// Steer the active turn via the codex app-server.
#[tauri::command]
pub(crate) async fn steer_codex_rpc_turn(
    app: AppHandle,
    params: SteerCodexRpcTurnParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .steer_turn(&params.turn_id, &params.input)
        .await
        .map_err(|e| format!("turn/steer failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Code review Tauri commands
// ---------------------------------------------------------------------------

/// Start a code review via the codex app-server.
#[tauri::command]
pub(crate) async fn start_codex_rpc_review(
    app: AppHandle,
    params: StartCodexRpcReviewParams,
) -> Result<crate::codex_rpc_types::ReviewStartResponse, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .start_review(&params.thread_id, params.instruction.as_deref())
        .await
        .map_err(|e| format!("review/start failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Skills Tauri commands
// ---------------------------------------------------------------------------

/// List skills via the codex app-server.
#[tauri::command]
pub(crate) async fn list_codex_rpc_skills(
    app: AppHandle,
    params: ListCodexRpcSkillsParams,
) -> Result<Vec<crate::codex_rpc_types::SkillInfo>, String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .list_skills(params.cwd.as_deref())
        .await
        .map_err(|e| format!("skills/list failed: {e}"))
}

// ---------------------------------------------------------------------------
// Phase 5: Dynamic tool response Tauri commands
// ---------------------------------------------------------------------------

/// Respond to a dynamic tool call server request.
#[tauri::command]
pub(crate) async fn respond_codex_rpc_dynamic_tool(
    app: AppHandle,
    params: RespondCodexRpcDynamicToolParams,
) -> Result<(), String> {
    let session_store = app.state::<CodexRpcSessionStore>();
    let session_arc = {
        let store = session_store.sessions.lock().await;
        store
            .get(&params.session_id)
            .ok_or_else(|| format!("No active RPC session: {}", params.session_id))?
            .clone()
    };

    let mut session = session_arc.lock().await;
    session
        .respond_to_dynamic_tool(params.request_id, params.result)
        .await
        .map_err(|e| format!("dynamic tool response failed: {e}"))
}
