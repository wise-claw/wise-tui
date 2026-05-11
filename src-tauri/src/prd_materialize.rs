//! Copy PRD markdown images into the repository under `.wise/prd-runs/<runId>/`
//! so Claude Code can read them via `@` paths (Tauri `asset://` URLs are not visible to the CLI).

use serde::Serialize;
use serde_json::json;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterializePrdSnapshotResult {
    pub run_id: String,
    pub prd_relative_path: String,
    pub split_relative_path: Option<String>,
    pub requirements_index_relative_path: Option<String>,
    pub split_mapping_relative_path: Option<String>,
}

fn sanitize_run_id(raw: Option<String>) -> String {
    if let Some(s) = raw {
        let clean: String = s
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
            .take(64)
            .collect();
        if !clean.is_empty() {
            return clean;
        }
    }
    Uuid::new_v4().to_string()
}

fn strip_query_fragment(s: &str) -> &str {
    s.split('?')
        .next()
        .unwrap_or(s)
        .split('#')
        .next()
        .unwrap_or(s)
}

fn percent_decode_path(s: &str) -> Result<PathBuf, String> {
    let dec = urlencoding::decode(s).map_err(|e| format!("URL 解码失败: {e}"))?;
    Ok(PathBuf::from(dec.into_owned()))
}

/// Resolves `convertFileSrc` / asset protocol URLs to a local filesystem path.
fn asset_like_url_to_path(url: &str) -> Option<PathBuf> {
    let u = strip_query_fragment(url.trim());
    if let Some(rest) = u.strip_prefix("asset://") {
        return percent_decode_path(rest).ok();
    }
    const HTTPS: &str = "https://asset.localhost/";
    const HTTP: &str = "http://asset.localhost/";
    if u.len() >= HTTPS.len() && u[..HTTPS.len()].eq_ignore_ascii_case(HTTPS) {
        return percent_decode_path(&u[HTTPS.len()..]).ok();
    }
    if u.len() >= HTTP.len() && u[..HTTP.len()].eq_ignore_ascii_case(HTTP) {
        return percent_decode_path(&u[HTTP.len()..]).ok();
    }
    None
}

fn file_url_to_path(url: &str) -> Option<PathBuf> {
    let u = strip_query_fragment(url.trim());
    let rest = u.strip_prefix("file://")?;
    let path = if rest.starts_with('/') {
        percent_decode_path(rest).ok()?
    } else {
        // file://host/path (Windows sometimes)
        let slash = rest.find('/')?;
        percent_decode_path(&rest[slash..]).ok()?
    };
    Some(path)
}

fn is_allowed_image_source(src: &Path, prd_images_root: &Path, project: &Path) -> bool {
    let project_wise = project.join(".wise");
    let roots = [
        prd_images_root.to_path_buf(),
        project_wise.join("composer-attachments"),
        project_wise.join("prd-runs"),
    ];
    let Ok(can_src) = src.canonicalize() else {
        return false;
    };
    for r in &roots {
        if let Ok(cr) = r.canonicalize() {
            if can_src.strip_prefix(&cr).is_ok() {
                return true;
            }
        }
    }
    false
}

fn next_image_dest_name(counter: u32, src: &Path) -> String {
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("png");
    format!("img-{counter:03}.{ext}")
}

/// Returns `(abs_start, url_start, url_end)` for `![...](url)` starting at or after `cursor`.
fn scan_md_image(md: &str, cursor: usize) -> Option<(usize, usize, usize)> {
    let tail = md.get(cursor..)?;
    let rel = tail.find("![")?;
    let abs = cursor + rel;
    let after_bang = md.get(abs + 2..)?;
    let close = after_bang.find("](")?;
    let url_start = abs + 2 + close + 2;
    let after_paren = md.get(url_start..)?;
    let end_rel = after_paren.find(')')?;
    let url_end = url_start + end_rel;
    Some((abs, url_start, url_end))
}

