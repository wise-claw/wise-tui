//! High-level ACP session: bootstrap, session/new|load|resume, prompt, cancel.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::sync::oneshot;

use crate::acp_engine::AcpEngine;
use crate::opencode_acp_transport::OpencodeAcpTransport;
use crate::opencode_acp_types::{
    parse_server_request, AcpServerRequest, ClientCapabilities, ClientInfo,
    FsClientCapabilities, InitializeParams, JsonRpcId, JsonRpcMessage, PromptContent,
    SessionCancelParams, SessionLoadParams, SessionNewParams, SessionNewResult,
    SessionPromptParams, SetConfigOptionParams,
};

pub struct OpencodeAcpSession {
    engine: AcpEngine,
    transport: OpencodeAcpTransport,
    pub acp_session_id: Option<String>,
    pub project_path: String,
    /// Full configuration-option state returned by `session/new` (includes the
    /// model catalog for engines that advertise it, e.g. DeepSeek Harness).
    pub config_options: Option<Value>,
    /// True while a session/prompt request is in flight.
    pub prompt_in_flight: bool,
}

impl OpencodeAcpSession {
    pub async fn bootstrap(
        engine: AcpEngine,
        binary_path: &str,
        project_path: &str,
    ) -> Result<Self> {
        let mut transport =
            OpencodeAcpTransport::spawn(engine, binary_path, Some(project_path)).await?;

        // Neither agent needs an `authenticate` handshake: auth is configured in the
        // agent's own settings (opencode auth / dsh provider + API key).
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
            .with_context(|| format!("{} ACP initialize failed", engine.display_name()))?;
        Self::ensure_ok(engine, &init_resp, "initialize")?;

        // Drain any early notifications (e.g. available_commands_update).
        while transport.poll_notification().is_some() {}

        Ok(Self {
            engine,
            transport,
            acp_session_id: None,
            project_path: project_path.to_string(),
            config_options: None,
            prompt_in_flight: false,
        })
    }

    fn ensure_ok(engine: AcpEngine, msg: &JsonRpcMessage, method: &str) -> Result<Value> {
        match msg {
            JsonRpcMessage::Response {
                result, error, ..
            } => {
                if let Some(err) = error {
                    return Err(anyhow!(
                        "{} ACP {method} error: {} ({})",
                        engine.display_name(),
                        err.message,
                        err.code
                    ));
                }
                Ok(result.clone().unwrap_or(Value::Null))
            }
            other => Err(anyhow!(
                "{} ACP {method}: unexpected response {other:?}",
                engine.display_name()
            )),
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
        let result = Self::ensure_ok(self.engine, &resp, "session/new")?;
        let parsed: SessionNewResult = serde_json::from_value(result)
            .context("Failed to parse session/new result")?;
        self.config_options = parsed.config_options.clone();
        self.acp_session_id = Some(parsed.session_id.clone());
        Ok(parsed.session_id)
    }

    /// Attach an existing persisted session using this engine's resume method
    /// (`session/load` for OpenCode, `session/resume` for DeepSeek Harness).
    pub async fn session_load(&mut self, session_id: &str) -> Result<String> {
        let params = SessionLoadParams {
            session_id: session_id.to_string(),
            cwd: self.project_path.clone(),
            mcp_servers: vec![],
        };
        let method = self.engine.resume_method();
        let resp = self
            .transport
            .send_request(method, Some(serde_json::to_value(&params)?))
            .await?;
        let _ = Self::ensure_ok(self.engine, &resp, method)?;
        // load / resume may not echo sessionId; keep the requested one.
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
        let _ = Self::ensure_ok(self.engine, &resp, "session/set_config_option")?;
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

    /// Best-effort `session/close` (supported by DeepSeek Harness). Ignored when
    /// the engine does not implement it or the process is already gone.
    pub async fn session_close(&mut self) -> Result<()> {
        let Some(sid) = self.acp_session_id.clone() else {
            return Ok(());
        };
        let params = serde_json::json!({ "sessionId": sid });
        let _ = self
            .transport
            .send_request("session/close", Some(params))
            .await;
        self.acp_session_id = None;
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
