//! OpenCode ACP (Agent Client Protocol) wire types.
//!
//! Same JSON-RPC 2.0 surface as the ACP spec (`opencode acp` over stdio),
//! plus the `session/request_permission` server request and session options.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 id (number or string).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum JsonRpcId {
    Number(u64),
    String(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Wire messages for OpenCode ACP (includes `"jsonrpc":"2.0"`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    Request {
        jsonrpc: String,
        id: JsonRpcId,
        method: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<Value>,
    },
    Response {
        jsonrpc: String,
        id: JsonRpcId,
        #[serde(default)]
        result: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<JsonRpcError>,
    },
    Notification {
        jsonrpc: String,
        method: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client_capabilities: ClientCapabilities,
    pub client_info: ClientInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    pub fs: FsClientCapabilities,
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsClientCapabilities {
    pub read_text_file: bool,
    pub write_text_file: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewParams {
    pub cwd: String,
    #[serde(default)]
    pub mcp_servers: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionNewResult {
    pub session_id: String,
    #[serde(default)]
    pub modes: Option<Value>,
    #[serde(default)]
    pub models: Option<Value>,
    #[serde(default)]
    pub config_options: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLoadParams {
    pub session_id: String,
    pub cwd: String,
    #[serde(default)]
    pub mcp_servers: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPromptParams {
    pub session_id: String,
    pub prompt: Vec<PromptContent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PromptContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCancelParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetConfigOptionParams {
    pub session_id: String,
    pub config_id: String,
    pub value: String,
}

/// Parsed server-initiated request kinds we handle.
#[derive(Debug, Clone)]
pub enum AcpServerRequest {
    RequestPermission {
        request_id: JsonRpcId,
        params: Value,
    },
    Unknown {
        request_id: JsonRpcId,
        method: String,
        params: Option<Value>,
    },
}

pub fn parse_server_request(
    request_id: JsonRpcId,
    method: &str,
    params: Option<Value>,
) -> AcpServerRequest {
    match method {
        "session/request_permission" => AcpServerRequest::RequestPermission {
            request_id,
            params: params.unwrap_or(Value::Null),
        },
        other => AcpServerRequest::Unknown {
            request_id,
            method: other.to_string(),
            params,
        },
    }
}

/// Permission response: `{ outcome: { outcome: "selected", optionId } }`.
pub fn permission_selected_result(option_id: &str) -> Value {
    serde_json::json!({
        "outcome": {
            "outcome": "selected",
            "optionId": option_id,
        }
    })
}

pub fn permission_cancelled_result() -> Value {
    serde_json::json!({
        "outcome": { "outcome": "cancelled" }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_response_with_jsonrpc_field() {
        let raw = r#"{"jsonrpc":"2.0","id":3,"result":{"sessionId":"ses_abc"}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(raw).unwrap();
        match msg {
            JsonRpcMessage::Response { id, result, error, .. } => {
                assert_eq!(id, JsonRpcId::Number(3));
                assert!(error.is_none());
                assert_eq!(
                    result.unwrap().get("sessionId").and_then(|v| v.as_str()),
                    Some("ses_abc")
                );
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_permission_request() {
        let raw = r#"{"jsonrpc":"2.0","id":0,"method":"session/request_permission","params":{"sessionId":"s","toolCall":{},"options":[{"optionId":"once"}]}}"#;
        let msg: JsonRpcMessage = serde_json::from_str(raw).unwrap();
        match msg {
            JsonRpcMessage::Request { id, method, params, .. } => {
                let req = parse_server_request(id, &method, params);
                assert!(matches!(req, AcpServerRequest::RequestPermission { .. }));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }
}