fn rewrite_markdown_images(
    md: &str,
    project: &Path,
    assets_dir: &Path,
    prd_images_root: &Path,
) -> Result<String, String> {
    let mut out = String::new();
    let mut cursor = 0usize;
    let mut img_counter = 1u32;
    while cursor < md.len() {
        match scan_md_image(md, cursor) {
            Some((abs, url_start, url_end)) => {
                out.push_str(
                    md.get(cursor..abs)
                        .ok_or_else(|| "PRD 内容切片越界".to_string())?,
                );
                let alt = md.get(abs + 2..url_start.saturating_sub(2)).unwrap_or("");
                let url = md
                    .get(url_start..url_end)
                    .ok_or_else(|| "图片 URL 切片越界".to_string())?
                    .trim();

                let mut new_url = url.to_string();
                if let Some(src_path) =
                    asset_like_url_to_path(url).or_else(|| file_url_to_path(url))
                {
                    if src_path.is_file()
                        && is_allowed_image_source(&src_path, prd_images_root, project)
                    {
                        let dest_name = next_image_dest_name(img_counter, &src_path);
                        img_counter += 1;
                        let dest = assets_dir.join(&dest_name);
                        if fs::copy(&src_path, &dest).is_ok() {
                            new_url = format!("./assets/{dest_name}");
                        }
                    }
                }

                out.push_str(&format!("![{alt}]({new_url})"));
                cursor = url_end + 1;
            }
            None => {
                out.push_str(&md[cursor..]);
                break;
            }
        }
    }
    Ok(out)
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

/// 读取仓库内 UTF-8 文本文件（防 `..` 与路径逃逸）。
/// 向仓库内 `.wise/` 下文件追加一行 UTF-8 内容（用于进化日志 JSONL）；路径防逃逸，单文件上限 2MB。
pub fn append_project_relative_file(
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

    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }
    let base = project
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
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

pub fn read_project_relative_file(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }
    let base = project
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let candidate = safe_join_under_project(&base, relative_path.trim())?;
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

/// 读取仓库内文件的原始字节并返回 Base64，供前端 `data:` URL / Blob 预览（不受 asset protocol `scope` 限制）。
const MAX_BINARY_PREVIEW_BYTES: u64 = 45 * 1024 * 1024;

pub fn read_project_relative_file_base64(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }
    let base = project
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let candidate = safe_join_under_project(&base, relative_path.trim())?;
    let meta = fs::metadata(&candidate).map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    if !meta.is_file() {
        return Err("目标不是普通文件".into());
    }
    let len = meta.len();
    if len > MAX_BINARY_PREVIEW_BYTES {
        return Err(format!(
            "文件超过 {}MB，无法预览",
            MAX_BINARY_PREVIEW_BYTES / 1024 / 1024
        ));
    }
    let canon = candidate
        .canonicalize()
        .map_err(|e| format!("解析文件路径失败: {e}"))?;
    if !canon.starts_with(&base) {
        return Err("路径越界".into());
    }
    let bytes = fs::read(&canon).map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(STANDARD.encode(&bytes))
}

/// 覆盖写入仓库内 UTF-8 文本文件（防 `..` 与路径逃逸），用于轻量状态快照。
pub fn write_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    if payload.len() > 512 * 1024 {
        return Err("写入内容超过 512KB 限制".into());
    }
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }
    let base = project
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
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

