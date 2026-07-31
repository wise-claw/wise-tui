//! Low-level JSON-RPC 2.0 transport for Cursor `agent acp` over stdio.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::cursor_acp_types::{JsonRpcId, JsonRpcMessage};
use crate::cursor_binary::{apply_cursor_child_env, cursor_merged_path_env};

/// Manages an `agent acp` subprocess over stdio (NDJSON JSON-RPC 2.0).
pub struct CursorAcpTransport {
    child: Child,
    stdin: Mutex<tokio::process::ChildStdin>,
    notification_rx: mpsc::Receiver<(String, Option<Value>)>,
    server_request_rx: mpsc::Receiver<(JsonRpcId, String, Option<Value>)>,
    pending_requests: Arc<Mutex<HashMap<JsonRpcId, oneshot::Sender<JsonRpcMessage>>>>,
    next_id: AtomicU64,
}

impl Drop for CursorAcpTransport {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl CursorAcpTransport {
    pub async fn spawn(binary_path: &str, api_key: Option<&str>, cwd: Option<&str>) -> Result<Self> {
        let path_env = cursor_merged_path_env();
        let mut cmd = Command::new(binary_path);
        apply_cursor_child_env(&mut cmd, &path_env);
        cmd.arg("acp");
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        if let Some(key) = api_key.map(str::trim).filter(|s| !s.is_empty()) {
            cmd.env("CURSOR_API_KEY", key);
        }
        if let Some(dir) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
            cmd.current_dir(dir);
        }

        let mut child = cmd
            .spawn()
            .with_context(|| format!("Failed to spawn agent acp: {binary_path}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to take agent acp stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to take agent acp stdout"))?;

        let pending_requests = Arc::new(Mutex::new(HashMap::new()));
        let (notification_tx, notification_rx) = mpsc::channel::<(String, Option<Value>)>(512);
        let (server_request_tx, server_request_rx) =
            mpsc::channel::<(JsonRpcId, String, Option<Value>)>(128);

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if std::env::var("WISE_CURSOR_ACP_DEBUG").ok().as_deref() == Some("1") {
                        eprintln!("[cursor_acp:stderr] {line}");
                    }
                }
            });
        }

        let pending_for_reader = Arc::clone(&pending_requests);
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let trimmed = line.trim().to_string();
                        if trimmed.is_empty() {
                            continue;
                        }
                        Self::handle_stdout_line(
                            &trimmed,
                            &pending_for_reader,
                            &notification_tx,
                            &server_request_tx,
                        )
                        .await;
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            pending_for_reader.lock().await.clear();
        });

        Ok(Self {
            child,
            stdin: Mutex::new(stdin),
            notification_rx,
            server_request_rx,
            pending_requests,
            next_id: AtomicU64::new(1),
        })
    }

    async fn handle_stdout_line(
        line: &str,
        pending_requests: &Arc<Mutex<HashMap<JsonRpcId, oneshot::Sender<JsonRpcMessage>>>>,
        notification_tx: &mpsc::Sender<(String, Option<Value>)>,
        server_request_tx: &mpsc::Sender<(JsonRpcId, String, Option<Value>)>,
    ) {
        let msg: JsonRpcMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[cursor_acp] Failed to parse JSON-RPC: {e}; line={}", &line[..line.len().min(200)]);
                return;
            }
        };

        match msg {
            JsonRpcMessage::Response { id, result, error, jsonrpc } => {
                let sender = {
                    let mut pending = pending_requests.lock().await;
                    pending.remove(&id)
                };
                if let Some(tx) = sender {
                    let _ = tx.send(JsonRpcMessage::Response {
                        jsonrpc,
                        id,
                        result,
                        error,
                    });
                } else {
                    eprintln!("[cursor_acp] Response for unknown id: {id:?}");
                }
            }
            JsonRpcMessage::Notification { method, params, .. } => {
                if notification_tx.try_send((method.clone(), params)).is_err() {
                    eprintln!("[cursor_acp] Notification channel full, dropping: {method}");
                }
            }
            JsonRpcMessage::Request {
                id, method, params, ..
            } => {
                if server_request_tx
                    .send((id.clone(), method.clone(), params))
                    .await
                    .is_err()
                {
                    eprintln!("[cursor_acp] Server-request channel closed: {method} id={id:?}");
                }
            }
        }
    }

    pub fn next_request_id(&self) -> JsonRpcId {
        JsonRpcId::Number(self.next_id.fetch_add(1, Ordering::Relaxed))
    }

    /// Write a request and return the oneshot that will receive the response.
    /// Caller must concurrently drain notifications / server requests while awaiting.
    pub async fn begin_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(JsonRpcId, oneshot::Receiver<JsonRpcMessage>)> {
        let id = self.next_request_id();
        let msg = JsonRpcMessage::Request {
            jsonrpc: "2.0".to_string(),
            id: id.clone(),
            method: method.to_string(),
            params,
        };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize request: {method}"))?;

        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id.clone(), tx);
        }

        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(wire.as_bytes())
                .await
                .with_context(|| format!("Failed to write ACP stdin: {method}"))?;
            stdin.write_all(b"\n").await?;
            stdin.flush().await?;
        }

        Ok((id, rx))
    }

    /// Convenience: begin + wait (no concurrent server-request handling).
    /// Safe for initialize / authenticate / session/new before a prompt.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<JsonRpcMessage> {
        let (_id, rx) = self.begin_request(method, params).await?;
        let response = tokio::time::timeout(std::time::Duration::from_secs(120), rx)
            .await
            .map_err(|_| anyhow!("Timeout waiting for ACP response: {method}"))?
            .with_context(|| format!("ACP reader dropped before responding to: {method}"))?;
        Ok(response)
    }

    pub async fn send_notification(&self, method: &str, params: Option<Value>) -> Result<()> {
        let msg = JsonRpcMessage::Notification {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
        };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize notification: {method}"))?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(wire.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn send_response(&self, id: JsonRpcId, result: Value) -> Result<()> {
        let msg = JsonRpcMessage::Response {
            jsonrpc: "2.0".to_string(),
            id: id.clone(),
            result: Some(result),
            error: None,
        };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize response id={id:?}"))?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(wire.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    pub fn poll_notification(&mut self) -> Option<(String, Option<Value>)> {
        self.notification_rx.try_recv().ok()
    }

    pub fn poll_server_request(&mut self) -> Option<(JsonRpcId, String, Option<Value>)> {
        self.server_request_rx.try_recv().ok()
    }

    pub async fn shutdown(&mut self) -> Result<()> {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
        Ok(())
    }

    pub fn is_child_exited(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(Some(_)))
    }
}
