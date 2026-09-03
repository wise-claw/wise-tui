use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs::{self, Metadata, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const MAX_LIST_DIR_ENTRIES: usize = 200;
const MAX_FIRST_FILE_CANDIDATES: usize = 32;
const MAX_BINARY_PREVIEW_BYTES: u64 = 45 * 1024 * 1024;
/// 仓库文件编辑器可读/可写的 UTF-8 正文上限（与前端 Monaco 大文件路径对齐）。
const MAX_EDITOR_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// 多仓库 LRU：编辑器轮询常跨 pane/工作区命中少数几个根路径。
const PROJECT_BASE_CACHE_CAPACITY: usize = 8;
/// entries[0] = 最近使用。
static PROJECT_BASE_CACHE: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());

fn project_base_cache_get(cache: &mut Vec<(String, PathBuf)>, key: &str) -> Option<PathBuf> {
    let idx = cache.iter().position(|(raw, _)| raw == key)?;
    let entry = cache.remove(idx);
    let canon = entry.1.clone();
    cache.insert(0, entry);
    Some(canon)
}

fn project_base_cache_put(cache: &mut Vec<(String, PathBuf)>, key: String, value: PathBuf) {
    if let Some(idx) = cache.iter().position(|(raw, _)| raw == &key) {
        cache.remove(idx);
    }
    cache.insert(0, (key, value));
    while cache.len() > PROJECT_BASE_CACHE_CAPACITY {
        cache.pop();
    }
}

fn canonicalize_project_dir(project_path: &str) -> Result<PathBuf, String> {
    let project = PathBuf::from(project_path);
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }
    if let Ok(mut guard) = PROJECT_BASE_CACHE.lock() {
        if let Some(cached) = project_base_cache_get(&mut guard, project_path) {
            return Ok(cached);
        }
    }
    let base = project
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    if let Ok(mut guard) = PROJECT_BASE_CACHE.lock() {
        project_base_cache_put(&mut guard, project_path.to_string(), base.clone());
    }
    Ok(base)
}

/// 解析仓库内普通文件：一次文件 canonicalize + 一次 metadata（去掉先 metadata 再 canonicalize 的重复路径行走）。
fn resolve_project_relative_regular_file(
    project_path: &str,
    relative_path: &str,
) -> Result<(PathBuf, Metadata), String> {
    let base = canonicalize_project_dir(project_path)?;
    let candidate = safe_join_under_project(&base, relative_path.trim())?;
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !canon.starts_with(&base) {
        return Err("路径越界".into());
    }
    let meta = fs::metadata(&canon).map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !meta.is_file() {
        return Err("目标不是普通文件".into());
    }
    Ok((canon, meta))
}

fn resolve_project_relative_directory(
    project_path: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let base = canonicalize_project_dir(project_path)?;
    let candidate = safe_join_under_project(&base, relative_path.trim())?;
    let canon_dir = candidate
        .canonicalize()
        .map_err(|e| format!("目录不存在或无法访问: {e}"))?;
    if !canon_dir.starts_with(&base) {
        return Err("路径越界".into());
    }
    let meta = fs::metadata(&canon_dir).map_err(|e| format!("目录不存在或无法访问: {e}"))?;
    if !meta.is_dir() {
        return Err("目标不是目录".into());
    }
    Ok(canon_dir)
}

fn safe_join_under_project(project: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("必须使用仓库相对路径".into());
    }
    let mut out = project.to_path_buf();
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

fn safe_join_under_wise(relative_path: &str) -> Result<PathBuf, String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("必须使用 ~/.wise 相对路径".into());
    }
    let mut out = crate::wise_dir()?;
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSddSignals {
    pub has_trellis_tasks: bool,
    pub has_trellis_spec: bool,
    pub has_open_spec: bool,
    pub has_generic_spec: bool,
}

