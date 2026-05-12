use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use serde_json::Value;

const MAX_PRD_BYTES: usize = 256 * 1024;
const TRUNCATION_MARKER: &str = "\n\n<!-- truncated: original exceeded 256 KB -->\n";
const TMP_SUFFIX: &str = ".trellis_tmp";
const ALLOWED_STATUSES: &[&str] = &[
    "planning",
    "in_progress",
    "completed",
    "rejected",
    "archived",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisTaskSummaryRow {
    pub task_id: String,
    pub dir: String,
    pub title: String,
    pub status: String,
    pub has_prd: bool,
    pub has_research: bool,
    pub created_at: Option<String>,
    pub parent: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisTaskDetailRow {
    pub task_id: String,
    pub dir: String,
    pub title: String,
    pub status: String,
    pub task_json_raw: String,
    pub prd_markdown: String,
    pub research_files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisResearchFileRow {
    pub name: String,
    pub size_bytes: u64,
    pub modified_at: Option<u64>,
}

fn validate_simple_slug(value: &str, field: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("WF_INVALID_INPUT: empty {field}"));
    }
    if value.contains("..") {
        return Err(format!("WF_INVALID_INPUT: {field} contains .."));
    }
    if value == "." || value.starts_with('.') {
        return Err(format!("WF_INVALID_INPUT: {field} must not be hidden"));
    }
    let ok = value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if !ok {
        return Err(format!("WF_INVALID_INPUT: {field} has illegal chars"));
    }
    Ok(())
}

fn validate_task_id(task_id: &str) -> Result<(), String> {
    validate_simple_slug(task_id, "taskId")
}

fn canon_trellis_tasks_root(repo_path: &str) -> Result<PathBuf, String> {
    if repo_path.trim().is_empty() {
        return Err("WF_INVALID_INPUT: empty repoPath".into());
    }
    let raw = PathBuf::from(repo_path);
    if !raw.is_absolute() {
        return Err("WF_INVALID_INPUT: repoPath must be absolute".into());
    }
    let repo_canon = raw
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: repo not found: {e}"))?;
    let root = repo_canon.join(".trellis").join("tasks");
    if !root.is_dir() {
        return Err("WF_INVALID_INPUT: .trellis/tasks/ missing".into());
    }
    root.canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: tasks root canon failed: {e}"))
}

fn resolve_task_dir(tasks_root: &Path, task_id: &str) -> Result<PathBuf, String> {
    validate_task_id(task_id)?;
    let candidate = tasks_root.join(task_id);
    if !candidate.is_dir() {
        return Err(format!("WF_INVALID_INPUT: task dir missing for {task_id}"));
    }
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: task canon failed: {e}"))?;
    if !canon.starts_with(tasks_root) {
        return Err("WF_INVALID_INPUT: task dir escapes .trellis/tasks/".into());
    }
    Ok(canon)
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "WF_INVALID_INPUT: target has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut tmp_os = path.as_os_str().to_os_string();
    tmp_os.push(TMP_SUFFIX);
    let tmp_path = PathBuf::from(tmp_os);
    fs::write(&tmp_path, contents).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_task_title(task_json: &Value, fallback: &str) -> String {
    task_json
        .get("title")
        .and_then(Value::as_str)
        .or_else(|| task_json.get("name").and_then(Value::as_str))
        .unwrap_or(fallback)
        .to_string()
}

fn read_task_status(task_json: &Value) -> String {
    task_json
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string()
}

fn read_task_parent(task_json: &Value) -> Option<String> {
    task_json
        .get("parent")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn read_task_created_at(task_json: &Value) -> Option<String> {
    task_json
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn truncate_prd(raw: String) -> String {
    if raw.len() <= MAX_PRD_BYTES {
        return raw;
    }
    let mut cut = MAX_PRD_BYTES;
    while cut > 0 && !raw.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut truncated = raw[..cut].to_string();
    truncated.push_str(TRUNCATION_MARKER);
    truncated
}

#[tauri::command]
pub fn trellis_list_tasks(repo_path: String) -> Result<Vec<TrellisTaskSummaryRow>, String> {
    let tasks_root = canon_trellis_tasks_root(&repo_path)?;
    let entries = fs::read_dir(&tasks_root).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() {
            continue;
        }
        let name_os = entry.file_name();
        let name_str = name_os.to_string_lossy().into_owned();
        if name_str == "archive" || name_str.starts_with('.') {
            continue;
        }
        if validate_task_id(&name_str).is_err() {
            continue;
        }
        let dir = entry.path();
        let (title, status, created_at, parent) = match fs::read_to_string(dir.join("task.json")) {
            Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                Ok(v) => (
                    read_task_title(&v, &name_str),
                    read_task_status(&v),
                    read_task_created_at(&v),
                    read_task_parent(&v),
                ),
                Err(_) => (name_str.clone(), "unknown".into(), None, None),
            },
            Err(_) => (name_str.clone(), "unknown".into(), None, None),
        };
        rows.push(TrellisTaskSummaryRow {
            task_id: name_str.clone(),
            dir: dir.to_string_lossy().into_owned(),
            title,
            status,
            has_prd: dir.join("prd.md").is_file(),
            has_research: dir.join("research").is_dir(),
            created_at,
            parent,
        });
    }
    rows.sort_by(|a, b| a.task_id.cmp(&b.task_id));
    Ok(rows)
}

#[tauri::command]
pub fn trellis_read_task(
    repo_path: String,
    task_id: String,
) -> Result<TrellisTaskDetailRow, String> {
    let tasks_root = canon_trellis_tasks_root(&repo_path)?;
    let dir = resolve_task_dir(&tasks_root, &task_id)?;
    let task_json_raw = fs::read_to_string(dir.join("task.json")).unwrap_or_default();
    let task_value: Value = serde_json::from_str(&task_json_raw).unwrap_or(Value::Null);
    let title = read_task_title(&task_value, &task_id);
    let status = read_task_status(&task_value);
    let prd_path = dir.join("prd.md");
    let prd_markdown = if prd_path.is_file() {
        truncate_prd(fs::read_to_string(&prd_path).map_err(|e| e.to_string())?)
    } else {
        String::new()
    };
    let research_dir = dir.join("research");
    let research_files = if research_dir.is_dir() {
        let mut names: Vec<String> = fs::read_dir(&research_dir)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    } else {
        Vec::new()
    };
    Ok(TrellisTaskDetailRow {
        task_id,
        dir: dir.to_string_lossy().into_owned(),
        title,
        status,
        task_json_raw,
        prd_markdown,
        research_files,
    })
}

#[tauri::command]
pub fn trellis_write_prd(
    repo_path: String,
    task_id: String,
    content: String,
) -> Result<(), String> {
    if content.len() > MAX_PRD_BYTES {
        return Err(format!(
            "WF_INVALID_INPUT: prd content exceeds {MAX_PRD_BYTES} bytes",
        ));
    }
    let tasks_root = canon_trellis_tasks_root(&repo_path)?;
    let dir = resolve_task_dir(&tasks_root, &task_id)?;
    atomic_write(&dir.join("prd.md"), content.as_bytes())
}

#[tauri::command]
pub fn trellis_write_status(
    repo_path: String,
    task_id: String,
    status: String,
) -> Result<(), String> {
    if !ALLOWED_STATUSES.contains(&status.as_str()) {
        return Err(format!("WF_INVALID_INPUT: status {status} not allowed"));
    }
    let tasks_root = canon_trellis_tasks_root(&repo_path)?;
    let dir = resolve_task_dir(&tasks_root, &task_id)?;
    let task_json_path = dir.join("task.json");
    let raw = fs::read_to_string(&task_json_path).map_err(|e| e.to_string())?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| "WF_INVALID_INPUT: task.json not an object".to_string())?;
    obj.insert("status".into(), Value::String(status));
    let serialized = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    atomic_write(&task_json_path, serialized.as_bytes())
}

#[tauri::command]
pub fn trellis_list_research(
    repo_path: String,
    task_id: String,
) -> Result<Vec<TrellisResearchFileRow>, String> {
    let tasks_root = canon_trellis_tasks_root(&repo_path)?;
    let dir = resolve_task_dir(&tasks_root, &task_id)?;
    let research_dir = dir.join("research");
    if !research_dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&research_dir).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .and_then(|d| u64::try_from(d.as_millis()).ok());
        rows.push(TrellisResearchFileRow {
            name: entry.file_name().to_string_lossy().into_owned(),
            size_bytes: metadata.len(),
            modified_at,
        });
    }
    rows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(rows)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SddSignalsRow {
    pub has_trellis_tasks: bool,
    pub has_trellis_spec: bool,
    pub has_open_spec: bool,
    pub has_generic_spec: bool,
}

