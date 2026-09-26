//! Low-level JSON-RPC transport for the Codex App-Server protocol over stdio.
//!
//! Manages a `codex app-server --stdio` subprocess, sending JSON-RPC requests
//! on stdin and reading JSONL responses/notifications from stdout. The protocol
//! is JSON-RPC 2.0 **without** the `"jsonrpc":"2.0"` field on the wire.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex, OwnedSemaphorePermit, Semaphore};

use crate::pending_rpc_request::{PendingRequestMap, PendingResponse};

// Keep stdout responsive to RPC responses even while UI/disk consumption is slow.
// Bound queued wire bytes, rather than silently dropping events at 256 items.
const EVENT_BACKLOG_BYTES: usize = 32 * 1024 * 1024;
pub struct QueuedRpcEvent<T> {
    pub value: T,
    _budget: Option<OwnedSemaphorePermit>,
}

impl<T> QueuedRpcEvent<T> {
    fn reserve(value: T, bytes: usize, budget: &Arc<Semaphore>) -> Result<Self> {
        let count = u32::try_from(bytes.max(1)).context("RPC event too large")?;
        let permit = budget.clone().try_acquire_many_owned(count)
            .context("Codex event backlog exceeded 32 MiB; consumer cannot keep up")?;
        Ok(Self { value, _budget: Some(permit) })
    }
}

pub type RawNotification = QueuedRpcEvent<(String, Option<Value>)>;
pub type RawServerRequest = QueuedRpcEvent<(u64, String, Option<Value>)>;

fn report_event_stream_failure(tx: &mpsc::UnboundedSender<RawNotification>, error: &str) {
    // One terminal error bypasses the backlog budget so overflow is visible.
    let _ = tx.send(QueuedRpcEvent {
        value: ("error".into(), Some(serde_json::json!({ "message": error }))),
        _budget: None,
    });
}

// ---------------------------------------------------------------------------
// Wire-level JSON-RPC message types
// ---------------------------------------------------------------------------

/// A JSON-RPC error object (wire format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Discriminated union of all JSON-RPC messages on the wire.
///
/// Uses `#[serde(untagged)]` because the wire format has no single
/// discriminator field — variant selection depends on which fields
/// are present (`id` + `method` = Request, `id` + `result` = Response,
/// `id` + `error` = Error, `method` only = Notification).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum JsonRpcMessage {
    /// A request that expects a response: `{ "id": N, "method": "...", "params": {...} }`.
    Request {
        id: u64,
        method: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<Value>,
    },
    /// A successful response: `{ "id": N, "result": {...} }`.
    Response {
        id: u64,
        result: Value,
    },
    /// An error response: `{ "id": N, "error": { ... } }`.
    Error {
        id: u64,
        error: JsonRpcError,
    },
    /// A notification (no `id`): `{ "method": "...", "params": {...} }`.
    Notification {
        method: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<Value>,
    },
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/// Manages a codex app-server subprocess over stdio (JSONL).
///
/// - Writes JSON-RPC requests/notifications to the child's stdin.
/// - A background reader task parses stdout lines and routes:
///   - Responses / errors → the corresponding `oneshot` channel in `pending_requests`.
///   - Notifications → the `notification_tx` channel for the session layer.
///   - Server-initiated requests → the `server_request_tx` channel for the session layer.
pub struct CodexRpcTransport {
    /// Handle to the child process (kept so we can kill it on shutdown).
    child: Child,
    /// Buffered writer for the child's stdin.
    stdin: Mutex<tokio::process::ChildStdin>,
    /// Receiver for notifications dispatched by the reader task.
    notification_rx: mpsc::UnboundedReceiver<RawNotification>,
    /// Receiver for server-initiated requests dispatched by the reader task.
    /// Each item is `(request_id, method, params)`.
    server_request_rx: mpsc::UnboundedReceiver<RawServerRequest>,
    /// Pending requests awaiting a response, keyed by request id.
    pending_requests: PendingRequestMap<u64, JsonRpcMessage>,
    /// Monotonically increasing request id counter.
    next_id: AtomicU64,
}