/// 向用户目录 `~/.wise/` 下文件追加一行 UTF-8 内容（用于进化日志 JSONL）；路径防逃逸，单文件上限 2MB。
pub fn append_wise_relative_file(relative_path: String, payload: String) -> Result<(), String> {
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

/// 读取用户目录 `~/.wise/` 下 UTF-8 文本文件。
pub fn read_wise_relative_file(relative_path: String) -> Result<String, String> {
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

pub fn materialize_prd_snapshot(
    project_path: String,
    prd_markdown: String,
    split_markdown: Option<String>,
    run_id: Option<String>,
    requirements_index_json: Option<String>,
    snapshot_meta_json: Option<String>,
) -> Result<MaterializePrdSnapshotResult, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }

    let run_id = sanitize_run_id(run_id);
    let prd_images_root = crate::wise_dir()?.join("prd-images");
    let run_dir = crate::wise_dir()?.join("prd-runs").join(&run_id);
    let assets_dir = run_dir.join("assets");
    fs::create_dir_all(&assets_dir).map_err(|e| format!("创建快照目录失败: {e}"))?;

    let prd_body = rewrite_markdown_images(&prd_markdown, &project, &assets_dir, &prd_images_root)?;
    let prd_path = run_dir.join("prd.md");
    fs::write(&prd_path, prd_body).map_err(|e| format!("写入 prd.md 失败: {e}"))?;

    let prd_relative_path = prd_path.to_string_lossy().to_string();
    let mut split_relative_path: Option<String> = None;
    if let Some(split) = split_markdown {
        if !split.trim().is_empty() {
            let split_path = run_dir.join("split.md");
            fs::write(&split_path, split).map_err(|e| format!("写入 split.md 失败: {e}"))?;
            split_relative_path = Some(split_path.to_string_lossy().to_string());
        }
    }

    let mut requirements_index_relative_path: Option<String> = None;
    let mut split_mapping_relative_path: Option<String> = None;
    if let Some(raw) = requirements_index_json.filter(|s| !s.trim().is_empty()) {
        let mut val: serde_json::Value = serde_json::from_str(raw.trim())
            .map_err(|e| format!("requirements-index JSON 无效: {e}"))?;
        if val.is_array() {
            val = json!({ "version": 1, "requirements": val });
        }
        if let Some(obj) = val.as_object_mut() {
            obj.insert(
                "runId".to_string(),
                serde_json::Value::String(run_id.clone()),
            );
            if !obj.contains_key("version") {
                obj.insert("version".to_string(), json!(1));
            }
        }
        let idx_path = run_dir.join("requirements-index.json");
        let pretty = serde_json::to_string_pretty(&val)
            .map_err(|e| format!("序列化 requirements-index 失败: {e}"))?;
        fs::write(&idx_path, pretty)
            .map_err(|e| format!("写入 requirements-index.json 失败: {e}"))?;
        requirements_index_relative_path = Some(idx_path.to_string_lossy().to_string());

        let mapping_seed = json!({ "version": 1, "taskRequirementLinks": [] });
        let map_pretty = serde_json::to_string_pretty(&mapping_seed)
            .map_err(|e| format!("序列化 split-mapping 模板失败: {e}"))?;
        let map_path = run_dir.join("split-mapping.json");
        fs::write(&map_path, map_pretty)
            .map_err(|e| format!("写入 split-mapping.json 失败: {e}"))?;
        split_mapping_relative_path = Some(map_path.to_string_lossy().to_string());
    }

    let mut meta = json!({
        "version": 1,
        "runId": run_id,
    });
    if let Some(raw_meta) = snapshot_meta_json.filter(|s| !s.trim().is_empty()) {
        let parsed_meta: serde_json::Value = serde_json::from_str(raw_meta.trim())
            .map_err(|e| format!("snapshot meta JSON 无效: {e}"))?;
        if let Some(obj) = parsed_meta.as_object() {
            let meta_obj = meta
                .as_object_mut()
                .ok_or_else(|| "meta 结构异常".to_string())?;
            for (k, v) in obj {
                meta_obj.insert(k.to_string(), v.clone());
            }
        }
    }
    let meta_path = run_dir.join("meta.json");
    let meta_pretty =
        serde_json::to_string_pretty(&meta).map_err(|e| format!("序列化 meta.json 失败: {e}"))?;
    fs::write(&meta_path, meta_pretty).map_err(|e| format!("写入 meta.json 失败: {e}"))?;

    Ok(MaterializePrdSnapshotResult {
        run_id,
        prd_relative_path,
        split_relative_path,
        requirements_index_relative_path,
        split_mapping_relative_path,
    })
}

pub fn read_snapshot_file(file_path: String) -> Result<String, String> {
    let root = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 目录失败: {e}"))?
        .join("prd-runs");
    let base = root
        .canonicalize()
        .map_err(|e| format!("快照目录不存在或不可访问: {e}"))?;
    let path = PathBuf::from(file_path.trim());
    if !path.is_absolute() {
        return Err("快照文件路径必须是绝对路径".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("快照文件不存在或无法访问: {e}"))?;
    if !canon.starts_with(&base) {
        return Err("仅允许读取 ~/.wise/prd-runs 下的快照文件".into());
    }
    let meta = fs::metadata(&canon).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if !meta.is_file() {
        return Err("目标不是普通文件".into());
    }
    fs::read_to_string(&canon).map_err(|e| format!("读取快照文件失败: {e}"))
}
