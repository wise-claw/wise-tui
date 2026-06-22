use crate::project_workspace_paths::expand_tilde_in_path;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader};
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
            | ".codegraph"
            | "vendor"
            | ".gradle"
            | ".cargo"
            | "Pods"
            | "DerivedData"
            | ".pnpm-store"
            | ".yarn"
            | ".cache"
            | ".tox"
            | ".mypy_cache"
            | ".pytest_cache"
            | ".ruff_cache"
            | ".parcel-cache"
            | ".sass-cache"
    )
}

fn project_file_rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryExplorerEntry {
    path: String,
    is_dir: bool,
}

fn searchable_walk_entry(
    entry: &walkdir::DirEntry,
    root_path: &Path,
) -> Option<(String, bool)> {
    if entry.depth() == 0 {
        return None;
    }
    let file_type = entry.file_type();
    let is_dir = file_type.is_dir();
    let is_file = file_type.is_file();
    if !is_dir && !is_file {
        return None;
    }
    if is_dir && should_skip_walk_dir(&entry.file_name().to_string_lossy()) {
        return None;
    }
    let rel = project_file_rel_path(root_path, entry.path())?;
    Some((rel, is_dir))
}

fn score_repository_search_match(base_l: &str, rel_l: &str, q: &str) -> Option<u8> {
    if !rel_l.contains(q) && !base_l.contains(q) {
        return None;
    }
    Some(if base_l.starts_with(q) {
        0u8
    } else if base_l.contains(q) {
        1u8
    } else {
        2u8
    })
}

fn sort_repository_search_results(entries: &mut [RepositoryExplorerEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.path.cmp(&b.path))
    });
}

/// Fast in-process file/directory search for @ mentions (no shell spawn).
#[tauri::command]
pub(crate) fn search_repository_files(
    root: String,
    query: String,
    relative_dir: Option<String>,
) -> Result<Vec<RepositoryExplorerEntry>, String> {
    const MAX_RESULTS: usize = 50;
    const MAX_MATCH_COLLECT: usize = 150;
    const MAX_SCAN_ENTRIES: usize = 300_000;

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".to_string());
    }

    // 搜索起始目录：仓库根 + relative_dir（空=整个仓库）。
    // explorer_join_dir 经 safe_join_repository_root 校验拒绝 `..`/绝对路径，并保证拼接结果在仓库根下。
    // `searchable_walk_entry` 仍按仓库根计算 rel，因此结果 path 始终相对仓库根，与打开/展示逻辑一致。
    let rel = relative_dir.unwrap_or_default();
    let search_root = explorer_join_dir(&root_path, &rel)?;
    if !search_root.is_dir() {
        return Err(format!("搜索目录不存在或不是目录：{rel}"));
    }

    let q = query.trim().to_lowercase();
    let mut scanned: usize = 0;

    let walker = WalkDir::new(&search_root)
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
        let mut out: Vec<RepositoryExplorerEntry> = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                break;
            }
            let Some((path, is_dir)) = searchable_walk_entry(&entry, &root_path) else {
                continue;
            };
            out.push(RepositoryExplorerEntry { path, is_dir });
            if out.len() >= MAX_RESULTS {
                break;
            }
        }
        sort_repository_search_results(&mut out);
        Ok(out)
    } else {
        let mut scored: Vec<(u8, String, bool)> = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                break;
            }
            let Some((rel, is_dir)) = searchable_walk_entry(&entry, &root_path) else {
                continue;
            };
            let base = Path::new(&rel)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let rel_l = rel.to_lowercase();
            let base_l = base.to_lowercase();
            let Some(score) = score_repository_search_match(&base_l, &rel_l, &q) else {
                continue;
            };
            scored.push((score, rel, is_dir));
            if scored.len() >= MAX_MATCH_COLLECT {
                break;
            }
        }
        scored.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| a.1.len().cmp(&b.1.len()))
                .then_with(|| b.2.cmp(&a.2))
        });
        scored.truncate(MAX_RESULTS);
        Ok(scored
            .into_iter()
            .map(|(_, path, is_dir)| RepositoryExplorerEntry { path, is_dir })
            .collect())
    }
}

