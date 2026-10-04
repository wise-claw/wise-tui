use super::disk_sessions::{encoded_claude_project_dir, is_safe_claude_session_filename};
use serde_json::Value;
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

fn safe_agent_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// Claude 的 progress 行和 Task toolUseResult 都保留调用与 agentId 的关联。
fn agent_id_for_tool(row: &Value, tool_use_id: &str) -> Option<String> {
    let progress_matches = row
        .get("parentToolUseID")
        .or_else(|| row.get("parent_tool_use_id"))
        .and_then(Value::as_str)
        == Some(tool_use_id);
    let result_matches = row
        .pointer("/message/content")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|block| {
                block.get("type").and_then(Value::as_str) == Some("tool_result")
                    && block.get("tool_use_id").and_then(Value::as_str) == Some(tool_use_id)
            })
        });
    let source = if progress_matches {
        row.get("data")
    } else if result_matches {
        row.get("toolUseResult")
    } else {
        None
    }?;
    source
        .get("agentId")
        .or_else(|| source.get("agent_id"))
        .and_then(Value::as_str)
        .filter(|id| safe_agent_id(id))
        .map(str::to_string)
}

fn find_agent_id(parent: &Path, tool_use_id: &str) -> Result<Option<String>, String> {
    if !parent.is_file() {
        return Ok(None);
    }
    let file = fs::File::open(parent).map_err(|error| error.to_string())?;
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|error| error.to_string())?;
        // 大部分行是普通消息，先过滤避免重复解析全部历史。
        if !line.contains(tool_use_id) {
            continue;
        }
        if let Ok(row) = serde_json::from_str::<Value>(&line) {
            if let Some(id) = agent_id_for_tool(&row, tool_use_id) {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}

fn canonical_file_inside(root: &Path, candidate: &Path) -> Result<Option<PathBuf>, String> {
    if !candidate.is_file() {
        return Ok(None);
    }
    let path = fs::canonicalize(candidate).map_err(|error| error.to_string())?;
    if !path.starts_with(root) {
        return Err("subagent path outside project dir".into());
    }
    Ok(Some(path))
}

fn load_from_project_dir(
    project_dir: &Path,
    parent_session_id: &str,
    tool_use_id: &str,
    agent_id: Option<&str>,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    if !is_safe_claude_session_filename(parent_session_id) {
        return Err("invalid parent session id".into());
    }
    if tool_use_id.is_empty() || tool_use_id.len() > 256 {
        return Err("invalid tool use id".into());
    }
    if agent_id.is_some_and(|id| !safe_agent_id(id)) {
        return Err("invalid agent id".into());
    }
    if !project_dir.is_dir() {
        return Ok(Vec::new());
    }
    let root = fs::canonicalize(project_dir).map_err(|error| error.to_string())?;
    let resolved_id = match agent_id {
        Some(id) => Some(id.to_string()),
        None => {
            let parent = root.join(format!("{parent_session_id}.jsonl"));
            match canonical_file_inside(&root, &parent)? {
                Some(path) => find_agent_id(&path, tool_use_id)?,
                None => None,
            }
        }
    };
    let Some(id) = resolved_id else {
        return Ok(Vec::new());
    };
    // 新版按主会话收纳；兼容旧版项目目录下独立的 agent-*.jsonl。
    let candidates = [
        root.join(parent_session_id)
            .join("subagents")
            .join(format!("agent-{id}.jsonl")),
        root.join(format!("agent-{id}.jsonl")),
    ];
    for candidate in candidates {
        let Some(path) = canonical_file_inside(&root, &candidate)? else {
            continue;
        };
        let file = fs::File::open(path).map_err(|error| error.to_string())?;
        let mut lines = VecDeque::new();
        let max = tail_lines.filter(|&count| count > 0);
        for line in BufReader::new(file).lines() {
            let line = line.map_err(|error| error.to_string())?;
            if max.is_some_and(|count| lines.len() >= count) {
                lines.pop_front();
            }
            lines.push_back(line);
        }
        return Ok(lines.into_iter().collect());
    }
    Ok(Vec::new())
}

#[tauri::command]
pub(crate) async fn load_claude_subagent_jsonl(
    project_path: String,
    parent_session_id: String,
    tool_use_id: String,
    agent_id: Option<String>,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let encoded = encoded_claude_project_dir(Path::new(&project_path))?;
        let project_dir = crate::claude_config_dir::user_claude_dir()
            .join("projects")
            .join(encoded);
        load_from_project_dir(
            &project_dir,
            &parent_session_id,
            &tool_use_id,
            agent_id.as_deref(),
            tail_lines,
        )
    })
    .await
    .map_err(|error| format!("load_claude_subagent_jsonl 任务异常: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const SESSION: &str = "11111111-1111-1111-1111-111111111111";

    #[test]
    fn matches_only_the_selected_tool() {
        let progress = json!({"parentToolUseID": "tool-1", "data": {"agentId": "a123"}});
        assert_eq!(
            agent_id_for_tool(&progress, "tool-1").as_deref(),
            Some("a123")
        );
        assert_eq!(agent_id_for_tool(&progress, "tool-2"), None);
        let result = json!({"message": {"content": [{"type": "tool_result", "tool_use_id": "tool-2"}]},
            "toolUseResult": {"agentId": "a456"}});
        assert_eq!(
            agent_id_for_tool(&result, "tool-2").as_deref(),
            Some("a456")
        );
        assert_eq!(agent_id_for_tool(&result, "tool-1"), None);
    }

    #[test]
    fn loads_nested_and_legacy_logs_with_tail_and_missing_fallback() {
        let dir = std::env::temp_dir().join(format!("wise_subagent_{}", uuid::Uuid::new_v4()));
        let nested = dir.join(SESSION).join("subagents");
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            dir.join(format!("{SESSION}.jsonl")),
            json!({"parentToolUseID": "tool-1", "data": {"agentId": "a123"}}).to_string(),
        )
        .unwrap();
        fs::write(nested.join("agent-a123.jsonl"), "first\nsecond\nthird\n").unwrap();
        assert_eq!(
            load_from_project_dir(&dir, SESSION, "tool-1", None, Some(2)).unwrap(),
            vec!["second", "third"]
        );
        assert!(
            load_from_project_dir(&dir, SESSION, "unrelated", None, None)
                .unwrap()
                .is_empty()
        );
        fs::write(dir.join("agent-old.jsonl"), "legacy\n").unwrap();
        assert_eq!(
            load_from_project_dir(&dir, SESSION, "tool-1", Some("old"), None).unwrap(),
            vec!["legacy"]
        );
        assert!(load_from_project_dir(&dir, SESSION, "tool-1", Some("../escape"), None).is_err());
        assert!(load_from_project_dir(&dir, "../escape", "tool-1", Some("old"), None).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_outside_the_project() {
        let dir = std::env::temp_dir().join(format!("wise_subagent_{}", uuid::Uuid::new_v4()));
        let outside = dir.with_extension("jsonl");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("agent-outside.jsonl")).unwrap();
        assert!(load_from_project_dir(&dir, SESSION, "tool-1", Some("outside"), None).is_err());
        fs::remove_dir_all(dir).unwrap();
        fs::remove_file(outside).unwrap();
    }
}
