//! Short-lived CLI discovery: coalesce concurrent probes and reap timed-out children.

use std::future::Future;
use std::process::{Output, Stdio};
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Mutex;

pub(crate) async fn output_with_timeout(
    cmd: &mut Command,
    timeout: Duration,
) -> Result<std::io::Result<Output>, tokio::time::error::Elapsed> {
    // Dropping Command::output alone does not terminate its child. The future can
    // also be cancelled by its caller, so cleanup must be tied to child ownership.
    cmd.kill_on_drop(true).stdin(Stdio::null());
    tokio::time::timeout(timeout, cmd.output()).await
}

pub(crate) struct ModelProbeCache<T> {
    entry: Mutex<Option<(Instant, Vec<T>)>>,
}

impl<T: Clone> ModelProbeCache<T> {
    pub(crate) const fn new() -> Self {
        Self {
            entry: Mutex::const_new(None),
        }
    }

    pub(crate) async fn get_or_load<F, Fut>(&self, load: F) -> Vec<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Vec<T>>,
    {
        // Hold an async mutex through discovery so picker/launch requests share
        // one probe. Cancelling the owner releases the lock for the next caller.
        let mut entry = self.entry.lock().await;
        if let Some((at, items)) = entry.as_ref() {
            let ttl = if items.is_empty() { 5 } else { 60 };
            if at.elapsed() < Duration::from_secs(ttl) {
                return items.clone();
            }
        }
        let items = load().await;
        // Failures get a short cooldown, not a permanent empty catalog. Local
        // configured models are merged outside this cache on every request.
        *entry = Some((Instant::now(), items.clone()));
        items
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn concurrent_and_warm_requests_launch_one_probe() {
        let cache = ModelProbeCache::new();
        let calls = AtomicUsize::new(0);
        let requests = (0..32).map(|_| {
            cache.get_or_load(|| async {
                calls.fetch_add(1, Ordering::SeqCst);
                tokio::task::yield_now().await;
                vec!["model"]
            })
        });
        let results = futures_util::future::join_all(requests).await;
        assert!(results.iter().all(|items| items == &["model"]));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            cache.get_or_load(|| async { panic!("warm cache") }).await,
            vec!["model"]
        );
    }

    #[tokio::test]
    async fn failure_cooldown_and_success_expiry_allow_recovery() {
        let cache = ModelProbeCache::<&str>::new();
        assert!(cache.get_or_load(|| async { vec![] }).await.is_empty());
        assert!(cache
            .get_or_load(|| async { panic!("failure cooldown") })
            .await
            .is_empty());
        cache.entry.lock().await.as_mut().unwrap().0 = Instant::now() - Duration::from_secs(6);
        assert_eq!(
            cache.get_or_load(|| async { vec!["recovered"] }).await,
            vec!["recovered"]
        );
        cache.entry.lock().await.as_mut().unwrap().0 = Instant::now() - Duration::from_secs(61);
        assert_eq!(
            cache.get_or_load(|| async { vec!["new"] }).await,
            vec!["new"]
        );
    }

    #[tokio::test]
    async fn cancelled_owner_does_not_poison_cache_or_block_waiters() {
        let cache = ModelProbeCache::<&str>::new();
        assert!(tokio::time::timeout(
            Duration::from_millis(10),
            cache.get_or_load(|| { std::future::pending() })
        )
        .await
        .is_err());
        assert_eq!(
            cache.get_or_load(|| async { vec!["retry"] }).await,
            vec!["retry"]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_reaps_child_and_success_preserves_output() {
        let dir = tempfile::tempdir().unwrap();
        let pid_path = dir.path().join("pid");
        let mut cmd = Command::new("/bin/sh");
        cmd.arg("-c")
            .arg("echo $$ > \"$1\"; exec sleep 30")
            .arg("probe")
            .arg(&pid_path);
        assert!(output_with_timeout(&mut cmd, Duration::from_millis(200))
            .await
            .is_err());
        let pid: i32 = std::fs::read_to_string(pid_path)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("timed-out child must be reaped");

        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "printf catalog; printf warning >&2; exit 7"]);
        let output = output_with_timeout(&mut cmd, Duration::from_secs(3))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(output.stdout, b"catalog");
        assert_eq!(output.stderr, b"warning");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancelling_capture_reaps_child() {
        let dir = tempfile::tempdir().unwrap();
        let pid_path = dir.path().join("pid");
        let child_pid_path = pid_path.clone();
        let task = tokio::spawn(async move {
            let mut cmd = Command::new("/bin/sh");
            cmd.arg("-c")
                .arg("echo $$ > \"$1\"; exec sleep 30")
                .arg("probe")
                .arg(child_pid_path);
            output_with_timeout(&mut cmd, Duration::from_secs(60)).await
        });
        let pid: i32 = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(pid) = std::fs::read_to_string(&pid_path)
                    .ok()
                    .and_then(|text| text.trim().parse().ok())
                {
                    break pid;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::timeout(Duration::from_secs(3), async {
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("cancelled child must be reaped");
    }

    #[cfg(unix)]
    #[tokio::test]
    #[ignore = "manual local-process benchmark; no network or AI calls"]
    async fn benchmark_repeated_model_probes() {
        async fn load() -> Vec<String> {
            let mut cmd = Command::new("/bin/sh");
            cmd.args(["-c", "sleep 0.02; printf model"]);
            let output = output_with_timeout(&mut cmd, Duration::from_secs(3))
                .await
                .unwrap()
                .unwrap();
            assert!(output.status.success());
            vec![String::from_utf8(output.stdout).unwrap()]
        }
        let start = Instant::now();
        for _ in 0..32 {
            assert_eq!(load().await, vec!["model"]);
        }
        let uncached = start.elapsed();
        let cache = ModelProbeCache::new();
        let start = Instant::now();
        for _ in 0..32 {
            assert_eq!(cache.get_or_load(load).await, vec!["model"]);
        }
        eprintln!(
            "32 sequential probes: uncached={uncached:?}, shared cache={:?}",
            start.elapsed()
        );
    }
}
