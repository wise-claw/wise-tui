use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use walkdir::WalkDir;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisRequirementWorkspaceInput {
    pub project_root_path: Option<String>,
    #[serde(default)]
    pub project_repository_paths: Vec<String>,
    #[serde(default)]
    pub floating_repository_paths: Vec<String>,
    #[serde(default)]
    pub include_archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisRequirementWorkspaceSource {
    pub source_id: String,
    pub source_kind: String,
    pub root_path: String,
    pub task_count: u32,
    pub prd_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisRequirementTaskRow {
    pub task_id: String,
    pub dir: String,
    pub title: String,
    pub status: String,
    pub archived: bool,
    pub has_prd: bool,
    pub has_research: bool,
    pub created_at: Option<String>,
    pub parent: Option<String>,
    pub root_path: String,
    pub source_kind: String,
    pub repository_id: Option<i64>,
    pub cluster_id: Option<String>,
    pub source_requirement_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisRequirementPrdRow {
    pub task_id: String,
    pub dir: String,
    pub title: String,
    pub status: String,
    pub archived: bool,
    pub parent: Option<String>,
    pub root_path: String,
    pub source_kind: String,
    pub repository_id: Option<i64>,
    pub cluster_id: Option<String>,
    pub requirements_index_json: Option<String>,
    pub prd_markdown: String,
    pub child_task_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisRequirementWorkspaceSnapshot {
    pub sources: Vec<TrellisRequirementWorkspaceSource>,
    pub prds: Vec<TrellisRequirementPrdRow>,
    pub tasks: Vec<TrellisRequirementTaskRow>,
}

#[derive(Debug)]
struct DiscoveredTaskDir {
    task_id: String,
    dir: PathBuf,
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

fn read_string_array_field(task_json: &Value, field: &str) -> Vec<String> {
    task_json
        .get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn read_task_children(task_json: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for field in ["children", "subtasks"] {
        for child in read_string_array_field(task_json, field) {
            if !out.contains(&child) {
                out.push(child);
            }
        }
    }
    out
}

fn read_task_repository_id(task_json: &Value) -> Option<i64> {
    task_json.get("repositoryId").and_then(Value::as_i64)
}

fn read_task_cluster_id(task_json: &Value) -> Option<String> {
    task_json
        .get("clusterId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn read_source_requirement_ids(task_json: &Value) -> Vec<String> {
    task_json
        .get("meta")
        .and_then(Value::as_object)
        .and_then(|meta| meta.get("sourceRequirementIds"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
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

fn should_enter_task_scan_dir(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    name != "archive" && !name.starts_with('.')
}

fn discover_task_dirs(tasks_root: &Path, include_archived: bool) -> Vec<DiscoveredTaskDir> {
    let mut rows = Vec::new();
    if !tasks_root.is_dir() {
        return rows;
    }

    let walker = WalkDir::new(tasks_root)
        .min_depth(1)
        .follow_links(false);

    let entries: Box<dyn Iterator<Item = walkdir::Result<walkdir::DirEntry>>> = if include_archived {
        Box::new(walker.into_iter())
    } else {
        Box::new(walker.into_iter().filter_entry(should_enter_task_scan_dir))
    };

    for entry in entries.flatten()
    {
        if !entry.file_type().is_dir() {
            continue;
        }
        let task_id = entry.file_name().to_string_lossy().into_owned();
        if validate_task_id(&task_id).is_err() {
            continue;
        }
        let dir = entry.path();
        if !dir.join("task.json").is_file() {
            continue;
        }
        rows.push(DiscoveredTaskDir {
            task_id,
            dir: dir.to_path_buf(),
        });
    }

    rows.sort_by(|a, b| a.task_id.cmp(&b.task_id).then_with(|| a.dir.cmp(&b.dir)));
    rows
}

fn is_archived_task_dir(tasks_root: &Path, dir: &Path, status: &str) -> bool {
    if status == "archived" {
        return true;
    }
    dir.strip_prefix(tasks_root)
        .ok()
        .and_then(|relative| relative.components().next())
        .map(|component| component.as_os_str() == "archive")
        .unwrap_or(false)
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
pub fn trellis_list_requirement_workspace(
    input: TrellisRequirementWorkspaceInput,
) -> Result<TrellisRequirementWorkspaceSnapshot, String> {
    let mut scan_roots: Vec<(String, PathBuf)> = Vec::new();
    let mut seen = std::collections::HashSet::<PathBuf>::new();

    if let Some(project_root) = input
        .project_root_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        push_scan_root(&mut scan_roots, &mut seen, "project", project_root)?;
    }
    for path in input.project_repository_paths {
        push_scan_root(&mut scan_roots, &mut seen, "projectRepository", &path)?;
    }
    for path in input.floating_repository_paths {
        push_scan_root(&mut scan_roots, &mut seen, "floatingRepository", &path)?;
    }

    let mut sources = Vec::new();
    let mut prds = Vec::new();
    let mut tasks = Vec::new();

    for (source_kind, root) in scan_roots {
        let tasks_root = root.join(".trellis").join("tasks");
        if !tasks_root.is_dir() {
            sources.push(TrellisRequirementWorkspaceSource {
                source_id: format!("{}:{}", source_kind, root.to_string_lossy()),
                source_kind,
                root_path: root.to_string_lossy().into_owned(),
                task_count: 0,
                prd_count: 0,
            });
            continue;
        }

        let mut source_task_count = 0_u32;
        let mut source_prd_count = 0_u32;
        for discovered in discover_task_dirs(&tasks_root, input.include_archived) {
            let name = discovered.task_id;
            let dir = discovered.dir;
            let task_json_raw = fs::read_to_string(dir.join("task.json")).unwrap_or_default();
            let task_json: Value = serde_json::from_str(&task_json_raw).unwrap_or(Value::Null);
            let title = read_task_title(&task_json, &name);
            let status = read_task_status(&task_json);
            let archived = is_archived_task_dir(&tasks_root, &dir, &status);
            let created_at = read_task_created_at(&task_json);
            let parent = read_task_parent(&task_json);
            let repository_id = read_task_repository_id(&task_json);
            let cluster_id = read_task_cluster_id(&task_json);
            let source_requirement_ids = read_source_requirement_ids(&task_json);
            let has_prd = dir.join("prd.md").is_file();
            let has_research = dir.join("research").is_dir();
            let child_task_ids = read_task_children(&task_json);

            source_task_count += 1;
            tasks.push(TrellisRequirementTaskRow {
                task_id: name.clone(),
                dir: dir.to_string_lossy().into_owned(),
                title: title.clone(),
                status: status.clone(),
                archived,
                has_prd,
                has_research,
                created_at,
                parent: parent.clone(),
                root_path: root.to_string_lossy().into_owned(),
                source_kind: source_kind.clone(),
                repository_id,
                cluster_id: cluster_id.clone(),
                source_requirement_ids,
            });

            if has_prd {
                source_prd_count += 1;
                let prd_markdown = truncate_prd(
                    fs::read_to_string(dir.join("prd.md")).map_err(|e| e.to_string())?,
                );
                let requirements_index_json =
                    fs::read_to_string(dir.join("requirements-index.json")).ok();
                prds.push(TrellisRequirementPrdRow {
                    task_id: name,
                    dir: dir.to_string_lossy().into_owned(),
                    title,
                    status,
                    archived,
                    parent,
                    root_path: root.to_string_lossy().into_owned(),
                    source_kind: source_kind.clone(),
                    repository_id,
                    cluster_id,
                    requirements_index_json,
                    prd_markdown,
                    child_task_ids,
                });
            }
        }

        sources.push(TrellisRequirementWorkspaceSource {
            source_id: format!("{}:{}", source_kind, root.to_string_lossy()),
            source_kind,
            root_path: root.to_string_lossy().into_owned(),
            task_count: source_task_count,
            prd_count: source_prd_count,
        });
    }

    prds.sort_by(|a, b| b.task_id.cmp(&a.task_id));
    tasks.sort_by(|a, b| b.task_id.cmp(&a.task_id));

    Ok(TrellisRequirementWorkspaceSnapshot {
        sources,
        prds,
        tasks,
    })
}

fn push_scan_root(
    out: &mut Vec<(String, PathBuf)>,
    seen: &mut std::collections::HashSet<PathBuf>,
    source_kind: &str,
    raw: &str,
) -> Result<(), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!(
            "WF_INVALID_INPUT: {source_kind} path must be absolute"
        ));
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: {source_kind} path not found: {e}"))?;
    if !canon.is_dir() {
        return Err(format!(
            "WF_INVALID_INPUT: {source_kind} path must be a directory"
        ));
    }
    if seen.insert(canon.clone()) {
        out.push((source_kind.to_string(), canon));
    }
    Ok(())
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
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisSpecFileRow {
    pub relative_path: String,
    pub content: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrellisSpecTreeNode {
    pub name: String,
    pub relative_path: String,
    pub node_type: String,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<u64>,
    pub children: Vec<TrellisSpecTreeNode>,
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

fn canon_trellis_spec_root(repo_path: &str) -> Result<PathBuf, String> {
    let spec_root = trellis_spec_root_path(repo_path)?;
    if !spec_root.is_dir() {
        return Err("WF_INVALID_INPUT: .trellis/spec/ missing".into());
    }
    spec_root
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: spec root canon failed: {e}"))
}

fn resolve_spec_markdown_file(spec_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("WF_INVALID_INPUT: empty relativePath".into());
    }
    if trimmed == "." || trimmed.starts_with('.') || trimmed.contains("..") {
        return Err("WF_INVALID_INPUT: relativePath escapes .trellis/spec/".into());
    }
    let raw = PathBuf::from(trimmed);
    if raw.is_absolute() {
        return Err("WF_INVALID_INPUT: relativePath must be relative".into());
    }
    if raw.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("WF_INVALID_INPUT: relativePath has illegal components".into());
    }
    if raw.extension().and_then(|value| value.to_str()) != Some("md") {
        return Err("WF_INVALID_INPUT: only Markdown spec files are editable".into());
    }
    let candidate = spec_root.join(raw);
    let parent = candidate
        .parent()
        .ok_or_else(|| "WF_INVALID_INPUT: spec file has no parent".to_string())?;
    if !parent.is_dir() {
        return Err("WF_INVALID_INPUT: spec parent directory missing".into());
    }
    let parent_canon = parent
        .canonicalize()
        .map_err(|e| format!("WF_INVALID_INPUT: spec parent canon failed: {e}"))?;
    if !parent_canon.starts_with(spec_root) {
        return Err("WF_INVALID_INPUT: spec file escapes .trellis/spec/".into());
    }
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "WF_INVALID_INPUT: spec file missing name".to_string())?;
    Ok(parent_canon.join(file_name))
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

fn modified_secs(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
}

fn build_spec_tree_node(
    spec_root: &Path,
    path: &Path,
    depth: usize,
) -> Result<Option<TrellisSpecTreeNode>, String> {
    const MAX_SPEC_TREE_DEPTH: usize = 8;
    if depth > MAX_SPEC_TREE_DEPTH {
        return Ok(None);
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "spec".to_string());
    if name.starts_with('.') {
        return Ok(None);
    }
    let relative_path = path
        .strip_prefix(spec_root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| ".".to_string());
    if metadata.is_file() {
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            return Ok(None);
        }
        return Ok(Some(TrellisSpecTreeNode {
            name,
            relative_path,
            node_type: "file".to_string(),
            size_bytes: Some(metadata.len()),
            modified_at: modified_secs(&metadata),
            children: Vec::new(),
        }));
    }
    if !metadata.is_dir() {
        return Ok(None);
    }
    let mut children = Vec::new();
    let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if let Some(child) = build_spec_tree_node(spec_root, &entry.path(), depth + 1)? {
            children.push(child);
        }
    }
    children.sort_by(|a, b| {
        let a_dir = a.node_type == "directory";
        let b_dir = b.node_type == "directory";
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Some(TrellisSpecTreeNode {
        name,
        relative_path,
        node_type: "directory".to_string(),
        size_bytes: None,
        modified_at: modified_secs(&metadata),
        children,
    }))
}

#[tauri::command]
pub fn trellis_list_spec_tree(repo_path: String) -> Result<Vec<TrellisSpecTreeNode>, String> {
    let spec_root = trellis_spec_root_path(&repo_path)?;
    if !spec_root.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&spec_root).map_err(|e| e.to_string())?;
    let mut roots = Vec::new();
    for entry in entries.flatten() {
        if let Some(node) = build_spec_tree_node(&spec_root, &entry.path(), 1)? {
            roots.push(node);
        }
    }
    roots.sort_by(|a, b| {
        let a_dir = a.node_type == "directory";
        let b_dir = b.node_type == "directory";
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(roots)
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

#[tauri::command]
pub fn trellis_read_spec_file(
    repo_path: String,
    relative_path: String,
) -> Result<TrellisSpecFileRow, String> {
    let spec_root = canon_trellis_spec_root(&repo_path)?;
    let file_path = resolve_spec_markdown_file(&spec_root, &relative_path)?;
    if !file_path.is_file() {
        return Err("WF_INVALID_INPUT: spec file missing".into());
    }
    let raw = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let size_bytes = raw.len() as u64;
    let content = truncate_prd(raw);
    let relative_path = file_path
        .strip_prefix(&spec_root)
        .map_err(|_| "WF_INVALID_INPUT: spec file escapes .trellis/spec/".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(TrellisSpecFileRow {
        relative_path,
        content,
        size_bytes,
    })
}

#[tauri::command]
pub fn trellis_write_spec_file(
    repo_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    if content.len() > MAX_PRD_BYTES {
        return Err(format!(
            "WF_INVALID_INPUT: content exceeds {MAX_PRD_BYTES} bytes",
        ));
    }
    let spec_root = canon_trellis_spec_root(&repo_path)?;
    let file_path = resolve_spec_markdown_file(&spec_root, &relative_path)?;
    atomic_write(&file_path, content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("wise-trellis-bridge-{name}-{nanos}"))
    }

    fn write_task(root: &Path, rel: &str, task_json: &str, prd: Option<&str>) {
        let dir = root.join(".trellis").join("tasks").join(rel);
        fs::create_dir_all(&dir).expect("task dir should be created");
        fs::write(dir.join("task.json"), task_json).expect("task json should be written");
        if let Some(markdown) = prd {
            fs::write(dir.join("prd.md"), markdown).expect("prd should be written");
        }
    }

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

    #[test]
    fn discover_task_dirs_includes_nested_children_and_skips_archive() {
        let root = unique_test_dir("discover-nested");
        fs::create_dir_all(root.join(".trellis/tasks/archive/2026-05/05-14-old"))
            .expect("archive should be created");
        write_task(
            &root,
            "05-14-parent",
            r#"{"title":"Parent","status":"planning","children":["05-14-child"]}"#,
            Some("# Parent"),
        );
        write_task(
            &root,
            "05-14-parent/05-14-child",
            r#"{"title":"Child","status":"planning","parent":"05-14-parent"}"#,
            Some("# Child"),
        );
        write_task(
            &root,
            "archive/2026-05/05-14-old",
            r#"{"title":"Old","status":"completed"}"#,
            Some("# Old"),
        );

        let tasks = discover_task_dirs(&root.join(".trellis/tasks"), false);
        let ids: Vec<String> = tasks.into_iter().map(|task| task.task_id).collect();
        assert_eq!(ids, vec!["05-14-child", "05-14-parent"]);

        let tasks_with_archive = discover_task_dirs(&root.join(".trellis/tasks"), true);
        let ids_with_archive: Vec<String> = tasks_with_archive
            .into_iter()
            .map(|task| task.task_id)
            .collect();
        assert_eq!(
            ids_with_archive,
            vec!["05-14-child", "05-14-old", "05-14-parent"]
        );

        fs::remove_dir_all(root).expect("test dir should be removed");
    }

    #[test]
    fn requirement_workspace_scans_project_and_floating_repository_tasks() {
        let base = unique_test_dir("workspace");
        let project = base.join("project");
        let linked_repo = base.join("linked-repo");
        let floating_repo = base.join("floating-repo");
        fs::create_dir_all(&linked_repo).expect("linked repo should be created");

        write_task(
            &project,
            "05-14-parent",
            r#"{
              "title":"Parent",
              "status":"planning",
              "children":["05-14-child"],
              "subtasks":["legacy-child"],
              "repositoryId":7,
              "clusterId":"cluster-web"
            }"#,
            Some("# Parent"),
        );
        fs::write(
            project.join(".trellis/tasks/05-14-parent/requirements-index.json"),
            r#"{"requirements":[]}"#,
        )
        .expect("requirements index should be written");
        write_task(
            &project,
            "05-14-parent/05-14-child",
            r#"{
              "title":"Child",
              "status":"planning",
              "parent":"05-14-parent",
              "repositoryId":7,
              "clusterId":"cluster-web",
              "meta":{"sourceRequirementIds":["REQ-1"]}
            }"#,
            Some("# Child"),
        );
        write_task(
            &floating_repo,
            "05-15-floating",
            r#"{"title":"Floating","status":"in_progress"}"#,
            Some("# Floating"),
        );
        write_task(
            &project,
            "archive/2026-05/05-13-archived",
            r#"{"title":"Archived","status":"completed"}"#,
            Some("# Archived"),
        );

        let snapshot = trellis_list_requirement_workspace(TrellisRequirementWorkspaceInput {
            project_root_path: Some(project.to_string_lossy().into_owned()),
            project_repository_paths: vec![linked_repo.to_string_lossy().into_owned()],
            floating_repository_paths: vec![floating_repo.to_string_lossy().into_owned()],
            include_archived: false,
        })
        .expect("workspace should scan");

        assert_eq!(snapshot.sources.len(), 3);
        assert_eq!(snapshot.tasks.len(), 3);
        assert_eq!(snapshot.prds.len(), 3);
        assert!(snapshot.tasks.iter().all(|task| !task.archived));
        let task_ids: Vec<&str> = snapshot
            .tasks
            .iter()
            .map(|task| task.task_id.as_str())
            .collect();
        assert!(task_ids.contains(&"05-14-parent"));
        assert!(task_ids.contains(&"05-14-child"));
        assert!(task_ids.contains(&"05-15-floating"));

        let parent = snapshot
            .prds
            .iter()
            .find(|prd| prd.task_id == "05-14-parent")
            .expect("parent prd should be present");
        assert_eq!(parent.child_task_ids, vec!["05-14-child", "legacy-child"]);
        assert_eq!(parent.repository_id, Some(7));
        assert_eq!(parent.cluster_id.as_deref(), Some("cluster-web"));
        assert_eq!(
            parent.requirements_index_json.as_deref(),
            Some(r#"{"requirements":[]}"#),
        );

        let child = snapshot
            .tasks
            .iter()
            .find(|task| task.task_id == "05-14-child")
            .expect("child task should be present");
        assert_eq!(child.parent.as_deref(), Some("05-14-parent"));
        assert_eq!(child.source_requirement_ids, vec!["REQ-1"]);

        let floating_source = snapshot
            .sources
            .iter()
            .find(|source| source.source_kind == "floatingRepository")
            .expect("floating source should be present");
        assert_eq!(floating_source.task_count, 1);
        assert_eq!(floating_source.prd_count, 1);

        let with_archive = trellis_list_requirement_workspace(TrellisRequirementWorkspaceInput {
            project_root_path: Some(project.to_string_lossy().into_owned()),
            project_repository_paths: vec![linked_repo.to_string_lossy().into_owned()],
            floating_repository_paths: vec![floating_repo.to_string_lossy().into_owned()],
            include_archived: true,
        })
        .expect("workspace should scan archived tasks");
        let archived = with_archive
            .tasks
            .iter()
            .find(|task| task.task_id == "05-13-archived")
            .expect("archived task should be present");
        assert!(archived.archived);
        let archived_prd = with_archive
            .prds
            .iter()
            .find(|prd| prd.task_id == "05-13-archived")
            .expect("archived prd should be present");
        assert!(archived_prd.archived);

        fs::remove_dir_all(base).expect("test dir should be removed");
    }
}