#[tauri::command]
pub(crate) fn detect_workspace_sdd_signals(
    repo_path: String,
) -> Result<WorkspaceSddSignals, String> {
    if repo_path.trim().is_empty() {
        return Err("repoPath 不能为空".into());
    }
    let raw = PathBuf::from(&repo_path);
    if !raw.is_absolute() {
        return Err("repoPath 必须是绝对路径".into());
    }
    let repo_canon = raw
        .canonicalize()
        .map_err(|e| format!("仓库路径无效: {e}"))?;
    Ok(WorkspaceSddSignals {
        has_trellis_tasks: repo_canon.join(".trellis").join("tasks").is_dir(),
        has_trellis_spec: repo_canon.join(".trellis").join("spec").is_dir(),
        has_open_spec: repo_canon.join(".openspec").is_dir(),
        has_generic_spec: repo_canon.join(".spec").is_dir(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRelativeFileText {
    pub content: String,
    pub byte_len: u64,
    pub mtime_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRelativeFileStat {
    pub byte_len: u64,
    pub mtime_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRelativeFileMatch {
    pub relative_path: String,
    pub content: String,
}

fn editor_file_too_large(byte_len: u64) -> bool {
    byte_len > MAX_EDITOR_FILE_BYTES
}

fn metadata_mtime_ms(meta: &Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub(crate) fn read_project_relative_file(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    let (canon, _) = resolve_project_relative_regular_file(&project_path, &relative_path)?;
    fs::read_to_string(&canon).map_err(|e| format!("读取文件失败: {e}"))
}

/// 按优先级返回第一个存在的仓库相对文件。用于模块解析时把十余次 IPC/根路径校验
/// 合并成一次；任一候选都必须通过与单文件读取相同的越界和普通文件检查。
#[tauri::command]
pub(crate) fn read_first_project_relative_file(
    project_path: String,
    relative_paths: Vec<String>,
) -> Result<Option<ProjectRelativeFileMatch>, String> {
    if relative_paths.len() > MAX_FIRST_FILE_CANDIDATES {
        return Err(format!(
            "候选文件数量超过上限（{}）",
            MAX_FIRST_FILE_CANDIDATES
        ));
    }
    let base = canonicalize_project_dir(&project_path)?;
    for relative_path in relative_paths {
        let normalized = relative_path.trim();
        let candidate = match safe_join_under_project(&base, normalized) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let canon = match candidate.canonicalize() {
            Ok(path) if path.starts_with(&base) => path,
            _ => continue,
        };
        let is_file = fs::metadata(&canon)
            .map(|meta| meta.is_file())
            .unwrap_or(false);
        if !is_file {
            continue;
        }
        let Ok(content) = fs::read_to_string(&canon) else {
            continue;
        };
        return Ok(Some(ProjectRelativeFileMatch {
            relative_path: normalized.to_string(),
            content,
        }));
    }
    Ok(None)
}

/// 仓库文件编辑器专用读取：超过 4MiB 拒绝打开，避免多 MB 正文整包 IPC。
#[tauri::command]
pub(crate) fn read_project_relative_file_for_editor(
    project_path: String,
    relative_path: String,
) -> Result<ProjectRelativeFileText, String> {
    let (canon, meta) = resolve_project_relative_regular_file(&project_path, &relative_path)?;
    let byte_len = meta.len();
    if editor_file_too_large(byte_len) {
        return Err("文件超过 4MB 编辑器上限，请用系统应用打开".into());
    }
    let content = fs::read_to_string(&canon).map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(ProjectRelativeFileText {
        content,
        byte_len,
        mtime_ms: metadata_mtime_ms(&meta),
    })
}

/// 轻量 stat：仅返回 byteLen/mtime，供编辑器前台轮询跳过未变更文件的全文重读。
#[tauri::command]
pub(crate) fn stat_project_relative_file(
    project_path: String,
    relative_path: String,
) -> Result<ProjectRelativeFileStat, String> {
    let (_, meta) = resolve_project_relative_regular_file(&project_path, &relative_path)?;
    Ok(ProjectRelativeFileStat {
        byte_len: meta.len(),
        mtime_ms: metadata_mtime_ms(&meta),
    })
}

#[tauri::command]
pub(crate) fn read_project_relative_file_base64(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    let (canon, meta) = resolve_project_relative_regular_file(&project_path, &relative_path)?;
    let len = meta.len();
    if len > MAX_BINARY_PREVIEW_BYTES {
        return Err(format!(
            "文件超过 {}MB，无法预览",
            MAX_BINARY_PREVIEW_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&canon).map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(STANDARD.encode(&bytes))
}

#[tauri::command]
pub(crate) fn list_project_relative_directory(
    project_path: String,
    relative_path: String,
) -> Result<Vec<String>, String> {
    let canon_dir = resolve_project_relative_directory(&project_path, &relative_path)?;

    let mut entries: Vec<String> = Vec::new();
    for entry in fs::read_dir(&canon_dir).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取文件类型失败: {e}"))?;
        if !file_type.is_file() {
            continue;
        }
        entries.push(entry.file_name().to_string_lossy().to_string());
        if entries.len() >= MAX_LIST_DIR_ENTRIES {
            break;
        }
    }
    entries.sort();
    Ok(entries)
}

#[tauri::command]
pub(crate) fn write_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    if payload.len() as u64 > MAX_EDITOR_FILE_BYTES {
        return Err("写入内容超过 4MB 限制".into());
    }
    let base = canonicalize_project_dir(&project_path)?;
    let full_path = safe_join_under_project(&base, rel)?;
    let parent = full_path
        .parent()
        .ok_or_else(|| "无效文件路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;

    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("解析父目录失败: {e}"))?;
    if !canon_parent.starts_with(&base) {
        return Err("路径越界".into());
    }

    fs::write(&full_path, payload).map_err(|e| format!("写入文件失败: {e}"))?;

    let canon_file = full_path
        .canonicalize()
        .map_err(|e| format!("解析文件路径失败: {e}"))?;
    if !canon_file.starts_with(&base) {
        return Err("路径越界".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn append_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    if !rel.starts_with(".wise/") {
        return Err("仅允许向仓库 .wise/ 目录下追加文件".into());
    }

    let base = canonicalize_project_dir(&project_path)?;
    let full_path = safe_join_under_project(&base, rel)?;
    let parent = full_path
        .parent()
        .ok_or_else(|| "无效文件路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;

    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("解析父目录失败: {e}"))?;
    if !canon_parent.starts_with(&base) {
        return Err("路径越界".into());
    }

    if full_path.is_file() {
        let len = fs::metadata(&full_path)
            .map_err(|e| format!("读取文件信息失败: {e}"))?
            .len();
        if len > 2 * 1024 * 1024 {
            return Err("目标文件已超过 2MB，请手动归档后重试".into());
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&full_path)
        .map_err(|e| format!("打开文件失败: {e}"))?;
    file.write_all(payload.as_bytes())
        .map_err(|e| format!("追加写入失败: {e}"))?;

    let canon_file = full_path
        .canonicalize()
        .map_err(|e| format!("解析文件路径失败: {e}"))?;
    if !canon_file.starts_with(&base) {
        return Err("路径越界".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn read_wise_relative_file(relative_path: String) -> Result<String, String> {
    let candidate = safe_join_under_wise(relative_path.trim())?;
    let base = crate::wise_dir()?
        .canonicalize()
        .map_err(|e| format!("解析 ~/.wise 目录失败: {e}"))?;
    let meta = fs::metadata(&candidate).map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !meta.is_file() {
        return Err("目标不是普通文件".into());
    }
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("解析文件路径失败: {e}"))?;
    if !canon.starts_with(&base) {
        return Err("路径越界".into());
    }
    fs::read_to_string(&canon).map_err(|e| format!("读取文件失败: {e}"))
}

#[tauri::command]
pub(crate) fn append_wise_relative_file(
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    let full_path = safe_join_under_wise(rel)?;
    let base = crate::wise_dir()?
        .canonicalize()
        .map_err(|e| format!("解析 ~/.wise 目录失败: {e}"))?;
    let parent = full_path
        .parent()
        .ok_or_else(|| "无效文件路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;

    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("解析父目录失败: {e}"))?;
    if !canon_parent.starts_with(&base) {
        return Err("路径越界".into());
    }

    if full_path.is_file() {
        let len = fs::metadata(&full_path)
            .map_err(|e| format!("读取文件信息失败: {e}"))?
            .len();
        if len > 2 * 1024 * 1024 {
            return Err("目标文件已超过 2MB，请手动归档后重试".into());
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&full_path)
        .map_err(|e| format!("打开文件失败: {e}"))?;
    file.write_all(payload.as_bytes())
        .map_err(|e| format!("追加写入失败: {e}"))?;

    let canon_file = full_path
        .canonicalize()
        .map_err(|e| format!("解析文件路径失败: {e}"))?;
    if !canon_file.starts_with(&base) {
        return Err("路径越界".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        canonicalize_project_dir, editor_file_too_large, project_base_cache_get,
        project_base_cache_put, read_first_project_relative_file,
        resolve_project_relative_regular_file, MAX_EDITOR_FILE_BYTES, PROJECT_BASE_CACHE,
        PROJECT_BASE_CACHE_CAPACITY,
    };
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    #[test]
    fn editor_file_size_gate_allows_at_limit() {
        assert!(!editor_file_too_large(MAX_EDITOR_FILE_BYTES));
        assert!(!editor_file_too_large(0));
        assert!(editor_file_too_large(MAX_EDITOR_FILE_BYTES + 1));
    }

    #[test]
    fn canonicalize_project_dir_reuses_lru_cache() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().to_string_lossy().to_string();
        let first = canonicalize_project_dir(&path).expect("canon");
        let second = canonicalize_project_dir(&path).expect("canon again");
        assert_eq!(first, second);
        let cached = PROJECT_BASE_CACHE.lock().expect("cache lock");
        assert!(
            cached
                .iter()
                .any(|(raw, canon)| raw == &path && canon == &first),
            "expected path in LRU cache"
        );
    }

    #[test]
    fn project_base_cache_evicts_least_recently_used() {
        let mut cache: Vec<(String, PathBuf)> = Vec::new();
        for i in 0..PROJECT_BASE_CACHE_CAPACITY {
            project_base_cache_put(
                &mut cache,
                format!("/repo/{i}"),
                PathBuf::from(format!("/canon/{i}")),
            );
        }
        assert_eq!(cache.len(), PROJECT_BASE_CACHE_CAPACITY);
        // 访问最老的一条，使其变为 MRU
        let oldest_key = format!("/repo/0");
        let hit = project_base_cache_get(&mut cache, &oldest_key).expect("hit oldest");
        assert_eq!(hit, PathBuf::from("/canon/0"));
        assert_eq!(cache[0].0, oldest_key);
        // 再插入一条，应淘汰原先第二老（repo/1），保留刚访问的 repo/0
        project_base_cache_put(&mut cache, "/repo/new".into(), PathBuf::from("/canon/new"));
        assert_eq!(cache.len(), PROJECT_BASE_CACHE_CAPACITY);
        assert!(cache.iter().any(|(k, _)| k == "/repo/0"));
        assert!(cache.iter().any(|(k, _)| k == "/repo/new"));
        assert!(!cache.iter().any(|(k, _)| k == "/repo/1"));
    }

    #[test]
    fn resolve_project_relative_regular_file_reads_under_project() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file_path = dir.path().join("note.txt");
        {
            let mut f = fs::File::create(&file_path).expect("create");
            f.write_all(b"hello").expect("write");
        }
        let project = dir.path().to_string_lossy().to_string();
        let (canon, meta) =
            resolve_project_relative_regular_file(&project, "note.txt").expect("resolve");
        assert_eq!(canon, file_path.canonicalize().expect("file canon"));
        assert_eq!(meta.len(), 5);
        assert!(resolve_project_relative_regular_file(&project, "../outside.txt").is_err());
    }

    #[test]
    fn read_first_project_relative_file_preserves_candidate_priority() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("fallback.ts"), "fallback").expect("fallback");
        fs::write(dir.path().join("preferred.ts"), "preferred").expect("preferred");
        let project = dir.path().to_string_lossy().to_string();
        let matched = read_first_project_relative_file(
            project,
            vec![
                "missing.ts".into(),
                "preferred.ts".into(),
                "fallback.ts".into(),
            ],
        )
        .expect("read candidates")
        .expect("match");
        assert_eq!(matched.relative_path, "preferred.ts");
        assert_eq!(matched.content, "preferred");
    }

    #[test]
    fn read_first_project_relative_file_skips_unsafe_candidates() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("safe.ts"), "safe").expect("safe");
        let project = dir.path().to_string_lossy().to_string();
        let matched = read_first_project_relative_file(
            project,
            vec!["../outside.ts".into(), "safe.ts".into()],
        )
        .expect("read candidates")
        .expect("match");
        assert_eq!(matched.relative_path, "safe.ts");
    }
}
