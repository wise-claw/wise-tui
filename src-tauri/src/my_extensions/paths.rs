//! Resolve global / repository roots for user extension assets.

use std::path::{Path, PathBuf};

use crate::wise_paths;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InstallScope {
    Global,
    Repository,
}

impl InstallScope {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "global" => Ok(Self::Global),
            "repository" => Ok(Self::Repository),
            other => Err(format!("未知安装范围: {other}")),
        }
    }
}

/// Wise extension packages (`wise-extension.json` per subfolder).
pub fn extensions_packages_dir(scope: InstallScope, repository_path: Option<&Path>) -> Result<PathBuf, String> {
    match scope {
        InstallScope::Global => Ok(wise_paths::wise_dir()?.join("extensions")),
        InstallScope::Repository => {
            let repo = repository_path.ok_or_else(|| "未选择仓库，无法使用仓库级扩展".to_string())?;
            Ok(PathBuf::from(repo).join(".wise").join("extensions"))
        }
    }
}

/// Loose asset buckets: mcp / skills / plugins / hooks / scripts.
pub fn my_extensions_assets_root(scope: InstallScope, repository_path: Option<&Path>) -> Result<PathBuf, String> {
    match scope {
        InstallScope::Global => Ok(wise_paths::wise_dir()?.join("my-extensions")),
        InstallScope::Repository => {
            let repo = repository_path.ok_or_else(|| "未选择仓库，无法使用仓库级扩展".to_string())?;
            Ok(PathBuf::from(repo).join(".wise").join("my-extensions"))
        }
    }
}

pub fn asset_kind_dir(
    scope: InstallScope,
    repository_path: Option<&Path>,
    kind: &str,
) -> Result<PathBuf, String> {
    Ok(my_extensions_assets_root(scope, repository_path)?.join(kind))
}

pub fn ensure_layout(scope: InstallScope, repository_path: Option<&Path>) -> Result<Vec<PathBuf>, String> {
    let packages = extensions_packages_dir(scope, repository_path)?;
    let assets = my_extensions_assets_root(scope, repository_path)?;
    let mut created = Vec::new();
    for dir in [
        packages,
        assets.join("mcp"),
        assets.join("skills"),
        assets.join("plugins"),
        assets.join("hooks"),
        assets.join("scripts"),
    ] {
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| format!("创建 {} 失败: {e}", dir.display()))?;
            created.push(dir);
        }
    }
    Ok(created)
}
