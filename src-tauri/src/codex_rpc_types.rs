//! Protocol types for the Codex App-Server JSON-RPC protocol (Phase 1 minimal set).
//!
//! These types model the `initialize`, `thread/*`, `turn/*`, and key server
//! notifications needed to drive a basic conversation session.
//!
//! Phase 2 adds server-initiated request types (approval requests) and the
//! ability for the client to respond.
//!
//! Phase 3 adds MCP (Model Context Protocol) types: server status listing,
//! elicitation requests, OAuth login, and direct tool invocation.
//!
//! Phase 4 adds sandbox command execution (`command/exec/*`) and filesystem
//! operations (`fs/*`).
//!
//! Phase 5 adds thread management (list, archive, fork, read, delete),
//! turn steering (`turn/steer`), code review (`review/start`), skills
//! listing (`skills/list`), and dynamic tool call server requests
//! (`item/tool/call`).

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

/// Parameters for the `initialize` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub client_info: ClientInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ClientCapabilities>,
}

/// Client identification sent during initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

/// Optional client capabilities advertised at initialization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub experimental_api: Option<bool>,
}

/// Response payload from the `initialize` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_home: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform_os: Option<String>,
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

/// Parameters for the `thread/start` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// 可选配置覆盖（与 CLI `-c key=value` / config.toml 同源键名）。
    /// 例如 `sandbox_mode`、`approval_policy`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<std::collections::HashMap<String, serde_json::Value>>,
}

/// Response payload from `thread/start`.
///
/// Wire shape: `{ "thread": { "id": "thr_…", … } }` (not a bare `{ "id": … }`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStartResponse {
    pub thread: ThreadInfo,
}

/// Parameters for the `thread/resume` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeParams {
    pub thread_id: String,
}

/// Response payload from `thread/resume` (same envelope as `thread/start`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadResumeResponse {
    pub thread: ThreadInfo,
}

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

/// Parameters for the `turn/start` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartParams {
    pub thread_id: String,
    /// App-server expects an array of input items, e.g. `[{ "type": "text", "text": "…" }]`.
    pub input: Vec<TurnInputItem>,
}

/// One user input item for `turn/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInputItem {
    #[serde(rename = "type")]
    pub item_type: String,
    pub text: String,
}

impl TurnInputItem {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            item_type: "text".to_string(),
            text: text.into(),
        }
    }
}

/// Backward-compatible alias used by older call sites / docs.
pub type TurnInput = TurnInputItem;

/// Turn metadata returned by `turn/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Response payload from `turn/start`.
///
/// Wire shape: `{ "turn": { "id": "turn_…", "status": "inProgress", … } }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartResponse {
    pub turn: TurnInfo,
}

/// Parameters for the `turn/interrupt` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInterruptParams {
    pub turn_id: String,
}

// ---------------------------------------------------------------------------
// Server Notifications
// ---------------------------------------------------------------------------

/// Thread metadata embedded in `thread/started` notifications.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadInfo {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A thread item (user message, agent message, command execution, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadItem {
    pub id: String,
    /// Item type discriminator: `"userMessage"`, `"agentMessage"`, `"commandExecution"`, etc.
    #[serde(default, rename = "type", alias = "item_type")]
    pub item_type: String,
    /// Raw JSON for forward compatibility — fields we don't model yet.
    #[serde(flatten)]
    pub raw: Value,
}

