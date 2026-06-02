use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};

fn claude_projects_root() -> Result<PathBuf, String> {
    Ok(crate::claude_config_dir::user_claude_dir().join("projects"))
}

/// Encodes an absolute project path into Claude Code's directory name under `~/.claude/projects/`.
pub(crate) fn encoded_claude_project_dir(project_path: &Path) -> Result<String, String> {
    let canon = fs::canonicalize(project_path)
        .map_err(|e| format!("cannot canonicalize project path: {}", e))?;
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
    Ok(format!("-{}", normalized))
}

fn is_safe_claude_session_filename(name: &str) -> bool {
    let len = name.len();
    if !(32..=48).contains(&len) {
        return false;
    }
    name.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// 从一条 user 消息的 content 数组里，尝试用 `Task` 工具调用的 input 生成列表预览（无正文文本时）。
fn preview_from_task_tool_use_in_user_content(content: &serde_json::Value) -> Option<String> {
    let arr = content.as_array()?;
    for b in arr {
        if b.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
            continue;
        }
        let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if !name.eq_ignore_ascii_case("task") {
            continue;
        }
        let Some(input) = b.get("input") else {
            continue;
        };
        let sub = input
            .get("subagent_type")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let desc = input
            .get("description")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                input
                    .get("prompt")
                    .and_then(|x| x.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("");
        let mut out = String::new();
        if !sub.is_empty() {
            out.push('[');
            let take = sub.chars().take(36).collect::<String>();
            out.push_str(&take);
            if sub.chars().nth(36).is_some() {
                out.push('…');
            }
            out.push_str("] ");
        }
        if !desc.is_empty() {
            let take = desc.chars().take(72).collect::<String>();
            out.push_str(&take);
            if desc.chars().nth(72).is_some() {
                out.push('…');
            }
        }
        let t = out.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

fn scan_jsonl_preview(path: &Path) -> (String, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (String::new(), None),
    };
    let reader = std::io::BufReader::new(file);
    let mut model_hint: Option<String> = None;
    let mut preview = String::new();

    for (i, line) in reader.lines().enumerate() {
        if i > 600 {
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if model_hint.is_none() {
            if let Some(m) = v
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|x| x.as_str())
            {
                model_hint = Some(m.to_string());
            }
        }
        if v.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        if v.get("isMeta").and_then(|x| x.as_bool()) == Some(true) {
            continue;
        }
        let content = match v.get("message").and_then(|m| m.get("content")) {
            Some(c) => c,
            None => continue,
        };
        // Content can be a string or an array of content blocks（合并全部非空 text，与前端 JSONL 解析一致）
        let text = match content.as_str() {
            Some(s) => s.to_string(),
            None => {
                let joined = content
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                if !joined.is_empty() {
                    joined
                } else {
                    preview_from_task_tool_use_in_user_content(content).unwrap_or_default()
                }
            }
        };
        if text.is_empty() {
            continue;
        }
        if text.contains("<local-command-caveat>")
            || text.trim_start().starts_with("<command-name>")
        {
            continue;
        }
        let mut ch = text.chars();
        preview = ch.by_ref().take(80).collect();
        if ch.next().is_some() {
            preview.push_str("...");
        }
        break;
    }

    (preview, model_hint)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeDiskSessionItem {
    session_id: String,
    updated_at_ms: i64,
    preview: String,
    model_hint: Option<String>,
}

#[tauri::command]
pub(crate) fn list_claude_disk_sessions(
    project_path: String,
) -> Result<Vec<ClaudeDiskSessionItem>, String> {
    let root = claude_projects_root()?;
    let dir_name = encoded_claude_project_dir(Path::new(&project_path))?;
    let dir = root.join(dir_name);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<ClaudeDiskSessionItem> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if !is_safe_claude_session_filename(stem) {
            continue;
        }
        let meta = fs::metadata(&path).ok();
        let updated_at_ms = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let (preview, model_hint) = scan_jsonl_preview(&path);
        out.push(ClaudeDiskSessionItem {
            session_id: stem.to_string(),
            updated_at_ms,
            preview,
            model_hint,
        });
    }

    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

/// 解析 `~/.claude/projects/<encoded>/<session_id>.jsonl` 的绝对路径，并强制限定在项目目录沙箱内。
///
/// 用于 `load_claude_session_jsonl` / `delete_claude_disk_session` 共享路径校验：
/// 1. `session_id` 必须满足 `is_safe_claude_session_filename`（32~48 个 ASCII 十六进制或 `-`）；
/// 2. 解析 `project_path` 编码后的目录并 `canonicalize`，避免被符号链接跳出；
/// 3. 目标 jsonl 必须存在且 `canonicalize` 后仍在项目目录内，防止越界删/读。
fn resolve_session_jsonl_path(
    project_path: &str,
    session_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    if !is_safe_claude_session_filename(session_id) {
        return Err("invalid session id".into());
    }
    let root = claude_projects_root()?;
    let dir_name = encoded_claude_project_dir(Path::new(project_path))?;
    let dir = root.join(&dir_name);
    let dir_canon =
        fs::canonicalize(&dir).map_err(|e| format!("bad project sessions dir: {}", e))?;
    let path = dir_canon.join(format!("{}.jsonl", session_id));
    if !path.exists() || !path.is_file() {
        return Err("session file not found".into());
    }
    let path_canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !path_canon.starts_with(&dir_canon) {
        return Err("session path outside project dir".into());
    }
    Ok((dir_canon, path_canon))
}

/// 仅用于 resume 前快速探测：该项目作用域下是否存在目标会话 jsonl。
pub(crate) fn claude_session_jsonl_exists(project_path: &str, session_id: &str) -> bool {
    resolve_session_jsonl_path(project_path, session_id).is_ok()
}

#[tauri::command]
pub(crate) fn load_claude_session_jsonl(
    project_path: String,
    session_id: String,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    let (_dir_canon, path_canon) = resolve_session_jsonl_path(&project_path, &session_id)?;
    let file = fs::File::open(&path_canon).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    match tail_lines.filter(|&n| n > 0) {
        None => {
            let mut out: Vec<String> = Vec::new();
            for line in reader.lines() {
                out.push(line.map_err(|e| e.to_string())?);
            }
            Ok(out)
        }
        Some(max) => {
            let mut dq: VecDeque<String> = VecDeque::with_capacity(max.min(8192));
            for line in reader.lines() {
                let line = line.map_err(|e| e.to_string())?;
                if dq.len() == max {
                    dq.pop_front();
                }
                dq.push_back(line);
            }
            Ok(dq.into_iter().collect())
        }
    }
}

/// 物理删除 `~/.claude/projects/<encoded>/<session_id>.jsonl`。
///
/// 与 Claude Code CLI 行为对齐：删除即真删，不再可恢复。前端必须做二次确认，
/// 且在会话处于 `running` / `connecting` 时拒绝调用（避免与正在写盘的 Claude 子进程冲突）。
///
/// 安全约束：复用 `resolve_session_jsonl_path` 校验，确保 `session_id` 形态合法、
/// 解析后的 jsonl 真实存在于该项目目录内（canonicalize + `starts_with`）。
/// 删除时若项目目录或 jsonl 已不存在，视为幂等成功（磁盘侧已无记录）。
fn delete_session_jsonl_already_absent(err: &str) -> bool {
    err.contains("session file not found") || err.contains("bad project sessions dir")
}

#[tauri::command]
pub(crate) fn delete_claude_disk_session(
    project_path: String,
    session_id: String,
) -> Result<(), String> {
    let (_dir_canon, path_canon) = match resolve_session_jsonl_path(&project_path, &session_id) {
        Ok(paths) => paths,
        Err(e) if delete_session_jsonl_already_absent(&e) => return Ok(()),
        Err(e) => return Err(e),
    };
    fs::remove_file(&path_canon).map_err(|e| format!("remove session jsonl: {}", e))?;
    Ok(())
}
