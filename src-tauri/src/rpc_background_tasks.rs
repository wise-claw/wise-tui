//! An RPC owner must own its readers/forwarders, including their queued payloads.

use std::future::Future;
use tokio::task::JoinHandle;

#[derive(Default)]
pub(crate) struct RpcBackgroundTasks(Vec<JoinHandle<()>>);

impl RpcBackgroundTasks {
    pub fn is_empty(&self) -> bool { self.0.is_empty() }

    pub fn spawn(&mut self, future: impl Future<Output = ()> + Send + 'static) {
        self.0.push(tokio::spawn(future));
    }

    pub async fn shutdown(&mut self) {
        for task in &self.0 { task.abort(); }
        for task in self.0.drain(..) { let _ = task.await; }
    }
}

impl Drop for RpcBackgroundTasks {
    fn drop(&mut self) {
        for task in &self.0 { task.abort(); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn shutdown_and_drop_release_captured_buffers_and_waiting_tasks() {
        for explicit_shutdown in [true, false] {
            let mut tasks = RpcBackgroundTasks::default();
            let payload = Arc::new(vec![0_u8; 1024 * 1024]);
            let weak = Arc::downgrade(&payload);
            tasks.spawn(async move {
                let _payload = payload;
                std::future::pending::<()>().await;
            });
            if explicit_shutdown { tasks.shutdown().await; }
            drop(tasks);
            tokio::time::timeout(std::time::Duration::from_secs(1), async {
                while weak.upgrade().is_some() { tokio::task::yield_now().await; }
            }).await.expect("detached task retained its payload");
        }
    }
}
