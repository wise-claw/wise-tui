//! A pending response owns its registration, including while stdin is being written.
//! Dropping a cancelled/timed-out request must not leave its sender in a live transport.

use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use tokio::sync::oneshot;

pub(crate) type PendingRequestMap<K, V> = Arc<Mutex<HashMap<K, oneshot::Sender<V>>>>;

pub(crate) struct PendingResponse<K: Eq + Hash, V> {
    id: K,
    pending: PendingRequestMap<K, V>,
    receiver: oneshot::Receiver<V>,
}

impl<K: Clone + Eq + Hash, V> PendingResponse<K, V> {
    pub(crate) fn register(pending: &PendingRequestMap<K, V>, id: K) -> Self {
        let (sender, receiver) = oneshot::channel();
        pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id.clone(), sender);
        Self {
            id,
            pending: Arc::clone(pending),
            receiver,
        }
    }
}

impl<K: Eq + Hash, V> PendingResponse<K, V> {
    pub(crate) fn try_recv(&mut self) -> Result<V, oneshot::error::TryRecvError> {
        self.receiver.try_recv()
    }
}

// No field is structurally pinned; the oneshot receiver is Unpin.
impl<K: Eq + Hash, V> Unpin for PendingResponse<K, V> {}

impl<K: Eq + Hash, V> Future for PendingResponse<K, V> {
    type Output = Result<V, oneshot::error::RecvError>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        Pin::new(&mut self.receiver).poll(cx)
    }
}

impl<K: Eq + Hash, V> Drop for PendingResponse<K, V> {
    fn drop(&mut self) {
        // Only short map operations hold this mutex; none await or do I/O.
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn timeout_and_cancellation_release_pending_senders() {
        let pending: PendingRequestMap<u64, ()> = Arc::default();
        let response = PendingResponse::register(&pending, 1);
        assert!(tokio::time::timeout(std::time::Duration::ZERO, response)
            .await
            .is_err());
        assert!(pending.lock().unwrap().is_empty());

        // Simulate cancellation / an early stdin-write error after registration.
        for id in 0..10_000 {
            let response = PendingResponse::register(&pending, id);
            assert_eq!(pending.lock().unwrap().len(), 1);
            drop(response);
            assert!(pending.lock().unwrap().is_empty());
        }
    }

    #[tokio::test]
    async fn responses_and_transport_shutdown_still_unblock_waiters() {
        let pending = Arc::default();
        let response = PendingResponse::register(&pending, 1_u64);
        let sender = pending.lock().unwrap().remove(&1).unwrap();
        sender.send("done").unwrap();
        assert_eq!(response.await.unwrap(), "done");
        assert!(pending.lock().unwrap().is_empty());

        let response = PendingResponse::register(&pending, 2);
        pending.lock().unwrap().clear();
        assert!(response.await.is_err());
    }

    #[test]
    fn cancelling_one_request_keeps_other_requests_and_polling_intact() {
        let pending = Arc::default();
        let first = PendingResponse::register(&pending, "first");
        let mut second = PendingResponse::register(&pending, "second");
        drop(first);
        assert_eq!(pending.lock().unwrap().len(), 1);
        assert_eq!(second.try_recv(), Err(oneshot::error::TryRecvError::Empty));
        let sender = pending.lock().unwrap().remove("second").unwrap();
        sender.send(42).unwrap();
        assert_eq!(second.try_recv(), Ok(42));
    }
}