/// Extensions that are unlikely to contain searchable plain text.
fn should_skip_content_search_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "ico"
            | "bmp"
            | "svg"
            | "pdf"
            | "zip"
            | "gz"
            | "tar"
            | "rar"
            | "7z"
            | "jar"
            | "war"
            | "woff"
            | "woff2"
            | "ttf"
            | "otf"
            | "eot"
            | "mp3"
            | "mp4"
            | "mov"
            | "avi"
            | "wasm"
            | "exe"
            | "dll"
            | "so"
            | "dylib"
            | "bin"
            | "class"
            | "pyc"
            | "o"
            | "a"
            | "sqlite"
            | "db"
            | "lock"
    )
}

fn is_probably_binary_file(path: &Path) -> bool {
    const SAMPLE: usize = 8192;
    let Ok(meta) = fs::metadata(path) else {
        return true;
    };
    if meta.len() == 0 {
        return false;
    }
    let Ok(mut file) = fs::File::open(path) else {
        return true;
    };
    let mut buf = vec![0u8; SAMPLE.min(meta.len() as usize)];
    let Ok(n) = std::io::Read::read(&mut file, &mut buf) else {
        return true;
    };
    buf.truncate(n);
    buf.contains(&0)
}

fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
    haystack
        .to_lowercase()
        .contains(&needle.to_lowercase())
}

/// 构造行预览，并返回匹配区间在最终 preview 中的 char 偏移 `(start, end)`。
///
/// 偏移在最终 preview（含可能的前后省略号、截断）上重新按 `chars()` 计数定位，
/// 与前端 `Array.from(preview)` 的 code point 切分保持一致；找不到匹配返回 `None`。
fn build_content_preview(line: &str, query: &str, max_len: usize) -> (String, Option<(usize, usize)>) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return (String::new(), None);
    }
    let lower = trimmed.to_lowercase();
    let q = query.to_lowercase();
    let Some(byte_idx) = lower.find(&q) else {
        return (truncate_utf8_chars(trimmed, max_len), None);
    };
    // Byte indices from `lower` may not align with `trimmed` after case folding; use char indices.
    let match_char = lower[..byte_idx].chars().count();
    let match_char_len = q.chars().count();
    let chars: Vec<char> = trimmed.chars().collect();
    let context = 24usize;
    let start = match_char.saturating_sub(context);
    let end = (match_char + match_char_len + context).min(chars.len());
    let mut slice: String = chars[start..end].iter().collect();
    if start > 0 {
        slice.insert(0, '…');
    }
    if end < chars.len() {
        slice.push('…');
    }
    let preview = truncate_utf8_chars(&slice, max_len);
    // 在最终 preview 上重新定位匹配区间（char 偏移）。匹配位于 preview 前 24+query_len 字符内，
    // 不会超出 160 截断点，故一定能复现匹配。
    let preview_chars = preview.chars().count();
    let range = preview
        .to_lowercase()
        .find(&q)
        .map(|b| {
            let s = preview[..b].chars().count();
            (s, (s + q.chars().count()).min(preview_chars))
        });
    (preview, range)
}

