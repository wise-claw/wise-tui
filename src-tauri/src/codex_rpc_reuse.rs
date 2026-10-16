//! Bounded, short-lived ownership of idle native runtimes. No user prompts are cached.

use std::collections::{HashSet, VecDeque};
use std::time::{Duration, Instant};

pub(crate) const IDLE_TTL: Duration = Duration::from_secs(120);
const IDLE_CAPACITY: usize = 4;
const IDLE_RESIDENT_BUDGET: u64 = 512 * 1024 * 1024;
const UNKNOWN_RESIDENT_BYTES: u64 = IDLE_RESIDENT_BUDGET / IDLE_CAPACITY as u64;

struct Entry<T> {
    tab: String,
    thread: String,
    fingerprint: u64,
    parked_at: Instant,
    runtime: T,
}

pub(crate) struct IdleSessionPool<T> {
    entries: VecDeque<Entry<T>>,
    persistent_tabs: HashSet<String>,
}

impl<T> Default for IdleSessionPool<T> {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
            persistent_tabs: HashSet::new(),
        }
    }
}

impl<T> IdleSessionPool<T> {
    /// 仅显式选中的会话常驻；关闭常驻后从当前时刻恢复空闲倒计时。
    pub fn set_persistent(&mut self, tab: &str, persistent: bool, now: Instant) {
        if persistent {
            self.persistent_tabs.insert(tab.to_string());
        } else if self.persistent_tabs.remove(tab) {
            if let Some(entry) = self.entries.iter_mut().find(|entry| entry.tab == tab) {
                entry.parked_at = now;
            }
        }
    }

    pub fn is_persistent(&self, tab: &str) -> bool {
        self.persistent_tabs.contains(tab)
    }

    fn enforce_capacity(&mut self) -> Vec<T> {
        let mut retired = Vec::new();
        while self.entries.iter().filter(|entry| !self.is_persistent(&entry.tab)).count() > IDLE_CAPACITY {
            let index = self.entries.iter().enumerate()
                .filter(|(_, entry)| !self.is_persistent(&entry.tab))
                .min_by_key(|(_, entry)| entry.parked_at).map(|(index, _)| index).unwrap();
            retired.push(self.entries.remove(index).unwrap().runtime);
        }
        retired
    }

    pub fn get(&self, tab: &str) -> Option<&T> {
        self.entries.iter().find(|entry| entry.tab == tab).map(|entry| &entry.runtime)
    }
    /// Invalid/expired entries are returned to the caller for shutdown outside the lock.
    pub fn take(
        &mut self,
        tab: &str,
        thread: Option<&str>,
        fingerprint: u64,
        now: Instant,
    ) -> (Option<T>, Vec<T>) {
        let mut retired = self.expire(now);
        let Some(index) = self.entries.iter().position(|entry| entry.tab == tab) else {
            return (None, retired);
        };
        let entry = self.entries.remove(index).unwrap();
        if thread == Some(entry.thread.as_str()) && entry.fingerprint == fingerprint {
            (Some(entry.runtime), retired)
        } else {
            retired.push(entry.runtime);
            (None, retired)
        }
    }

    pub fn park(
        &mut self,
        tab: String,
        thread: String,
        fingerprint: u64,
        runtime: T,
        now: Instant,
    ) -> Vec<T> {
        let mut retired = self.expire(now);
        if let Some(old) = self.remove(&tab) {
            retired.push(old);
        }
        self.entries.push_back(Entry {
            tab,
            thread,
            fingerprint,
            parked_at: now,
            runtime,
        });
        retired.extend(self.enforce_capacity());
        retired
    }

    pub fn remove(&mut self, tab: &str) -> Option<T> {
        let index = self.entries.iter().position(|entry| entry.tab == tab)?;
        Some(self.entries.remove(index)?.runtime)
    }

    pub fn expire(&mut self, now: Instant) -> Vec<T> {
        let mut retired = Vec::new();
        let mut index = 0;
        while index < self.entries.len() {
            let entry = &self.entries[index];
            if !self.is_persistent(&entry.tab) && now.duration_since(entry.parked_at) >= IDLE_TTL {
                retired.push(self.entries.remove(index).unwrap().runtime);
            } else { index += 1; }
        }
        retired.extend(self.enforce_capacity());
        retired
    }

    pub fn drain(&mut self) -> Vec<T> {
        self.entries.drain(..).map(|entry| entry.runtime).collect()
    }

    pub fn next_expiry(&self) -> Option<Instant> {
        self.entries.iter().filter(|entry| !self.is_persistent(&entry.tab))
            .map(|entry| entry.parked_at + IDLE_TTL).min()
    }

