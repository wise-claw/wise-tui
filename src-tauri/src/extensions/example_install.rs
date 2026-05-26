//! Install the bundled `hello-world` reference extension into `~/.wise/extensions/`.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::registry::{ExtensionListEntry, ExtensionRegistry};
use crate::my_extensions::{paths, InstallScope};

const EXAMPLE_DIR_NAME: &str = "hello-world";
const MANIFEST_FILE: &str = "wise-extension.json";
const RESOURCE_DIR: &str = "hello-world";

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallHelloWorldResult {
    pub dest_path: String,
    pub entry: ExtensionListEntry,
}

pub fn install_hello_world(
    app: &AppHandle,
    registry: &ExtensionRegistry,
) -> Result<InstallHelloWorldResult, String> {
    install_hello_world_scoped(app, registry, InstallScope::Global, None)
}

pub fn install_hello_world_scoped(
    app: &AppHandle,
    registry: &ExtensionRegistry,
    scope: InstallScope,
    repository_path: Option<&Path>,
) -> Result<InstallHelloWorldResult, String> {
    let source = resolve_hello_world_source(app)?;
    let dest = paths::extensions_packages_dir(scope, repository_path)?.join(EXAMPLE_DIR_NAME);
    copy_dir_recursive(&source, &dest)?;
    let extra = match scope {
        InstallScope::Repository => {
            let repo = repository_path.ok_or_else(|| "缺少 repositoryPath".to_string())?;
            vec![PathBuf::from(repo).join(".wise").join("extensions")]
        }
        InstallScope::Global => vec![],
    };
    registry.hot_reload(&extra)?;
    let entry = registry
        .list()
        .into_iter()
        .find(|e| e.name == EXAMPLE_DIR_NAME)
        .ok_or_else(|| "示例已复制但未在扩展列表中出现，请点「重新扫描」".to_string())?;
    Ok(InstallHelloWorldResult {
        dest_path: dest.display().to_string(),
        entry,
    })
}

fn resolve_hello_world_source(app: &AppHandle) -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut dev_candidates = vec![
        manifest_dir
            .join("..")
            .join("examples")
            .join("wise-extensions")
            .join(EXAMPLE_DIR_NAME),
        manifest_dir
            .join("resources")
            .join("extension-examples")
            .join(EXAMPLE_DIR_NAME),
    ];
    if let Some(repo_root) = manifest_dir.parent() {
        dev_candidates.push(
            repo_root
                .join("examples")
                .join("wise-extensions")
                .join(EXAMPLE_DIR_NAME),
        );
    }
    for dev in dev_candidates {
        if dev.join(MANIFEST_FILE).is_file() {
            return dev.canonicalize().map_err(|e| e.to_string());
        }
    }

    let resource_root = app
        .path()
        .resolve(RESOURCE_DIR, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("未找到打包的示例扩展: {e}"))?;
    if resource_root.join(MANIFEST_FILE).is_file() {
        return Ok(resource_root);
    }
    let via_manifest = app
        .path()
        .resolve(
            format!("{RESOURCE_DIR}/{MANIFEST_FILE}"),
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("未找到打包的示例扩展: {e}"))?;
    via_manifest
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "示例扩展资源路径无效".to_string())
}

fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| format!("清理旧示例失败: {e}"))?;
    }
    fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {e}"))?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let s = entry.path();
        let d = dest.join(entry.file_name());
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else if ft.is_file() {
            if let Some(parent) = d.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&s, &d).map_err(|e| format!("复制 {} 失败: {e}", s.display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_hello_world_example_exists() {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("wise-extensions")
            .join(EXAMPLE_DIR_NAME)
            .join(MANIFEST_FILE);
        assert!(p.is_file(), "missing {}", p.display());
    }
}