impl Drop for CodexRpcTransport {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl CodexRpcTransport {
    /// Spawn a `codex app-server --stdio` subprocess and start the stdout reader task.
    ///
    /// `binary_path` is the resolved path to the `codex` binary.
    /// Extra `args` are appended after `app-server` (e.g. `&["--stdio"]`).
    pub async fn spawn(
        binary_path: &str,
        args: &[&str],
        spawn_env_overrides: Option<&(String, String)>,
    ) -> Result<Self> {
        let mut cmd = Command::new(binary_path);
        cmd.arg("app-server").args(args);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Apply the same env enrichment used by the existing codex integration.
        let path_env = tokio::task::spawn_blocking(crate::codex_binary::codex_merged_path_env)
            .await.context("Failed to resolve Codex PATH")?;
        crate::codex_binary::apply_codex_child_env(&mut cmd, &path_env);
        if let Some((api_key, base_url)) = spawn_env_overrides {
            cmd.env("OPENAI_API_KEY", api_key);
            cmd.env("OPENAI_BASE_URL", base_url);
        }

        let mut child = cmd
            .spawn()
            .with_context(|| format!("Failed to spawn codex app-server: {binary_path}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("Failed to take codex app-server stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("Failed to take codex app-server stdout"))?;

        let pending: HashMap<u64, oneshot::Sender<JsonRpcMessage>> = HashMap::new();
        let pending_requests = Arc::new(std::sync::Mutex::new(pending));

        // Notification channel: reader task → session layer.
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();
        let event_budget = Arc::new(Semaphore::new(EVENT_BACKLOG_BYTES));

        // Server-request channel: reader task → session layer.
        let (server_request_tx, server_request_rx) = mpsc::unbounded_channel();

        // Spawn the stderr drain (best-effort, log at debug level).
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = line; // stderr drained silently
                }
            });
        }

        // Spawn the stdout reader task.
        let pending_for_reader = Arc::clone(&pending_requests);
        {
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
                            if let Err(error) = Self::handle_stdout_line(
                                &trimmed,
                                &pending_for_reader,
                                &notification_tx,
                                &server_request_tx,
                                &event_budget,
                            )
                            .await {
                                report_event_stream_failure(&notification_tx, &error.to_string());
                                break;
                            }
                        }
                        Ok(None) => break,
                        Err(_) => break,
                    }
                }
                // On exit, drop all pending senders so waiters unblock with errors.
                let mut pending = pending_for_reader.lock().unwrap_or_else(|e| e.into_inner());
                pending.clear();
            });
        }

        Ok(Self {
            child,
            stdin: Mutex::new(stdin),
            notification_rx,
            server_request_rx,
            pending_requests,
            next_id: AtomicU64::new(1),
        })
    }

    /// Parse a single stdout JSON line and route it.
    async fn handle_stdout_line(
        line: &str,
        pending_requests: &PendingRequestMap<u64, JsonRpcMessage>,
        notification_tx: &mpsc::UnboundedSender<RawNotification>,
        server_request_tx: &mpsc::UnboundedSender<RawServerRequest>,
        event_budget: &Arc<Semaphore>,
    ) -> Result<()> {
        let msg: JsonRpcMessage = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[codex_rpc] Failed to parse JSON-RPC message: {e}");
                return Ok(());
            }
        };

        match msg {
            msg @ JsonRpcMessage::Response { id, .. } | msg @ JsonRpcMessage::Error { id, .. } => {
                let sender = {
                    let mut pending = pending_requests.lock().unwrap_or_else(|e| e.into_inner());
                    pending.remove(&id)
                };
                if let Some(tx) = sender {
                    let _ = tx.send(msg);
                } else {
                    eprintln!("[codex_rpc] Received response for unknown request id: {id}");
                }
            }
            JsonRpcMessage::Notification { method, params } => {
                notification_tx.send(QueuedRpcEvent::reserve((method, params), line.len(), event_budget)?)
                    .map_err(|_| anyhow!("Codex notification consumer closed"))?;
            }
            JsonRpcMessage::Request { id, method, params } => {
                server_request_tx.send(QueuedRpcEvent::reserve((id, method, params), line.len(), event_budget)?)
                    .map_err(|_| anyhow!("Codex request consumer closed"))?;
            }
        }
        Ok(())
    }

    /// Allocate the next unique request id.
    pub fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Send a JSON-RPC request and wait for the corresponding response.
    pub async fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<JsonRpcMessage> {
        let id = self.next_request_id();
        let msg = JsonRpcMessage::Request {
            id,
            method: method.to_string(),
            params,
        };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize request: {method}"))?;

        // Register the pending oneshot before writing to stdin.
        let rx = PendingResponse::register(&self.pending_requests, id);

        // Write the JSON line to stdin.
        {
            let mut stdin = self.stdin.lock().await;
            stdin
                .write_all(wire.as_bytes())
                .await
                .with_context(|| format!("Failed to write to app-server stdin: {method}"))?;
            stdin
                .write_all(b"\n")
                .await
                .with_context(|| format!("Failed to write newline to app-server stdin: {method}"))?;
            stdin
                .flush()
                .await
                .with_context(|| format!("Failed to flush app-server stdin: {method}"))?;
        }

        // Wait for the reader task to deliver the response (with timeout).
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(300),
            rx,
        )
        .await
        .map_err(|_| anyhow!("Timeout waiting for response to: {method}"))?
        .with_context(|| format!("app-server reader task dropped before responding to: {method}"))?;
        Ok(response)
    }

    /// Send a JSON-RPC notification (no response expected).
    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<()> {
        let msg = JsonRpcMessage::Notification {
            method: method.to_string(),
            params,
        };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize notification: {method}"))?;

        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(wire.as_bytes())
            .await
            .with_context(|| format!("Failed to write notification to app-server stdin: {method}"))?;
        stdin
            .write_all(b"\n")
            .await
            .with_context(|| format!("Failed to write newline for notification: {method}"))?;
        stdin
            .flush()
            .await
            .with_context(|| format!("Failed to flush notification: {method}"))?;

        Ok(())
    }

    /// Take the notification receiver out of the transport (called once during bootstrap).
    pub fn take_notification_rx(&mut self) -> mpsc::UnboundedReceiver<RawNotification> {
        let (_dummy_tx, dummy_rx) = mpsc::unbounded_channel();
        std::mem::replace(&mut self.notification_rx, dummy_rx)
    }

    /// Take the server-request receiver out of the transport (called once during bootstrap).
    pub fn take_server_request_rx(
        &mut self,
    ) -> mpsc::UnboundedReceiver<RawServerRequest> {
        let (_dummy_tx, dummy_rx) = mpsc::unbounded_channel();
        std::mem::replace(&mut self.server_request_rx, dummy_rx)
    }

    /// Send a JSON-RPC response to a server-initiated request.
    ///
    /// `id` must match the `id` from the incoming `JsonRpcMessage::Request`.
    pub async fn send_response(&self, id: u64, result: Value) -> Result<()> {
        let msg = JsonRpcMessage::Response { id, result };
        let wire = serde_json::to_string(&msg)
            .with_context(|| format!("Failed to serialize response for request id: {id}"))?;

        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(wire.as_bytes())
            .await
            .with_context(|| format!("Failed to write response to app-server stdin: id={id}"))?;
        stdin
            .write_all(b"\n")
            .await
            .with_context(|| format!("Failed to write newline for response: id={id}"))?;
        stdin
            .flush()
            .await
            .with_context(|| format!("Failed to flush response: id={id}"))?;

        Ok(())
    }

    /// Gracefully shut down the child process.
    pub async fn shutdown(&mut self) -> Result<()> {
        match self.child.kill().await {
            Ok(()) => {}
            Err(_) => {
                // Process may have already exited.
            }
        }
        let _ = self.child.wait().await;
        Ok(())
    }
}