/// Typed server notifications dispatched by the app-server.
///
/// The wire format uses `"method": "thread/started"` etc. as the discriminator.
/// We parse with a manual `parse_notification` function for robustness against
/// unknown methods.
#[derive(Debug, Clone)]
pub enum ServerNotification {
    ThreadStarted {
        thread: ThreadInfo,
    },
    ThreadClosed {
        thread_id: String,
    },
    TurnStarted {
        turn_id: String,
        thread_id: String,
    },
    TurnCompleted {
        turn_id: String,
        thread_id: String,
        status: String,
    },
    ItemStarted {
        item_id: String,
        turn_id: String,
        item: ThreadItem,
    },
    ItemCompleted {
        item_id: String,
        turn_id: String,
        item: ThreadItem,
    },
    AgentMessageDelta {
        item_id: String,
        delta: String,
    },
    CommandExecutionOutputDelta {
        item_id: String,
        delta: String,
        stream: String,
    },
    Error {
        code: i64,
        message: String,
        data: Option<Value>,
    },
    /// A server-initiated request has been resolved (e.g. approval completed).
    ServerRequestResolved {
        thread_id: String,
        request_id: u64,
    },
    /// MCP server status changed (connecting, ready, failed, etc.).
    McpServerStatusUpdated {
        name: String,
        status: String,
        error: Option<String>,
    },
    /// MCP OAuth login completed for a server.
    McpOAuthLoginCompleted {
        name: String,
        success: bool,
        error: Option<String>,
    },
    /// Catch-all for notifications not yet modelled.
    Unknown {
        method: String,
        params: Option<Value>,
    },
    // --- Phase 4: Command execution & filesystem notifications ---
    /// `command/exec/outputDelta` — streamed output chunk for a running command.
    CommandExecOutputDeltaNotification {
        process_id: String,
        stream: String,
        delta_base64: String,
        cap_reached: bool,
    },
    /// `fs/changed` — filesystem watch notification.
    FsChanged {
        watch_id: String,
        changed_paths: Vec<String>,
    },
    // --- Phase 5: Turn plan / diff notifications ---
    /// `turn/planUpdated` — the agent's plan has been updated.
    TurnPlanUpdated {
        thread_id: String,
        turn_id: String,
        plan: Option<String>,
    },
    /// `turn/diffUpdated` — the cumulative diff has been updated.
    TurnDiffUpdated {
        thread_id: String,
        turn_id: String,
        diff: Option<String>,
    },
}

