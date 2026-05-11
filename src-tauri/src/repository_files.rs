use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

/// Skip heavy / generated directories when walking a project tree.
fn should_skip_walk_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "dist"
            | "build"
            | "target"
            | ".next"
            | "__pycache__"
            | ".venv"
            | "venv"
            | ".idea"
            | ".vscode"
            | "coverage"
            | ".turbo"
            | ".nuxt"
            | ".output"
            | "out"
    )
}

fn project_file_rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Fast in-process file search for @ mentions (no shell spawn).
#[tauri::command]
pub(crate) fn search_repository_files(root: String, query: String) -> Result<Vec<String>, String> {
    const MAX_RESULTS: usize = 50;
    const MAX_MATCH_COLLECT: usize = 150;
    const MAX_SCAN_ENTRIES: usize = 300_000;

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let q = query.trim().to_lowercase();
    let mut scanned: usize = 0;

    let walker = WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().is_dir() && should_skip_walk_dir(&e.file_name().to_string_lossy()) {
                return false;
            }
            true
        });

    if q.is_empty() {
        let mut out: Vec<String> = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                break;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = project_file_rel_path(&root_path, entry.path()) else {
                continue;
            };
            out.push(rel);
            if out.len() >= MAX_RESULTS {
                break;
            }
        }
        Ok(out)
    } else {
        let mut scored: Vec<(u8, String)> = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                break;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = project_file_rel_path(&root_path, entry.path()) else {
                continue;
            };
            let base = Path::new(&rel)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let rel_l = rel.to_lowercase();
            let base_l = base.to_lowercase();
            if !rel_l.contains(&q) && !base_l.contains(&q) {
                continue;
            }
            let score = if base_l.starts_with(&q) {
                0u8
            } else if base_l.contains(&q) {
                1u8
            } else {
                2u8
            };
            scored.push((score, rel));
            if scored.len() >= MAX_MATCH_COLLECT {
                break;
            }
        }
        scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.len().cmp(&b.1.len())));
        scored.truncate(MAX_RESULTS);
        Ok(scored.into_iter().map(|(_, p)| p).collect())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryExplorerEntry {
    path: String,
    is_dir: bool,
}

/// Join `relative_path` under repository root; rejects `..` and absolute paths.
fn safe_join_repository_root(repo_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("必须使用仓库相对路径".into());
    }
    let mut out = repo_root.to_path_buf();
    for c in rel_path.components() {
        match c {
            Component::ParentDir => return Err("路径不允许包含 ..".into()),
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return Err("路径非法".into()),
        }
    }
    Ok(out)
}

fn assert_resolved_path_under_repo(repo_canon: &Path, path: &Path) -> Result<(), String> {
    let canon = path
        .canonicalize()
        .map_err(|e| format!("解析路径失败: {e}"))?;
    if !canon.starts_with(repo_canon) {
        return Err("路径越界".into());
    }
    Ok(())
}

/// List files and directories (including empty folders) for explorer tree UI.
#[tauri::command]
pub(crate) fn list_repository_explorer_entries(
    root: String,
) -> Result<Vec<RepositoryExplorerEntry>, String> {
    const MAX_SCAN_ENTRIES: usize = 400_000;
    const MAX_RESULTS: usize = 30_000;

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".to_string());
    }
    let root_path = root_path.canonicalize().map_err(|e| e.to_string())?;

    let walker = WalkDir::new(&root_path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().is_dir() && should_skip_walk_dir(&e.file_name().to_string_lossy()) {
                return false;
            }
            true
        });

    let mut scanned: usize = 0;
    let mut seen: BTreeMap<String, bool> = BTreeMap::new();

    for entry in walker.filter_map(|e| e.ok()) {
        scanned += 1;
        if scanned > MAX_SCAN_ENTRIES || seen.len() >= MAX_RESULTS {
            break;
        }
        let Some(rel) = project_file_rel_path(&root_path, entry.path()) else {
            continue;
        };
        if entry.file_type().is_dir() {
            seen.insert(rel, true);
        } else if entry.file_type().is_file() {
            seen.insert(rel, false);
        }
    }

    let mut out: Vec<RepositoryExplorerEntry> = seen
        .into_iter()
        .map(|(path, is_dir)| RepositoryExplorerEntry { path, is_dir })
        .collect();
    out.sort_by(|a, b| match a.path.cmp(&b.path) {
        std::cmp::Ordering::Equal => a.is_dir.cmp(&b.is_dir),
        o => o,
    });
    Ok(out)
}

/// Create an empty file under the repository (parent directories are created if missing).
#[tauri::command]
pub(crate) fn create_repository_file(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err("仓库根目录无效".into());
    }
    let base = root_pb
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = safe_join_repository_root(&base, &relative_path)?;
    if full.exists() {
        return Err("目标已存在".into());
    }
    let parent = full.parent().ok_or_else(|| "无效文件路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("解析父目录失败: {e}"))?;
    if !canon_parent.starts_with(&base) {
        return Err("路径越界".into());
    }
    fs::File::create(&full).map_err(|e| format!("创建文件失败: {e}"))?;
    assert_resolved_path_under_repo(&base, &full)?;
    Ok(())
}

/// Create a directory under the repository (`relative_path` is the new folder path).
#[tauri::command]
pub(crate) fn create_repository_directory(
    root: String,
    relative_path: String,
) -> Result<(), String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err("仓库根目录无效".into());
    }
    let base = root_pb
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = safe_join_repository_root(&base, &relative_path)?;
    if full.exists() {
        return Err("目标已存在".into());
    }
    fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
    assert_resolved_path_under_repo(&base, &full)?;
    Ok(())
}

/// Delete a file or directory under the repository (directories are removed recursively).
#[tauri::command]
pub(crate) fn delete_repository_entry(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err("仓库根目录无效".into());
    }
    let base = root_pb
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = safe_join_repository_root(&base, &relative_path)?;
    if !full.exists() {
        return Err("路径不存在".into());
    }
    assert_resolved_path_under_repo(&base, &full)?;
    let meta = fs::symlink_metadata(&full).map_err(|e| format!("读取路径信息失败: {e}"))?;
    if meta.is_dir() {
        fs::remove_dir_all(&full).map_err(|e| format!("删除目录失败: {e}"))?;
    } else if meta.is_file() || meta.file_type().is_symlink() {
        fs::remove_file(&full).map_err(|e| format!("删除文件失败: {e}"))?;
    } else {
        return Err("不支持的文件类型".into());
    }
    Ok(())
}
