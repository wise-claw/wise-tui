use crate::wise_paths::{
    wise_legacy_projects_json, wise_repositories_json, wise_tabs_json, write_file_atomic,
};
use crate::{git_commands, wise_db};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;
use uuid::Uuid;

pub(crate) mod settings_commands;
pub(crate) mod workflow_graph_commands;
pub(crate) mod workflow_run_commands;

// ── Repository (Wise sidebar workspace) Types ──

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredRepository {
    id: i64,
    /// 与 `path` 末段目录名一致（打开的仓库名）。
    name: String,
    path: String,
    #[serde(default = "default_repository_type", alias = "repository_type")]
    repository_type: String,
    /// 侧栏圆形角标背景色（`#rgb` / `#rrggbb`）；为空则按 `repository_type` 使用默认色。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_color: Option<String>,
    /// 角标首字来源；为空则取 `name`（目录名）首字。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_display_name: Option<String>,
    /// 主 Owner 子代理展示名（与 `repositoryName` 中 `…/员工:姓名` 的姓名一致）；未设置则为人类主会话逻辑。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    main_owner_agent_name: Option<String>,
    branch: Option<String>,
    #[serde(alias = "created_at")]
    created_at: String,
    #[serde(alias = "updated_at")]
    updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sdd_mode: Option<String>,
}

fn default_repository_type() -> String {
    "frontend".to_string()
}

