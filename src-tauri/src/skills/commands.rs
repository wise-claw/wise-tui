//! Tauri command surface for the skills three-tier source system.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::external_paths::{self, ExternalPathRow};
use super::import::{self, ImportedSkill};
use super::source::{
    self, count_skill_subdirs, default_external_paths, home_dir_for_skills, is_symlink,
    wise_skills_home, SkillSource,
};
use crate::wise_db::WiseDb;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedExternalPath {
    pub id: Option<String>,
    pub path: String,
    pub exists: bool,
    pub count: usize,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedSkill {
    pub name: String,
    pub location: String,
    pub is_symlink: bool,
    pub has_skill_md: bool,
    pub source: SkillSource,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathArg {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdArg {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePathArg {
    pub source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteArg {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArg {
    pub source_path: String,
    pub dest_path: String,
}

#[tauri::command]
pub fn skills_detect_external_paths(
    db: State<'_, WiseDb>,
) -> Result<Vec<DetectedExternalPath>, String> {
    let mut out: Vec<DetectedExternalPath> = Vec::new();
    for path in default_external_paths() {
        let exists = path.exists();
        let count = if exists { count_skill_subdirs(&path) } else { 0 };
        out.push(DetectedExternalPath {
            id: None,
            path: path.to_string_lossy().to_string(),
            exists,
            count,
            is_default: true,
        });
    }
    let conn = db
        .0
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    for row in external_paths::list(&conn)? {
        let p = PathBuf::from(&row.path);
        let exists = p.exists();
        let count = if exists { count_skill_subdirs(&p) } else { 0 };
        out.push(DetectedExternalPath {
            id: Some(row.id),
            path: row.path,
            exists,
            count,
            is_default: false,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn skills_scan_path(arg: PathArg) -> Result<Vec<ScannedSkill>, String> {
    let p = PathBuf::from(arg.path);
    if !p.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&p).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if !ft.is_dir() && !ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let has_skill_md =
            path.join("SKILL.md").exists() || path.join("skill.md").exists();
        let (skill_source, _classified) = source::classify(&path);
        out.push(ScannedSkill {
            name,
            location: path.to_string_lossy().to_string(),
            is_symlink: is_symlink(&path),
            has_skill_md,
            source: skill_source,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn skills_add_external_path(
    db: State<'_, WiseDb>,
    arg: PathArg,
) -> Result<DetectedExternalPath, String> {
    let conn = db
        .0
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    let row = external_paths::insert(&conn, &arg.path)?;
    let p = PathBuf::from(&row.path);
    let exists = p.exists();
    let count = if exists { count_skill_subdirs(&p) } else { 0 };
    Ok(DetectedExternalPath {
        id: Some(row.id),
        path: row.path,
        exists,
        count,
        is_default: false,
    })
}

#[tauri::command]
pub fn skills_remove_external_path(db: State<'_, WiseDb>, arg: IdArg) -> Result<(), String> {
    let conn = db
        .0
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    external_paths::delete(&conn, &arg.id)
}

#[tauri::command]
pub fn skills_list_external_paths(db: State<'_, WiseDb>) -> Result<Vec<ExternalPathRow>, String> {
    let conn = db
        .0
        .lock()
        .map_err(|e| format!("db lock poisoned: {e}"))?;
    external_paths::list(&conn)
}

#[tauri::command]
pub fn skills_import_copy(arg: SourcePathArg) -> Result<ImportedSkill, String> {
    import::import_copy(Path::new(&arg.source_path))
}

#[tauri::command]
pub fn skills_import_symlink(arg: SourcePathArg) -> Result<ImportedSkill, String> {
    import::import_symlink(Path::new(&arg.source_path))
}

#[tauri::command]
pub fn skills_delete_imported(arg: DeleteArg) -> Result<(), String> {
    import::delete_imported(&arg.name)
}

#[tauri::command]
pub fn skills_export_symlink(arg: ExportArg) -> Result<(), String> {
    import::export_symlink(Path::new(&arg.source_path), Path::new(&arg.dest_path))
}

#[tauri::command]
pub fn skills_wise_home() -> Result<Option<String>, String> {
    Ok(wise_skills_home().map(|p| p.to_string_lossy().to_string()))
}

/// Probe whether the runtime thinks `~/.wise/skills/` resolves correctly.
/// Useful for UI diagnostics; not used in normal flows.
#[tauri::command]
pub fn skills_resolve_home_diagnostic() -> Result<Option<String>, String> {
    Ok(home_dir_for_skills().map(|p| p.to_string_lossy().to_string()))
}
