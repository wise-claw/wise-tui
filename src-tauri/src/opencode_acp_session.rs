//! High-level OpenCode ACP session: bootstrap, session/new|load, prompt, cancel.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::sync::oneshot;

use crate::opencode_acp_transport::OpencodeAcpTransport;
use crate::opencode_acp_types::{
    parse_server_request, AcpServerRequest, ClientCapabilities, ClientInfo,
    FsClientCapabilities, InitializeParams, JsonRpcId, JsonRpcMessage, PromptContent,
    SessionCancelParams, SessionLoadParams, SessionNewParams, SessionNewResult,
    SessionPromptParams, SetConfigOptionParams,
};

pub struct OpencodeAcpSession {
    transport: OpencodeAcpTransport,
    pub acp_session_id: Option<String>,
    pub project_path: String,
    /// True while a session/prompt request is in flight.
    pub prompt_in_flight: bool,
}

impl OpencodeAcpSession {
    pub async fn bootstrap(binary_path: &str, project_path: &str) -> Result<Self> {
        let mut transport =
            OpencodeAcpTransport::spawn(binary_path, Some(project_path)).await?;

        // OpenCode ACP needs no `authenticate` step (auth is `opencode auth login`).
        let init_params = InitializeParams {
            protocol_version: 1,
            client_capabilities: ClientCapabilities {
                fs: FsClientCapabilities {
                    read_text_file: false,
                    write_text_file: false,
                },
                terminal: false,
            },
            client_info: ClientInfo {
                name: "wise-tui".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
        };
        let init_value = serde_json::to_value(&init_params)?;
        let init_resp = transport
            .send_request("initialize", Some(init_value))
            .await
            .context("OpenCode ACP initialize failed")?;
        Self::ensure_ok(&init_resp, "initialize")?;

        // Drain any early notifications (e.g. available_commands_update).
        while transport.poll_notification().is_some() {}

        Ok(Self {
            transport,
            acp_session_id: None,
            project_path: project_path.to_string(),
            prompt_in_flight: false,
        })
    }

    fn ensure_ok(msg: &JsonRpcMessage, method: &str) -> Result<Value> {
        match msg {
            JsonRpcMessage::Response {
                result, error, ..
            } => {
                if let Some(err) = error {
                    return Err(anyhow!(
                        "OpenCode ACP {method} error: {} ({})",
                        err.message,
                        err.code
                    ));
                }
                Ok(result.clone().unwrap_or(Value::Null))
            }
            other => Err(anyhow!("OpenCode ACP {method}: unexpected response {other:?}")),
        }
    }

    pub async fn session_new(&mut self) -> Result<String> {
        let params = SessionNewParams {
            cwd: self.project_path.clone(),
            mcp_servers: vec![],
        };
        let resp = self
            .transport
            .send_request("session/new", Some(serde_json::to_value(&params)?))
            .await?;
        let result = Self::ensure_ok(&resp, "session/new")?;
        let parsed: SessionNewResult = serde_json::from_value(result)
            .context("Failed to parse session/new result")?;
        self.acp_session_id = Some(parsed.session_id.clone());
        Ok(parsed.session_id)
    }

    pub async fn session_load(&mut self, session_id: &str) -> Result<String> {
        let params = SessionLoadParams {
            session_id: session_id.to_string(),
            cwd: self.project_path.clone(),
            mcp_servers: vec![],
        };
        let resp = self
            .transport
            .send_request("session/load", Some(serde_json::to_value(&params)?))
            .await?;
        let _ = Self::ensure_ok(&resp, "session/load")?;
        // load may not echo sessionId; keep the requested one.
        let sid = session_id.to_string();
        self.acp_session_id = Some(sid.clone());
        Ok(sid)
    }

    pub async fn set_config_option(&mut self, config_id: &str, value: &str) -> Result<()> {
        let Some(sid) = self.acp_session_id.clone() else {
            return Err(anyhow!("No ACP session for set_config_option"));
        };
        let params = SetConfigOptionParams {
            session_id: sid,
            config_id: config_id.to_string(),
            value: value.to_string(),
        };
        let resp = self
            .transport
            .send_request(
                "session/set_config_option",
                Some(serde_json::to_value(&params)?),
            )
            .await?;
        let _ = Self::ensure_ok(&resp, "session/set_config_option")?;
        Ok(())
    }

    /// Best-effort model switch. `auto`/empty keeps the session default.
    pub async fn set_model_if_needed(&mut self, model: Option<&str>) -> Result<()> {
        let Some(raw) = model.map(str::trim).filter(|s| !s.is_empty()) else {
            return Ok(());
        };
        let lower = raw.to_ascii_lowercase();
        if lower == "auto" || lower == "default" {
            return Ok(());
        }
        self.set_config_option("model", raw)
            .await
            .with_context(|| format!("set model failed for {raw}"))
    }

    /// Start a prompt without waiting; returns oneshot for the prompt response.
    pub async fn begin_prompt(
        &mut self,
        prompt: &str,
    ) -> Result<(JsonRpcId, oneshot::Receiver<JsonRpcMessage>)> {
        let sid = self
            .acp_session_id
            .clone()
            .ok_or_else(|| anyhow!("No ACP session id for prompt"))?;
        let params = SessionPromptParams {
            session_id: sid,
            prompt: vec![PromptContent::Text {
                text: prompt.to_string(),
            }],
        };
        let (id, rx) = self
            .transport
            .begin_request("session/prompt", Some(serde_json::to_value(&params)?))
            .await?;
        self.prompt_in_flight = true;
        Ok((id, rx))
    }

    pub async fn cancel_prompt(&mut self) -> Result<()> {
        if let Some(sid) = self.acp_session_id.clone() {
            let params = SessionCancelParams { session_id: sid };
            // Best-effort: agent may ignore or delay the cancel notification.
            let _ = self
                .transport
                .send_notification("session/cancel", Some(serde_json::to_value(&params)?))
                .await;
        }
        // Always unblock the local prompt waiter so the turn loop can exit and
        // release `busy` — otherwise "结束" then re-send fails with overlapping turn.
        self.transport.abort_pending_requests("cancelled").await;
        self.prompt_in_flight = false;
        Ok(())
    }

    pub async fn respond(&mut self, id: JsonRpcId, result: Value) -> Result<()> {
        self.transport.send_response(id, result).await
    }

    pub fn poll_notification(&mut self) -> Option<(String, Option<Value>)> {
        self.transport.poll_notification()
    }

    pub fn poll_server_request(&mut self) -> Option<AcpServerRequest> {
        self.transport
            .poll_server_request()
            .map(|(id, method, params)| parse_server_request(id, &method, params))
    }

    pub fn mark_prompt_done(&mut self) {
        self.prompt_in_flight = false;
    }

    pub async fn shutdown(&mut self) -> Result<()> {
        self.transport.shutdown().await
    }

    pub fn is_dead(&mut self) -> bool {
        self.transport.is_child_exited()
    }
}
