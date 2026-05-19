//! Shared transport-level connection testing.
//!
//! v1 ships a structural skeleton: it validates the transport shape and
//! returns a deterministic `McpConnectionTestResult`. Real socket-level
//! probes (stdio spawn + JSON-RPC initialize handshake; HTTP `WWW-
//! Authenticate` parsing; SSE EventStream open) land in a follow-up
//! once the storage + UI surfaces are in place.

use std::time::Duration;

use super::protocol::{
    AuthMethod, McpConnectionTestResult, McpServer, McpToolSummary, McpTransport,
};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(5);

/// Probe a server's transport. v1 returns a *structural* validation result:
/// shape-checks every transport variant and returns ok on success. Real
/// network / process probing is out of scope for v1 (documented as
/// follow-up).
pub async fn test_transport(server: &McpServer) -> McpConnectionTestResult {
    let _ = DEFAULT_TIMEOUT;
    match &server.transport {
        McpTransport::Stdio { command, .. } => {
            if command.trim().is_empty() {
                return McpConnectionTestResult::fail("stdio transport requires a command");
            }
            McpConnectionTestResult::ok_empty()
        }
        McpTransport::Sse { url, .. }
        | McpTransport::Http { url, .. }
        | McpTransport::StreamableHttp { url, .. } => {
            if !is_well_formed_url(url) {
                return McpConnectionTestResult::fail(format!(
                    "transport url is not a valid http(s) URL: {url}"
                ));
            }
            McpConnectionTestResult::ok_empty()
        }
    }
}

/// Helper that callers can use to surface a synthetic OAuth challenge for
/// UX rehearsal. Real implementations route through `test_transport`.
pub fn synthetic_oauth_challenge(www_authenticate: &str) -> McpConnectionTestResult {
    McpConnectionTestResult::auth_required(www_authenticate.to_string(), AuthMethod::Oauth)
}

/// Stub builder used in tests + future engine implementations to surface
/// recovered tools. v1 callers do not exercise this path.
pub fn _ok_with_tools(tools: Vec<McpToolSummary>) -> McpConnectionTestResult {
    McpConnectionTestResult {
        ok: true,
        tools: Some(tools),
        error: None,
        needs_auth: false,
        auth_method: None,
        www_authenticate: None,
    }
}

fn is_well_formed_url(s: &str) -> bool {
    let lower = s.trim().to_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::protocol::{McpServer, McpSource};
    use std::collections::BTreeMap;

    fn server(transport: McpTransport) -> McpServer {
        McpServer {
            id: "id-1".to_string(),
            name: "test".to_string(),
            transport,
            enabled: true,
            source: McpSource::User,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[tokio::test]
    async fn stdio_with_empty_command_fails() {
        let s = server(McpTransport::Stdio {
            command: "  ".to_string(),
            args: vec![],
            env: BTreeMap::new(),
        });
        let r = test_transport(&s).await;
        assert!(!r.ok);
        assert!(r.error.unwrap().contains("requires a command"));
    }

    #[tokio::test]
    async fn stdio_with_command_passes_structural_check() {
        let s = server(McpTransport::Stdio {
            command: "claude-mcp".to_string(),
            args: vec!["--port".to_string(), "0".to_string()],
            env: BTreeMap::new(),
        });
        let r = test_transport(&s).await;
        assert!(r.ok);
    }

    #[tokio::test]
    async fn http_with_bare_host_rejected() {
        let s = server(McpTransport::Http {
            url: "example.com".to_string(),
            headers: BTreeMap::new(),
        });
        let r = test_transport(&s).await;
        assert!(!r.ok);
    }

    #[tokio::test]
    async fn https_url_passes_structural_check() {
        let s = server(McpTransport::StreamableHttp {
            url: "https://example.com/mcp".to_string(),
            headers: BTreeMap::new(),
        });
        let r = test_transport(&s).await;
        assert!(r.ok);
    }

    #[test]
    fn synthetic_oauth_challenge_marks_needs_auth() {
        let r = synthetic_oauth_challenge("Bearer realm=\"test\"");
        assert!(r.needs_auth);
        assert!(matches!(r.auth_method, Some(AuthMethod::Oauth)));
    }
}
