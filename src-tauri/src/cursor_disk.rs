use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

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
    if len < 8 || len > 64 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_tab_session_id_validation() {
        assert!(is_safe_cursor_tab_session_id("abc12345-uuid"));
        assert!(!is_safe_cursor_tab_session_id("../evil"));
    }
}