/// Parse a raw `(method, params)` pair from the transport into a typed notification.
///
/// Unknown method names are mapped to [`ServerNotification::Unknown`] so the
/// caller can decide whether to log, ignore, or forward them.
pub fn parse_notification(method: &str, params: Option<Value>) -> ServerNotification {
    let p = params.unwrap_or(Value::Null);
    match method {
        "thread/started" => {
            let thread = parse_thread_info(&p);
            ServerNotification::ThreadStarted { thread }
        }
        "thread/closed" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::ThreadClosed { thread_id }
        }
        "turn/started" => {
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::TurnStarted { turn_id, thread_id }
        }
        "turn/completed" | "turn/finished" => {
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let status = p
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed")
                .to_string();
            ServerNotification::TurnCompleted {
                turn_id,
                thread_id,
                status,
            }
        }
        "item/started" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let item = parse_thread_item(p.get("item"));
            ServerNotification::ItemStarted {
                item_id,
                turn_id,
                item,
            }
        }
        "item/completed" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let item = parse_thread_item(p.get("item"));
            ServerNotification::ItemCompleted {
                item_id,
                turn_id,
                item,
            }
        }
        "item/agentMessage/delta" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let delta = p
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            ServerNotification::AgentMessageDelta { item_id, delta }
        }
        "item/commandExecution/outputDelta" => {
            let item_id = p
                .get("itemId")
                .or_else(|| p.get("item_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let delta = p
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let stream = p
                .get("stream")
                .and_then(Value::as_str)
                .unwrap_or("stdout")
                .to_string();
            ServerNotification::CommandExecutionOutputDelta { item_id, delta, stream }
        }
        "error" => {
            let code = p.get("code").and_then(Value::as_i64).unwrap_or(0);
            let message = p
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Unknown error")
                .to_string();
            let data = p.get("data").cloned();
            ServerNotification::Error {
                code,
                message,
                data,
            }
        }
        "mcpServer/statusUpdated" | "mcp/serverStatusUpdated" => {
            let name = p
                .get("name")
                .or_else(|| p.get("server_name"))
                .or_else(|| p.get("serverName"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let status = p
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let error = p
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::McpServerStatusUpdated { name, status, error }
        }
        "mcpServer/oauthLoginCompleted" | "mcp/oauthLoginCompleted" => {
            let name = p
                .get("name")
                .or_else(|| p.get("server"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let success = p
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let error = p
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::McpOAuthLoginCompleted { name, success, error }
        }
        "serverRequest/resolved" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let request_id = p
                .get("requestId")
                .or_else(|| p.get("request_id"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            ServerNotification::ServerRequestResolved {
                thread_id,
                request_id,
            }
        }
        "command/exec/outputDelta" => {
            let process_id = p
                .get("processId")
                .or_else(|| p.get("process_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let stream = p
                .get("stream")
                .and_then(Value::as_str)
                .unwrap_or("stdout")
                .to_string();
            let delta_base64 = p
                .get("deltaBase64")
                .or_else(|| p.get("delta_base64"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cap_reached = p
                .get("capReached")
                .or_else(|| p.get("cap_reached"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            ServerNotification::CommandExecOutputDeltaNotification {
                process_id,
                stream,
                delta_base64,
                cap_reached,
            }
        }
        "fs/changed" => {
            let watch_id = p
                .get("watchId")
                .or_else(|| p.get("watch_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let changed_paths = p
                .get("changedPaths")
                .or_else(|| p.get("changed_paths"))
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            ServerNotification::FsChanged {
                watch_id,
                changed_paths,
            }
        }
        "turn/planUpdated" | "turn/plan_updated" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let plan = p
                .get("plan")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::TurnPlanUpdated { thread_id, turn_id, plan }
        }
        "turn/diffUpdated" | "turn/diff_updated" => {
            let thread_id = p
                .get("threadId")
                .or_else(|| p.get("thread_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let turn_id = p
                .get("turnId")
                .or_else(|| p.get("turn_id"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let diff = p
                .get("diff")
                .and_then(Value::as_str)
                .map(str::to_string);
            ServerNotification::TurnDiffUpdated { thread_id, turn_id, diff }
        }
        _ => ServerNotification::Unknown {
            method: method.to_string(),
            params: Some(p),
        },
    }
}

// ---------------------------------------------------------------------------
// Server-initiated requests (Phase 2)
// ---------------------------------------------------------------------------

/// Server-initiated request (the server asks the client for something).
///
/// The Codex App-Server protocol is **bidirectional**: the server sends
/// requests TO the client (for approvals, tool calls, elicitation), and the
/// client must respond with a matching JSON-RPC response message.
#[derive(Debug, Clone)]
pub enum ServerRequest {
    /// `item/commandExecution/requestApproval` — the server wants the user to
    /// approve (or decline) a command before it runs.
    CommandExecutionRequestApproval {
        request_id: u64,
        params: CommandExecutionApprovalParams,
    },
    /// `item/fileChange/requestApproval` — the server wants the user to
    /// approve (or decline) proposed file changes.
    FileChangeRequestApproval {
        request_id: u64,
        params: FileChangeApprovalParams,
    },
    /// `mcpServer/elicitation/create` — the server wants user input (elicitation).
    McpServerElicitationRequest {
        request_id: u64,
        params: McpElicitationParams,
    },
    /// `item/tool/call` — the server wants the client to execute a dynamic tool.
    DynamicToolCall {
        request_id: u64,
        params: DynamicToolCallRequestParams,
    },
    /// Catch-all for server request methods not yet modelled.
    Unknown {
        request_id: u64,
        method: String,
        params: Option<Value>,
    },
}

/// Parse a raw `(id, method, params)` tuple from the transport into a typed
/// [`ServerRequest`].
pub fn parse_server_request(
    id: u64,
    method: &str,
    params: Option<Value>,
) -> ServerRequest {
    match method {
        "item/commandExecution/requestApproval" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::CommandExecutionRequestApproval {
                request_id: id,
                params: p,
            }
        }
        "item/fileChange/requestApproval" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::FileChangeRequestApproval {
                request_id: id,
                params: p,
            }
        }
        method if method.starts_with("mcpServer/elicitation") || method == "mcp/elicitation/create" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::McpServerElicitationRequest {
                request_id: id,
                params: p,
            }
        }
        "item/tool/call" => {
            let p = params
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            ServerRequest::DynamicToolCall {
                request_id: id,
                params: p,
            }
        }
        _ => ServerRequest::Unknown {
            request_id: id,
            method: method.to_string(),
            params,
        },
    }
}

/// Parameters for `item/commandExecution/requestApproval`.
///
/// Fields are optional for forward-compatibility — the server may add new
/// fields without breaking older clients.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionApprovalParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available_decisions: Option<Vec<String>>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Parameters for `item/fileChange/requestApproval`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeApprovalParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// MCP Types (Phase 3)
// ---------------------------------------------------------------------------

/// MCP server status entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_status: Option<String>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Response from `mcpServer/listStatuses`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatusListResponse {
    pub data: Vec<McpServerStatusInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Parameters for `mcpServer/tool/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallParams {
    pub server: String,
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// Response from `mcpServer/tool/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResponse {
    #[serde(default)]
    pub content: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
}

/// Parameters for `mcpServer/oauth/login`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthLoginParams {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
}

/// Response from `mcpServer/oauth/login`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOAuthLoginResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
}

/// Parameters for an MCP elicitation server request.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_schema: Option<Value>,
    /// Catch-all for fields we don't model yet.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Elicitation response payload sent back to the server.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationResponse {
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
}

/// Approval decision sent back to the server in a JSON-RPC response.
///
/// Shared by both command-execution and file-change approval flows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApprovalDecision {
    Accept,
    AcceptForSession,
    Decline,
    Cancel,
}

// ---------------------------------------------------------------------------
// Command Execution Types (Phase 4)
// ---------------------------------------------------------------------------

/// PTY size in character cells for `command/exec` PTY sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecTerminalSize {
    pub rows: u16,
    pub cols: u16,
}

/// Parameters for the `command/exec` request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecParams {
    /// Command argv vector. Empty arrays are rejected.
    pub command: Vec<String>,
    /// Optional client-supplied, connection-scoped process id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
    /// Enable PTY mode (implies streamStdin and streamStdoutStderr).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tty: bool,
    /// Allow follow-up `command/exec/write` requests to write stdin bytes.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stream_stdin: bool,
    /// Stream stdout/stderr via `command/exec/outputDelta` notifications.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stream_stdout_stderr: bool,
    /// Optional timeout in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<i64>,
    /// Optional working directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// Optional environment overrides.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<HashMap<String, Option<String>>>,
    /// Optional initial PTY size.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<CommandExecTerminalSize>,
}

/// Final buffered result for `command/exec`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Write stdin bytes to a running `command/exec` session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecWriteParams {
    pub process_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta_base64: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub close_stdin: bool,
}

/// Terminate a running `command/exec` session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecTerminateParams {
    pub process_id: String,
}

/// Resize a running PTY-backed `command/exec` session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecResizeParams {
    pub process_id: String,
    pub size: CommandExecTerminalSize,
}

// ---------------------------------------------------------------------------
// Filesystem Types (Phase 4)
// ---------------------------------------------------------------------------

/// Parameters for `fs/readFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileParams {
    pub path: String,
}

/// Response from `fs/readFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadFileResponse {
    pub data_base64: String,
}

/// Parameters for `fs/writeFile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteFileParams {
    pub path: String,
    pub data_base64: String,
}

/// Parameters for `fs/createDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCreateDirectoryParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
}

