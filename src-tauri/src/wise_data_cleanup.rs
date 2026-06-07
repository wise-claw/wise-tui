//! Enumerate and purge selected cache directories under `~/.wise/`.

use crate::composer_image_gc;
use crate::wise_db::WiseDb;
use crate::wise_paths::wise_dir;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Copy)]
struct CleanupCategoryDef {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    relative_dirs: &'static [&'static str],
}

const CATEGORIES: &[CleanupCategoryDef] = &[
    CleanupCategoryDef {
        id: "composer_images",
        label: "Composer 图片",
        description: "主会话截图、粘贴与上传的图片缓存",
        relative_dirs: &["composer-images"],
    },
    CleanupCategoryDef {
        id: "prd_images",
        label: "PRD 粘贴图片",
        description: "需求编辑器中粘贴的图片缓存",
        relative_dirs: &["prd-images"],
    },
    CleanupCategoryDef {
        id: "prd_runs",
        label: "PRD 拆分快照",
        description: "已物化的 PRD 运行目录（不影响仓库内 .trellis）",
        relative_dirs: &["prd-runs"],
    },
    CleanupCategoryDef {
        id: "spawn_cache",
        label: "子进程配置缓存",
        description: "Claude / MCP 派发时生成的临时 JSON 配置",
        relative_dirs: &["claude-spawn", "spawn-mcp"],
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseDataCategoryUsage {
    pub id: String,
    pub label: String,
    pub description: String,
    pub path: String,
    pub file_count: u64,
    pub byte_size: u64,
    pub exists: bool,
    /// 仍被会话引用的文件数（仅 composer_images）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referenced_file_count: Option<u64>,
    /// 当前可安全自动回收的文件数（仅 composer_images）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gc_eligible_file_count: Option<u64>,
    /// 当前可安全自动回收的字节数（仅 composer_images）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gc_eligible_byte_size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseDataCleanupResult {
    pub category_id: String,
    pub removed_files: u64,
    pub freed_bytes: u64,
}

fn category_paths(wise: &Path, cat: &CleanupCategoryDef) -> Vec<PathBuf> {
    cat.relative_dirs
        .iter()
        .map(|rel| wise.join(rel))
        .collect()
}

fn dir_usage(path: &Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    if !path.is_dir() {
        return (files, bytes);
    }
    let entries = match fs::read_dir(path) {
        Ok(v) => v,
        Err(_) => return (files, bytes),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            let (f, b) = dir_usage(&path);
            files += f;
            bytes += b;
        } else if ft.is_file() {
            files += 1;
            bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    (files, bytes)
}

fn usage_for_paths(paths: &[PathBuf]) -> (u64, u64, bool) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut exists = false;
    for path in paths {
        if path.exists() {
            exists = true;
            let (f, b) = dir_usage(path);
            files += f;
            bytes += b;
        }
    }
    (files, bytes, exists)
}

fn remove_dir_contents(path: &Path) -> Result<(u64, u64), String> {
    if !path.exists() {
        return Ok((0, 0));
    }
    let (before_files, before_bytes) = dir_usage(path);
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
        return Ok((before_files.max(1), before_bytes));
    }
    if !path.is_dir() {
        return Ok((0, 0));
    }
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_dir() {
            fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
        } else {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok((before_files, before_bytes))
}

fn assert_paths_under_wise(wise: &Path, paths: &[PathBuf]) -> Result<(), String> {
    let canon_wise = fs::canonicalize(wise).map_err(|e| format!("无法解析 ~/.wise：{e}"))?;
    for path in paths {
        if !path.exists() {
            continue;
        }
        let canon = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !canon.starts_with(&canon_wise) {
            return Err(format!(
                "路径超出 ~/.wise 范围：{}",
                path.to_string_lossy()
            ));
        }
    }
    Ok(())
}

fn cleanup_category_paths(paths: &[PathBuf]) -> Result<(u64, u64), String> {
    let mut removed = 0u64;
    let mut freed = 0u64;
    for path in paths {
        let (f, b) = remove_dir_contents(path)?;
        removed += f;
        freed += b;
    }
    Ok((removed, freed))
}

fn find_category(id: &str) -> Option<&'static CleanupCategoryDef> {
    CATEGORIES.iter().find(|c| c.id == id)
}

/// Opens `~/.wise` in the system file manager (backend opener; not limited by frontend path scope).
#[tauri::command]
pub fn open_wise_home_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = wise_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_wise_data_cleanup_categories(
    db: tauri::State<'_, WiseDb>,
) -> Result<Vec<WiseDataCategoryUsage>, String> {
    let wise = wise_dir()?;
    let mut out = Vec::with_capacity(CATEGORIES.len());
    for cat in CATEGORIES {
        let paths = category_paths(&wise, cat);
        let (file_count, byte_size, exists) = usage_for_paths(&paths);
        let path = paths
            .first()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| wise.join(cat.relative_dirs[0]).to_string_lossy().to_string());
        let path = if cat.relative_dirs.len() > 1 {
            format!(
                "{}（含 {}）",
                path,
                cat.relative_dirs[1..]
                    .iter()
                    .map(|s| format!("~/.wise/{s}"))
                    .collect::<Vec<_>>()
                    .join("、")
            )
        } else {
            path
        };
        let (referenced_file_count, gc_eligible_file_count, gc_eligible_byte_size) =
            if cat.id == "composer_images" {
                match composer_image_gc::composer_image_gc_stats(&db) {
                    Ok(stats) => (
                        Some(stats.referenced_files),
                        Some(stats.gc_eligible_files),
                        Some(stats.gc_eligible_bytes),
                    ),
                    Err(_) => (None, None, None),
                }
            } else {
                (None, None, None)
            };
        out.push(WiseDataCategoryUsage {
            id: cat.id.to_string(),
            label: cat.label.to_string(),
            description: cat.description.to_string(),
            path,
            file_count,
            byte_size,
            exists,
            referenced_file_count,
            gc_eligible_file_count,
            gc_eligible_byte_size,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn cleanup_wise_data_categories(
    category_ids: Vec<String>,
) -> Result<Vec<WiseDataCleanupResult>, String> {
    if category_ids.is_empty() {
        return Err("请至少选择一项要清理的数据".into());
    }
    let wise = wise_dir()?;
    let mut results = Vec::with_capacity(category_ids.len());
    for id in category_ids {
        let cat = find_category(id.trim()).ok_or_else(|| format!("未知的清理类别：{id}"))?;
        let paths = category_paths(&wise, cat);
        assert_paths_under_wise(&wise, &paths)?;
        let (removed_files, freed_bytes) = cleanup_category_paths(&paths)?;
        results.push(WiseDataCleanupResult {
            category_id: cat.id.to_string(),
            removed_files,
            freed_bytes,
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn remove_dir_contents_counts_files() {
        let base = std::env::temp_dir().join(format!("wise-cleanup-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let file = base.join("a.png");
        let mut f = File::create(&file).unwrap();
        f.write_all(b"hello").unwrap();
        let (removed, freed) = remove_dir_contents(&base).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(freed, 5);
        assert!(base.is_dir());
        assert!(!file.exists());
        let _ = fs::remove_dir_all(&base);
    }
}
