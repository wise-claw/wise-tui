use crate::claude_config_dir::user_claude_dir;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    let data = data.trim_start_matches('\u{feff}');
    serde_json::from_str(data).ok()
}

pub(crate) fn resolve_omc_plugin_root() -> Option<PathBuf> {
    let base = user_claude_dir()
        .join("plugins")
        .join("cache")
        .join("omc")
        .join("oh-my-claudecode");
    if !base.is_dir() {
        return None;
    }
    let mut versions: Vec<PathBuf> = fs::read_dir(&base)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    versions.sort_by(|a, b| {
        let av = a.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let bv = b.file_name().and_then(|s| s.to_str()).unwrap_or("");
        av.cmp(bv)
    });
    versions.pop()
}

pub(crate) fn canonicalize_existing_project_dir(project_path: Option<&str>) -> Option<PathBuf> {
    let raw = project_path.map(str::trim).filter(|s| !s.is_empty())?;
    let root = PathBuf::from(raw);
    if !root.is_dir() {
        return None;
    }
    fs::canonicalize(root).ok()
}