fn normalize_hex_icon_color(input: Option<String>) -> Option<String> {
    let raw = input?.trim().to_owned();
    if raw.is_empty() {
        return None;
    }
    let without_hash = raw.strip_prefix('#').unwrap_or(&raw);
    if without_hash.len() != 3 && without_hash.len() != 6 {
        return None;
    }
    if !without_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", without_hash.to_ascii_lowercase()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredProject {
    id: String,
    name: String,
    repository_ids: Vec<i64>,
    created_at: i64,
    updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmployeeItem {
    id: String,
    name: String,
    agent_type: String,
    enabled: bool,
    created_at: i64,
    updated_at: i64,
    display_order: i64,
    repository_ids: Vec<i64>,
    project_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmployeeTaskCountItem {
    employee_id: String,
    task_count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTemplateAssignee {
    id: String,
    employee_id: String,
    required_count: i64,
    is_required: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTemplateStage {
    id: String,
    name: String,
    stage_order: i64,
    pass_rule: String,
    reject_rule: String,
    assignees: Vec<WorkflowTemplateAssignee>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTemplateItem {
    id: String,
    name: String,
    is_default: bool,
    created_at: i64,
    updated_at: i64,
    stages: Vec<WorkflowTemplateStage>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTaskItem {
    id: String,
    title: String,
    content: String,
    creator: String,
    workflow_id: String,
    current_stage_index: i64,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTaskEventItem {
    id: String,
    task_id: String,
    event_type: String,
    payload_json: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcceptanceVerdictSourceStatsItem {
    verdict_source: String,
    count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskPendingEmployeeItem {
    employee_id: String,
    name: String,
}

fn legacy_repositories_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to get app data dir")
        .join("projects.json")
}

/// Ensures `~/.wise/repositories.json` exists: migrates from `~/.wise/projects.json`, then app-data legacy.
fn migrate_repository_storage(app: &tauri::AppHandle) -> Result<(), String> {
    let dest = wise_repositories_json()?;
    if dest.exists() {
        return Ok(());
    }
    let old_wise = wise_legacy_projects_json()?;
    if old_wise.exists() {
        let contents = fs::read_to_string(&old_wise).map_err(|e| e.to_string())?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        write_file_atomic(&dest, &contents)?;
        let _ = fs::remove_file(&old_wise);
        return Ok(());
    }
    let legacy = legacy_repositories_path(app);
    if !legacy.exists() {
        return Ok(());
    }
    let contents = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_file_atomic(&dest, &contents)?;
    let _ = fs::remove_file(&legacy);
    Ok(())
}

// ── Repository Helpers ──

fn repository_folder_label_from_path(folder_path: &str) -> String {
    std::path::Path::new(folder_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "未命名仓库".to_string())
}

/// 将 `name` 规范为路径末段；若旧数据曾把自定义侧栏名写在 `name` 里，则迁入 `icon_display_name`。
fn normalize_stored_repository_row(mut r: StoredRepository) -> (StoredRepository, bool) {
    let folder = repository_folder_label_from_path(&r.path);
    let mut changed = false;
    if let Some(ref s) = r.icon_display_name {
        let t = s.trim().to_string();
        if t.is_empty() {
            r.icon_display_name = None;
            changed = true;
        } else if t != *s {
            r.icon_display_name = Some(t);
            changed = true;
        }
    }
    let old_name_trimmed = r.name.trim().to_string();
    if r.icon_display_name.is_none() && !old_name_trimmed.is_empty() && old_name_trimmed != folder {
        r.icon_display_name = Some(old_name_trimmed.clone());
        changed = true;
    }
    if r.name != folder {
        r.name = folder;
        changed = true;
    }
    (r, changed)
}

fn load_repositories(app: &tauri::AppHandle) -> Vec<StoredRepository> {
    let _ = migrate_repository_storage(app);
    let path = match wise_repositories_json() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    if !path.exists() {
        return Vec::new();
    }
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let list: Vec<StoredRepository> = serde_json::from_str(&contents).unwrap_or_default();
    let mut any_changed = false;
    let mut next = Vec::with_capacity(list.len());
    for r in list {
        let (r2, ch) = normalize_stored_repository_row(r);
        any_changed |= ch;
        next.push(r2);
    }
    if any_changed {
        let _ = save_repositories(app, &next);
    }
    next
}

fn save_repositories(
    _app: &tauri::AppHandle,
    repositories: &[StoredRepository],
) -> Result<(), String> {
    let path = wise_repositories_json()?;
    let json = serde_json::to_string_pretty(repositories).map_err(|e| e.to_string())?;
    write_file_atomic(&path, &json)
}

#[tauri::command]
pub(crate) fn load_session_tabs() -> Option<serde_json::Value> {
    let path = wise_tabs_json().ok()?;
    if !path.exists() {
        return None;
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
pub(crate) fn save_session_tabs(state: serde_json::Value) -> Result<(), String> {
    let path = wise_tabs_json()?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    write_file_atomic(&path, &json)
}

fn enrich_repositories_with_branch(repositories: Vec<StoredRepository>) -> Vec<StoredRepository> {
    repositories
        .into_iter()
        .map(|mut p| {
            p.branch = git_commands::get_git_branch(&p.path);
            p
        })
        .collect()
}

// ── Repository Commands ──

#[tauri::command]
pub(crate) fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub(crate) fn list_repositories(app: tauri::AppHandle) -> Vec<StoredRepository> {
    let repositories = load_repositories(&app);
    enrich_repositories_with_branch(repositories)
}

#[tauri::command]
pub(crate) fn create_repository_from_path(
    app: tauri::AppHandle,
    folder_path: String,
    repository_type: String,
    icon_display_name: Option<String>,
    icon_color: Option<String>,
) -> Result<StoredRepository, String> {
    let folder_label = repository_folder_label_from_path(&folder_path);
    let icon_disp = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let existing = load_repositories(&app);
    if existing.iter().any(|p| p.path == folder_path) {
        return Err("此路径的仓库已存在".into());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let normalized_repository_type = match repository_type.as_str() {
        "frontend" | "backend" | "document" => repository_type,
        _ => return Err("仓库类型无效，仅支持 frontend/backend/document".into()),
    };

    let repository = StoredRepository {
        id: now,
        name: folder_label,
        path: folder_path.clone(),
        repository_type: normalized_repository_type,
        icon_color: normalize_hex_icon_color(icon_color),
        icon_display_name: icon_disp,
        main_owner_agent_name: None,
        branch: git_commands::get_git_branch(&folder_path),
        created_at: now.to_string(),
        updated_at: now.to_string(),
        sdd_mode: None,
    };

    let mut repositories = load_repositories(&app);
    repositories.push(repository.clone());
    save_repositories(&app, &repositories)?;

    Ok(repository)
}

#[tauri::command]
pub(crate) fn update_repository_icon_display(
    app: tauri::AppHandle,
    id: i64,
    icon_display_name: Option<String>,
) -> Result<StoredRepository, String> {
    let mut repositories = load_repositories(&app);
    let idx = repositories
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "仓库未找到".to_string())?;
    let trimmed = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    repositories[idx].icon_display_name = trimmed;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    repositories[idx].updated_at = now.to_string();
    save_repositories(&app, &repositories)?;
    let mut out = repositories[idx].clone();
    out.branch = git_commands::get_git_branch(&out.path);
    Ok(out)
}

#[tauri::command]
pub(crate) fn update_repository_main_owner_agent(
    app: tauri::AppHandle,
    id: i64,
    main_owner_agent_name: Option<String>,
) -> Result<StoredRepository, String> {
    let mut repositories = load_repositories(&app);
    let idx = repositories
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "仓库未找到".to_string())?;
    let trimmed = main_owner_agent_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    repositories[idx].main_owner_agent_name = trimmed;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    repositories[idx].updated_at = now.to_string();
    save_repositories(&app, &repositories)?;
    let mut out = repositories[idx].clone();
    out.branch = git_commands::get_git_branch(&out.path);
    Ok(out)
}

#[tauri::command]
pub(crate) fn update_repository_sdd_mode(
    app: tauri::AppHandle,
    id: i64,
    sdd_mode: Option<String>,
) -> Result<StoredRepository, String> {
    const ALLOWED: &[&str] = &["auto", "wise_trellis", "project_owned", "off"];
    let normalized = match sdd_mode {
        None => None,
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else if !ALLOWED.contains(&trimmed) {
                return Err("WF_INVALID_INPUT: sddMode value not allowed".into());
            } else {
                Some(trimmed.to_string())
            }
        }
    };
    let mut repositories = load_repositories(&app);
    let idx = repositories
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "仓库未找到".to_string())?;
    repositories[idx].sdd_mode = normalized;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    repositories[idx].updated_at = now.to_string();
    save_repositories(&app, &repositories)?;
    let mut out = repositories[idx].clone();
    out.branch = git_commands::get_git_branch(&out.path);
    Ok(out)
}

#[tauri::command]
pub(crate) fn remove_repository(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let mut repositories = load_repositories(&app);
    let len_before = repositories.len();
    repositories.retain(|p| p.id != id);
    if repositories.len() == len_before {
        return Err("仓库未找到".into());
    }
    save_repositories(&app, &repositories)
}

fn map_projects(rows: Vec<wise_db::WiseProjectRow>) -> Vec<StoredProject> {
    rows.into_iter()
        .map(|row| StoredProject {
            id: row.id,
            name: row.name,
            repository_ids: row.repository_ids,
            created_at: row.created_at,
            updated_at: row.updated_at,
            icon_display_name: row.icon_display_name.clone(),
            icon_color: row.icon_color.clone(),
        })
        .collect()
}

#[tauri::command]
pub(crate) fn list_projects(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<StoredProject>, String> {
    let rows = db.list_projects()?;
    Ok(map_projects(rows))
}

#[tauri::command]
pub(crate) fn create_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    name: String,
    icon_display_name: Option<String>,
    icon_color: Option<String>,
) -> Result<StoredProject, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    let id = format!("project_{}", Uuid::new_v4().simple());
    let icon_name_sql = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let icon_color_sql = normalize_hex_icon_color(icon_color);
    db.create_project(
        &id,
        trimmed,
        icon_name_sql,
        icon_color_sql.as_deref(),
        now_ms,
    )?;
    let rows = db.list_projects()?;
    let row = rows
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "项目创建失败".to_string())?;
    Ok(StoredProject {
        id: row.id,
        name: row.name,
        repository_ids: row.repository_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
        icon_display_name: row.icon_display_name.clone(),
        icon_color: row.icon_color.clone(),
    })
}

#[tauri::command]
pub(crate) fn update_project_name(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    name: String,
) -> Result<StoredProject, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.update_project_name(&project_id, trimmed, now_ms)?;
    let rows = db.list_projects()?;
    let row = rows
        .into_iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "项目未找到".to_string())?;
    Ok(StoredProject {
        id: row.id,
        name: row.name,
        repository_ids: row.repository_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
        icon_display_name: row.icon_display_name.clone(),
        icon_color: row.icon_color.clone(),
    })
}

#[tauri::command]
pub(crate) fn update_project_icon_badge(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    icon_display_name: Option<String>,
    icon_color: Option<String>,
) -> Result<StoredProject, String> {
    let icon_name_sql = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let icon_color_sql = normalize_hex_icon_color(icon_color);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.update_project_icon_badge(
        &project_id,
        icon_name_sql,
        icon_color_sql.as_deref(),
        now_ms,
    )?;
    let rows = db.list_projects()?;
    let row = rows
        .into_iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "项目未找到".to_string())?;
    Ok(StoredProject {
        id: row.id,
        name: row.name,
        repository_ids: row.repository_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
        icon_display_name: row.icon_display_name.clone(),
        icon_color: row.icon_color.clone(),
    })
}

#[tauri::command]
pub(crate) fn delete_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<(), String> {
    db.delete_project(&project_id)?;
    let active = db.get_setting("active_project_id")?;
    if active.as_deref() == Some(project_id.as_str()) {
        db.delete_setting("active_project_id")?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn add_repository_to_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    repository_id: i64,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.add_repository_to_project(&project_id, repository_id, now_ms)
}

#[tauri::command]
pub(crate) fn reorder_project_repositories(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    repository_ids: Vec<i64>,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.reorder_project_repositories(&project_id, &repository_ids, now_ms)
}

#[tauri::command]
pub(crate) fn remove_repository_from_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    repository_id: i64,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.remove_repository_from_project(&project_id, repository_id, now_ms)
}

#[tauri::command]
pub(crate) fn remove_repository_global(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    id: i64,
) -> Result<(), String> {
    remove_repository(app, id)?;
    db.remove_repository_from_all_projects(id)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_active_project_id(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<String>, String> {
    db.get_setting("active_project_id")
}

#[tauri::command]
pub(crate) fn set_active_project_id(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = project_id {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            db.delete_setting("active_project_id")
        } else {
            db.set_setting("active_project_id", trimmed)
        }
    } else {
        db.delete_setting("active_project_id")
    }
}

#[tauri::command]
pub(crate) fn list_project_prd_employee_ids(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let pid = project_id.trim();
    if pid.is_empty() {
        return Err("项目 id 无效".into());
    }
    db.list_project_prd_employee_ids(pid)
}

#[tauri::command]
pub(crate) fn list_project_prd_workflow_ids(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<Vec<String>, String> {
    let pid = project_id.trim();
    if pid.is_empty() {
        return Err("项目 id 无效".into());
    }
    db.list_project_prd_workflow_ids(pid)
}

#[tauri::command]
pub(crate) fn list_workflow_project_ids(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
) -> Result<Vec<String>, String> {
    db.list_workflow_project_ids(&workflow_id)
}

#[tauri::command]
pub(crate) fn add_project_prd_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    employee_id: String,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.add_project_prd_employee(project_id.trim(), employee_id.trim(), now_ms)
}

#[tauri::command]
pub(crate) fn remove_project_prd_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    employee_id: String,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.remove_project_prd_employee(project_id.trim(), employee_id.trim(), now_ms)
}

#[tauri::command]
pub(crate) fn add_project_prd_workflow(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    workflow_id: String,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.add_project_prd_workflow(project_id.trim(), workflow_id.trim(), now_ms)
}

#[tauri::command]
pub(crate) fn remove_project_prd_workflow(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    workflow_id: String,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.remove_project_prd_workflow(project_id.trim(), workflow_id.trim(), now_ms)
}

#[tauri::command]
pub(crate) fn list_employees(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<EmployeeItem>, String> {
    let rows = db.list_employees()?;
    Ok(rows
        .into_iter()
        .map(|row| EmployeeItem {
            id: row.id,
            name: row.name,
            agent_type: row.agent_type,
            enabled: row.enabled,
            created_at: row.created_at,
            updated_at: row.updated_at,
            display_order: row.display_order,
            repository_ids: row.repository_ids,
            project_ids: row.project_ids,
        })
        .collect())
}

#[tauri::command]
pub(crate) fn create_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    name: String,
    agent_type: String,
    enabled: Option<bool>,
    repository_ids: Option<Vec<i64>>,
    project_ids: Option<Vec<String>>,
) -> Result<EmployeeItem, String> {
    let now_ms = unix_now_ms();
    let normalized_name = name.trim();
    let normalized_agent_type = agent_type.trim();
    if normalized_name.is_empty() {
        return Err("员工名称不能为空".to_string());
    }
    if normalized_agent_type.is_empty() {
        return Err("智能体不能为空".to_string());
    }
    let id = format!("employee_{}", Uuid::new_v4().simple());
    let repository_ids = repository_ids.unwrap_or_default();
    let project_ids = project_ids.unwrap_or_default();
    db.create_employee(
        &id,
        normalized_name,
        normalized_agent_type,
        enabled.unwrap_or(true),
        now_ms,
        &repository_ids,
    )?;
    for pid in &project_ids {
        let _ = db.add_project_prd_employee(pid, &id, now_ms);
    }
    let created = db
        .list_employees()?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "员工创建后读取失败".to_string())?;
    Ok(EmployeeItem {
        id: created.id,
        name: created.name,
        agent_type: created.agent_type,
        enabled: created.enabled,
        created_at: created.created_at,
        updated_at: created.updated_at,
        display_order: created.display_order,
        repository_ids: created.repository_ids,
        project_ids: created.project_ids,
    })
}

#[tauri::command]
pub(crate) fn update_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    employee_id: String,
    name: String,
    agent_type: String,
    enabled: bool,
    repository_ids: Option<Vec<i64>>,
    project_ids: Option<Vec<String>>,
) -> Result<EmployeeItem, String> {
    let now_ms = unix_now_ms();
    let normalized_name = name.trim();
    let normalized_agent_type = agent_type.trim();
    if normalized_name.is_empty() {
        return Err("员工名称不能为空".to_string());
    }
    if normalized_agent_type.is_empty() {
        return Err("智能体不能为空".to_string());
    }
    let repository_ids = repository_ids.unwrap_or_default();
    let new_project_ids = project_ids.unwrap_or_default();
    db.update_employee(
        &employee_id,
        normalized_name,
        normalized_agent_type,
        enabled,
        now_ms,
        &repository_ids,
    )?;

    let updated = db
        .list_employees()?
        .into_iter()
        .find(|item| item.id == employee_id)
        .ok_or_else(|| "员工更新后读取失败".to_string())?;

    let old_ids: std::collections::HashSet<String> = updated.project_ids.iter().cloned().collect();
    let new_ids: std::collections::HashSet<String> = new_project_ids.iter().cloned().collect();
    for pid in old_ids.difference(&new_ids) {
        let _ = db.remove_project_prd_employee(pid, &employee_id, now_ms);
    }
    for pid in new_ids.difference(&old_ids) {
        let _ = db.add_project_prd_employee(pid, &employee_id, now_ms);
    }

    let updated = db
        .list_employees()?
        .into_iter()
        .find(|item| item.id == employee_id)
        .ok_or_else(|| "员工更新后读取失败".to_string())?;
    Ok(EmployeeItem {
        id: updated.id,
        name: updated.name,
        agent_type: updated.agent_type,
        enabled: updated.enabled,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
        display_order: updated.display_order,
        repository_ids: updated.repository_ids,
        project_ids: updated.project_ids,
    })
}

