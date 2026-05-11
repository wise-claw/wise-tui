use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    let data = data.trim_start_matches('\u{feff}');
    serde_json::from_str(data).ok()
}

pub(crate) fn resolve_omc_plugin_root() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let base = home
        .join(".claude")
        .join("plugins")
        .join("cache")
        .join("omc")
        .join("oh-my-claudecode");
    if !base.is_dir() {
        return None;
    }
    let preferred = base.join("4.13.2");
    if preferred.is_dir() {
        return Some(preferred);
    }
    let mut versions: Vec<PathBuf> = fs::read_dir(&base)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    versions.sort();
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
