//! Shared wait helper for oneshot agent child slots (Codex / Cursor / OpenCode / Qoder).
//!
//! These engines store `Arc<Mutex<Option<Child>>>` so cancel can kill the process.
//! Waiting with `child.wait().await` **while holding the mutex** blocks cancel forever.
//! This module polls `try_wait` and releases the lock between polls.

use std::process::ExitStatus;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Child;
use tokio::sync::Mutex as TokioMutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WaitChildSlotOutcome {
    /// Process exited with a status.
    Exited(ExitStatus),
    /// Slot was cleared (typically by cancel) or wait errored.
    Cleared,
    /// Deadline reached while process was still running.
    TimedOut,
}

/// Poll until the child exits, the slot is cleared, or an optional deadline elapses.
pub(crate) async fn wait_child_slot(
    wait_child: &Arc<TokioMutex<Option<Child>>>,
    timeout: Option<Duration>,
) -> WaitChildSlotOutcome {
    let deadline = timeout.map(|d| Instant::now() + d);
    loop {
        if let Some(dl) = deadline {
            if Instant::now() >= dl {
                return WaitChildSlotOutcome::TimedOut;
            }
        }

        {
            let mut slot = wait_child.lock().await;
            match slot.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => {
                        *slot = None;
                        return WaitChildSlotOutcome::Exited(status);
                    }
                    Ok(None) => {}
                    Err(_) => {
                        *slot = None;
                        return WaitChildSlotOutcome::Cleared;
                    }
                },
                None => return WaitChildSlotOutcome::Cleared,
            }
        }

        let sleep_for = match deadline {
            Some(dl) => {
                let remaining = dl.saturating_duration_since(Instant::now());
                remaining.min(Duration::from_millis(40))
            }
            None => Duration::from_millis(40),
        };
        if sleep_for.is_zero() {
            return WaitChildSlotOutcome::TimedOut;
        }
        tokio::time::sleep(sleep_for).await;
    }
}

/// Convenience: map outcome to exit status (Cleared/TimedOut → None).
pub(crate) async fn wait_child_slot_exit_status(
    wait_child: &Arc<TokioMutex<Option<Child>>>,
) -> Option<ExitStatus> {
    match wait_child_slot(wait_child, None).await {
        WaitChildSlotOutcome::Exited(status) => Some(status),
        WaitChildSlotOutcome::Cleared | WaitChildSlotOutcome::TimedOut => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::process::Command;

    #[tokio::test]
    async fn cleared_slot_returns_cleared() {
        let slot = Arc::new(TokioMutex::new(None));
        let outcome = wait_child_slot(&slot, Some(Duration::from_millis(200))).await;
        assert_eq!(outcome, WaitChildSlotOutcome::Cleared);
    }

    #[tokio::test]
    async fn cancel_can_kill_while_waiter_polls() {
        let mut child = Command::new("sleep")
            .arg("30")
            .kill_on_drop(true)
            .spawn()
            .expect("spawn sleep");
        let _ = child.stdout.take();
        let _ = child.stderr.take();
        let slot = Arc::new(TokioMutex::new(Some(child)));
        let waiter_slot = slot.clone();
        let cancel_slot = slot.clone();

        let waiter = tokio::spawn(async move { wait_child_slot_exit_status(&waiter_slot).await });

        tokio::time::sleep(Duration::from_millis(80)).await;
        {
            let mut guard = cancel_slot.lock().await;
            if let Some(ref mut proc) = *guard {
                let _ = proc.kill().await;
            }
            *guard = None;
        }

        let status = tokio::time::timeout(Duration::from_secs(3), waiter)
            .await
            .expect("waiter finishes")
            .expect("join ok");
        // Cleared path may yield None; either way cancel must not block the waiter.
        let _ = status;
    }
}