    /// Sample only idle runtimes. Active turns are never evicted for memory use.
    pub fn trim_resident_memory(&mut self, mut measure: impl FnMut(&T) -> Option<u64>) -> Vec<T> {
        let mut sizes: Vec<_> = self.entries.iter().enumerate()
            .filter(|(_, entry)| !self.is_persistent(&entry.tab))
            .map(|(index, entry)| (index, entry.parked_at, measure(&entry.runtime).unwrap_or(UNKNOWN_RESIDENT_BYTES)))
            .collect();
        sizes.sort_by_key(|(_, parked_at, _)| *parked_at);
        let mut total = sizes.iter().fold(0_u64, |sum, (_, _, size)| sum.saturating_add(*size));
        let mut indices = Vec::new();
        for (index, _, size) in sizes {
            if total <= IDLE_RESIDENT_BUDGET { break; }
            total = total.saturating_sub(size);
            indices.push(index);
        }
        indices.sort_unstable_by(|a, b| b.cmp(a));
        let mut retired = Vec::new();
        for index in indices { retired.push(self.entries.remove(index).unwrap().runtime); }
        retired
    }
}

/// Native primary-process RSS, without spawning `ps`. Descendant MCP processes
/// are not included. Unsupported platforms retain the count/TTL fallback.
pub(crate) fn process_resident_bytes(pid: u32) -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        let pid = i32::try_from(pid).ok()?;
        let mut usage = std::mem::MaybeUninit::<libc::rusage_info_v2>::uninit();
        // SAFETY: flavor V2 writes exactly rusage_info_v2 into the supplied buffer;
        // read it only after proc_pid_rusage reports success.
        let result = unsafe { libc::proc_pid_rusage(pid, libc::RUSAGE_INFO_V2, usage.as_mut_ptr().cast()) };
        if result == 0 { Some(unsafe { usage.assume_init() }.ri_resident_size) } else { None }
    }
    #[cfg(target_os = "linux")]
    {
        let statm = std::fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
        let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
        // SAFETY: sysconf takes a constant selector and no pointers.
        let page_size = u64::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }).ok()?;
        pages.checked_mul(page_size)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { let _ = pid; None }
}

