//! 应用退出时统一结束 Wise 托管的子进程。
//!
//! `RunEvent::Exit` 之后进程直接退出，托管状态的析构（包括 `kill_on_drop`）不会运行；
//! 不在这里显式结束的话，单次 Claude 任务、Codex / ACP app-server、PTY 与 sidecar 会成为孤儿进程继续运行。

use std::future::Future;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::claude_commands::{ClaudeProcessState, TerminalManager};
use crate::codex_rpc_commands::CodexRpcSessionStore;
use crate::cursor_acp_commands::CursorAcpSessionStore;
use crate::opencode_acp_commands::{DeepseekAcpSessionStore, OpencodeAcpSessionStore};
use crate::stagehand_browse::StagehandBrowseState;

/// 每类存储的收尾上限：某个会话锁被长期占用时放弃该类，不拖住退出。
const STORE_SHUTDOWN_BUDGET: Duration = Duration::from_millis(1500);
/// 终端管理器是同步锁，退出路径只做有限次 try_lock。
const TERMINAL_LOCK_BUDGET: Duration = Duration::from_millis(500);

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ShutdownReport {
    pub claude: usize,
    pub codex: usize,
    pub cursor: usize,
    pub opencode: usize,
    pub deepseek: usize,
    pub stagehand: usize,
    pub terminals: usize,
}

impl ShutdownReport {
    fn total(&self) -> usize {
        self.claude
            + self.codex
            + self.cursor
            + self.opencode
            + self.deepseek
            + self.stagehand
            + self.terminals
    }
}

pub(crate) fn shutdown_managed_processes(app: &AppHandle) -> ShutdownReport {
    let terminals = terminate_terminals(app);
    let app = app.clone();
    let mut report = tauri::async_runtime::block_on(async move {
        let claude = app.try_state::<ClaudeProcessState>();
        let codex = app.try_state::<CodexRpcSessionStore>();
        let cursor = app.try_state::<CursorAcpSessionStore>();
        let opencode = app.try_state::<OpencodeAcpSessionStore>();
        let deepseek = app.try_state::<DeepseekAcpSessionStore>();
        let stagehand = app.try_state::<StagehandBrowseState>();
        let (claude, codex, cursor, opencode, deepseek, stagehand) = tokio::join!(
            bounded(claude.as_ref().map(|s| s.kill_all_children())),
            bounded(codex.as_ref().map(|s| s.shutdown_all())),
            bounded(cursor.as_ref().map(|s| s.shutdown_all())),
            bounded(opencode.as_ref().map(|s| s.0.shutdown_all())),
            bounded(deepseek.as_ref().map(|s| s.0.shutdown_all())),
            bounded(stagehand.as_ref().map(|s| s.shutdown_all())),
        );
        ShutdownReport {
            claude,
            codex,
            cursor,
            opencode,
            deepseek,
            stagehand,
            terminals: 0,
        }
    });
    report.terminals = terminals;
    if report.total() > 0 {
        eprintln!("[wise] exit: terminated managed processes {report:?}");
    }
    report
}

async fn bounded<F: Future<Output = usize>>(fut: Option<F>) -> usize {
    match fut {
        Some(fut) => bounded_with(STORE_SHUTDOWN_BUDGET, fut).await,
        None => 0,
    }
}

async fn bounded_with<F: Future<Output = usize>>(budget: Duration, fut: F) -> usize {
    tokio::time::timeout(budget, fut).await.unwrap_or(0)
}

fn terminate_terminals(app: &AppHandle) -> usize {
    let Some(manager) = app.try_state::<Mutex<TerminalManager>>() else {
        return 0;
    };
    with_try_lock(&manager, TERMINAL_LOCK_BUDGET, |m| m.terminate_all()).unwrap_or(0)
}

fn with_try_lock<T, R>(mutex: &Mutex<T>, budget: Duration, f: impl FnOnce(&mut T) -> R) -> Option<R> {
    let deadline = Instant::now() + budget;
    loop {
        match mutex.try_lock() {
            Ok(mut guard) => return Some(f(&mut guard)),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                return Some(f(&mut poisoned.into_inner()));
            }
            Err(std::sync::TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn bounded_gives_up_on_stuck_store() {
        let started = Instant::now();
        let n = bounded_with(Duration::from_millis(50), async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            7
        })
        .await;
        assert_eq!(n, 0);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(bounded::<std::future::Ready<usize>>(None).await, 0);
    }

    #[test]
    fn try_lock_gives_up_when_held_and_recovers_poison() {
        let m = Arc::new(Mutex::new(1));
        let guard = m.lock().unwrap();
        assert_eq!(with_try_lock(&m, Duration::from_millis(30), |v| *v), None);
        drop(guard);
        assert_eq!(with_try_lock(&m, Duration::from_millis(30), |v| *v), Some(1));

        let poisoned = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = poisoned.lock().unwrap();
            panic!("poison");
        })
        .join();
        assert_eq!(with_try_lock(&m, Duration::from_millis(30), |v| *v + 1), Some(2));
    }
}