#[tauri::command]
pub fn trellis_detect_sdd_signals(repo_path: String) -> Result<SddSignalsRow, String> {
    if repo_path.trim().is_empty() {
        return Err("WF_INVALID_INPUT: empty repoPath".into());
    }
    let raw = PathBuf::from(&repo_path);
    if !raw.is_absolute() {
        return Err("WF_INVALID_INPUT: repoPath must be absolute".into());
    }
    let repo_canon = raw
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: repo not found: {e}"))?;
    Ok(SddSignalsRow {
        has_trellis_tasks: repo_canon.join(".trellis").join("tasks").is_dir(),
        has_trellis_spec: repo_canon.join(".trellis").join("spec").is_dir(),
        has_open_spec: repo_canon.join(".openspec").is_dir(),
        has_generic_spec: repo_canon.join(".spec").is_dir(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisSpecAreaRow {
    pub area: String,
    pub has_index: bool,
    pub md_file_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisSpecIndexRow {
    pub area: String,
    pub content: String,
    pub size_bytes: u64,
}

fn trellis_spec_root_path(repo_path: &str) -> Result<PathBuf, String> {
    if repo_path.trim().is_empty() {
        return Err("WF_INVALID_INPUT: empty repoPath".into());
    }
    let raw = PathBuf::from(repo_path);
    if !raw.is_absolute() {
        return Err("WF_INVALID_INPUT: repoPath must be absolute".into());
    }
    let repo_canon = raw
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: repo not found: {e}"))?;
    Ok(repo_canon.join(".trellis").join("spec"))
}

#[tauri::command]
pub fn trellis_list_spec_areas(repo_path: String) -> Result<Vec<TrellisSpecAreaRow>, String> {
    let spec_root = trellis_spec_root_path(&repo_path)?;
    if !spec_root.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&spec_root).map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        if validate_simple_slug(&name, "area").is_err() {
            continue;
        }
        let dir = entry.path();
        let has_index = dir.join("index.md").is_file();
        let md_file_count: u64 = match fs::read_dir(&dir) {
            Ok(iter) => iter
                .flatten()
                .filter(|child| {
                    child.file_type().map(|t| t.is_file()).unwrap_or(false)
                        && child.file_name().to_string_lossy().ends_with(".md")
                })
                .count() as u64,
            Err(_) => 0,
        };
        rows.push(TrellisSpecAreaRow {
            area: name,
            has_index,
            md_file_count,
        });
    }
    rows.sort_by(|a, b| a.area.cmp(&b.area));
    Ok(rows)
}

#[tauri::command]
pub fn trellis_read_spec_index(
    repo_path: String,
    area: String,
) -> Result<TrellisSpecIndexRow, String> {
    validate_simple_slug(&area, "area")?;
    let spec_root = trellis_spec_root_path(&repo_path)?;
    let index_path = spec_root.join(&area).join("index.md");
    if !index_path.is_file() {
        return Ok(TrellisSpecIndexRow {
            area,
            content: String::new(),
            size_bytes: 0,
        });
    }
    let raw = fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let size_bytes = raw.len() as u64;
    let content = truncate_prd(raw);
    Ok(TrellisSpecIndexRow {
        area,
        content,
        size_bytes,
    })
}

#[tauri::command]
pub fn trellis_write_spec_index(
    repo_path: String,
    area: String,
    content: String,
) -> Result<(), String> {
    if content.len() > MAX_PRD_BYTES {
        return Err(format!(
            "WF_INVALID_INPUT: content exceeds {MAX_PRD_BYTES} bytes",
        ));
    }
    validate_simple_slug(&area, "area")?;
    let spec_root = trellis_spec_root_path(&repo_path)?;
    let area_dir = spec_root.join(&area);
    fs::create_dir_all(&area_dir).map_err(|e| e.to_string())?;
    atomic_write(&area_dir.join("index.md"), content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_task_id_accepts_valid_slugs() {
        assert!(validate_task_id("05-11-foo").is_ok());
        assert!(validate_task_id("foo_bar.baz").is_ok());
        assert!(validate_task_id("a1.b-2_c").is_ok());
    }

    #[test]
    fn validate_task_id_rejects_dotdot_slash_and_specials() {
        assert!(validate_task_id("").is_err());
        assert!(validate_task_id(".").is_err());
        assert!(validate_task_id(".hidden").is_err());
        assert!(validate_task_id("..").is_err());
        assert!(validate_task_id("foo/../bar").is_err());
        assert!(validate_task_id("foo bar").is_err());
        assert!(validate_task_id("foo/bar").is_err());
        assert!(validate_task_id("foo*bar").is_err());
    }

    #[test]
    fn truncate_prd_returns_input_when_small() {
        let s = "small".to_string();
        assert_eq!(truncate_prd(s.clone()), s);
    }

    #[test]
    fn truncate_prd_appends_marker_when_large() {
        let big = "x".repeat(MAX_PRD_BYTES + 10);
        let t = truncate_prd(big);
        assert!(t.ends_with(TRUNCATION_MARKER));
        assert!(t.len() < MAX_PRD_BYTES + TRUNCATION_MARKER.len() + 1);
    }
}