#[cfg(test)]
mod event_delivery_tests {
    use super::*;

    #[tokio::test]
    async fn burst_preserves_all_events_and_does_not_block_rpc_responses() {
        let pending = PendingRequestMap::default();
        let (notifications, mut rx) = mpsc::unbounded_channel();
        let (requests, mut requests_rx) = mpsc::unbounded_channel();
        let budget = Arc::new(Semaphore::new(EVENT_BACKLOG_BYTES));
        // More than both old channel capacities, with no event consumer running.
        for index in 0..4096 {
            let line = serde_json::json!({ "method": "test/delta", "params": { "index": index } }).to_string();
            CodexRpcTransport::handle_stdout_line(&line, &pending, &notifications, &requests, &budget)
                .await.unwrap();
        }
        for id in 0..256 {
            let line = serde_json::json!({ "id": id, "method": "test/approval" }).to_string();
            CodexRpcTransport::handle_stdout_line(&line, &pending, &notifications, &requests, &budget)
                .await.unwrap();
        }
        let (response_tx, response_rx) = oneshot::channel();
        pending.lock().unwrap().insert(9000, response_tx);
        CodexRpcTransport::handle_stdout_line(r#"{"id":9000,"result":{}}"#, &pending, &notifications, &requests, &budget)
            .await.unwrap();
        assert!(matches!(response_rx.await.unwrap(), JsonRpcMessage::Response { id: 9000, .. }));
        CodexRpcTransport::handle_stdout_line(r#"{"method":"turn/completed"}"#, &pending, &notifications, &requests, &budget)
            .await.unwrap();
        for index in 0..4096 {
            let event = rx.recv().await.unwrap();
            assert_eq!(event.value.1.as_ref().unwrap()["index"], index);
        }
        assert_eq!(rx.recv().await.unwrap().value.0, "turn/completed");
        for id in 0..256 {
            assert_eq!(requests_rx.recv().await.unwrap().value.0, id);
        }
        assert_eq!(budget.available_permits(), EVENT_BACKLOG_BYTES);
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn backlog_exhaustion_is_explicit_and_releases_budget_when_drained() {
        let pending = PendingRequestMap::default();
        let (notifications, mut rx) = mpsc::unbounded_channel();
        let (requests, _requests_rx) = mpsc::unbounded_channel();
        let line = r#"{"method":"turn/completed"}"#;
        let budget = Arc::new(Semaphore::new(line.len()));
        CodexRpcTransport::handle_stdout_line(line, &pending, &notifications, &requests, &budget)
            .await.unwrap();
        let error = CodexRpcTransport::handle_stdout_line(line, &pending, &notifications, &requests, &budget)
            .await.unwrap_err();
        report_event_stream_failure(&notifications, &error.to_string());
        assert_eq!(rx.recv().await.unwrap().value.0, "turn/completed");
        let failure = rx.recv().await.unwrap();
        assert_eq!(failure.value.0, "error");
        assert!(failure.value.1.unwrap()["message"].as_str().unwrap().contains("backlog"));
        assert_eq!(budget.available_permits(), line.len());
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
        let mut transport = CodexRpcTransport {
            child,
            stdin: Mutex::new(stdin),
            notification_rx: mpsc::unbounded_channel().1,
            server_request_rx: mpsc::unbounded_channel().1,
            pending_requests: Arc::default(),
            next_id: AtomicU64::new(1),
        };
        let timeout = std::time::Duration::from_millis(5);
        // Cancellation while waiting to acquire stdin must release registration too.
        let held_stdin = transport.stdin.lock().await;
        assert!(tokio::time::timeout(timeout, transport.send_request("test", None)).await.is_err());
        assert!(transport.pending_requests.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
        drop(held_stdin);
        // The write succeeds, but the peer never replies.
        assert!(tokio::time::timeout(timeout, transport.send_request("test", None)).await.is_err());
        assert!(transport.pending_requests.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
        transport.shutdown().await.unwrap();
        // Broken-pipe errors must not strand the sender registered before writing.
        assert!(transport.send_request("test", None).await.is_err());
        assert!(transport.pending_requests.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
    }
}
