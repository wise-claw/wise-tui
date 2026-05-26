//! Install library items to global Claude Code or a target repository.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};

use crate::claude_commands::project_skills::validate_claude_skill_name;

use super::inventory::MyExtensionKind;
use super::library::{copy_dir_recursive, get_item, item_snapshot_path, LibraryItem};
use super::mcp_config::{merge_mcp_server_into_file, resolve_mcp_install_path_for_server};
use super::paths::InstallScope;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLibraryArgs {
    pub library_item_id: String,
    pub install_scope: String,
    #[serde(default)]
    pub repository_path: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLibraryResult {
    pub installed_path: String,
    pub install_scope: InstallScope,
}

pub fn install_library_item(args: InstallLibraryArgs) -> Result<InstallLibraryResult, String> {
    let scope = InstallScope::parse(&args.install_scope)?;
    let repo = args
        .repository_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    if scope == InstallScope::Repository && repo.is_none() {
        return Err("安装到仓库需要 repositoryPath".to_string());
    }
    let item = get_item(&args.library_item_id)?;
    let snap = item_snapshot_path(&item)?;
    let installed_path = match item.kind {
        MyExtensionKind::Skill => install_skill(&item, &snap, scope, repo.as_deref())?,
        MyExtensionKind::Mcp => install_mcp(&item, &snap, scope, repo.as_deref())?,
        MyExtensionKind::Hook => install_hooks(&item, &snap, scope, repo.as_deref())?,
        MyExtensionKind::Script => install_script(&item, &snap, scope, repo.as_deref())?,
        MyExtensionKind::Plugin => {
            return Err("插件请通过「插件市场」安装；库内条目仅作备份参考".to_string());
        }
        MyExtensionKind::Package => {
            return Err("扩展包请复制到目标 ~/.wise/extensions 或 <仓库>/.wise/extensions".to_string());
        }
    };
    Ok(InstallLibraryResult {
        installed_path,
        install_scope: scope,
    })
}

fn install_skill(
    item: &LibraryItem,
    snap: &Path,
    scope: InstallScope,
    repo: Option<&Path>,
) -> Result<String, String> {
    validate_claude_skill_name(&item.name)?;
    let skill_src = snap.join("skill");
    if !skill_src.is_dir() {
        return Err("库内技能快照损坏".to_string());
    }
    let dest = match scope {
        InstallScope::Global => {
            let home = dirs::home_dir().ok_or_else(|| "无法解析用户目录".to_string())?;
            home.join(".claude").join("skills").join(&item.name)
        }
        InstallScope::Repository => {
            let repo = repo.ok_or_else(|| "缺少仓库路径".to_string())?;
            let canon = fs::canonicalize(repo).map_err(|e| format!("无法解析仓库路径: {e}"))?;
            canon.join(".claude").join("skills").join(&item.name)
        }
    };
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&skill_src, &dest)?;
    Ok(dest.display().to_string())
}

fn install_mcp(
    item: &LibraryItem,
    snap: &Path,
    scope: InstallScope,
    repo: Option<&Path>,
) -> Result<String, String> {
    let raw = fs::read_to_string(snap.join("mcp-server.json")).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let entry = v
        .get("entry")
        .cloned()
        .ok_or_else(|| "MCP 快照缺少 entry".to_string())?;
    let server_name = v
        .get("serverName")
        .and_then(|x| x.as_str())
        .unwrap_or(&item.name)
        .to_string();

    let path = resolve_mcp_install_path_for_server(scope, repo, &server_name)?;
    merge_mcp_server_into_file(&path, &server_name, entry)?;
    Ok(path.display().to_string())
}

fn install_hooks(
    item: &LibraryItem,
    snap: &Path,
    scope: InstallScope,
    repo: Option<&Path>,
) -> Result<String, String> {
    let snap_file = snap.join("hooks-settings.json");
    if !snap_file.is_file() {
        return Err("库内 hooks 快照损坏".to_string());
    }
    let raw = fs::read_to_string(&snap_file).map_err(|e| e.to_string())?;
    let captured: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let hooks = captured
        .get("hooks")
        .cloned()
        .ok_or_else(|| "快照中无 hooks 字段".to_string())?;

    let path = match scope {
        InstallScope::Global => crate::claude_config_dir::user_claude_dir().join("settings.json"),
        InstallScope::Repository => {
            let repo = repo.ok_or_else(|| "缺少仓库路径".to_string())?;
            repo.join(".claude").join("settings.json")
        }
    };

    let mut root: Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).unwrap_or(json!({}))
    } else {
        json!({})
    };
    if !root.is_object() {
        root = json!({});
    }
    root.as_object_mut()
        .unwrap()
        .insert("hooks".to_string(), hooks);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| e.to_string())?;
    let _ = item;
    Ok(path.display().to_string())
}

fn install_script(
    item: &LibraryItem,
    snap: &Path,
    scope: InstallScope,
    repo: Option<&Path>,
) -> Result<String, String> {
    let script_dir = match scope {
        InstallScope::Global => {
            let home = crate::wise_paths::wise_dir()?;
            home.join("my-extensions").join("scripts")
        }
        InstallScope::Repository => {
            let repo = repo.ok_or_else(|| "缺少仓库路径".to_string())?;
            repo.join(".wise").join("my-extensions").join("scripts")
        }
    };
    fs::create_dir_all(&script_dir).map_err(|e| e.to_string())?;

    let bundled = snap.join("script");
    if bundled.is_dir() {
        let dest = script_dir.join(&item.name);
        if dest.exists() {
            fs::remove_dir_all(&dest).ok();
        }
        copy_dir_recursive(&bundled, &dest)?;
        return Ok(dest.display().to_string());
    }

    let mut copied = None;
    if let Ok(entries) = fs::read_dir(snap) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() && p.file_name() != Some(std::ffi::OsStr::new("meta.json")) {
                let fname = p.file_name().unwrap().to_string_lossy().to_string();
                let dest = script_dir.join(&fname);
                fs::copy(&p, &dest).map_err(|e| e.to_string())?;
                copied = Some(dest);
                break;
            }
        }
    }
    copied
        .map(|p| p.display().to_string())
        .ok_or_else(|| "库内脚本快照损坏".to_string())
}
