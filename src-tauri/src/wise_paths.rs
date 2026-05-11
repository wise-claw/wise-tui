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
