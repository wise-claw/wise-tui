use serde::Serialize;
use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

fn wise_cursor_runs_root() -> Result<PathBuf, String> {
    Ok(crate::wise_paths::wise_dir()?.join("cursor-runs"))
}

fn encoded_cursor_repo_dir(project_path: &Path) -> Result<String, String> {
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

fn is_safe_cursor_tab_session_id(id: &str) -> bool {
    let len = id.len();
    if len < 8 || len > 128 {
        return false;
    }
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn cursor_session_jsonl_path(project_path: &str, tab_session_id: &str) -> Result<PathBuf, String> {
    let tab = tab_session_id.trim();
    if tab.is_empty() {
        return Err("tabSessionId 不能为空".to_string());
    }
    if !is_safe_cursor_tab_session_id(tab) {
        return Err("tabSessionId 含非法字符".to_string());
    }
    let encoded = encoded_cursor_repo_dir(Path::new(project_path.trim()))?;
    Ok(wise_cursor_runs_root()?
        .join(encoded)
        .join(format!("{tab}.jsonl")))
}

pub fn build_cursor_user_turn_line(
    prompt: &str,
    attachments: Option<&[(String, String)]>,
) -> String {
    let mut content = vec![json!({ "type": "text", "text": prompt })];
    if let Some(items) = attachments {
        for (path, mime) in items {
            content.push(json!({
                "type": "cursor_attachment",
                "path": path,
                "mimeType": mime,
            }));
        }
    }
    json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content,
        },
        "timestamp": chrono::Utc::now().timestamp_millis(),
    })
    .to_string()
}

pub fn append_cursor_session_line(
    project_path: &str,
    tab_session_id: &str,
    line: &str,
) -> Result<(), String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = cursor_session_jsonl_path(project_path, tab_session_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 cursor-runs 目录失败: {e}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("写入 cursor 会话落盘失败: {e}"))?;
    file.write_all(trimmed.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| format!("写入 cursor 会话落盘失败: {e}"))?;
    Ok(())
}

pub fn load_cursor_session_jsonl(
    project_path: &str,
    tab_session_id: &str,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let path = cursor_session_jsonl_path(project_path, tab_session_id)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let file = fs::File::open(&path).map_err(|e| format!("读取 cursor 会话落盘失败: {e}"))?;
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

const PREVIEW_MAX_LINES: usize = 400;
const PREVIEW_MAX_CHARS: usize = 80;
const CURSOR_LIST_MAX: usize = 64;

/// One Wise-owned Cursor transcript under `~/.wise/cursor-runs`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CursorDiskSessionItem {
    /// Wise tab id（jsonl 文件名 stem）。
    session_id: String,
    updated_at_ms: i64,
    preview: String,
    model_hint: Option<String>,
    /// Cursor ACP agent id（来自 `cursor_agent` 绑定行），用于续接。
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

/// 扫 jsonl 头部：取首条用户预览 + Cursor agent id + 模型提示。
fn scan_cursor_run_head(path: &Path) -> (String, Option<String>, Option<String>) {
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

        if resume_session_id.is_none() && row_type == "cursor_agent" {
            if let Some(sid) = v
                .get("agentId")
                .or_else(|| v.get("agent_id"))
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

        if !preview.is_empty() && resume_session_id.is_some() {
            break;
        }
    }

    (preview, resume_session_id, model_hint)
}

fn list_cursor_disk_sessions_blocking(
    project_path: String,
) -> Result<Vec<CursorDiskSessionItem>, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let encoded = encoded_cursor_repo_dir(Path::new(trimmed))?;
    let dir = wise_cursor_runs_root()?.join(encoded);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<CursorDiskSessionItem> = Vec::new();
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
        if !is_safe_cursor_tab_session_id(stem) {
            continue;
        }
        if stem.contains("roundtrip") {
            continue;
        }
        let updated_at_ms = file_mtime_ms(&path);
        let (preview, resume_session_id, model_hint) = scan_cursor_run_head(&path);
        out.push(CursorDiskSessionItem {
            session_id: stem.to_string(),
            updated_at_ms,
            preview,
            model_hint,
            resume_session_id,
        });
    }

    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    out.truncate(CURSOR_LIST_MAX);
    Ok(out)
}

/// 列出 Wise 在本仓库通过 Cursor 落盘的会话（`~/.wise/cursor-runs`）。
#[tauri::command]
pub async fn list_cursor_disk_sessions(
    project_path: String,
) -> Result<Vec<CursorDiskSessionItem>, String> {
    tokio::task::spawn_blocking(move || list_cursor_disk_sessions_blocking(project_path))
        .await
        .map_err(|e| format!("list_cursor_disk_sessions 任务异常: {e}"))?
}

/// 按 Cursor ACP agent id 反查 Wise `cursor-runs` 标签 id（用于原生 ACP 会话读回转录）。
pub fn find_cursor_tab_id_for_agent(project_path: &str, agent_id: &str) -> Option<String> {
    let agent = agent_id.trim();
    if agent.is_empty() || !is_safe_cursor_tab_session_id(agent) {
        return None;
    }
    let encoded = encoded_cursor_repo_dir(Path::new(project_path.trim())).ok()?;
    let dir = wise_cursor_runs_root().ok()?.join(encoded);
    if !dir.is_dir() {
        return None;
    }
    let entries = fs::read_dir(&dir).ok()?;
    let mut best: Option<(i64, String)> = None;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if !is_safe_cursor_tab_session_id(stem) {
            continue;
        }
        let (_, resume, _) = scan_cursor_run_head(&path);
        if resume.as_deref() != Some(agent) {
            continue;
        }
        let mtime = file_mtime_ms(&path);
        if best.as_ref().map(|(t, _)| mtime >= *t).unwrap_or(true) {
            best = Some((mtime, stem.to_string()));
        }
    }
    best.map(|(_, id)| id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_tab_session_id_validation() {
        assert!(is_safe_cursor_tab_session_id("abc12345-uuid"));
        assert!(is_safe_cursor_tab_session_id("session_1790087873060_okbqpw"));
        assert!(!is_safe_cursor_tab_session_id("../evil"));
    }

    #[test]
    fn list_cursor_disk_sessions_returns_preview_and_agent_id() {
        let tmp = std::env::temp_dir().join(format!(
            "wise-cursor-disk-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let project_path = tmp.to_string_lossy().to_string();
        let tab = "session_1719000000_listme";
        let path = cursor_session_jsonl_path(&project_path, tab).unwrap();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            &path,
            format!(
                "{}\n{}\n{}\n",
                json!({"type":"system","subtype":"init"}),
                json!({"type":"cursor_agent","agentId":"74ef5e36-b25b-4838-8276-b4c9e619df20"}),
                json!({"type":"user","message":{"role":"user","content":[{"type":"text","text":"帮我看看这个仓库"}]}}),
            ),
        )
        .unwrap();

        let listed = list_cursor_disk_sessions_blocking(project_path.clone()).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].session_id, tab);
        assert_eq!(
            listed[0].resume_session_id.as_deref(),
            Some("74ef5e36-b25b-4838-8276-b4c9e619df20")
        );
        assert!(listed[0].preview.contains("帮我看看"));
        assert_eq!(
            find_cursor_tab_id_for_agent(&project_path, "74ef5e36-b25b-4838-8276-b4c9e619df20")
                .as_deref(),
            Some(tab)
        );
        let _ = fs::remove_dir_all(&tmp);
    }
}
