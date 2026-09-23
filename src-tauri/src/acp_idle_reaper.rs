//! Cursor / OpenCode / DeepSeek 常驻 ACP 会话的空闲回收。
//!
//! 每个标签在首轮后保留一个 agent 子进程；前端关标签会显式 shutdown，但长时间打开大量标签时
//! 进程只增不减。这里按「空闲时长 + 空闲数量上限」回收，下次发送时 `get_or_create_session`
//! 会用前端传回的 resume id 走 `session/load` 接回原对话。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex as TokioMutex;

use crate::cursor_acp_commands::CursorAcpSessionStore;
use crate::opencode_acp_commands::{AcpSessionStore, DeepseekAcpSessionStore, OpencodeAcpSessionStore};

const SCAN_INTERVAL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy)]
pub(crate) struct AcpIdlePolicy {
    /// 空闲超过此时长即回收。
    pub idle_ttl: Duration,
    /// 同一引擎的会话总数上限；超出时从最久空闲的开始回收。
    pub max_live: usize,
    /// 数量上限触发时，刚结束回合的会话至少保留这么久，避免用户正要回复就被回收。
    pub min_idle_before_evict: Duration,
}

impl Default for AcpIdlePolicy {
    fn default() -> Self {
        Self {
            idle_ttl: Duration::from_secs(20 * 60),
            max_live: 8,
            min_idle_before_evict: Duration::from_secs(2 * 60),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AcpSessionObservation {
    pub tab_id: String,
    pub busy: bool,
    /// 每次发送 / 中断都会递增；与上次观察不同说明两次扫描之间有过活动。
    pub turn_epoch: u64,
}

/// 记录每个会话从何时开始空闲；只存在于回收任务内部。
#[derive(Debug, Default)]
pub(crate) struct AcpIdleTracker {
    idle_since: HashMap<String, (u64, Instant)>,
}

impl AcpIdleTracker {
    /// 返回本轮应回收的标签 id。
    pub(crate) fn select(
        &mut self,
        now: Instant,
        observations: &[AcpSessionObservation],
        policy: &AcpIdlePolicy,
    ) -> Vec<String> {
        self.idle_since
            .retain(|id, _| observations.iter().any(|o| &o.tab_id == id));

        let mut idle: Vec<(&str, Instant)> = Vec::new();
        for obs in observations {
            if obs.busy {
                self.idle_since.remove(&obs.tab_id);
                continue;
            }
            let entry = self
                .idle_since
                .entry(obs.tab_id.clone())
                .or_insert((obs.turn_epoch, now));
            if entry.0 != obs.turn_epoch {
                *entry = (obs.turn_epoch, now);
            }
            idle.push((obs.tab_id.as_str(), entry.1));
        }
        idle.sort_by_key(|(_, since)| *since);

        let mut reap: Vec<String> = Vec::new();
        let mut live = observations.len();
        for (id, since) in &idle {
            let idle_for = now.saturating_duration_since(*since);
            let expired = idle_for >= policy.idle_ttl;
            let over_limit = live > policy.max_live && idle_for >= policy.min_idle_before_evict;
            if expired || over_limit {
                reap.push((*id).to_string());
                live -= 1;
            }
        }
        for id in &reap {
            self.idle_since.remove(id);
        }
        reap
    }
}

type SessionMap<S> = Arc<TokioMutex<HashMap<String, Arc<TokioMutex<S>>>>>;
type FlagMap<V> = Arc<TokioMutex<HashMap<String, V>>>;

/// 在持有 busy 锁期间摘除会话：新回合必须先拿到 busy 锁，所以不会拿到即将关闭的会话。
async fn detach_idle_sessions<S>(
    tracker: &mut AcpIdleTracker,
    policy: &AcpIdlePolicy,
    sessions: &SessionMap<S>,
    busy: &FlagMap<bool>,
    turn_epoch: &FlagMap<u64>,
) -> Vec<(String, Arc<TokioMutex<S>>)> {
    let mut busy_guard = busy.lock().await;
    let mut sessions_guard = sessions.lock().await;
    let epochs = turn_epoch.lock().await.clone();
    let observations: Vec<AcpSessionObservation> = sessions_guard
        .keys()
        .map(|id| AcpSessionObservation {
            tab_id: id.clone(),
            busy: busy_guard.get(id).copied().unwrap_or(false),
            turn_epoch: epochs.get(id).copied().unwrap_or(0),
        })
        .collect();
    let reap = tracker.select(Instant::now(), &observations, policy);
    let mut detached = Vec::with_capacity(reap.len());
    for id in reap {
        busy_guard.remove(&id);
        if let Some(session) = sessions_guard.remove(&id) {
            detached.push((id, session));
        }
    }
    drop(sessions_guard);
    drop(busy_guard);
    if !detached.is_empty() {
        let mut epochs = turn_epoch.lock().await;
        for (id, _) in &detached {
            epochs.remove(id);
        }
    }
    detached
}

async fn reap_generic_acp(
    label: &str,
    store: &AcpSessionStore,
    tracker: &mut AcpIdleTracker,
    policy: &AcpIdlePolicy,
) {
    let detached =
        detach_idle_sessions(tracker, policy, &store.sessions, &store.busy, &store.turn_epoch)
            .await;
    if detached.is_empty() {
        return;
    }
    eprintln!("[acp-idle] {label}: reclaiming {} idle session(s)", detached.len());
    for (_, session) in detached {
        let _ = session.lock().await.shutdown().await;
    }
}

async fn reap_cursor_acp(
    store: &CursorAcpSessionStore,
    tracker: &mut AcpIdleTracker,
    policy: &AcpIdlePolicy,
) {
    let detached =
        detach_idle_sessions(tracker, policy, &store.sessions, &store.busy, &store.turn_epoch)
            .await;
    if detached.is_empty() {
        return;
    }
    eprintln!("[acp-idle] cursor: reclaiming {} idle session(s)", detached.len());
    for (_, session) in detached {
        let _ = session.lock().await.shutdown().await;
    }
}

pub(crate) fn spawn_acp_idle_reaper(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let policy = AcpIdlePolicy::default();
        let mut cursor = AcpIdleTracker::default();
        let mut opencode = AcpIdleTracker::default();
        let mut deepseek = AcpIdleTracker::default();
        loop {
            tokio::time::sleep(SCAN_INTERVAL).await;
            if let Some(store) = app.try_state::<CursorAcpSessionStore>() {
                reap_cursor_acp(&store, &mut cursor, &policy).await;
            }
            if let Some(store) = app.try_state::<OpencodeAcpSessionStore>() {
                reap_generic_acp("opencode", &store.0, &mut opencode, &policy).await;
            }
            if let Some(store) = app.try_state::<DeepseekAcpSessionStore>() {
                reap_generic_acp("deepseek", &store.0, &mut deepseek, &policy).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs(id: &str, busy: bool, epoch: u64) -> AcpSessionObservation {
        AcpSessionObservation {
            tab_id: id.to_string(),
            busy,
            turn_epoch: epoch,
        }
    }

    fn policy() -> AcpIdlePolicy {
        AcpIdlePolicy {
            idle_ttl: Duration::from_secs(600),
            max_live: 3,
            min_idle_before_evict: Duration::from_secs(60),
        }
    }

    #[test]
    fn reaps_after_ttl_and_activity_between_scans_resets_the_clock() {
        let mut tracker = AcpIdleTracker::default();
        let t0 = Instant::now();
        let p = policy();
        assert!(tracker.select(t0, &[obs("a", false, 1)], &p).is_empty());
        // 两次扫描之间完成了一轮很快的对话：epoch 变化，空闲从这次观察重新计时。
        let t1 = t0 + Duration::from_secs(590);
        assert!(tracker.select(t1, &[obs("a", false, 2)], &p).is_empty());
        let t2 = t0 + Duration::from_secs(900);
        assert!(tracker.select(t2, &[obs("a", false, 2)], &p).is_empty());
        let t3 = t1 + Duration::from_secs(600);
        assert_eq!(tracker.select(t3, &[obs("a", false, 2)], &p), vec!["a"]);
    }

    #[test]
    fn busy_sessions_are_never_reaped_and_restart_idle_clock() {
        let mut tracker = AcpIdleTracker::default();
        let t0 = Instant::now();
        let p = policy();
        tracker.select(t0, &[obs("a", false, 1)], &p);
        let t1 = t0 + Duration::from_secs(10_000);
        assert!(tracker.select(t1, &[obs("a", true, 1)], &p).is_empty());
        assert!(tracker
            .select(t1 + Duration::from_secs(1), &[obs("a", false, 1)], &p)
            .is_empty());
    }

    #[test]
    fn over_limit_evicts_oldest_idle_after_grace_only() {
        let mut tracker = AcpIdleTracker::default();
        let p = policy();
        let t0 = Instant::now();
        let all = vec![
            obs("old", false, 1),
            obs("mid", false, 1),
            obs("busy1", true, 1),
            obs("busy2", true, 1),
            obs("fresh", false, 1),
        ];
        tracker.select(t0, &[obs("old", false, 1)], &p);
        tracker.select(t0 + Duration::from_secs(30), &[obs("old", false, 1), obs("mid", false, 1)], &p);
        // fresh 刚结束回合：数量超限但未过宽限期，不回收。
        let t1 = t0 + Duration::from_secs(90);
        let reaped = tracker.select(t1, &all, &p);
        assert_eq!(reaped, vec!["old", "mid"]);
        // 剩余 3 个（2 busy + fresh），已在上限内。
        let t2 = t1 + Duration::from_secs(120);
        let remaining = vec![obs("busy1", true, 1), obs("busy2", true, 1), obs("fresh", false, 1)];
        assert!(tracker.select(t2, &remaining, &p).is_empty());
    }

    #[test]
    fn forgets_sessions_that_disappeared() {
        let mut tracker = AcpIdleTracker::default();
        let p = policy();
        let t0 = Instant::now();
        tracker.select(t0, &[obs("a", false, 1)], &p);
        tracker.select(t0 + Duration::from_secs(1), &[], &p);
        // 同 id 重新出现视为新会话，从头计时。
        assert!(tracker
            .select(t0 + Duration::from_secs(700), &[obs("a", false, 1)], &p)
            .is_empty());
    }

    #[tokio::test]
    async fn detach_removes_only_idle_entries_under_busy_lock() {
        let sessions: SessionMap<u8> = Arc::new(TokioMutex::new(HashMap::new()));
        let busy: FlagMap<bool> = Arc::new(TokioMutex::new(HashMap::new()));
        let epochs: FlagMap<u64> = Arc::new(TokioMutex::new(HashMap::new()));
        for id in ["idle", "running"] {
            sessions.lock().await.insert(id.into(), Arc::new(TokioMutex::new(0)));
            epochs.lock().await.insert(id.into(), 1);
        }
        busy.lock().await.insert("running".into(), true);
        let p = AcpIdlePolicy {
            idle_ttl: Duration::ZERO,
            ..policy()
        };
        let mut tracker = AcpIdleTracker::default();
        let detached = detach_idle_sessions(&mut tracker, &p, &sessions, &busy, &epochs).await;
        assert_eq!(detached.len(), 1);
        assert_eq!(detached[0].0, "idle");
        assert!(sessions.lock().await.contains_key("running"));
        assert!(!sessions.lock().await.contains_key("idle"));
        assert!(!epochs.lock().await.contains_key("idle"));
        assert!(busy.lock().await.get("running").copied().unwrap_or(false));
    }
}
