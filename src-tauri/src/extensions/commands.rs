//! Tauri command surface for the extension system.
//!
//! Commands are defined here but their registration in
//! `tauri::generate_handler![]` is performed in `lib_impl.rs`. Keeping the
//! definitions co-located with the registry minimizes blast radius if the
//! host wiring lands in a different commit.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use super::example_install::InstallHelloWorldResult;
use super::manifest::Permissions;
use super::registry::{
    ExtensionListEntry, ExtensionRegistry, ResolvedMcpServer, ResolvedSettingsDeclaration,
    ResolvedSettingsTab, ResolvedSkill, ResolvedTheme,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEnabledArgs {
    pub name: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsArgs {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsResponse {
    pub permissions: Permissions,
}

#[tauri::command]
pub fn extensions_list(state: State<'_, ExtensionRegistry>) -> Vec<ExtensionListEntry> {
    state.list()
}

#[tauri::command]
pub fn extensions_get_skills(state: State<'_, ExtensionRegistry>) -> Vec<ResolvedSkill> {
    state.skills()
}

#[tauri::command]
pub fn extensions_get_themes(state: State<'_, ExtensionRegistry>) -> Vec<ResolvedTheme> {
    state.themes()
}

#[tauri::command]
pub fn extensions_get_settings_declarations(
    state: State<'_, ExtensionRegistry>,
) -> Vec<ResolvedSettingsDeclaration> {
    state.settings_declarations()
}

#[tauri::command]
pub fn extensions_set_enabled(
    state: State<'_, ExtensionRegistry>,
    args: SetEnabledArgs,
) -> Result<(), String> {
    state.set_enabled(&args.name, args.enabled)
}

#[tauri::command]
pub fn extensions_get_permissions(
    state: State<'_, ExtensionRegistry>,
    args: PermissionsArgs,
) -> Option<PermissionsResponse> {
    state
        .permissions(&args.name)
        .map(|permissions| PermissionsResponse { permissions })
}

#[tauri::command]
pub fn extensions_reload(
    state: State<'_, ExtensionRegistry>,
) -> Result<Vec<ExtensionListEntry>, String> {
    let extra: Vec<PathBuf> = Vec::new();
    state.hot_reload(&extra)?;
    Ok(state.list())
}

#[tauri::command]
pub fn extensions_install_hello_world_example(
    app: tauri::AppHandle,
    state: State<'_, ExtensionRegistry>,
) -> Result<InstallHelloWorldResult, String> {
    super::example_install::install_hello_world(&app, &state)
}

#[tauri::command]
pub fn extensions_get_mcp_servers(state: State<'_, ExtensionRegistry>) -> Vec<ResolvedMcpServer> {
    state.mcp_servers()
}

#[tauri::command]
pub fn extensions_get_settings_tabs(state: State<'_, ExtensionRegistry>) -> Vec<ResolvedSettingsTab> {
    state.settings_tabs()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsTabBodyArgs {
    pub id: String,
}

#[tauri::command]
pub fn extensions_read_settings_tab_body(
    state: State<'_, ExtensionRegistry>,
    args: SettingsTabBodyArgs,
) -> Result<String, String> {
    state.read_settings_tab_body(&args.id)
}
