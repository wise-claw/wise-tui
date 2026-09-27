//! Bounded, short-lived ownership of idle native runtimes. No user prompts are cached.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

pub(crate) const IDLE_TTL: Duration = Duration::from_secs(120);
const IDLE_CAPACITY: usize = 4;

struct Entry<T> {
    tab: String,
    thread: String,
    fingerprint: u64,
    parked_at: Instant,
    runtime: T,
}

pub(crate) struct IdleSessionPool<T> {
    entries: VecDeque<Entry<T>>,
}

impl<T> Default for IdleSessionPool<T> {
    fn default() -> Self {
        Self {
            entries: VecDeque::new(),
        }
    }
}

impl<T> IdleSessionPool<T> {
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
        while self.entries.len() > IDLE_CAPACITY {
            retired.push(self.entries.pop_front().unwrap().runtime);
        }
        retired
    }

    pub fn remove(&mut self, tab: &str) -> Option<T> {
        let index = self.entries.iter().position(|entry| entry.tab == tab)?;
        Some(self.entries.remove(index)?.runtime)
    }

    pub fn expire(&mut self, now: Instant) -> Vec<T> {
        let mut retired = Vec::new();
        while self
            .entries
            .front()
            .is_some_and(|entry| now.duration_since(entry.parked_at) >= IDLE_TTL)
        {
            retired.push(self.entries.pop_front().unwrap().runtime);
        }
        retired
    }

    pub fn drain(&mut self) -> Vec<T> {
        self.entries.drain(..).map(|entry| entry.runtime).collect()
    }
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
