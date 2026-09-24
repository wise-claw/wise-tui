//! Low-level JSON-RPC 2.0 transport for ACP agents (`opencode acp`, `dsh --profile acp`) over stdio.

use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use crate::pending_rpc_request::{PendingRequestMap, PendingResponse};

use crate::acp_engine::AcpEngine;
use crate::opencode_acp_types::{JsonRpcId, JsonRpcMessage};

/// Manages an ACP agent subprocess over stdio (NDJSON JSON-RPC 2.0).
pub struct OpencodeAcpTransport {
    child: Child,
    stdin: Mutex<tokio::process::ChildStdin>,
    notification_rx: mpsc::Receiver<(String, Option<Value>)>,
    server_request_rx: mpsc::Receiver<(JsonRpcId, String, Option<Value>)>,
    pending_requests: PendingRequestMap<JsonRpcId, JsonRpcMessage>,
    next_id: AtomicU64,
}

impl Drop for OpencodeAcpTransport {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl OpencodeAcpTransport {
    pub async fn spawn(engine: AcpEngine, binary_path: &str, cwd: Option<&str>) -> Result<Self> {
        let path_env = engine.merged_path_env();
        let mut cmd = Command::new(binary_path);
        engine.apply_child_env(&mut cmd, &path_env);
        cmd.args(engine.spawn_args());
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        if let Some(dir) = cwd.map(str::trim).filter(|s| !s.is_empty()) {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().with_context(|| {
            format!("Failed to spawn {} acp: {binary_path}", engine.display_name())
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to take {} acp stdin", engine.display_name()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to take {} acp stdout", engine.display_name()))?;

        let pending_requests = Arc::new(std::sync::Mutex::new(HashMap::new()));
        let (notification_tx, notification_rx) = mpsc::channel::<(String, Option<Value>)>(512);
        let (server_request_tx, server_request_rx) =
            mpsc::channel::<(JsonRpcId, String, Option<Value>)>(128);

        if let Some(stderr) = child.stderr.take() {
            let debug_env = engine.debug_env();
            let debug_prefix = format!("[{}_acp:stderr]", engine.kind());
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if std::env::var(debug_env).ok().as_deref() == Some("1") {
                        eprintln!("{debug_prefix} {line}");
                    }
                }
            });
        }

        let pending_for_reader = Arc::clone(&pending_requests);
        let reader_engine = engine;
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
                            reader_engine,
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
            pending_for_reader.lock().unwrap_or_else(|e| e.into_inner()).clear();
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
        engine: AcpEngine,
        line: &str,
        pending_requests: &PendingRequestMap<JsonRpcId, JsonRpcMessage>,
        notification_tx: &mpsc::Sender<(String, Option<Value>)>,
        server_request_tx: &mpsc::Sender<(JsonRpcId, String, Option<Value>)>,
    ) {
        let msg: JsonRpcMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(e) => {
                eprintln!(
                    "[{}_acp] Failed to parse JSON-RPC: {e}; line={}",
                    engine.kind(),
                    &line[..line.len().min(200)]
                );
                return;
            }
        };

        match msg {
            JsonRpcMessage::Response { id, result, error, jsonrpc } => {
                let sender = {
                    let mut pending = pending_requests.lock().unwrap_or_else(|e| e.into_inner());
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
                    eprintln!("[{}_acp] Response for unknown id: {id:?}", engine.kind());
                }
            }
            JsonRpcMessage::Notification { method, params, .. } => {
                if notification_tx.try_send((method.clone(), params)).is_err() {
                    eprintln!(
                        "[{}_acp] Notification channel full, dropping: {method}",
                        engine.kind()
                    );
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
                    eprintln!(
                        "[{}_acp] Server-request channel closed: {method} id={id:?}",
                        engine.kind()
                    );
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
    ) -> Result<(JsonRpcId, PendingResponse<JsonRpcId, JsonRpcMessage>)> {
        let id = self.next_request_id();
        let msg = JsonRpcMessage::Request {
            jsonrpc: "2.0".to_string(),
            id: id.clone(),
            method: method.to_string(),
            params,
        };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize request: {method}"))?;

        let rx = PendingResponse::register(&self.pending_requests, id.clone());

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

    /// Locally complete every in-flight JSON-RPC request waiter.
    ///
    /// Used when `session/cancel` is sent: the agent may not reply to `session/prompt`
    /// promptly (or at all). Without forcing the oneshot closed, the prompt loop
    /// never exits and the tab `busy` flag stays stuck.
    pub async fn abort_pending_requests(&self, stop_reason: &str) {
        let pending: HashMap<JsonRpcId, oneshot::Sender<JsonRpcMessage>> = {
            let mut map = self.pending_requests.lock().unwrap_or_else(|e| e.into_inner());
            std::mem::take(&mut *map)
        };
        complete_pending_with_stop_reason(pending, stop_reason);
    }

    /// Convenience: begin + wait (no concurrent server-request handling).
    /// Safe for initialize / session/new / session-load-or-resume before a prompt.
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

/// Complete local oneshot waiters with a synthetic ACP prompt result.
pub(crate) fn complete_pending_with_stop_reason(
    pending: HashMap<JsonRpcId, oneshot::Sender<JsonRpcMessage>>,
    stop_reason: &str,
) {
    let result = serde_json::json!({ "stopReason": stop_reason });
    for (id, tx) in pending {
        let _ = tx.send(JsonRpcMessage::Response {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(result.clone()),
            error: None,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn complete_pending_with_stop_reason_unblocks_waiters() {
        let (tx, rx) = oneshot::channel();
        let id = JsonRpcId::Number(42);
        let mut pending = HashMap::new();
        pending.insert(id.clone(), tx);

        complete_pending_with_stop_reason(pending, "cancelled");

        let msg = rx.await.expect("waiter should receive synthetic response");
        match msg {
            JsonRpcMessage::Response { id: got_id, result, error, .. } => {
                assert_eq!(got_id, id);
                assert!(error.is_none());
                assert_eq!(
                    result.as_ref().and_then(|v| v.get("stopReason")).and_then(|v| v.as_str()),
                    Some("cancelled")
                );
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }
}

#[cfg(all(test, unix))]
mod request_lifecycle_tests {
    use super::*;

    #[tokio::test]
    async fn abandoned_requests_and_failed_writes_leave_no_pending_entries() {
        // A local sink exercises real stdin writes without invoking an AI engine.
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exec /bin/cat > /dev/null"])
            .stdin(Stdio::piped())
            .kill_on_drop(true)
            .spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let mut transport = OpencodeAcpTransport {
            child,
            stdin: Mutex::new(stdin),
            notification_rx: mpsc::channel(1).1,
            server_request_rx: mpsc::channel(1).1,
            pending_requests: Arc::default(),
            next_id: AtomicU64::new(1),
        };
        let timeout = std::time::Duration::from_millis(5);
        // Cancellation while waiting to acquire stdin must release registration too.
        let held_stdin = transport.stdin.lock().await;
        assert!(tokio::time::timeout(timeout, transport.send_request("test", None)).await.is_err());
        assert!(transport.pending_requests.lock().unwrap().is_empty());
        drop(held_stdin);
        // The write succeeds, but the peer never replies.
        assert!(tokio::time::timeout(timeout, transport.send_request("test", None)).await.is_err());
        assert!(transport.pending_requests.lock().unwrap().is_empty());
        transport.shutdown().await.unwrap();
        // Broken-pipe errors must not strand the sender registered before writing.
        assert!(transport.send_request("test", None).await.is_err());
        assert!(transport.pending_requests.lock().unwrap().is_empty());
    }
}
