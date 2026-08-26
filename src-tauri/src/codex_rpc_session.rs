//! High-level session manager for the Codex App-Server JSON-RPC protocol.
//!
//! [`CodexRpcSession`] wraps [`CodexRpcTransport`] and provides a typed,
//! ergonomic API for the Phase 1 lifecycle:
//!
//! 1. `bootstrap` — spawn the subprocess, run the `initialize` handshake.
//! 2. `start_thread` / `resume_thread` — open or continue a conversation.
//! 3. `start_turn` / `interrupt_turn` — drive the conversation.
//! 4. `poll_notification` / `next_notification` — consume server events.
//! 5. `shutdown` — tear down the subprocess.

use anyhow::{anyhow, Context, Result};
use tokio::sync::mpsc;

use crate::codex_rpc_transport::CodexRpcTransport;
use crate::codex_rpc_types::{
    parse_notification, parse_server_request, ApprovalDecision, ClientCapabilities, ClientInfo,
    CommandExecParams, CommandExecResponse, CommandExecResizeParams, CommandExecTerminateParams,
    CommandExecWriteParams, FsCopyParams, FsCreateDirectoryParams, FsGetMetadataParams,
    FsGetMetadataResponse, FsReadDirectoryParams, FsReadDirectoryResponse, FsReadFileParams,
    FsReadFileResponse, FsRemoveParams, FsUnwatchParams, FsWatchParams, FsWatchResponse,
    FsWriteFileParams, InitializeParams, InitializeResponse, McpElicitationResponse,
    McpOAuthLoginParams, McpOAuthLoginResponse, McpServerStatusInfo, McpServerStatusListResponse,
    McpToolCallParams, McpToolCallResponse, ReviewStartParams, ReviewStartResponse,
    ServerNotification, ServerRequest, SkillInfo, SkillsListParams, ThreadArchiveParams,
    ThreadDeleteParams, ThreadForkParams, ThreadListParams, ThreadListResponse, ThreadReadParams,
    ThreadResumeParams, ThreadStartParams, ThreadStartResponse, ThreadSummary,
    ThreadUnarchiveParams, TurnInterruptParams, TurnInputItem, TurnStartParams, TurnStartResponse,
    TurnSteerParams,
};

/// A fully-initialized Codex App-Server session.
pub struct CodexRpcSession {
    transport: CodexRpcTransport,
    notification_rx: mpsc::Receiver<ServerNotification>,
    /// Receiver for typed server-initiated requests (approval prompts, etc.).
    server_request_rx: mpsc::Receiver<ServerRequest>,
    current_thread_id: Option<String>,
    current_turn_id: Option<String>,
    /// Effective model used for turn input shaping (vision vs path-only).
    active_model: Option<String>,
    initialized: bool,
}

