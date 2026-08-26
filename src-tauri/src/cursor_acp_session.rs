//! High-level Cursor ACP session: bootstrap, session/new|load, prompt, cancel.

use std::path::Path;

use anyhow::{anyhow, Context, Result};
use base64::Engine;
use serde_json::Value;
use tokio::sync::oneshot;

use crate::cursor_acp_transport::CursorAcpTransport;
use crate::cursor_acp_types::{
    parse_server_request, AcpServerRequest, AuthenticateParams, ClientCapabilities, ClientInfo,
    FsClientCapabilities, InitializeParams, JsonRpcId, JsonRpcMessage, PromptContent,
    SessionCancelParams, SessionLoadParams, SessionNewParams, SessionNewResult,
    SessionPromptParams, SetConfigOptionParams,
};

pub struct CursorAcpSession {
    transport: CursorAcpTransport,
    pub acp_session_id: Option<String>,
    pub project_path: String,
    /// True while a session/prompt request is in flight.
    pub prompt_in_flight: bool,
}

impl CursorAcpSession {
    pub async fn bootstrap(
        binary_path: &str,
        api_key: Option<&str>,
        project_path: &str,
    ) -> Result<Self> {
        let mut transport =
            CursorAcpTransport::spawn(binary_path, api_key, Some(project_path)).await?;

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
            .context("ACP initialize failed")?;
        Self::ensure_ok(&init_resp, "initialize")?;

        // Drain any early notifications.
        while transport.poll_notification().is_some() {}

        let auth_params = AuthenticateParams {
            method_id: "cursor_login".to_string(),
        };
        let auth_resp = transport
            .send_request("authenticate", Some(serde_json::to_value(&auth_params)?))
            .await
            .context("ACP authenticate failed")?;
        Self::ensure_ok(&auth_resp, "authenticate")?;

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
                        "ACP {method} error: {} ({})",
                        err.message,
                        err.code
                    ));
                }
                Ok(result.clone().unwrap_or(Value::Null))
            }
            other => Err(anyhow!("ACP {method}: unexpected response {other:?}")),
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
        let result = Self::ensure_ok(&resp, "session/load")?;
        // load may return sessionId or reuse the requested one
        let sid = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or(session_id)
            .to_string();
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

    pub async fn set_model_if_needed(&mut self, model: Option<&str>) -> Result<()> {
        let Some(raw) = model.map(str::trim).filter(|s| !s.is_empty()) else {
            return Ok(());
        };
        let lower = raw.to_ascii_lowercase();
        if lower == "auto" || lower == "default" {
            let _ = self.set_config_option("model", "default[]").await;
            return Ok(());
        }
        // Prefer exact id; if caller passed bare "composer-2.5", try with [fast=true].
        if let Err(e) = self.set_config_option("model", raw).await {
            if !raw.contains('[') {
                let alt = format!("{raw}[fast=true]");
                self.set_config_option("model", &alt)
                    .await
                    .with_context(|| format!("set model failed for {raw} and {alt}: {e}"))?;
            } else {
                return Err(e);
            }
        }
        Ok(())
    }

    /// Start a prompt without waiting; returns oneshot for the prompt response.
    pub async fn begin_prompt(
        &mut self,
        prompt: &str,
        attachments: &[(String, String)],
    ) -> Result<(JsonRpcId, oneshot::Receiver<JsonRpcMessage>)> {
        let sid = self
            .acp_session_id
            .clone()
            .ok_or_else(|| anyhow!("No ACP session id for prompt"))?;
        let params = SessionPromptParams {
            session_id: sid,
            prompt: build_cursor_acp_prompt(prompt, attachments),
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

const MAX_ACP_IMAGE_BYTES: u64 = 12 * 1024 * 1024;

fn path_to_file_uri(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.starts_with("file:") {
        return trimmed.to_string();
    }
    let display = Path::new(trimmed).to_string_lossy();
    if cfg!(windows) {
        let normalized = display.replace('\\', "/");
        if normalized.starts_with('/') {
            format!("file://{normalized}")
        } else {
            format!("file:///{normalized}")
        }
    } else {
        format!("file://{display}")
    }
}

fn load_image_prompt_block(path: &str, mime: &str) -> Option<PromptContent> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    let meta = std::fs::metadata(trimmed).ok()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_ACP_IMAGE_BYTES {
        return None;
    }
    let bytes = std::fs::read(trimmed).ok()?;
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    let mime_type = mime.trim();
    Some(PromptContent::Image {
        data,
        mime_type: if mime_type.is_empty() {
            "image/png".to_string()
        } else {
            mime_type.to_string()
        },
        uri: Some(path_to_file_uri(trimmed)),
    })
}

/// Build ACP `session/prompt` content: text first, then inline images (base64).
pub(crate) fn build_cursor_acp_prompt(
    prompt: &str,
    attachments: &[(String, String)],
) -> Vec<PromptContent> {
    let mut blocks = vec![PromptContent::Text {
        text: prompt.to_string(),
    }];
    for (path, mime) in attachments {
        match load_image_prompt_block(path, mime) {
            Some(block) => blocks.push(block),
            None => blocks.push(PromptContent::Text {
                text: format!("[附件] {path} ({mime})"),
            }),
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp_png() -> std::path::PathBuf {
        // 1x1 transparent PNG
        const PNG: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        let mut path = std::env::temp_dir();
        path.push(format!("wise-acp-img-{}.png", uuid::Uuid::new_v4().simple()));
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(PNG).unwrap();
        path
    }

    #[test]
    fn build_cursor_acp_prompt_inlines_readable_images() {
        let path = write_temp_png();
        let blocks = build_cursor_acp_prompt(
            "图中有什么",
            &[(path.to_string_lossy().to_string(), "image/png".to_string())],
        );
        assert_eq!(blocks.len(), 2);
        match &blocks[0] {
            PromptContent::Text { text } => assert_eq!(text, "图中有什么"),
            other => panic!("expected text, got {other:?}"),
        }
        match &blocks[1] {
            PromptContent::Image {
                data,
                mime_type,
                uri,
            } => {
                assert!(!data.is_empty());
                assert_eq!(mime_type, "image/png");
                assert!(uri.as_ref().unwrap().starts_with("file://"));
            }
            other => panic!("expected image, got {other:?}"),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn build_cursor_acp_prompt_falls_back_to_path_hint() {
        let blocks = build_cursor_acp_prompt(
            "hello",
            &[("/definitely/missing/wise-acp.png".to_string(), "image/png".to_string())],
        );
        assert_eq!(blocks.len(), 2);
        match &blocks[1] {
            PromptContent::Text { text } => {
                assert!(text.contains("/definitely/missing/wise-acp.png"));
            }
            other => panic!("expected text fallback, got {other:?}"),
        }
    }
}
