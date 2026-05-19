//! Skill source classification + external-path scanning.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillSource {
    Builtin,
    Custom,
    Extension,
}

/// Default external skill directories Wise knows how to scan automatically.
pub const DEFAULT_EXTERNAL_REL_PATHS: &[&str] = &[
    ".claude/skills",
    ".codex/skills",
    ".gemini/skills",
    ".goose/skills",
];

/// Default home for skills imported by Wise via copy or symlink.
pub fn wise_skills_home() -> Option<PathBuf> {
    home_dir_for_skills().map(|h| h.join(".wise").join("skills"))
}

/// Resolve the user home directory. Honors `$HOME` first (so tests can
/// redirect via env var) then falls back to `dirs::home_dir()`.
pub fn home_dir_for_skills() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("HOME") {
        if !h.is_empty() {
            return Some(PathBuf::from(h));
        }
    }
    dirs::home_dir()
}

/// Resolved absolute paths for `DEFAULT_EXTERNAL_REL_PATHS` plus the user
/// home dir. Caller filters non-existent entries before display.
pub fn default_external_paths() -> Vec<PathBuf> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return Vec::new(),
    };
    DEFAULT_EXTERNAL_REL_PATHS
        .iter()
        .map(|rel| home.join(rel))
        .collect()
}

/// Classify a skill location into one of the three source tiers.
///
/// Heuristics, in priority order:
/// 1. Located under wise's own `~/.wise/skills/` → `Custom`.
/// 2. Located under `<plugins>/cache/<plugin>/skills/` (Claude plugin
///    cache) → `Builtin`.
/// 3. Located under `<repo>/.claude/skills/` (project skill) → `Custom`.
/// 4. Located under `~/.claude/skills/` (user skill) → `Custom`.
/// 5. Anything else → `Custom` with `classified` = false (callers can
///    surface a diagnostic).
///
/// `Extension` classification is deliberately not implemented here — it
/// requires a live `extensions::ExtensionRegistry`, which Wise's runtime
/// holds in `tauri::State`. Use [`classify_with_extension_locations`]
/// when that registry is available.
pub fn classify(path: &Path) -> (SkillSource, bool) {
    let normalized = lexical_normalize(path);
    if let Some(home) = dirs::home_dir() {
        if normalized.starts_with(home.join(".wise").join("skills")) {
            return (SkillSource::Custom, true);
        }
        let claude_user = home.join(".claude");
        if normalized.starts_with(claude_user.join("skills")) {
            return (SkillSource::Custom, true);
        }
        if normalized.starts_with(claude_user.join("plugins").join("cache")) {
            return (SkillSource::Builtin, true);
        }
    }
    if path_contains_segment_pair(&normalized, ".claude", "skills") {
        return (SkillSource::Custom, true);
    }
    (SkillSource::Custom, false)
}

/// Variant of [`classify`] that also matches against a slice of known
/// extension directories. The first matching extension dir wins.
/// Kept for the in-progress extensions integration; the live registry path
/// has not been wired through yet.
#[allow(dead_code)]
pub fn classify_with_extension_locations(
    path: &Path,
    extension_locations: &[(String, PathBuf)],
) -> (SkillSource, Option<String>, bool) {
    let normalized = lexical_normalize(path);
    for (name, ext_dir) in extension_locations {
        let canonical_ext = ext_dir
            .canonicalize()
            .unwrap_or_else(|_| ext_dir.clone());
        if normalized.starts_with(&canonical_ext) {
            return (SkillSource::Extension, Some(name.clone()), true);
        }
    }
    let (source, classified) = classify(path);
    (source, None, classified)
}

pub fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Cheap probe: does `dir` look like it holds skill subdirs? Counts
/// children that are directories AND contain a `SKILL.md` or `skill.md`.
pub fn count_skill_subdirs(dir: &Path) -> usize {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() && !ft.is_symlink() {
            continue;
        }
        let p = entry.path();
        if p.join("SKILL.md").exists() || p.join("skill.md").exists() {
            count += 1;
        }
    }
    count
}

fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn path_contains_segment_pair(path: &Path, parent: &str, child: &str) -> bool {
    let mut iter = path.components().peekable();
    while let Some(c) = iter.next() {
        if c.as_os_str() == parent {
            if let Some(next) = iter.peek() {
                if next.as_os_str() == child {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn count_skill_subdirs_recognizes_SKILL_md() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("foo")).unwrap();
        fs::write(dir.path().join("foo").join("SKILL.md"), "x").unwrap();
        fs::create_dir(dir.path().join("bar")).unwrap();
        fs::write(dir.path().join("bar").join("skill.md"), "x").unwrap();
        fs::create_dir(dir.path().join("baz")).unwrap();
        assert_eq!(count_skill_subdirs(dir.path()), 2);
    }

    #[test]
    fn classify_extension_wins_when_path_inside_extension_dir() {
        let dir = tempdir().unwrap();
        let ext_dir = dir.path().join("ext-hello").canonicalize().unwrap_or_else(|_| {
            fs::create_dir(dir.path().join("ext-hello")).unwrap();
            dir.path().join("ext-hello").canonicalize().unwrap()
        });
        let skill_path = ext_dir.join("contributes").join("skill.md");
        let exts = vec![("hello".to_string(), ext_dir.clone())];
        let (s, name, classified) = classify_with_extension_locations(&skill_path, &exts);
        assert_eq!(s, SkillSource::Extension);
        assert_eq!(name, Some("hello".to_string()));
        assert!(classified);
    }

    #[test]
    fn classify_path_under_dot_claude_skills_is_custom() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("repo").join(".claude").join("skills").join("foo");
        let (s, classified) = classify(&p);
        assert_eq!(s, SkillSource::Custom);
        assert!(classified);
    }

    #[test]
    fn classify_unknown_falls_back_to_custom_unclassified() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("random").join("place").join("foo");
        let (s, classified) = classify(&p);
        assert_eq!(s, SkillSource::Custom);
        assert!(!classified);
    }

    #[test]
    fn is_symlink_detects_unix_symlink() {
        #[cfg(unix)]
        {
            let dir = tempdir().unwrap();
            let target = dir.path().join("target");
            fs::create_dir(&target).unwrap();
            let link = dir.path().join("link");
            std::os::unix::fs::symlink(&target, &link).unwrap();
            assert!(is_symlink(&link));
            assert!(!is_symlink(&target));
        }
    }
}
