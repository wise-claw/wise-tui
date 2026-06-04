//! Scan user extension packages and loose asset folders.
#![allow(dead_code)] // list/inventory IPC not wired yet; used by capture/install via kind only

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::extensions::loader::{load_one, LoadError};
use crate::extensions::registry::ExtensionRegistry;

use super::paths::{self, InstallScope};

const ASSET_KINDS: &[(&str, &str)] = &[
    ("mcp", "mcp"),
    ("skills", "skill"),
    ("plugins", "plugin"),
    ("hooks", "hook"),
    ("scripts", "script"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MyExtensionKind {
    Package,
    Mcp,
    Skill,
    Plugin,
    Hook,
    Script,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributeCounts {
    pub skills: u32,
    pub themes: u32,
    pub settings: u32,
    pub mcp: u32,
    pub assistants: u32,
    pub hooks: u32,
    pub scripts: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyExtensionEntry {
    pub id: String,
    pub kind: MyExtensionKind,
    pub name: String,
    pub install_scope: InstallScope,
    pub path: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub enabled: Option<bool>,
    pub error: Option<String>,
    pub contributes: ContributeCounts,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyExtensionsRoots {
    pub install_scope: InstallScope,
    pub packages_dir: String,
    pub assets_dir: String,
    pub mcp_dir: String,
    pub skills_dir: String,
    pub plugins_dir: String,
    pub hooks_dir: String,
    pub scripts_dir: String,
}

pub fn resolve_roots(scope: InstallScope, repository_path: Option<&Path>) -> Result<MyExtensionsRoots, String> {
    let packages = paths::extensions_packages_dir(scope, repository_path)?;
    let assets = paths::my_extensions_assets_root(scope, repository_path)?;
    Ok(MyExtensionsRoots {
        install_scope: scope,
        packages_dir: packages.display().to_string(),
        assets_dir: assets.display().to_string(),
        mcp_dir: assets.join("mcp").display().to_string(),
        skills_dir: assets.join("skills").display().to_string(),
        plugins_dir: assets.join("plugins").display().to_string(),
        hooks_dir: assets.join("hooks").display().to_string(),
        scripts_dir: assets.join("scripts").display().to_string(),
    })
}

pub fn list_entries(
    scope: InstallScope,
    repository_path: Option<&Path>,
    registry: &ExtensionRegistry,
) -> Result<Vec<MyExtensionEntry>, String> {
    let _ = paths::ensure_layout(scope, repository_path)?;
    let mut out = Vec::new();
    scan_packages(scope, repository_path, registry, &mut out)?;
    for (folder, kind) in ASSET_KINDS {
        scan_loose_assets(scope, repository_path, folder, kind, &mut out)?;
    }
    out.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

fn scan_packages(
    scope: InstallScope,
    repository_path: Option<&Path>,
    registry: &ExtensionRegistry,
    out: &mut Vec<MyExtensionEntry>,
) -> Result<(), String> {
    let dir = paths::extensions_packages_dir(scope, repository_path)?;
    if !dir.is_dir() {
        return Ok(());
    }
    let registry_list: std::collections::HashMap<String, _> = registry
        .list()
        .into_iter()
        .map(|e| (e.name.clone(), e))
        .collect();

    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ext_dir = entry.path();
        if !ext_dir.is_dir() {
            continue;
        }
        let folder_name = ext_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        match load_one(&ext_dir) {
            Ok(loaded) => {
                let name = loaded.manifest.name.clone();
                let reg = registry_list.get(&name);
                let contributes = ContributeCounts {
                    skills: loaded.manifest.contributes.skills.len() as u32,
                    themes: loaded.manifest.contributes.themes.len() as u32,
                    settings: loaded.manifest.contributes.settings_declarations.len() as u32,
                    mcp: loaded.manifest.contributes.mcp_servers.len() as u32,
                    assistants: loaded.manifest.contributes.assistants.len() as u32,
                    hooks: lifecycle_hook_count(&loaded.manifest.lifecycle),
                    scripts: 0,
                };
                out.push(MyExtensionEntry {
                    id: entry_id(scope, MyExtensionKind::Package, &name),
                    kind: MyExtensionKind::Package,
                    name,
                    install_scope: scope,
                    path: ext_dir.display().to_string(),
                    description: Some(loaded.manifest.description.clone()),
                    version: Some(loaded.manifest.version.clone()),
                    enabled: reg.map(|e| e.enabled),
                    error: reg.and_then(|e| e.error.clone()),
                    contributes,
                });
            }
            Err(LoadError::Io(_)) => {
                // Subfolder without manifest — skip silently.
            }
            Err(e) => {
                out.push(MyExtensionEntry {
                    id: entry_id(scope, MyExtensionKind::Package, &folder_name),
                    kind: MyExtensionKind::Package,
                    name: folder_name,
                    install_scope: scope,
                    path: ext_dir.display().to_string(),
                    description: None,
                    version: None,
                    enabled: None,
                    error: Some(e.to_string()),
                    contributes: ContributeCounts::default(),
                });
            }
        }
    }
    Ok(())
}

fn lifecycle_hook_count(lifecycle: &crate::extensions::manifest::Lifecycle) -> u32 {
    let mut n = 0u32;
    if lifecycle.on_install.is_some() {
        n += 1;
    }
    if lifecycle.on_activate.is_some() {
        n += 1;
    }
    if lifecycle.on_deactivate.is_some() {
        n += 1;
    }
    if lifecycle.on_uninstall.is_some() {
        n += 1;
    }
    n
}

fn scan_loose_assets(
    scope: InstallScope,
    repository_path: Option<&Path>,
    folder: &str,
    kind_slug: &str,
    out: &mut Vec<MyExtensionEntry>,
) -> Result<(), String> {
    let dir = paths::asset_kind_dir(scope, repository_path, folder)?;
    if !dir.is_dir() {
        return Ok(());
    }
    let kind = match kind_slug {
        "mcp" => MyExtensionKind::Mcp,
        "skill" => MyExtensionKind::Skill,
        "plugin" => MyExtensionKind::Plugin,
        "hook" => MyExtensionKind::Hook,
        "script" => MyExtensionKind::Script,
        _ => return Ok(()),
    };
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
        let description = loose_asset_description(&path, kind);
        out.push(MyExtensionEntry {
            id: entry_id(scope, kind, &name),
            kind,
            name,
            install_scope: scope,
            path: path.display().to_string(),
            description,
            version: None,
            enabled: None,
            error: None,
            contributes: ContributeCounts::default(),
        });
    }
    Ok(())
}

fn loose_asset_description(path: &Path, kind: MyExtensionKind) -> Option<String> {
    match kind {
        MyExtensionKind::Skill => {
            let skill_md = if path.is_dir() {
                path.join("SKILL.md")
            } else {
                path.to_path_buf()
            };
            if skill_md.is_file() {
                Some("含 SKILL.md".to_string())
            } else {
                Some("技能目录或文件".to_string())
            }
        }
        MyExtensionKind::Mcp => Some("MCP 配置或服务器目录".to_string()),
        MyExtensionKind::Plugin => Some("Claude / Wise 插件目录".to_string()),
        MyExtensionKind::Hook => Some("Hook 规则或脚本".to_string()),
        MyExtensionKind::Script => Some("可执行脚本".to_string()),
        MyExtensionKind::Package => None,
    }
}

fn entry_id(scope: InstallScope, kind: MyExtensionKind, name: &str) -> String {
    let scope_s = match scope {
        InstallScope::Global => "global",
        InstallScope::Repository => "repository",
    };
    let kind_s = match kind {
        MyExtensionKind::Package => "package",
        MyExtensionKind::Mcp => "mcp",
        MyExtensionKind::Skill => "skill",
        MyExtensionKind::Plugin => "plugin",
        MyExtensionKind::Hook => "hook",
        MyExtensionKind::Script => "script",
    };
    format!("{scope_s}:{kind_s}:{name}")
}
