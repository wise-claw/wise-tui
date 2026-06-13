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

/// 从任意仓库路径向上回溯，找到最近一个启用了 Trellis 的项目根。
///
/// 这样 nested repo 也能把 rootPath 锚定到真正持有 `.trellis/scripts/task.py` 的父目录。
pub(crate) fn find_trellis_project_root_from_path(repo_path: &str) -> Option<PathBuf> {
    let raw = repo_path.trim();
    if raw.is_empty() {
        return None;
    }
    let root = PathBuf::from(raw);
    if !root.is_absolute() {
        return None;
    }
    let canon = fs::canonicalize(&root).ok()?;
    let mut current = Some(canon.as_path());
    while let Some(dir) = current {
        if dir
            .join(".trellis")
            .join("scripts")
            .join("task.py")
            .is_file()
        {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}