/// Include startup inputs and native config/instruction files, without retaining
/// credentials in cache keys or logging them. File contents catch same-mtime edits.
pub(crate) fn runtime_fingerprint(
    binary: &str,
    cwd: &str,
    settings: &impl serde::Serialize,
    native_home: &std::path::Path,
) -> u64 {
    use std::hash::{Hash, Hasher};
    use std::path::Path;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    binary.hash(&mut hash);
    cwd.hash(&mut hash);
    native_home.hash(&mut hash);
    serde_json::to_vec(settings)
        .unwrap_or_default()
        .hash(&mut hash);
    if let Ok(meta) = std::fs::metadata(binary) {
        meta.len().hash(&mut hash);
        meta.modified().ok().hash(&mut hash);
    }
    let files = ["config.toml", "AGENTS.md", "AGENTS.override.md"];
    for name in files {
        std::fs::read(native_home.join(name)).ok().hash(&mut hash);
    }
    // Profile overlays can change startup tools without changing config.toml.
    if let Ok(entries) = std::fs::read_dir(native_home) {
        let mut profiles: Vec<_> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().ends_with(".config.toml"))
            })
            .collect();
        profiles.sort();
        for path in profiles {
            path.hash(&mut hash);
            std::fs::read(path).ok().hash(&mut hash);
        }
    }
    for dir in Path::new(cwd).ancestors() {
        for name in [".codex/config.toml", "AGENTS.md", "AGENTS.override.md"] {
            std::fs::read(dir.join(name)).ok().hash(&mut hash);
        }
    }
    hash.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixed_pool_only_protects_selected_sessions_and_unpin_restores_expiry() {
        let now = Instant::now();
        let mut pool = IdleSessionPool::default();
        pool.set_persistent("resident", true, now);
        pool.park("resident".into(), "t".into(), 1, 99, now);
        for n in 0..5 {
            let retired = pool.park(n.to_string(), "t".into(), 1, n, now);
            assert_eq!(retired, if n == 4 { vec![0] } else { vec![] });
        }
        assert_eq!(pool.expire(now + IDLE_TTL), vec![1, 2, 3, 4]);
        assert_eq!(pool.get("resident"), Some(&99));
        let later = now + IDLE_TTL;
        pool.set_persistent("resident", false, later);
        assert_eq!(pool.next_expiry(), Some(later + IDLE_TTL));
        assert!(pool.expire(later + IDLE_TTL - Duration::from_millis(1)).is_empty());
        assert_eq!(pool.expire(later + IDLE_TTL), vec![99]);
    }

    #[test]
    fn ordinary_memory_pressure_does_not_evict_resident_connections() {
        let now = Instant::now();
        let mut pool = IdleSessionPool::default();
        pool.set_persistent("resident", true, now);
        pool.park("resident".into(), "t".into(), 1, 99, now);
        pool.park("a".into(), "t".into(), 1, 1, now);
        pool.park("b".into(), "t".into(), 1, 2, now);
        assert_eq!(pool.trim_resident_memory(|_| Some(IDLE_RESIDENT_BUDGET)), vec![1]);
        assert_eq!(pool.get("resident"), Some(&99));
        assert_eq!(pool.get("b"), Some(&2));
    }

    #[test]
    fn persistent_sessions_survive_idle_time_and_pool_pressure_until_explicit_close() {
        let now = Instant::now();
        let mut pool = IdleSessionPool::default();
        for n in 0..10 {
            pool.set_persistent(&n.to_string(), true, now);
            assert!(pool.park(n.to_string(), "thread".into(), 1, n, now).is_empty());
        }
        assert!(pool.expire(now + Duration::from_secs(86_400)).is_empty());
        assert!(pool.trim_resident_memory(|_| Some(IDLE_RESIDENT_BUDGET)).is_empty());
        assert_eq!(pool.next_expiry(), None);
        assert_eq!(pool.get("0"), Some(&0));
        assert_eq!(pool.take("0", Some("thread"), 1, now + Duration::from_secs(86_400)), (Some(0), vec![]));
        assert_eq!(pool.remove("1"), Some(1));
        assert_eq!(pool.drain().len(), 8);
    }

    #[test]
    fn reuse_requires_same_tab_thread_and_config_and_consumes_ownership() {
        let now = Instant::now();
        let mut pool = IdleSessionPool::default();
        pool.park("tab".into(), "thread".into(), 1, 42, now);
        assert_eq!(pool.take("other", Some("thread"), 1, now), (None, vec![]));
        assert_eq!(pool.take("tab", Some("thread"), 1, now), (Some(42), vec![]));
        assert_eq!(pool.take("tab", Some("thread"), 1, now), (None, vec![]));
        for (thread, fingerprint) in [(None, 1), (Some("new"), 1), (Some("thread"), 2)] {
            pool.park("tab".into(), "thread".into(), 1, 42, now);
            assert_eq!(pool.take("tab", thread, fingerprint, now), (None, vec![42]));
        }
    }

    #[test]
    fn idle_limit_expiry_replacement_and_shutdown_return_all_runtimes() {
        let now = Instant::now();
        let mut pool = IdleSessionPool::default();
        for n in 0..4 {
            assert!(pool.park(n.to_string(), "t".into(), 1, n, now).is_empty());
        }
        assert_eq!(pool.park("4".into(), "t".into(), 1, 4, now), vec![0]);
        assert_eq!(pool.park("4".into(), "t".into(), 1, 5, now), vec![4]);
        assert_eq!(pool.remove("3"), Some(3));
        assert!(pool
            .expire(now + IDLE_TTL - Duration::from_millis(1))
            .is_empty());
        assert_eq!(pool.expire(now + IDLE_TTL), vec![1, 2, 5]);
        pool.park("new".into(), "t".into(), 1, 6, now + IDLE_TTL);
        assert_eq!(pool.drain(), vec![6]);
        assert!(pool.drain().is_empty());
    }

    #[test]
    fn fingerprint_changes_with_model_permissions_project_config_and_profiles() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let repo = root.path().join("repo");
        std::fs::create_dir_all(repo.join(".codex")).unwrap();
        std::fs::create_dir_all(&home).unwrap();
        let key = |settings: serde_json::Value| {
            runtime_fingerprint("codex", repo.to_str().unwrap(), &settings, &home)
        };
        let original = key(serde_json::json!({"model": "a"}));
        assert_eq!(original, key(serde_json::json!({"model": "a"})));
        assert_ne!(original, key(serde_json::json!({"model": "b"})));
        assert_ne!(
            original,
            key(serde_json::json!({"model": "a", "sandbox": "read-only"}))
        );
        std::fs::write(repo.join(".codex/config.toml"), "model='b'").unwrap();
        let project = key(serde_json::json!({"model": "a"}));
        assert_ne!(original, project);
        std::fs::write(home.join("work.config.toml"), "model='c'").unwrap();
        assert_ne!(project, key(serde_json::json!({"model": "a"})));
    }
}
