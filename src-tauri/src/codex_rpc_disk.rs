//! Disk persistence for Codex RPC session transcripts (JSONL).
//!
//! Mirrors [`cursor_disk`] but writes to `~/.wise/codex-runs/<encoded-repo>/<tabId>.jsonl`.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

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

const PREVIEW_MAX_LINES: usize = 400;
const PREVIEW_MAX_CHARS: usize = 80;
const CODEX_RPC_LIST_MAX: usize = 64;

/// One Wise-owned Codex RPC transcript under `~/.wise/codex-runs`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRpcDiskSessionItem {
    /// Wise tab id（jsonl 文件名 stem，形如 `session_<ts>_<rand>`）。
    session_id: String,
    updated_at_ms: i64,
    preview: String,
    model_hint: Option<String>,
    /// Codex thread id（来自 `codex_session` 绑定行），用于续接。
    resume_session_id: Option<String>,
}

fn file_mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis() as i64)
        .unwrap_or(0)
}

fn content_block_text(block: &serde_json::Value) -> Option<&str> {
    let text = block.get("text").and_then(|v| v.as_str())?.trim();
    if text.is_empty() {
        return None;
    }
    // Codex RPC 落盘常写 `{text}`；Claude 形态是 `{type:"text", text}`。两种都收。
    match block.get("type").and_then(|t| t.as_str()) {
        None | Some("text") => Some(text),
        _ => None,
    }
}

fn extract_user_preview_text(content: &serde_json::Value) -> String {
    if let Some(s) = content.as_str() {
        return s.trim().to_string();
    }
    content
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(content_block_text)
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// 扫 jsonl 头部：取首条用户预览 + Codex thread id + 模型提示。
fn scan_codex_rpc_head(path: &Path) -> (String, Option<String>, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (String::new(), None, None),
    };
    let reader = std::io::BufReader::new(file);
    let mut preview = String::new();
    let mut resume_session_id: Option<String> = None;
    let mut model_hint: Option<String> = None;

    for (index, line) in reader.lines().enumerate() {
        if index >= PREVIEW_MAX_LINES {
            break;
        }
        let Ok(line) = line else {
            break;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let row_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

        if resume_session_id.is_none() && row_type == "codex_session" {
            if let Some(sid) = v
                .get("sessionId")
                .or_else(|| v.get("session_id"))
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                resume_session_id = Some(sid.to_string());
            }
        }

        if model_hint.is_none() {
            if let Some(m) = v
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                model_hint = Some(m.to_string());
            }
        }

        if preview.is_empty() && row_type == "user" {
            if v.get("isMeta").and_then(|x| x.as_bool()) == Some(true) {
                continue;
            }
            let Some(content) = v.get("message").and_then(|m| m.get("content")) else {
                continue;
            };
            let text = extract_user_preview_text(content);
            if text.is_empty()
                || text.contains("<local-command-caveat>")
                || text.trim_start().starts_with("<command-name>")
            {
                continue;
            }
            let mut chars = text.chars();
            preview = chars.by_ref().take(PREVIEW_MAX_CHARS).collect();
            if chars.next().is_some() {
                preview.push_str("...");
            }
        }

        if !preview.is_empty() && resume_session_id.is_some() && model_hint.is_some() {
            break;
        }
    }

    (preview, resume_session_id, model_hint)
}

fn list_codex_rpc_disk_sessions_blocking(
    project_path: String,
) -> Result<Vec<CodexRpcDiskSessionItem>, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let encoded = encoded_codex_repo_dir(Path::new(trimmed))?;
    let dir = wise_codex_runs_root()?.join(encoded);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<CodexRpcDiskSessionItem> = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if !is_safe_codex_tab_session_id(stem) {
            continue;
        }
        // 单测 / 临时 roundtrip 文件不进侧栏。
        if stem.contains("roundtrip") {
            continue;
        }
        let updated_at_ms = file_mtime_ms(&path);
        let (preview, resume_session_id, model_hint) = scan_codex_rpc_head(&path);
        out.push(CodexRpcDiskSessionItem {
            session_id: stem.to_string(),
            updated_at_ms,
            preview,
            model_hint,
            resume_session_id,
        });
    }

    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    out.truncate(CODEX_RPC_LIST_MAX);
    Ok(out)
}

/// 列出 Wise 在本仓库通过 Codex RPC 落盘的会话（`~/.wise/codex-runs`）。
///
/// 与外部 `~/.codex/sessions` 原生索引互补：originator=wise 的会话不会进原生索引，
/// 必须靠这里把侧栏补回来，否则刷新后只剩「新会话」空壳。
#[tauri::command]
pub async fn list_codex_rpc_disk_sessions(
    project_path: String,
) -> Result<Vec<CodexRpcDiskSessionItem>, String> {
    tokio::task::spawn_blocking(move || list_codex_rpc_disk_sessions_blocking(project_path))
        .await
        .map_err(|e| format!("list_codex_rpc_disk_sessions 任务异常: {e}"))?
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

    #[test]
    fn list_codex_rpc_disk_sessions_returns_preview_and_resume_id() {
        let project = std::env::temp_dir().join(format!(
            "wise-codex-rpc-list-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&project);
        fs::create_dir_all(&project).expect("temp project dir");
        let project_path = project.to_string_lossy().to_string();
        let tab = "session_1719000001_listme";
        append_codex_rpc_session_line(
            &project_path,
            tab,
            r#"{"type":"system","subtype":"init"}"#,
        )
        .expect("append system");
        append_codex_rpc_session_line(
            &project_path,
            tab,
            r#"{"type":"user","message":{"role":"user","content":[{"text":"帮我看看这个仓库"}]}}"#,
        )
        .expect("append user");
        append_codex_rpc_session_line(
            &project_path,
            tab,
            r#"{"type":"codex_session","sessionId":"01a0abc-thread-id"}"#,
        )
        .expect("append bind");

        let listed = list_codex_rpc_disk_sessions_blocking(project_path.clone()).expect("list");
        let hit = listed.iter().find(|item| item.session_id == tab);
        assert!(hit.is_some(), "expected listed tab");
        let hit = hit.unwrap();
        assert!(hit.preview.contains("帮我看看这个仓库"));
        assert_eq!(hit.resume_session_id.as_deref(), Some("01a0abc-thread-id"));

        let _ = fs::remove_dir_all(&project);
        if let Ok(path) = codex_rpc_session_jsonl_path(&project_path, tab) {
            let _ = fs::remove_file(&path);
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir(parent);
            }
        }
    }
}
