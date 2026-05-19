//! MCP protocol contract — types shared between every backend.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TransportKind {
    Stdio,
    Sse,
    Http,
    StreamableHttp,
}

impl TransportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            TransportKind::Stdio => "stdio",
            TransportKind::Sse => "sse",
            TransportKind::Http => "http",
            TransportKind::StreamableHttp => "streamable_http",
        }
    }
}

/// Tagged JSON: `{ "type": "stdio", "command": "...", ... }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
    StreamableHttp {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

impl McpTransport {
    pub fn kind(&self) -> TransportKind {
        match self {
            McpTransport::Stdio { .. } => TransportKind::Stdio,
            McpTransport::Sse { .. } => TransportKind::Sse,
            McpTransport::Http { .. } => TransportKind::Http,
            McpTransport::StreamableHttp { .. } => TransportKind::StreamableHttp,
        }
    }
}

/// Source / origin of an MCP server record.
///
/// Wire format:
/// - `user`
/// - `builtin`
/// - `extension:<extensionName>`
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpSource {
    User,
    Builtin,
    Extension(String),
}

impl McpSource {
    pub fn to_wire(&self) -> String {
        match self {
            McpSource::User => "user".to_string(),
            McpSource::Builtin => "builtin".to_string(),
            McpSource::Extension(name) => format!("extension:{name}"),
        }
    }

    pub fn from_wire(s: &str) -> Option<Self> {
        match s {
            "user" => Some(Self::User),
            "builtin" => Some(Self::Builtin),
            other => other
                .strip_prefix("extension:")
                .map(|name| Self::Extension(name.to_string())),
        }
    }
}

impl Serialize for McpSource {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_wire())
    }
}

impl<'de> Deserialize<'de> for McpSource {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Self::from_wire(&s).ok_or_else(|| serde::de::Error::custom(format!("unknown McpSource '{s}'")))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub transport: McpTransport,
    pub enabled: bool,
    pub source: McpSource,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSummary {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Oauth,
    Basic,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionTestResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<McpToolSummary>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub needs_auth: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<AuthMethod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub www_authenticate: Option<String>,
}

impl McpConnectionTestResult {
    pub fn ok_empty() -> Self {
        Self {
            ok: true,
            tools: Some(Vec::new()),
            error: None,
            needs_auth: false,
            auth_method: None,
            www_authenticate: None,
        }
    }

    pub fn fail(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            tools: None,
            error: Some(error.into()),
            needs_auth: false,
            auth_method: None,
            www_authenticate: None,
        }
    }

    /// Auth-challenge result. Kept for in-progress engine implementations
    /// (Claude/Codex/Gemini) that will surface 401/Bearer challenges through
    /// the shared protocol; no v1 caller yet.
    #[allow(dead_code)]
    pub fn auth_required(www_authenticate: String, method: AuthMethod) -> Self {
        Self {
            ok: false,
            tools: None,
            error: Some("authentication required".to_string()),
            needs_auth: true,
            auth_method: Some(method),
            www_authenticate: Some(www_authenticate),
        }
    }
}

/// Per-server sync outcome surfaced by `McpProtocol::sync_servers`. Scaffolding
/// for the engine-specific implementations; no v1 Rust consumer yet.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub engine_id: String,
    pub server_id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Backend-neutral MCP protocol every concrete agent implements. v1 has
/// no Rust-side trait consumer (the Tauri commands operate on storage
/// directly), but downstream tasks will plug Claude / Codex / Gemini
/// implementations against this contract.
#[allow(dead_code)]
#[async_trait::async_trait]
pub trait McpProtocol: Send + Sync {
    fn id(&self) -> &'static str;
    fn supported_transports(&self) -> &'static [TransportKind];
    async fn list_servers(&self) -> Result<Vec<McpServer>, String>;
    async fn sync_servers(&self, servers: &[McpServer]) -> Vec<SyncResult>;
    async fn remove_server(&self, name: &str) -> Result<(), String>;
    async fn test_connection(&self, server: &McpServer) -> McpConnectionTestResult;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_round_trips_extension_with_colon() {
        let s = McpSource::Extension("hello-world".to_string());
        let wire = s.to_wire();
        assert_eq!(wire, "extension:hello-world");
        let back = McpSource::from_wire(&wire).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn source_user_and_builtin_round_trip() {
        assert_eq!(McpSource::from_wire("user"), Some(McpSource::User));
        assert_eq!(McpSource::from_wire("builtin"), Some(McpSource::Builtin));
        assert_eq!(McpSource::User.to_wire(), "user");
        assert_eq!(McpSource::Builtin.to_wire(), "builtin");
    }

    #[test]
    fn transport_serializes_with_type_tag() {
        let t = McpTransport::Stdio {
            command: "claude-mcp".to_string(),
            args: vec!["--port".to_string(), "0".to_string()],
            env: BTreeMap::new(),
        };
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["type"], "stdio");
        assert_eq!(json["command"], "claude-mcp");
    }

    #[test]
    fn transport_deserializes_streamable_http_with_headers() {
        let v: McpTransport = serde_json::from_value(serde_json::json!({
            "type": "streamable_http",
            "url": "https://x.example.com/mcp",
            "headers": { "X-Token": "abc" }
        }))
        .unwrap();
        assert_eq!(v.kind(), TransportKind::StreamableHttp);
    }
}