/// Parameters for `fs/getMetadata`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGetMetadataParams {
    pub path: String,
}

/// Response from `fs/getMetadata`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsGetMetadataResponse {
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub created_at_ms: i64,
    pub modified_at_ms: i64,
}

/// Parameters for `fs/readDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirectoryParams {
    pub path: String,
}

/// A directory entry returned by `fs/readDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirectoryEntry {
    pub file_name: String,
    pub is_directory: bool,
    pub is_file: bool,
}

/// Response from `fs/readDirectory`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadDirectoryResponse {
    pub entries: Vec<FsReadDirectoryEntry>,
}

/// Parameters for `fs/remove`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsRemoveParams {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}

/// Parameters for `fs/copy`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCopyParams {
    pub source_path: String,
    pub destination_path: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub recursive: bool,
}

/// Parameters for `fs/watch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWatchParams {
    pub watch_id: String,
    pub path: String,
}

/// Response from `fs/watch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWatchResponse {
    pub path: String,
}

/// Parameters for `fs/unwatch`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsUnwatchParams {
    pub watch_id: String,
}

// ---------------------------------------------------------------------------
// Thread management types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `thread/list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}

/// Response from `thread/list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResponse {
    pub data: Vec<ThreadSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_more: Option<bool>,
}

/// A thread summary entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

