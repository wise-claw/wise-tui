//! Disk persistence for Codex RPC session transcripts (JSONL).
//!
//! Mirrors [`cursor_disk`] but writes to `~/.wise/codex-runs/<encoded-repo>/<tabId>.jsonl`.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

fn wise_codex_runs_root() -> Result<PathBuf, String> {
    Ok(crate::wise_paths::wise_dir()?.join("codex-runs"))
}

fn encoded_codex_repo_dir(project_path: &Path) -> Result<String, String> {
    let canon = fs::canonicalize(project_path)
        .map_err(|e| format!("cannot canonicalize project path: {e}"))?;
    let s = canon.to_string_lossy().to_string();
    let normalized = if cfg!(windows) {
        let mut t = s.replace('\\', "/");
        if let Some(rest) = t.strip_prefix("//?/") {
            t = rest.to_string();
        }
        t.trim_start_matches('/').replace('/', "-").replace(':', "")
    } else {
        s.trim_start_matches('/').replace('/', "-")
    };
    Ok(format!("-{normalized}"))
}

/// Codex tab IDs have the form `session_<timestamp>_<random>`, which contains
/// underscores and is longer than Cursor IDs. Allow alphanumeric, `-`, and `_`.
fn is_safe_codex_tab_session_id(id: &str) -> bool {
    let len = id.len();
    if len < 8 || len > 128 {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn codex_rpc_session_jsonl_path(
    project_path: &str,
    tab_session_id: &str,
) -> Result<PathBuf, String> {
    let tab = tab_session_id.trim();
    if tab.is_empty() {
        return Err("tabSessionId 不能为空".to_string());
    }
    if !is_safe_codex_tab_session_id(tab) {
        return Err("tabSessionId 含非法字符".to_string());
    }
    let encoded = encoded_codex_repo_dir(Path::new(project_path.trim()))?;
    Ok(wise_codex_runs_root()?
        .join(encoded)
        .join(format!("{tab}.jsonl")))
}

/// Append a single JSONL line to the Codex RPC session transcript on disk.
pub fn append_codex_rpc_session_line(
    project_path: &str,
    tab_session_id: &str,
    line: &str,
) -> Result<(), String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = codex_rpc_session_jsonl_path(project_path, tab_session_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 codex-runs 目录失败: {e}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("写入 codex rpc 会话落盘失败: {e}"))?;
    file.write_all(trimmed.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("写入 codex rpc 会话落盘失败: {e}"))?;
    Ok(())
}

/// Load JSONL lines from a Codex RPC session transcript on disk.
pub fn load_codex_rpc_session_jsonl(
    project_path: &str,
    tab_session_id: &str,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let path = codex_rpc_session_jsonl_path(project_path, tab_session_id)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file =
        fs::File::open(&path).map_err(|e| format!("读取 codex rpc 会话落盘失败: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let mut lines: Vec<String> = reader
        .lines()
        .filter_map(|line| line.ok().map(|value| value.trim().to_string()))
        .filter(|line| !line.is_empty())
        .collect();
    if let Some(tail) = tail_lines {
        if tail > 0 && lines.len() > tail {
            lines = lines.split_off(lines.len() - tail);
        }
    }
    Ok(lines)
}

/// Tauri command wrapper for loading Codex RPC session JSONL.
#[tauri::command]
pub async fn load_codex_rpc_session_jsonl_command(
    project_path: String,
    tab_session_id: String,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    load_codex_rpc_session_jsonl(&project_path, &tab_session_id, tail_lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_tab_session_id_validation() {
        // Codex format: session_<timestamp>_<random>
        assert!(is_safe_codex_tab_session_id(
            "session_1719000000_abc123def456"
        ));
        assert!(is_safe_codex_tab_session_id("codex-rpc-abc12345-uuid"));
        assert!(!is_safe_codex_tab_session_id("../evil"));
        assert!(!is_safe_codex_tab_session_id("short"));
    }

    #[test]
    fn append_and_load_roundtrip() {
        let project = std::env::temp_dir().join(format!(
            "wise-codex-rpc-disk-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&project);
        fs::create_dir_all(&project).expect("temp project dir");
        let project_path = project.to_string_lossy().to_string();
        let tab = "session_1719000000_roundtrip";
        append_codex_rpc_session_line(&project_path, tab, r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}"#)
            .expect("append");
        let lines = load_codex_rpc_session_jsonl(&project_path, tab, None).expect("load");
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("hi"));
        let _ = fs::remove_dir_all(&project);
        // Also remove the encoded repo dir under ~/.wise/codex-runs created by this test.
        if let Ok(path) = codex_rpc_session_jsonl_path(&project_path, tab) {
            let _ = fs::remove_file(&path);
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }
}
