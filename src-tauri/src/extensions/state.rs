//! Persisted enable state for extensions.
//!
//! Written to `~/.wise/extension-states.json` via atomic temp+rename so a
//! crash mid-write cannot leave a partial file.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const STATE_FILE: &str = "extension-states.json";

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPersistedEntry {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub last_version: Option<String>,
    #[serde(default)]
    pub installed: bool,
    #[serde(default)]
    pub install_error: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPersistedState {
    #[serde(default)]
    pub extensions: HashMap<String, ExtensionPersistedEntry>,
}

fn state_file_path(home: &Path) -> PathBuf {
    home.join(STATE_FILE)
}

pub fn load(home: &Path) -> Result<ExtensionPersistedState, String> {
    let path = state_file_path(home);
    if !path.exists() {
        return Ok(ExtensionPersistedState::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    if raw.trim().is_empty() {
        return Ok(ExtensionPersistedState::default());
    }
    serde_json::from_str(&raw).map_err(|e| format!("parse {}: {e}", path.display()))
}

pub fn save(home: &Path, state: &ExtensionPersistedState) -> Result<(), String> {
    fs::create_dir_all(home).map_err(|e| format!("mkdir {}: {e}", home.display()))?;
    let path = state_file_path(home);
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(state)
        .map_err(|e| format!("serialize state: {e}"))?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {}: {e}", tmp.display()))?;
        f.write_all(body.as_bytes())
            .map_err(|e| format!("write {}: {e}", tmp.display()))?;
        f.sync_all().map_err(|e| format!("sync {}: {e}", tmp.display()))?;
    }
    fs::rename(&tmp, &path)
        .map_err(|e| format!("rename {} -> {}: {e}", tmp.display(), path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn missing_file_yields_empty_state() {
        let dir = tempdir().unwrap();
        let s = load(dir.path()).unwrap();
        assert!(s.extensions.is_empty());
    }

    #[test]
    fn round_trip_preserves_entries() {
        let dir = tempdir().unwrap();
        let mut s = ExtensionPersistedState::default();
        s.extensions.insert(
            "hello-world".to_string(),
            ExtensionPersistedEntry {
                enabled: false,
                last_version: Some("0.1.0".to_string()),
                installed: true,
                install_error: None,
            },
        );
        save(dir.path(), &s).unwrap();
        let back = load(dir.path()).unwrap();
        let entry = back.extensions.get("hello-world").unwrap();
        assert!(!entry.enabled);
        assert_eq!(entry.last_version.as_deref(), Some("0.1.0"));
        assert!(entry.installed);
    }

    #[test]
    fn enabled_defaults_to_true_when_missing() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join("extension-states.json"),
            r#"{ "extensions": { "hello": {} } }"#,
        )
        .unwrap();
        let back = load(dir.path()).unwrap();
        assert!(back.extensions.get("hello").unwrap().enabled);
    }
}
