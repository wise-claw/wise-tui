use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn wise_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Could not resolve home directory".to_string())
        .map(|h| h.join(".wise"))
}

pub(crate) fn wise_repositories_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("repositories.json"))
}

pub(crate) fn wise_legacy_projects_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("projects.json"))
}

pub(crate) fn wise_tabs_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("tabs.json"))
}

pub(crate) fn sanitize_window_label_for_filename(label: &str) -> String {
    label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

/// 主窗口沿用 `tabs.json`；辅助主窗口使用 `tabs/<label>.json` 独立持久化。
pub(crate) fn wise_tabs_json_for_window(window_label: Option<&str>) -> Result<PathBuf, String> {
    let wise = wise_dir()?;
    match window_label.map(str::trim).filter(|s| !s.is_empty()) {
        None | Some("main") => Ok(wise.join("tabs.json")),
        Some(label) if label.starts_with("main-dock-") => Ok(
            wise.join("tabs")
                .join(format!("{}.json", sanitize_window_label_for_filename(label))),
        ),
        Some(_) => Ok(wise.join("tabs.json")),
    }
}

pub(crate) fn write_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.save_tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}