#[tauri::command]
pub(crate) fn move_employee_display_order(
    db: tauri::State<'_, wise_db::WiseDb>,
    employee_id: String,
    direction: String,
) -> Result<(), String> {
    db.move_employee_display_order(&employee_id, direction.trim())
}

#[tauri::command]
pub(crate) fn delete_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    employee_id: String,
) -> Result<(), String> {
    db.delete_employee(&employee_id)
}

#[tauri::command]
pub(crate) fn list_employee_task_counts(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<EmployeeTaskCountItem>, String> {
    let rows = db.list_employee_task_counts()?;
    Ok(rows
        .into_iter()
        .map(|row| EmployeeTaskCountItem {
            employee_id: row.employee_id,
            task_count: row.task_count,
        })
        .collect())
}

#[tauri::command]
pub(crate) fn list_workflow_templates(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<WorkflowTemplateItem>, String> {
    let templates = db.list_workflow_templates()?;
    let mut out = Vec::new();
    for tpl in templates {
        let stages = db.list_workflow_stages(&tpl.id)?;
        let stage_ids: Vec<String> = stages.iter().map(|s| s.id.clone()).collect();
        let assignees = db.list_stage_assignees(&stage_ids)?;
        let stage_items: Vec<WorkflowTemplateStage> = stages
            .into_iter()
            .map(|stage| {
                let stage_assignees = assignees
                    .iter()
                    .filter(|a| a.stage_id == stage.id)
                    .map(|a| WorkflowTemplateAssignee {
                        id: a.id.clone(),
                        employee_id: a.employee_id.clone(),
                        required_count: a.required_count,
                        is_required: a.is_required,
                    })
                    .collect();
                WorkflowTemplateStage {
                    id: stage.id,
                    name: stage.name,
                    stage_order: stage.stage_order,
                    pass_rule: stage.pass_rule,
                    reject_rule: stage.reject_rule,
                    assignees: stage_assignees,
                }
            })
            .collect();
        out.push(WorkflowTemplateItem {
            id: tpl.id,
            name: tpl.name,
            is_default: tpl.is_default,
            created_at: tpl.created_at,
            updated_at: tpl.updated_at,
            stages: stage_items,
        });
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn save_workflow_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: Option<String>,
    name: String,
    is_default: bool,
    stages: Vec<WorkflowTemplateStage>,
    project_ids: Option<Vec<String>>,
) -> Result<WorkflowTemplateItem, String> {
    let now_ms = unix_now_ms();
    let normalized_name = name.trim();
    if normalized_name.is_empty() {
        return Err("工作流名称不能为空".to_string());
    }
    if stages.is_empty() {
        return Err("至少需要一个阶段".to_string());
    }
    let workflow_id_value = workflow_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| format!("workflow_{}", Uuid::new_v4().simple()));
    let mut db_stages = Vec::new();
    let mut db_assignees = Vec::new();
    for (idx, stage) in stages.iter().enumerate() {
        let stage_name = stage.name.trim();
        if stage_name.is_empty() {
            return Err("阶段名称不能为空".to_string());
        }
        let stage_id = if stage.id.trim().is_empty() {
            format!("stage_{}", Uuid::new_v4().simple())
        } else {
            stage.id.trim().to_string()
        };
        db_stages.push(wise_db::WiseWorkflowStageRow {
            id: stage_id.clone(),
            workflow_id: workflow_id_value.clone(),
            name: stage_name.to_string(),
            stage_order: idx as i64,
            pass_rule: stage.pass_rule.trim().to_string(),
            reject_rule: stage.reject_rule.trim().to_string(),
        });
        for assignee in &stage.assignees {
            if assignee.employee_id.trim().is_empty() {
                continue;
            }
            let assignee_id = if assignee.id.trim().is_empty() {
                format!("stage_assignee_{}", Uuid::new_v4().simple())
            } else {
                assignee.id.trim().to_string()
            };
            db_assignees.push(wise_db::WiseStageAssigneeRow {
                id: assignee_id,
                stage_id: stage_id.clone(),
                employee_id: assignee.employee_id.trim().to_string(),
                required_count: assignee.required_count.max(1),
                is_required: assignee.is_required,
            });
        }
    }
    db.upsert_workflow_template(
        &workflow_id_value,
        normalized_name,
        is_default,
        now_ms,
        &db_stages,
        &db_assignees,
    )?;

    // Sync project associations
    if let Some(new_project_ids) = project_ids {
        let old_ids = db
            .list_workflow_project_ids(&workflow_id_value)
            .unwrap_or_default();
        let old_set: std::collections::HashSet<String> = old_ids.iter().cloned().collect();
        let new_set: std::collections::HashSet<String> = new_project_ids.iter().cloned().collect();
        for pid in old_set.difference(&new_set) {
            let _ = db.remove_project_prd_workflow(pid, &workflow_id_value, now_ms);
        }
        for pid in new_set.difference(&old_set) {
            let _ = db.add_project_prd_workflow(pid, &workflow_id_value, now_ms);
        }
    }

    let templates = list_workflow_templates(db)?;
    templates
        .into_iter()
        .find(|item| item.id == workflow_id_value)
        .ok_or_else(|| "保存后读取工作流失败".to_string())
}

#[tauri::command]
pub(crate) fn delete_workflow_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
) -> Result<(), String> {
    db.delete_workflow_template(workflow_id.trim())
}

#[tauri::command]
pub(crate) fn create_workflow_task(
    db: tauri::State<'_, wise_db::WiseDb>,
    title: String,
    content: String,
    creator: String,
    workflow_id: Option<String>,
) -> Result<WorkflowTaskItem, String> {
    let now_ms = unix_now_ms();
    let title_value = title.trim();
    let creator_value = creator.trim();
    if title_value.is_empty() {
        return Err("任务标题不能为空".to_string());
    }
    if creator_value.is_empty() {
        return Err("任务创建者不能为空".to_string());
    }
    let workflow_id_value = if let Some(id) = workflow_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        id
    } else {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let default_id: Option<String> = g
            .query_row(
                "SELECT id FROM workflows WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();
        drop(g);
        default_id.ok_or_else(|| "未找到默认工作流，请先配置工作流".to_string())?
    };
    let task_id = format!("task_{}", Uuid::new_v4().simple());
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let tx = g.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO tasks (id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 'in_progress', ?6, ?7)",
        params![task_id, title_value, content, creator_value, workflow_id_value, now_ms, now_ms],
    )
    .map_err(|e| e.to_string())?;
    let stage_id: String = tx
        .query_row(
            "SELECT id FROM workflow_stages WHERE workflow_id = ?1 ORDER BY stage_order ASC LIMIT 1",
            params![workflow_id_value],
            |row| row.get(0),
        )
        .map_err(|_| "工作流未配置阶段，无法创建任务".to_string())?;
    {
        let mut stmt = tx
            .prepare("SELECT employee_id, required_count FROM stage_assignees WHERE stage_id = ?1")
            .map_err(|e| e.to_string())?;
        let assignees = stmt
            .query_map(params![stage_id.clone()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for item in assignees {
            let (employee_id, required_count) = item.map_err(|e| e.to_string())?;
            let count = required_count.max(1);
            for _ in 0..count {
                tx.execute(
                    "INSERT INTO task_stage_decisions (id, task_id, stage_id, employee_id, decision)
                     VALUES (?1, ?2, ?3, ?4, 'pending')",
                    params![format!("decision_{}", Uuid::new_v4().simple()), task_id, stage_id, employee_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    let payload = serde_json::json!({
        "action": "task_created",
        "currentStageIndex": 0,
        "workflowId": workflow_id_value,
    });
    tx.execute(
        "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, 'task_created', ?3, ?4)",
        params![
            format!("event_{}", Uuid::new_v4().simple()),
            task_id,
            payload.to_string(),
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(WorkflowTaskItem {
        id: task_id,
        title: title_value.to_string(),
        content,
        creator: creator_value.to_string(),
        workflow_id: workflow_id_value,
        current_stage_index: 0,
        status: "in_progress".to_string(),
        created_at: now_ms,
        updated_at: now_ms,
    })
}

#[tauri::command]
pub(crate) fn list_workflow_tasks(
    db: tauri::State<'_, wise_db::WiseDb>,
    creator: Option<String>,
) -> Result<Vec<WorkflowTaskItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut out = Vec::new();
    if let Some(creator_id) = creator
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        let mut stmt = g
            .prepare(
                "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
                 FROM tasks
                 WHERE creator = ?1
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![creator_id], |row| {
                Ok(WorkflowTaskItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    creator: row.get(3)?,
                    workflow_id: row.get(4)?,
                    current_stage_index: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }
    let mut stmt = g
        .prepare(
            "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
             FROM tasks
             ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WorkflowTaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                creator: row.get(3)?,
                workflow_id: row.get(4)?,
                current_stage_index: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn list_task_events(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
) -> Result<Vec<WorkflowTaskEventItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = g
        .prepare(
            "SELECT id, task_id, event_type, payload_json, created_at
             FROM task_events
             WHERE task_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id.trim()], |row| {
            Ok(WorkflowTaskEventItem {
                id: row.get(0)?,
                task_id: row.get(1)?,
                event_type: row.get(2)?,
                payload_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn get_acceptance_verdict_source_stats(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: Option<String>,
) -> Result<Vec<AcceptanceVerdictSourceStatsItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;

    let sql_with_task =
        "SELECT COALESCE(json_extract(payload_json, '$.verdictSource'), 'unknown') AS verdict_source,
                COUNT(*) AS cnt
         FROM task_events
         WHERE task_id = ?1
           AND event_type IN ('workflow_acceptance_verdict_submitted', 'workflow_acceptance_verdict_unresolved')
         GROUP BY verdict_source
         ORDER BY cnt DESC, verdict_source ASC";
    let sql_all =
        "SELECT COALESCE(json_extract(payload_json, '$.verdictSource'), 'unknown') AS verdict_source,
                COUNT(*) AS cnt
         FROM task_events
         WHERE event_type IN ('workflow_acceptance_verdict_submitted', 'workflow_acceptance_verdict_unresolved')
         GROUP BY verdict_source
         ORDER BY cnt DESC, verdict_source ASC";

    let mut out = Vec::new();
    if let Some(task) = task_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        let mut stmt = g.prepare(sql_with_task).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![task], |row| {
                Ok(AcceptanceVerdictSourceStatsItem {
                    verdict_source: row.get(0)?,
                    count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }

    let mut stmt = g.prepare(sql_all).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AcceptanceVerdictSourceStatsItem {
                verdict_source: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn append_task_event(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
    event_type: String,
    payload_json: String,
) -> Result<WorkflowTaskEventItem, String> {
    let now_ms = unix_now_ms();
    let task_id_value = task_id.trim();
    let event_type_value = event_type.trim();
    let payload_value = payload_json.trim();
    if task_id_value.is_empty() {
        return Err("taskId 不能为空".to_string());
    }
    if event_type_value.is_empty() {
        return Err("eventType 不能为空".to_string());
    }
    if payload_value.is_empty() {
        return Err("payloadJson 不能为空".to_string());
    }
    let event_id = format!("event_{}", Uuid::new_v4().simple());
    let parsed_payload: serde_json::Value = serde_json::from_str(payload_value)
        .map_err(|_| "payloadJson 必须是合法 JSON".to_string())?;
    let payload_corr_id = parsed_payload
        .get("correlationId")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let payload_graph_node_id = parsed_payload
        .get("graphNodeId")
        .or_else(|| parsed_payload.get("nodeId"))
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let insert_result = g.execute(
        "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            event_id,
            task_id_value,
            event_type_value,
            payload_value,
            now_ms
        ],
    );

    match insert_result {
        Ok(_) => Ok(WorkflowTaskEventItem {
            id: event_id,
            task_id: task_id_value.to_string(),
            event_type: event_type_value.to_string(),
            payload_json: payload_value.to_string(),
            created_at: now_ms,
        }),
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::ConstraintViolation
                && payload_corr_id.is_some()
                && payload_graph_node_id.is_some()
                && (event_type_value == "workflow_acceptance_verdict_submitted"
                    || event_type_value == "workflow_acceptance_verdict_unresolved") =>
        {
            let existing = g
                .query_row(
                    "SELECT id, task_id, event_type, payload_json, created_at
                     FROM task_events
                     WHERE task_id = ?1
                       AND event_type = ?2
                       AND json_extract(payload_json, '$.graphNodeId') = ?3
                       AND json_extract(payload_json, '$.correlationId') = ?4
                     ORDER BY created_at ASC
                     LIMIT 1",
                    params![
                        task_id_value,
                        event_type_value,
                        payload_graph_node_id.unwrap(),
                        payload_corr_id.unwrap()
                    ],
                    |row| {
                        Ok(WorkflowTaskEventItem {
                            id: row.get(0)?,
                            task_id: row.get(1)?,
                            event_type: row.get(2)?,
                            payload_json: row.get(3)?,
                            created_at: row.get(4)?,
                        })
                    },
                )
                .map_err(|e| e.to_string())?;
            Ok(existing)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub(crate) fn list_task_pending_employees(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
) -> Result<Vec<TaskPendingEmployeeItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let (workflow_id, current_stage_index): (String, i64) = g
        .query_row(
            "SELECT workflow_id, current_stage_index FROM tasks WHERE id = ?1",
            params![task_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "任务不存在".to_string())?;
    let stage_id: String = g
        .query_row(
            "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
            params![workflow_id, current_stage_index],
            |row| row.get(0),
        )
        .map_err(|_| "任务当前阶段不存在".to_string())?;
    let mut stmt = g
        .prepare(
            "SELECT DISTINCT e.id, e.name
             FROM task_stage_decisions d
             JOIN employees e ON e.id = d.employee_id
             WHERE d.task_id = ?1
               AND d.stage_id = ?2
               AND d.decision = 'pending'
             ORDER BY e.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id.trim(), stage_id], |row| {
            Ok(TaskPendingEmployeeItem {
                employee_id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn decide_workflow_task_stage(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
    employee_id: String,
    decision: String,
    reason: Option<String>,
) -> Result<WorkflowTaskItem, String> {
    let now_ms = unix_now_ms();
    let normalized_decision = decision.trim().to_lowercase();
    if normalized_decision != "approved" && normalized_decision != "rejected" {
        return Err("decision 仅支持 approved/rejected".to_string());
    }
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let tx = g.transaction().map_err(|e| e.to_string())?;
    let (workflow_id, current_stage_index, _status): (String, i64, String) = tx
        .query_row(
            "SELECT workflow_id, current_stage_index, status FROM tasks WHERE id = ?1",
            params![task_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "任务不存在".to_string())?;
    let stage_id: String = tx
        .query_row(
            "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
            params![workflow_id, current_stage_index],
            |row| row.get(0),
        )
        .map_err(|_| "当前阶段不存在".to_string())?;
    let rows_updated = tx
        .execute(
            "UPDATE task_stage_decisions
             SET decision = ?1, reason = ?2, decided_at = ?3
             WHERE id = (
               SELECT id FROM task_stage_decisions
               WHERE task_id = ?4 AND stage_id = ?5 AND employee_id = ?6 AND decision = 'pending'
               ORDER BY rowid ASC
               LIMIT 1
             )",
            params![
                normalized_decision,
                reason.clone().unwrap_or_default(),
                now_ms,
                task_id.trim(),
                stage_id,
                employee_id.trim()
            ],
        )
        .map_err(|e| e.to_string())?;
    if rows_updated == 0 {
        return Err(
            "未写入阶段决议：该员工在当前阶段没有待决记录，请检查工作流参与人与节点绑定员工是否一致。"
                .to_string(),
        );
    }
    if normalized_decision == "rejected" {
        let next_stage_index = if current_stage_index > 0 {
            current_stage_index - 1
        } else {
            0
        };
        // 驳回时执行“回退上一阶段”；若已在首阶段则不再回退，保持首阶段进行中。
        let next_status = "in_progress";
        let rollback_stage_id: String = tx
            .query_row(
                "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
                params![workflow_id, next_stage_index],
                |row| row.get(0),
            )
            .map_err(|_| "回退目标阶段不存在".to_string())?;

        // 回退后重置目标阶段决策为 pending，确保员工可继续执行该阶段。
        tx.execute(
            "DELETE FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2",
            params![task_id.trim(), rollback_stage_id.clone()],
        )
        .map_err(|e| e.to_string())?;
        let mut rollback_stmt = tx
            .prepare("SELECT employee_id, required_count FROM stage_assignees WHERE stage_id = ?1")
            .map_err(|e| e.to_string())?;
        let rollback_assignees = rollback_stmt
            .query_map(params![rollback_stage_id.clone()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for item in rollback_assignees {
            let (rollback_employee_id, required_count) = item.map_err(|e| e.to_string())?;
            let count = required_count.max(1);
            for _ in 0..count {
                tx.execute(
                    "INSERT INTO task_stage_decisions (id, task_id, stage_id, employee_id, decision)
                     VALUES (?1, ?2, ?3, ?4, 'pending')",
                    params![
                        format!("decision_{}", Uuid::new_v4().simple()),
                        task_id.trim(),
                        rollback_stage_id,
                        rollback_employee_id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        tx.execute(
            "UPDATE tasks SET current_stage_index = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
            params![next_stage_index, next_status, now_ms, task_id.trim()],
        )
        .map_err(|e| e.to_string())?;
        let payload = serde_json::json!({
            "action": "task_rejected",
            "employeeId": employee_id.trim(),
            "reason": reason.unwrap_or_default(),
            "fromStageIndex": current_stage_index,
            "toStageIndex": next_stage_index,
            "rollbackApplied": current_stage_index > 0,
        });
        tx.execute(
            "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
             VALUES (?1, ?2, 'task_rejected', ?3, ?4)",
            params![
                format!("event_{}", Uuid::new_v4().simple()),
                task_id.trim(),
                payload.to_string(),
                now_ms
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let pass_rule: String = tx
            .query_row(
                "SELECT pass_rule FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
                params![workflow_id, current_stage_index],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let should_advance = if pass_rule == "ANY_APPROVE" {
            let approved_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2 AND decision = 'approved'",
                    params![task_id.trim(), stage_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            approved_count > 0
        } else {
            let total_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2",
                    params![task_id.trim(), stage_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let approved_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2 AND decision = 'approved'",
                    params![task_id.trim(), stage_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            total_count > 0 && total_count == approved_count
        };
        if should_advance {
            let next_stage_exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
                    params![workflow_id, current_stage_index + 1],
                    |row| row.get(0),
                )
                .ok();
            if let Some(next_stage_id) = next_stage_exists {
                tx.execute(
                    "UPDATE tasks SET current_stage_index = ?1, status = 'in_progress', updated_at = ?2 WHERE id = ?3",
                    params![current_stage_index + 1, now_ms, task_id.trim()],
                )
                .map_err(|e| e.to_string())?;
                let mut stmt = tx
                    .prepare("SELECT employee_id, required_count FROM stage_assignees WHERE stage_id = ?1")
                    .map_err(|e| e.to_string())?;
                let next_assignees = stmt
                    .query_map(params![next_stage_id.clone()], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .map_err(|e| e.to_string())?;
                for item in next_assignees {
                    let (next_employee_id, required_count) = item.map_err(|e| e.to_string())?;
                    let count = required_count.max(1);
                    for _ in 0..count {
                        tx.execute(
                            "INSERT INTO task_stage_decisions (id, task_id, stage_id, employee_id, decision)
                             VALUES (?1, ?2, ?3, ?4, 'pending')",
                            params![
                                format!("decision_{}", Uuid::new_v4().simple()),
                                task_id.trim(),
                                next_stage_id,
                                next_employee_id
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            } else {
                tx.execute(
                    "UPDATE tasks SET status = 'completed', updated_at = ?1 WHERE id = ?2",
                    params![now_ms, task_id.trim()],
                )
                .map_err(|e| e.to_string())?;
            }
            let payload = serde_json::json!({
                "action": "task_approved",
                "employeeId": employee_id.trim(),
                "fromStageIndex": current_stage_index,
                "advanced": true
            });
            tx.execute(
                "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
                 VALUES (?1, ?2, 'task_approved', ?3, ?4)",
                params![
                    format!("event_{}", Uuid::new_v4().simple()),
                    task_id.trim(),
                    payload.to_string(),
                    now_ms
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    g.query_row(
        "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
         FROM tasks WHERE id = ?1",
        params![task_id.trim()],
        |row| {
            Ok(WorkflowTaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                creator: row.get(3)?,
                workflow_id: row.get(4)?,
                current_stage_index: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn end_workflow_task(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
    reason: Option<String>,
) -> Result<WorkflowTaskItem, String> {
    let now_ms = unix_now_ms();
    let task_id_value = task_id.trim();
    if task_id_value.is_empty() {
        return Err("taskId 不能为空".to_string());
    }
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let tx = g.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks
         SET status = 'archived', updated_at = ?1
         WHERE id = ?2",
        params![now_ms, task_id_value],
    )
    .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "action": "task_archived",
        "reason": reason.clone().unwrap_or_else(|| "手动结束".to_string()),
        "createdAt": now_ms,
    });
    tx.execute(
        "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, 'task_archived', ?3, ?4)",
        params![
            format!("event_{}", Uuid::new_v4().simple()),
            task_id_value,
            payload.to_string(),
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    g.query_row(
        "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
         FROM tasks WHERE id = ?1",
        params![task_id_value],
        |row| {
            Ok(WorkflowTaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                creator: row.get(3)?,
                workflow_id: row.get(4)?,
                current_stage_index: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
