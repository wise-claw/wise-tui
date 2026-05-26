//! IPC for「我的扩展」— extension library, capture, and install.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::extensions::example_install;
use crate::extensions::registry::ExtensionRegistry;

use super::capture::{
    capture_all_visible, capture_candidate, capture_from_repository_path, CaptureAllArgs,
    CaptureArgs, CapturePathArgs,
};
use super::discover::{discover_in_repository, DiscoverCandidate};
use super::install::{install_library_item, InstallLibraryArgs, InstallLibraryResult};
use super::library::{
    create_snapshot_directory, create_snapshot_file, default_relative_file, delete_snapshot_entry,
    get_item, language_from_path, library_home, list_items, list_snapshot_tree,
    read_snapshot_file_text, remove_item, resolve_snapshot_file, update_item_name, LibraryItem,
    SnapshotTreeNode,
};
use super::paths::InstallScope;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedArgs {
    pub install_scope: String,
    #[serde(default)]
    pub repository_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPathArgs {
    pub repository_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRepositoryScanArgs {
    #[serde(default)]
    pub repository_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLibraryNameArgs {
    pub library_item_id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryContentArgs {
    pub library_item_id: String,
    #[serde(default)]
    pub relative_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLibraryContentArgs {
    pub library_item_id: String,
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItemIdArgs {
    pub library_item_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotPathArgs {
    pub library_item_id: String,
    pub relative_path: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryContentPayload {
    pub library_item_id: String,
    pub relative_path: String,
    pub path: String,
    pub language: String,
    pub content: String,
}

fn parse_scope_and_repo(args: &ScopedArgs) -> Result<(InstallScope, Option<PathBuf>), String> {
    let scope = InstallScope::parse(&args.install_scope)?;
    let repo = args
        .repository_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    if scope == InstallScope::Repository && repo.is_none() {
        return Err("仓库级安装需要传入 repositoryPath".to_string());
    }
    Ok((scope, repo))
}

#[tauri::command]
pub fn my_extensions_library_list() -> Result<Vec<LibraryItem>, String> {
    list_items()
}

#[tauri::command]
pub fn my_extensions_library_remove(args: LibraryItemIdArgs) -> Result<(), String> {
    remove_item(&args.library_item_id)
}

#[tauri::command]
pub fn my_extensions_library_home() -> Result<String, String> {
    Ok(library_home()?.display().to_string())
}

#[tauri::command]
pub fn my_extensions_library_update_name(args: UpdateLibraryNameArgs) -> Result<LibraryItem, String> {
    update_item_name(&args.library_item_id, args.name)
}

#[tauri::command]
pub fn my_extensions_library_list_snapshot_tree(
    args: LibraryItemIdArgs,
) -> Result<Vec<SnapshotTreeNode>, String> {
    let item = get_item(&args.library_item_id)?;
    list_snapshot_tree(&item)
}

#[tauri::command]
pub fn my_extensions_library_get_content(args: LibraryContentArgs) -> Result<LibraryContentPayload, String> {
    let item = get_item(&args.library_item_id)?;
    let relative = match args
        .relative_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        Some(r) => r.to_string(),
        None => default_relative_file(&item)?,
    };
    let path = match resolve_snapshot_file(&item, &relative) {
        Ok(path) => path,
        Err(err) => {
            let fallback = default_relative_file(&item)?;
            if fallback == relative {
                return Err(err);
            }
            resolve_snapshot_file(&item, &fallback)?
        }
    };
    let content = read_snapshot_file_text(&path)?;
    Ok(LibraryContentPayload {
        library_item_id: item.id,
        relative_path: relative,
        path: path.display().to_string(),
        language: language_from_path(&path).to_string(),
        content,
    })
}

#[tauri::command]
pub fn my_extensions_library_save_content(args: SaveLibraryContentArgs) -> Result<(), String> {
    let item = get_item(&args.library_item_id)?;
    let path = resolve_snapshot_file(&item, &args.relative_path)?;
    std::fs::write(&path, args.content).map_err(|e| format!("保存内容失败: {e}"))
}

#[tauri::command]
pub fn my_extensions_library_create_snapshot_file(args: SnapshotPathArgs) -> Result<(), String> {
    let item = get_item(&args.library_item_id)?;
    create_snapshot_file(&item, &args.relative_path)
}

#[tauri::command]
pub fn my_extensions_library_create_snapshot_directory(
    args: SnapshotPathArgs,
) -> Result<(), String> {
    let item = get_item(&args.library_item_id)?;
    create_snapshot_directory(&item, &args.relative_path)
}

#[tauri::command]
pub fn my_extensions_library_delete_snapshot_entry(args: SnapshotPathArgs) -> Result<(), String> {
    let item = get_item(&args.library_item_id)?;
    delete_snapshot_entry(&item, &args.relative_path)
}

#[tauri::command]
pub fn my_extensions_discover(args: RepositoryPathArgs) -> Result<Vec<DiscoverCandidate>, String> {
    discover_in_repository(&args.repository_path)
}

#[tauri::command]
pub fn my_extensions_capture(args: CaptureArgs) -> Result<LibraryItem, String> {
    capture_candidate(args)
}

#[tauri::command]
pub fn my_extensions_capture_all(args: CaptureAllArgs) -> Result<Vec<LibraryItem>, String> {
    capture_all_visible(args)
}

#[tauri::command]
pub fn my_extensions_capture_from_path(args: CapturePathArgs) -> Result<LibraryItem, String> {
    capture_from_repository_path(args)
}

#[tauri::command]
pub fn my_extensions_install_from_library(
    args: InstallLibraryArgs,
) -> Result<InstallLibraryResult, String> {
    install_library_item(args)
}

#[tauri::command]
pub fn my_extensions_install_hello_world(
    app: AppHandle,
    registry: State<'_, ExtensionRegistry>,
    args: ScopedArgs,
) -> Result<example_install::InstallHelloWorldResult, String> {
    let (scope, repo) = parse_scope_and_repo(&args)?;
    example_install::install_hello_world_scoped(&app, &registry, scope, repo.as_deref())
}

#[tauri::command]
pub fn my_extensions_sync_repository_scan(
    registry: State<'_, ExtensionRegistry>,
    args: SetRepositoryScanArgs,
) -> Result<(), String> {
    let extra = match args
        .repository_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        Some(repo) => {
            let dir = PathBuf::from(repo).join(".wise").join("extensions");
            if dir.is_dir() {
                vec![dir]
            } else {
                vec![]
            }
        }
        None => vec![],
    };
    registry.hot_reload(&extra)
}