#[allow(dead_code)]
impl CodexRpcSession {
    /// Bootstrap a new session:
    ///
    /// 1. Spawn `codex app-server --stdio`.
    /// 2. Send `initialize` request with client metadata.
    /// 3. Send `initialized` notification.
    /// 4. Start a forwarding task that converts raw `(method, params)` into
    ///    typed [`ServerNotification`] values.
    pub async fn bootstrap(
        binary_path: &str,
        spawn_env_overrides: Option<&(String, String)>,
    ) -> Result<Self> {
        let mut transport =
            CodexRpcTransport::spawn(binary_path, &["--stdio"], spawn_env_overrides).await?;

        // --- Initialize handshake ---
        let init_params = InitializeParams {
            client_info: ClientInfo {
                name: "wise-tui".to_string(),
                version: "0.1.0".to_string(),
            },
            capabilities: Some(ClientCapabilities {
                experimental_api: Some(false),
            }),
        };
        let params_value = serde_json::to_value(&init_params)
            .context("Failed to serialize initialize params")?;

        let response = match transport
            .send_request("initialize", Some(params_value))
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let _ = transport.shutdown().await;
                return Err(e).context("initialize request failed");
            }
        };

        // Validate the response shape (best-effort — log but don't fail on extra fields).
        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let _init_resp: InitializeResponse = serde_json::from_value(result.clone())
                    .unwrap_or_else(|_| {
                        InitializeResponse {
                            user_agent: None,
                            codex_home: None,
                            platform_family: None,
                            platform_os: None,
                        }
                    });
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => {
                let _ = transport.shutdown().await;
                return Err(anyhow!(
                    "initialize failed: [{}] {}",
                    error.code,
                    error.message
                ));
            }
            _ => {
                let _ = transport.shutdown().await;
                return Err(anyhow!("Unexpected response type for initialize"));
            }
        }

        // Send the `initialized` notification to complete the handshake.
        if let Err(e) = transport.send_notification("initialized", None).await {
            let _ = transport.shutdown().await;
            return Err(e).context("Failed to send initialized notification");
        }

        // --- Notification forwarding ---
        // Take the raw notification receiver from the transport and spawn a
        // forwarding task that converts (method, params) → ServerNotification.
        let raw_rx = transport.take_notification_rx();
        let (typed_tx, typed_rx) = mpsc::channel::<ServerNotification>(256);
        tokio::spawn(async move {
            let mut raw_rx = raw_rx;
            while let Some((method, params)) = raw_rx.recv().await {
                let notification = parse_notification(&method, params);
                if typed_tx.send(notification).await.is_err() {
                    break; // receiver dropped
                }
            }
        });

        // --- Server-request forwarding ---
        // Take the raw server-request receiver from the transport and spawn a
        // forwarding task that converts (id, method, params) → ServerRequest.
        let raw_srv_rx = transport.take_server_request_rx();
        let (srv_tx, srv_rx) = mpsc::channel::<ServerRequest>(128);
        tokio::spawn(async move {
            let mut raw_srv_rx = raw_srv_rx;
            while let Some((id, method, params)) = raw_srv_rx.recv().await {
                let request = parse_server_request(id, &method, params);
                if srv_tx.send(request).await.is_err() {
                    break; // receiver dropped
                }
            }
        });

        Ok(Self {
            transport,
            notification_rx: typed_rx,
            server_request_rx: srv_rx,
            current_thread_id: None,
            current_turn_id: None,
            active_model: None,
            initialized: true,
        })
    }

    /// Record the effective model for subsequent turn input shaping.
    pub fn set_active_model(&mut self, model: Option<&str>) {
        self.active_model = model
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
    }

    pub fn active_model(&self) -> Option<&str> {
        self.active_model.as_deref()
    }

    /// Start a new thread and return its id.
    pub async fn start_thread(
        &mut self,
        cwd: Option<&str>,
        model: Option<&str>,
        config: Option<std::collections::HashMap<String, serde_json::Value>>,
    ) -> Result<String> {
        self.set_active_model(model);
        let params = ThreadStartParams {
            model: model.map(str::to_string),
            cwd: cwd.map(str::to_string),
            config,
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/start params")?;

        let response = self
            .transport
            .send_request("thread/start", Some(params_value))
            .await
            .context("thread/start request failed")?;

        let thread_id = match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let thread_resp: ThreadStartResponse = serde_json::from_value(result.clone())
                    .with_context(|| {
                        format!(
                            "Failed to parse thread/start response: {}",
                            truncate_json_for_error(result)
                        )
                    })?;
                thread_resp.thread.id
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => {
                return Err(anyhow!(
                    "thread/start failed: [{}] {}",
                    error.code,
                    error.message
                ));
            }
            _ => return Err(anyhow!("Unexpected response type for thread/start")),
        };

        self.current_thread_id = Some(thread_id.clone());
        Ok(thread_id)
    }

    /// Resume an existing thread by id.
    pub async fn resume_thread(&mut self, thread_id: &str) -> Result<()> {
        let params = ThreadResumeParams {
            thread_id: thread_id.to_string(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/resume params")?;

        let response = self
            .transport
            .send_request("thread/resume", Some(params_value))
            .await
            .context("thread/resume request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                // Prefer the id returned by the server when present.
                if let Ok(parsed) =
                    serde_json::from_value::<crate::codex_rpc_types::ThreadResumeResponse>(
                        result.clone(),
                    )
                {
                    self.current_thread_id = Some(parsed.thread.id);
                } else {
                    self.current_thread_id = Some(thread_id.to_string());
                }
                Ok(())
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/resume failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/resume")),
        }
    }

    /// Start a new turn from Wise Composer outbound text.
    ///
    /// Vision models: `附图：@/abs/path` → inline `image` / `localImage`.
    /// Non-vision models: keep path text only (avoids `[Unsupported Image]`).
    ///
    /// `effort` maps to app-server `turn/start.effort` (ChatGPT-style reasoning intensity).
    pub async fn start_turn(&mut self, input: &str, effort: Option<&str>) -> Result<String> {
        let items =
            crate::codex_rpc_types::build_turn_input_items_from_composer_prompt_for_model(
                input,
                self.active_model.as_deref(),
            );
        self.start_turn_with_items(items, effort).await
    }

    /// Start a new turn with pre-built app-server input items.
    pub async fn start_turn_with_items(
        &mut self,
        input: Vec<TurnInputItem>,
        effort: Option<&str>,
    ) -> Result<String> {
        let thread_id = self
            .current_thread_id
            .clone()
            .ok_or_else(|| anyhow!("No active thread — call start_thread or resume_thread first"))?;

        if input.is_empty() {
            return Err(anyhow!("turn/start requires at least one input item"));
        }

        let summary: Vec<&'static str> = input
            .iter()
            .map(|item| match item {
                TurnInputItem::Text { .. } => "text",
                TurnInputItem::LocalImage { .. } => "localImage",
                TurnInputItem::Image { .. } => "image",
            })
            .collect();
        let effort_trimmed = effort
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        eprintln!(
            "[codex_rpc] turn/start input items: {} {:?} effort={:?}",
            summary.len(),
            summary,
            effort_trimmed.as_deref()
        );

        let params = TurnStartParams {
            thread_id,
            input,
            effort: effort_trimmed,
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize turn/start params")?;

        let response = self
            .transport
            .send_request("turn/start", Some(params_value))
            .await
            .context("turn/start request failed")?;

        let turn_id = match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let turn_resp: TurnStartResponse = serde_json::from_value(result.clone())
                    .with_context(|| {
                        format!(
                            "Failed to parse turn/start response: {}",
                            truncate_json_for_error(result)
                        )
                    })?;
                turn_resp.turn.id
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => {
                return Err(anyhow!(
                    "turn/start failed: [{}] {}",
                    error.code,
                    error.message
                ));
            }
            _ => return Err(anyhow!("Unexpected response type for turn/start")),
        };

        self.current_turn_id = Some(turn_id.clone());
        Ok(turn_id)
    }

    /// Interrupt the current in-flight turn.
    pub async fn interrupt_turn(&mut self) -> Result<()> {
        let turn_id = self
            .current_turn_id
            .clone()
            .ok_or_else(|| anyhow!("No active turn to interrupt"))?;

        let params = TurnInterruptParams { turn_id };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize turn/interrupt params")?;

        let response = self
            .transport
            .send_request("turn/interrupt", Some(params_value))
            .await
            .context("turn/interrupt request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => {
                self.current_turn_id = None;
                Ok(())
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "turn/interrupt failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for turn/interrupt")),
        }
    }

    /// Non-blocking poll for the next server notification.
    pub fn poll_notification(&mut self) -> Option<ServerNotification> {
        self.notification_rx.try_recv().ok()
    }

    /// Blocking wait for the next server notification.
    ///
    /// Returns `None` when the notification channel is closed (e.g. the
    /// subprocess has exited).
    pub async fn next_notification(&mut self) -> Option<ServerNotification> {
        self.notification_rx.recv().await
    }

    /// Non-blocking poll for the next server-initiated request.
    pub fn poll_server_request(&mut self) -> Option<ServerRequest> {
        self.server_request_rx.try_recv().ok()
    }

    /// Blocking wait for the next server-initiated request.
    ///
    /// Returns `None` when the server-request channel is closed.
    pub async fn next_server_request(&mut self) -> Option<ServerRequest> {
        self.server_request_rx.recv().await
    }

    /// Send an approval decision back to the server for a server-initiated request.
    ///
    /// `request_id` must match the `id` from the incoming [`ServerRequest`].
    /// The decision is wrapped in `{ "decision": ... }` as required by the
    /// Codex App-Server protocol.
    pub async fn respond_to_request(
        &mut self,
        request_id: u64,
        decision: &ApprovalDecision,
    ) -> Result<()> {
        let decision_value =
            serde_json::to_value(decision).context("Failed to serialize approval decision")?;
        let response = serde_json::json!({ "decision": decision_value });
        self.transport.send_response(request_id, response).await
    }

    /// Shut down the session: kill the child process and clean up state.
    pub async fn shutdown(&mut self) -> Result<()> {
        self.initialized = false;
        self.current_thread_id = None;
        self.current_turn_id = None;
        self.transport.shutdown().await
    }

    /// Whether the session has completed the initialize handshake.
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// The current thread id, if any.
    pub fn current_thread_id(&self) -> Option<&str> {
        self.current_thread_id.as_deref()
    }

    /// The current turn id, if any.
    pub fn current_turn_id(&self) -> Option<&str> {
        self.current_turn_id.as_deref()
    }

    // -----------------------------------------------------------------------
    // MCP methods (Phase 3)
    // -----------------------------------------------------------------------

    /// List MCP server statuses.
    pub async fn list_mcp_server_statuses(&mut self) -> Result<Vec<McpServerStatusInfo>> {
        let response = self
            .transport
            .send_request("mcpServer/listStatuses", None)
            .await
            .context("mcpServer/listStatuses request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let list_resp: McpServerStatusListResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse mcpServer/listStatuses response")?;
                Ok(list_resp.data)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => {
                Err(anyhow!(
                    "mcpServer/listStatuses failed: [{}] {}",
                    error.code,
                    error.message
                ))
            }
            _ => Err(anyhow!("Unexpected response type for mcpServer/listStatuses")),
        }
    }

    /// Call an MCP tool directly.
    pub async fn call_mcp_tool(
        &mut self,
        server: &str,
        tool: &str,
        arguments: Option<serde_json::Value>,
    ) -> Result<McpToolCallResponse> {
        let thread_id = self.current_thread_id.clone().unwrap_or_default();
        let params = McpToolCallParams {
            server: server.to_string(),
            tool: tool.to_string(),
            arguments,
            thread_id: if thread_id.is_empty() { None } else { Some(thread_id) },
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize mcpServer/tool/call params")?;

        let response = self
            .transport
            .send_request("mcpServer/tool/call", Some(params_value))
            .await
            .context("mcpServer/tool/call request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let tool_resp: McpToolCallResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse mcpServer/tool/call response")?;
                Ok(tool_resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => {
                Err(anyhow!(
                    "mcpServer/tool/call failed: [{}] {}",
                    error.code,
                    error.message
                ))
            }
            _ => Err(anyhow!("Unexpected response type for mcpServer/tool/call")),
        }
    }

    /// Start MCP OAuth login for a server.
    pub async fn start_mcp_oauth_login(&mut self, server_name: &str) -> Result<McpOAuthLoginResponse> {
        let params = McpOAuthLoginParams {
            name: server_name.to_string(),
            thread_id: self.current_thread_id.clone(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize mcpServer/oauth/login params")?;

        let response = self
            .transport
            .send_request("mcpServer/oauth/login", Some(params_value))
            .await
            .context("mcpServer/oauth/login request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let login_resp: McpOAuthLoginResponse = serde_json::from_value(result.clone())
                    .unwrap_or(McpOAuthLoginResponse { authorization_url: None });
                Ok(login_resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => {
                Err(anyhow!(
                    "mcpServer/oauth/login failed: [{}] {}",
                    error.code,
                    error.message
                ))
            }
            _ => Err(anyhow!("Unexpected response type for mcpServer/oauth/login")),
        }
    }

    /// Respond to an MCP elicitation request.
    pub async fn respond_to_mcp_elicitation(
        &mut self,
        request_id: u64,
        action: &str,
        content: Option<serde_json::Value>,
    ) -> Result<()> {
        let response_payload = McpElicitationResponse {
            action: action.to_string(),
            content,
        };
        let result = serde_json::to_value(&response_payload)
            .context("Failed to serialize MCP elicitation response")?;
        self.transport.send_response(request_id, result).await
    }

    // -----------------------------------------------------------------------
    // Command execution methods (Phase 4)
    // -----------------------------------------------------------------------

    /// Run a sandboxed command via `command/exec`.
    pub async fn exec_command(&mut self, params: CommandExecParams) -> Result<CommandExecResponse> {
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize command/exec params")?;

        let response = self
            .transport
            .send_request("command/exec", Some(params_value))
            .await
            .context("command/exec request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let exec_resp: CommandExecResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse command/exec response")?;
                Ok(exec_resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "command/exec failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for command/exec")),
        }
    }

    /// Write stdin bytes to a running command via `command/exec/write`.
    pub async fn write_command_stdin(&mut self, params: CommandExecWriteParams) -> Result<()> {
        let params_value = serde_json::to_value(&params)
            .context("Failed to serialize command/exec/write params")?;

        let response = self
            .transport
            .send_request("command/exec/write", Some(params_value))
            .await
            .context("command/exec/write request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "command/exec/write failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for command/exec/write")),
        }
    }

    /// Terminate a running command via `command/exec/terminate`.
    pub async fn terminate_command(&mut self, process_id: &str) -> Result<()> {
        let params = CommandExecTerminateParams {
            process_id: process_id.to_string(),
        };
        let params_value = serde_json::to_value(&params)
            .context("Failed to serialize command/exec/terminate params")?;

        let response = self
            .transport
            .send_request("command/exec/terminate", Some(params_value))
            .await
            .context("command/exec/terminate request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "command/exec/terminate failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for command/exec/terminate")),
        }
    }

    /// Resize a PTY-backed command via `command/exec/resize`.
    pub async fn resize_command(
        &mut self,
        process_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<()> {
        let params = CommandExecResizeParams {
            process_id: process_id.to_string(),
            size: crate::codex_rpc_types::CommandExecTerminalSize { rows, cols },
        };
        let params_value = serde_json::to_value(&params)
            .context("Failed to serialize command/exec/resize params")?;

        let response = self
            .transport
            .send_request("command/exec/resize", Some(params_value))
            .await
            .context("command/exec/resize request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "command/exec/resize failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for command/exec/resize")),
        }
    }

    // -----------------------------------------------------------------------
    // Filesystem methods (Phase 4)
    // -----------------------------------------------------------------------

    /// Read a file via `fs/readFile`. Returns base64-encoded contents.
    pub async fn fs_read_file(&mut self, path: &str) -> Result<FsReadFileResponse> {
        let params = FsReadFileParams {
            path: path.to_string(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/readFile params")?;

        let response = self
            .transport
            .send_request("fs/readFile", Some(params_value))
            .await
            .context("fs/readFile request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let resp: FsReadFileResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse fs/readFile response")?;
                Ok(resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/readFile failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/readFile")),
        }
    }

    /// Write a file via `fs/writeFile`.
    pub async fn fs_write_file(&mut self, path: &str, data_base64: &str) -> Result<()> {
        let params = FsWriteFileParams {
            path: path.to_string(),
            data_base64: data_base64.to_string(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/writeFile params")?;

        let response = self
            .transport
            .send_request("fs/writeFile", Some(params_value))
            .await
            .context("fs/writeFile request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/writeFile failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/writeFile")),
        }
    }

    /// Create a directory via `fs/createDirectory`.
    pub async fn fs_create_directory(&mut self, path: &str, recursive: bool) -> Result<()> {
        let params = FsCreateDirectoryParams {
            path: path.to_string(),
            recursive: Some(recursive),
        };
        let params_value = serde_json::to_value(&params)
            .context("Failed to serialize fs/createDirectory params")?;

        let response = self
            .transport
            .send_request("fs/createDirectory", Some(params_value))
            .await
            .context("fs/createDirectory request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/createDirectory failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/createDirectory")),
        }
    }

    /// Get metadata for a path via `fs/getMetadata`.
    pub async fn fs_get_metadata(&mut self, path: &str) -> Result<FsGetMetadataResponse> {
        let params = FsGetMetadataParams {
            path: path.to_string(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/getMetadata params")?;

        let response = self
            .transport
            .send_request("fs/getMetadata", Some(params_value))
            .await
            .context("fs/getMetadata request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let resp: FsGetMetadataResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse fs/getMetadata response")?;
                Ok(resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/getMetadata failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/getMetadata")),
        }
    }

    /// Read a directory via `fs/readDirectory`.
    pub async fn fs_read_directory(&mut self, path: &str) -> Result<FsReadDirectoryResponse> {
        let params = FsReadDirectoryParams {
            path: path.to_string(),
        };
        let params_value = serde_json::to_value(&params)
            .context("Failed to serialize fs/readDirectory params")?;

        let response = self
            .transport
            .send_request("fs/readDirectory", Some(params_value))
            .await
            .context("fs/readDirectory request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let resp: FsReadDirectoryResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse fs/readDirectory response")?;
                Ok(resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/readDirectory failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/readDirectory")),
        }
    }

    /// Remove a file or directory via `fs/remove`.
    pub async fn fs_remove(&mut self, path: &str, recursive: bool, force: bool) -> Result<()> {
        let params = FsRemoveParams {
            path: path.to_string(),
            recursive: Some(recursive),
            force: Some(force),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/remove params")?;

        let response = self
            .transport
            .send_request("fs/remove", Some(params_value))
            .await
            .context("fs/remove request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/remove failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/remove")),
        }
    }

    /// Copy a file or directory via `fs/copy`.
    pub async fn fs_copy(
        &mut self,
        source_path: &str,
        destination_path: &str,
        recursive: bool,
    ) -> Result<()> {
        let params = FsCopyParams {
            source_path: source_path.to_string(),
            destination_path: destination_path.to_string(),
            recursive,
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/copy params")?;

        let response = self
            .transport
            .send_request("fs/copy", Some(params_value))
            .await
            .context("fs/copy request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/copy failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/copy")),
        }
    }

    /// Start a filesystem watch via `fs/watch`.
    pub async fn fs_watch(&mut self, watch_id: &str, path: &str) -> Result<FsWatchResponse> {
        let params = FsWatchParams {
            watch_id: watch_id.to_string(),
            path: path.to_string(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/watch params")?;

        let response = self
            .transport
            .send_request("fs/watch", Some(params_value))
            .await
            .context("fs/watch request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let resp: FsWatchResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse fs/watch response")?;
                Ok(resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/watch failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/watch")),
        }
    }

    /// Stop a filesystem watch via `fs/unwatch`.
    pub async fn fs_unwatch(&mut self, watch_id: &str) -> Result<()> {
        let params = FsUnwatchParams {
            watch_id: watch_id.to_string(),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize fs/unwatch params")?;

        let response = self
            .transport
            .send_request("fs/unwatch", Some(params_value))
            .await
            .context("fs/unwatch request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "fs/unwatch failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for fs/unwatch")),
        }
    }

    // -----------------------------------------------------------------------
    // Thread management methods (Phase 5)
    // -----------------------------------------------------------------------

    /// List threads via `thread/list`.
    pub async fn list_threads(&mut self, params: Option<ThreadListParams>) -> Result<ThreadListResponse> {
        let params_value = params
            .map(|p| serde_json::to_value(&p))
            .transpose()
            .context("Failed to serialize thread/list params")?;

        let response = self
            .transport
            .send_request("thread/list", params_value)
            .await
            .context("thread/list request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let list_resp: ThreadListResponse = serde_json::from_value(result.clone())
                    .context("Failed to parse thread/list response")?;
                Ok(list_resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/list failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/list")),
        }
    }

    /// Archive a thread via `thread/archive`.
    pub async fn archive_thread(&mut self, thread_id: &str) -> Result<()> {
        let params = ThreadArchiveParams { thread_id: thread_id.to_string() };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/archive params")?;

        let response = self
            .transport
            .send_request("thread/archive", Some(params_value))
            .await
            .context("thread/archive request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/archive failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/archive")),
        }
    }

    /// Unarchive a thread via `thread/unarchive`.
    pub async fn unarchive_thread(&mut self, thread_id: &str) -> Result<()> {
        let params = ThreadUnarchiveParams { thread_id: thread_id.to_string() };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/unarchive params")?;

        let response = self
            .transport
            .send_request("thread/unarchive", Some(params_value))
            .await
            .context("thread/unarchive request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/unarchive failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/unarchive")),
        }
    }

    /// Delete a thread via `thread/delete`.
    pub async fn delete_thread(&mut self, thread_id: &str) -> Result<()> {
        let params = ThreadDeleteParams { thread_id: thread_id.to_string() };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/delete params")?;

        let response = self
            .transport
            .send_request("thread/delete", Some(params_value))
            .await
            .context("thread/delete request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/delete failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/delete")),
        }
    }

    /// Fork a thread via `thread/fork`.
    pub async fn fork_thread(&mut self, thread_id: &str, name: Option<&str>) -> Result<ThreadSummary> {
        let params = ThreadForkParams {
            thread_id: thread_id.to_string(),
            name: name.map(str::to_string),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/fork params")?;

        let response = self
            .transport
            .send_request("thread/fork", Some(params_value))
            .await
            .context("thread/fork request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let summary: ThreadSummary = serde_json::from_value(result.clone())
                    .context("Failed to parse thread/fork response")?;
                Ok(summary)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/fork failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/fork")),
        }
    }

    /// Read a thread via `thread/read`.
    pub async fn read_thread(&mut self, thread_id: &str) -> Result<serde_json::Value> {
        let params = ThreadReadParams { thread_id: thread_id.to_string() };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize thread/read params")?;

        let response = self
            .transport
            .send_request("thread/read", Some(params_value))
            .await
            .context("thread/read request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                Ok(result.clone())
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "thread/read failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for thread/read")),
        }
    }

    // -----------------------------------------------------------------------
    // Turn steering methods (Phase 5)
    // -----------------------------------------------------------------------

    /// Steer the active turn via `turn/steer` (same input-item shape as `turn/start`).
    pub async fn steer_turn(&mut self, turn_id: &str, input: &str) -> Result<()> {
        let items =
            crate::codex_rpc_types::build_turn_input_items_from_composer_prompt_for_model(
                input,
                self.active_model.as_deref(),
            );
        self.steer_turn_with_items(turn_id, items).await
    }

    /// Steer with pre-built app-server input items (supports `localImage` / `image`).
    pub async fn steer_turn_with_items(
        &mut self,
        turn_id: &str,
        input: Vec<TurnInputItem>,
    ) -> Result<()> {
        if input.is_empty() {
            return Err(anyhow!("turn/steer requires at least one input item"));
        }
        let params = TurnSteerParams {
            turn_id: turn_id.to_string(),
            input,
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize turn/steer params")?;

        let response = self
            .transport
            .send_request("turn/steer", Some(params_value))
            .await
            .context("turn/steer request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { .. } => Ok(()),
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "turn/steer failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for turn/steer")),
        }
    }

    // -----------------------------------------------------------------------
    // Code review methods (Phase 5)
    // -----------------------------------------------------------------------

    /// Start a code review via `review/start`.
    pub async fn start_review(&mut self, thread_id: &str, instruction: Option<&str>) -> Result<ReviewStartResponse> {
        let params = ReviewStartParams {
            thread_id: thread_id.to_string(),
            instruction: instruction.map(str::to_string),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize review/start params")?;

        let response = self
            .transport
            .send_request("review/start", Some(params_value))
            .await
            .context("review/start request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let review_resp: ReviewStartResponse = serde_json::from_value(result.clone())
                    .unwrap_or(ReviewStartResponse { review_id: None, extra: None });
                Ok(review_resp)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "review/start failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for review/start")),
        }
    }

    // -----------------------------------------------------------------------
    // Skills methods (Phase 5)
    // -----------------------------------------------------------------------

    /// List skills via `skills/list`.
    pub async fn list_skills(&mut self, cwd: Option<&str>) -> Result<Vec<SkillInfo>> {
        let params = SkillsListParams {
            cwd: cwd.map(str::to_string),
        };
        let params_value =
            serde_json::to_value(&params).context("Failed to serialize skills/list params")?;

        let response = self
            .transport
            .send_request("skills/list", Some(params_value))
            .await
            .context("skills/list request failed")?;

        match &response {
            crate::codex_rpc_transport::JsonRpcMessage::Response { result, .. } => {
                let skills: Vec<SkillInfo> = serde_json::from_value(result.clone())
                    .unwrap_or_default();
                Ok(skills)
            }
            crate::codex_rpc_transport::JsonRpcMessage::Error { error, .. } => Err(anyhow!(
                "skills/list failed: [{}] {}",
                error.code,
                error.message
            )),
            _ => Err(anyhow!("Unexpected response type for skills/list")),
        }
    }

    // -----------------------------------------------------------------------
    // Dynamic tool response (Phase 5)
    // -----------------------------------------------------------------------

    /// Respond to a dynamic tool call server request.
    pub async fn respond_to_dynamic_tool(
        &mut self,
        request_id: u64,
        result: serde_json::Value,
    ) -> Result<()> {
        self.transport.send_response(request_id, result).await
    }
}

fn truncate_json_for_error(value: &serde_json::Value) -> String {
    let raw = value.to_string();
    const MAX: usize = 400;
    if raw.len() <= MAX {
        raw
    } else {
        format!("{}…", &raw[..MAX])
    }
}