fn truncate_utf8_chars(s: &str, max_len: usize) -> String {
    if s.chars().count() <= max_len {
        return s.to_string();
    }
    s.chars().take(max_len).collect::<String>() + "…"
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryFileContentMatch {
    path: String,
    line: u32,
    preview: String,
    /// 匹配区间在 `preview` 中的起始 char 偏移（与前端 code point 切分一致）。
    #[serde(skip_serializing_if = "Option::is_none")]
    match_start: Option<u32>,
    /// 匹配区间在 `preview` 中的结束 char 偏移（exclusive）。
    #[serde(skip_serializing_if = "Option::is_none")]
    match_end: Option<u32>,
}

fn search_repository_file_contents_blocking(
    root: String,
    query: String,
    relative_dir: String,
) -> Result<Vec<RepositoryFileContentMatch>, String> {
    const MAX_RESULTS: usize = 80;
    const MAX_SCAN_ENTRIES: usize = 300_000;
    const MAX_FILE_BYTES: u64 = 512 * 1024;
    const MAX_LINE_BYTES: usize = 8192;

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    // 搜索起始目录：仓库根 + relative_dir（空=整个仓库）。
    // explorer_join_dir 内部经 safe_join_repository_root 校验拒绝 `..`/绝对路径，并保证拼接结果在仓库根下。
    let search_root = explorer_join_dir(&root_path, &relative_dir)?;
    if !search_root.is_dir() {
        return Err(format!("搜索目录不存在或不是目录：{relative_dir}"));
    }

    let walker = WalkDir::new(&search_root)
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
    let mut out: Vec<RepositoryFileContentMatch> = Vec::new();

    for entry in walker.filter_map(|e| e.ok()) {
        scanned += 1;
        if scanned > MAX_SCAN_ENTRIES || out.len() >= MAX_RESULTS {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if should_skip_content_search_file(path) {
            continue;
        }
        let Ok(meta) = fs::metadata(path) else {
            continue;
        };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        if is_probably_binary_file(path) {
            continue;
        }
        let Some(rel) = project_file_rel_path(&root_path, path) else {
            continue;
        };

        let Ok(file) = fs::File::open(path) else {
            continue;
        };
        let reader = BufReader::new(file);
        for (line_no, line_result) in reader.lines().enumerate() {
            if out.len() >= MAX_RESULTS {
                break;
            }
            let Ok(line) = line_result else {
                break;
            };
            if line.len() > MAX_LINE_BYTES {
                continue;
            }
            if !contains_case_insensitive(&line, q) {
                continue;
            }
            let (preview, match_range) = build_content_preview(&line, q, 160);
            out.push(RepositoryFileContentMatch {
                path: rel.clone(),
                line: (line_no as u32).saturating_add(1),
                preview,
                match_start: match_range.map(|(s, _)| s as u32),
                match_end: match_range.map(|(_, e)| e as u32),
            });
        }
    }

    Ok(out)
}

/// Search plain-text file contents under a repository root (for global search).
///
/// `relative_dir` 为仓库相对目录，限定搜索范围；`None`/空串表示整个仓库。
#[tauri::command]
pub(crate) async fn search_repository_file_contents(
    root: String,
    query: String,
    relative_dir: Option<String>,
) -> Result<Vec<RepositoryFileContentMatch>, String> {
    let rel = relative_dir.unwrap_or_default();
    tokio::task::spawn_blocking(move || search_repository_file_contents_blocking(root, query, rel))
        .await
        .map_err(|e| format!("文件内容搜索任务异常: {e}"))?
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

/// Paths joined via `safe_join_repository_root` / `explorer_join_dir` only — no per-expand canonicalize.
fn assert_joined_path_under_repo(repo_root: &Path, joined: &Path) -> Result<(), String> {
    if !joined.starts_with(repo_root) {
        return Err("路径越界".into());
    }
    Ok(())
}

/// Whether `path` exists on this machine and is a directory (used before opening file tree).
#[tauri::command]
pub(crate) fn path_is_accessible_directory(path: String) -> bool {
    let trimmed = path.trim();
    !trimmed.is_empty() && expand_tilde_in_path(trimmed).is_dir()
}

fn explorer_root_error_message(root: &str, root_path: &Path) -> String {
    let display = root.trim();
    if display.is_empty() {
        return "仓库路径为空".to_string();
    }
    if !root_path.exists() {
        return format!(
            "仓库路径在本机不存在：{display}。若刚换电脑或复制了 ~/.wise，请在本机重新选择该仓库文件夹（侧栏添加/关联仓库）。"
        );
    }
    if !root_path.is_dir() {
        return format!("路径不是目录：{display}");
    }
    format!("无法打开仓库目录：{display}")
}

fn explorer_join_dir(repo_root: &Path, relative_dir: &str) -> Result<PathBuf, String> {
    let rel = relative_dir.trim().trim_start_matches('/').trim_end_matches('/');
    if rel.is_empty() {
        Ok(repo_root.to_path_buf())
    } else {
        safe_join_repository_root(repo_root, rel)
    }
}

/// List immediate children of one directory for lazy explorer tree expansion.
#[tauri::command]
pub(crate) async fn list_repository_explorer_children(
    root: String,
    relative_dir: String,
) -> Result<Vec<RepositoryExplorerEntry>, String> {
    const MAX_CHILDREN: usize = 4_000;

    let root_path = expand_tilde_in_path(&root);
    if !root_path.is_dir() {
        return Err(explorer_root_error_message(&root, &root_path));
    }
    // Do not canonicalize here — it can block on `.cursor`, symlinks, or network roots and freeze the UI.
    let dir_path = explorer_join_dir(&root_path, &relative_dir)?;
    if !dir_path.is_dir() {
        return Err("目录不存在".into());
    }
    assert_joined_path_under_repo(&root_path, &dir_path)?;

    let mut out: Vec<RepositoryExplorerEntry> = Vec::new();
    let read_dir = fs::read_dir(&dir_path).map_err(|e| format!("读取目录失败: {e}"))?;
    for entry in read_dir {
        if out.len() >= MAX_CHILDREN {
            break;
        }
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("读取类型失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        if file_type.is_dir() && should_skip_walk_dir(&name) {
            continue;
        }
        let rel = if relative_dir.trim().trim_matches('/').is_empty() {
            name.clone()
        } else {
            format!(
                "{}/{}",
                relative_dir.trim().trim_matches('/'),
                name
            )
        };
        out.push(RepositoryExplorerEntry {
            path: rel,
            is_dir: file_type.is_dir(),
        });
    }

    out.sort_by(|a, b| match a.path.cmp(&b.path) {
        std::cmp::Ordering::Equal => a.is_dir.cmp(&b.is_dir),
        o => o,
    });
    Ok(out)
}

/// List files and directories (including empty folders) for explorer tree UI.
#[tauri::command]
pub(crate) async fn list_repository_explorer_entries(
    root: String,
) -> Result<Vec<RepositoryExplorerEntry>, String> {
    const MAX_SCAN_ENTRIES: usize = 400_000;
    const MAX_RESULTS: usize = 30_000;

    let root_path = expand_tilde_in_path(&root);
    if !root_path.is_dir() {
        return Err(explorer_root_error_message(&root, &root_path));
    }
    let root_path = root_path
        .canonicalize()
        .map_err(|e| explorer_root_error_message(&root, &root_path) + &format!(" ({e})"))?;

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

#[cfg(test)]
mod repository_search_tests {
    use super::*;
    use std::fs;

    #[test]
    fn search_repository_files_includes_directories() {
        let root = std::env::temp_dir().join("wise-repo-search-dir-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src/components")).unwrap();
        fs::write(root.join("src/components/App.tsx"), "export {}").unwrap();

        let results = search_repository_files(
            root.to_string_lossy().to_string(),
            "components".into(),
            None,
        )
        .expect("search");

        assert!(
            results.iter().any(|entry| entry.is_dir && entry.path == "src/components"),
            "expected directory match: {results:?}",
        );
        assert!(
            results.iter().any(|entry| !entry.is_dir && entry.path == "src/components/App.tsx"),
            "expected file match: {results:?}",
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn search_repository_files_scopes_to_relative_dir() {
        let root = std::env::temp_dir().join("wise-repo-search-scope-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("src/widget.ts"), "export {}").unwrap();
        fs::write(root.join("docs/widget.md"), "# widget").unwrap();

        // 限定到 src/ 搜索 "widget"：只应命中 src/widget.ts，不命中 docs/widget.md。
        let results = search_repository_files(
            root.to_string_lossy().to_string(),
            "widget".into(),
            Some("src".into()),
        )
        .expect("scoped search");

        assert!(
            results.iter().any(|entry| !entry.is_dir && entry.path == "src/widget.ts"),
            "expected scoped file match: {results:?}",
        );
        assert!(
            !results.iter().any(|entry| entry.path == "docs/widget.md"),
            "docs/ must be excluded when scoped to src/: {results:?}",
        );

        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod content_search_tests {
    use super::*;
    use std::fs;

    #[test]
    fn search_repository_file_contents_finds_line_and_preview() {
        let root = std::env::temp_dir().join("wise-content-search-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/hello.ts"),
            "export const alpha = 1;\nexport const beta = 2;\n",
        )
        .unwrap();

        let matches = search_repository_file_contents_blocking(
            root.to_string_lossy().to_string(),
            "beta".into(),
            String::new(),
        )
        .expect("search");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "src/hello.ts");
        assert_eq!(matches[0].line, 2);
        assert!(matches[0].preview.contains("beta"));
        // 偏移指向 preview 中的 "beta" 子串（按 char 计数）。
        let preview_chars: Vec<char> = matches[0].preview.chars().collect();
        let ms = matches[0].match_start.expect("match_start") as usize;
        let me = matches[0].match_end.expect("match_end") as usize;
        assert_eq!(&preview_chars[ms..me].iter().collect::<String>(), "beta");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn search_repository_file_contents_scopes_to_relative_dir() {
        let root = std::env::temp_dir().join("wise-content-search-scope-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(
            root.join("src/hello.ts"),
            "export const scoped = 1;\n",
        )
        .unwrap();
        fs::write(
            root.join("docs/hello.md"),
            "export const scoped = 2;\n",
        )
        .unwrap();

        // 限定 src 子目录：只命中 src/hello.ts，不命中 docs/hello.md。
        let matches = search_repository_file_contents_blocking(
            root.to_string_lossy().to_string(),
            "scoped".into(),
            "src".to_string(),
        )
        .expect("scoped search");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].path, "src/hello.ts");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn build_content_preview_truncates_long_lines() {
        let (preview, range) = build_content_preview(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "bbbb",
            20,
        );
        assert!(preview.chars().count() <= 21);
        // 无匹配时不含偏移。
        assert!(range.is_none());
    }

    #[test]
    fn build_content_preview_range_aligns_with_match_after_ellipsis() {
        // 匹配靠后，preview 开头会补省略号；偏移仍应指向最终 preview 中的匹配子串。
        let (preview, range) = build_content_preview(
            "prefix padding padding padding padding padding target suffix",
            "target",
            160,
        );
        let (start, end) = range.expect("range");
        let chars: Vec<char> = preview.chars().collect();
        assert_eq!(&chars[start..end].iter().collect::<String>(), "target");
    }
}

#[cfg(test)]
mod explorer_children_tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn lists_dot_cursor_commands_under_repo_root() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let entries = list_repository_explorer_children(
            root.to_string_lossy().to_string(),
            ".cursor".to_string(),
        )
        .await
        .expect("list .cursor");
        let commands = entries.iter().find(|e| e.path.ends_with("commands") && e.is_dir);
        assert!(commands.is_some(), "expected .cursor/commands entry: {entries:?}");

        let cmd_entries = list_repository_explorer_children(
            root.to_string_lossy().to_string(),
            ".cursor/commands".to_string(),
        )
        .await
        .expect("list .cursor/commands");
        assert!(
            cmd_entries.iter().any(|e| e.path.contains("trellis")),
            "expected files under .cursor/commands: {cmd_entries:?}"
        );
    }

    #[test]
    fn joined_dot_path_stays_under_repo_without_canonicalize() {
        let root = std::env::temp_dir().join("wise-explorer-join-test");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".cursor/commands")).unwrap();
        let joined = explorer_join_dir(&root, ".cursor/commands").unwrap();
        assert!(assert_joined_path_under_repo(&root, &joined).is_ok());
        let _ = fs::remove_dir_all(&root);
    }
}