/// Parameters for `thread/archive`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadArchiveParams {
    pub thread_id: String,
}

/// Parameters for `thread/unarchive`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUnarchiveParams {
    pub thread_id: String,
}

/// Parameters for `thread/delete`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDeleteParams {
    pub thread_id: String,
}

/// Parameters for `thread/fork`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadForkParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// Parameters for `thread/read`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadParams {
    pub thread_id: String,
}

// ---------------------------------------------------------------------------
// Turn steering types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `turn/steer`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerParams {
    pub turn_id: String,
    pub input: String,
}

// ---------------------------------------------------------------------------
// Code review types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `review/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStartParams {
    pub thread_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
}

/// Response from `review/start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewStartResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_id: Option<String>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// Skills types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for `skills/list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsListParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

/// A skill info entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// Dynamic tool call types (Phase 5)
// ---------------------------------------------------------------------------

/// Parameters for an `item/tool/call` server request.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolCallRequestParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
    /// Catch-all for forward-compatible fields.
    #[serde(flatten)]
    pub extra: Option<Value>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_thread_info(v: &Value) -> ThreadInfo {
    let thread_obj = v.get("thread").unwrap_or(v);
    let id = thread_obj
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let name = thread_obj
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string);
    ThreadInfo { id, name }
}

fn parse_thread_item(v: Option<&Value>) -> ThreadItem {
    match v {
        Some(val) => {
            let id = val
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let item_type = val
                .get("type")
                .or_else(|| val.get("item_type"))
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            ThreadItem {
                id,
                item_type,
                raw: val.clone(),
            }
        }
        None => ThreadItem {
            id: String::new(),
            item_type: "unknown".to_string(),
            raw: Value::Null,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_thread_start_response_envelope() {
        let raw = serde_json::json!({
            "thread": {
                "id": "thr_123",
                "sessionId": "thr_123",
                "preview": "",
                "ephemeral": false,
                "modelProvider": "openai",
                "createdAt": 1730910000
            },
            "model": "gpt-5.4",
            "cwd": "/tmp/demo"
        });
        let parsed: ThreadStartResponse = serde_json::from_value(raw).expect("parse");
        assert_eq!(parsed.thread.id, "thr_123");
    }

    #[test]
    fn parses_turn_start_response_envelope() {
        let raw = serde_json::json!({
            "turn": {
                "id": "turn_456",
                "status": "inProgress",
                "items": [],
                "error": null
            }
        });
        let parsed: TurnStartResponse = serde_json::from_value(raw).expect("parse");
        assert_eq!(parsed.turn.id, "turn_456");
        assert_eq!(parsed.turn.status.as_deref(), Some("inProgress"));
    }

    #[test]
    fn serializes_turn_start_input_as_item_array() {
        let params = TurnStartParams {
            thread_id: "thr_123".to_string(),
            input: vec![TurnInputItem::text("hello")],
        };
        let value = serde_json::to_value(&params).expect("serialize");
        assert_eq!(value["threadId"], "thr_123");
        assert_eq!(value["input"][0]["type"], "text");
        assert_eq!(value["input"][0]["text"], "hello");
    }
}
