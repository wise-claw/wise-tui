//! Persisted extension library under `~/.wise/extension-library/`.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::wise_paths;

use super::inventory::MyExtensionKind;

const MANIFEST_FILE: &str = "manifest.json";
const ITEMS_DIR: &str = "items";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryManifest {
    #[serde(default = "default_manifest_version")]
    pub version: u32,
    #[serde(default)]
    pub items: Vec<LibraryItem>,
}

fn default_manifest_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub kind: MyExtensionKind,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub captured_from_repository: Option<String>,
    pub captured_at: String,
    #[serde(default)]
    pub origin_scope: Option<String>,
    /// Relative to library root, e.g. `items/<id>/`.
    pub snapshot_dir: String,
}

pub fn library_home() -> Result<PathBuf, String> {
    Ok(wise_paths::wise_dir()?.join("extension-library"))
}

/// 确保 `~/.wise/extension-library/` 与 `items/` 存在（首次录入前可能尚未创建）。
pub fn ensure_extension_library_ready() -> Result<(), String> {
    let home = library_home()?;
    fs::create_dir_all(home.join(ITEMS_DIR))
        .map_err(|e| format!("无法创建扩展库目录: {e}"))?;
    Ok(())
}

fn normalize_existing_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

pub fn item_snapshot_path(item: &LibraryItem) -> Result<PathBuf, String> {
    Ok(library_home()?.join(&item.snapshot_dir))
}

pub fn load_manifest() -> Result<LibraryManifest, String> {
    let path = library_home()?.join(MANIFEST_FILE);
    if !path.is_file() {
        return Ok(LibraryManifest {
            version: 1,
            items: Vec::new(),
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("读取扩展库清单失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析扩展库清单失败: {e}"))
}

pub fn save_manifest(manifest: &LibraryManifest) -> Result<(), String> {
    let home = library_home()?;
    fs::create_dir_all(&home).map_err(|e| format!("创建扩展库目录失败: {e}"))?;
    fs::create_dir_all(home.join(ITEMS_DIR)).map_err(|e| e.to_string())?;
    let path = home.join(MANIFEST_FILE);
    let tmp = path.with_extension("json.tmp");
    let body =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("序列化扩展库清单失败: {e}"))?;
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn list_items() -> Result<Vec<LibraryItem>, String> {
    Ok(load_manifest()?.items)
}

pub fn get_item(id: &str) -> Result<LibraryItem, String> {
    load_manifest()?
        .items
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("扩展库中未找到: {id}"))
}

pub fn update_item_name(id: &str, name: String) -> Result<LibraryItem, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    let mut manifest = load_manifest()?;
    let Some(item) = manifest.items.iter_mut().find(|i| i.id == id) else {
        return Err(format!("扩展库中未找到: {id}"));
    };
    item.name = trimmed.to_string();
    let updated = item.clone();
    save_manifest(&manifest)?;
    Ok(updated)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotTreeNode {
    pub key: String,
    pub title: String,
    pub is_leaf: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<SnapshotTreeNode>>,
}

const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;

pub fn list_snapshot_tree(item: &LibraryItem) -> Result<Vec<SnapshotTreeNode>, String> {
    let snap = item_snapshot_path(item)?;
    if !snap.is_dir() {
        return Ok(Vec::new());
    }
    build_tree_children(&snap, "")
}

fn build_tree_children(base: &Path, prefix: &str) -> Result<Vec<SnapshotTreeNode>, String> {
    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut files: Vec<(String, PathBuf)> = Vec::new();
    for entry in fs::read_dir(base).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            dirs.push((name, path));
        } else if ft.is_file() {
            files.push((name, path));
        }
    }
    dirs.sort_by(|a, b| a.0.cmp(&b.0));
    files.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out: Vec<SnapshotTreeNode> = Vec::new();
    for (name, path) in dirs {
        let key = join_relative(prefix, &name);
        let children = build_tree_children(&path, &key)?;
        out.push(SnapshotTreeNode {
            key,
            title: name,
            is_leaf: false,
            children: Some(children),
        });
    }
    for (name, _) in files {
        let key = join_relative(prefix, &name);
        out.push(SnapshotTreeNode {
            key,
            title: name,
            is_leaf: true,
            children: None,
        });
    }
    Ok(out)
}

fn join_relative(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}/{name}")
    }
}

pub fn default_relative_file(item: &LibraryItem) -> Result<String, String> {
    let snap = normalize_existing_path(&item_snapshot_path(item)?);
    let file = normalize_existing_path(&resolve_primary_content_path(item)?);
    file.strip_prefix(&snap)
        .map(|p| normalize_relative_path(p))
        .map_err(|_| "无法解析默认文件路径".to_string())
}

fn normalize_relative_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn snapshot_root(item: &LibraryItem) -> Result<PathBuf, String> {
    let snap = item_snapshot_path(item)?;
    if !snap.is_dir() {
        return Err("快照目录无效".to_string());
    }
    Ok(normalize_existing_path(&snap))
}

fn validate_snapshot_relative(relative_path: &str) -> Result<(), String> {
    let rel = relative_path.trim().trim_start_matches('/');
    if rel.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if rel.contains('\\') {
        return Err("路径非法".to_string());
    }
    Ok(())
}

fn safe_join_snapshot(snap: &Path, relative_path: &str) -> Result<PathBuf, String> {
    validate_snapshot_relative(relative_path)?;
    let rel = relative_path.trim().trim_start_matches('/');
    let mut out = snap.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::ParentDir => return Err("路径不允许包含 ..".to_string()),
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return Err("路径非法".to_string()),
        }
    }
    Ok(out)
}

fn assert_under_snapshot(snap: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Err(format!("路径不存在: {}", target.display()));
    }
    let canon = normalize_existing_path(target);
    if !canon.starts_with(snap) {
        return Err("路径越界".to_string());
    }
    Ok(())
}

/// 在快照内创建空文件（自动创建父目录）。
pub fn create_snapshot_file(item: &LibraryItem, relative_path: &str) -> Result<(), String> {
    let snap = snapshot_root(item)?;
    let full = safe_join_snapshot(&snap, relative_path)?;
    if full.exists() {
        return Err("目标已存在".to_string());
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
    }
    fs::File::create(&full).map_err(|e| format!("创建文件失败: {e}"))?;
    assert_under_snapshot(&snap, &full)
}

/// 在快照内创建目录。
pub fn create_snapshot_directory(item: &LibraryItem, relative_path: &str) -> Result<(), String> {
    let snap = snapshot_root(item)?;
    let full = safe_join_snapshot(&snap, relative_path)?;
    if full.exists() {
        return Err("目标已存在".to_string());
    }
    fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
    assert_under_snapshot(&snap, &full)
}

/// 删除快照内的文件或目录（目录递归删除）。
pub fn delete_snapshot_entry(item: &LibraryItem, relative_path: &str) -> Result<(), String> {
    let snap = snapshot_root(item)?;
    let rel = relative_path.trim().trim_start_matches('/');
    if rel == "meta.json" {
        return Err("不能删除元数据文件 meta.json".to_string());
    }
    let full = safe_join_snapshot(&snap, relative_path)?;
    assert_under_snapshot(&snap, &full)?;
    let meta = fs::symlink_metadata(&full).map_err(|e| format!("读取路径信息失败: {e}"))?;
    if meta.is_dir() {
        fs::remove_dir_all(&full).map_err(|e| format!("删除目录失败: {e}"))?;
    } else {
        fs::remove_file(&full).map_err(|e| format!("删除文件失败: {e}"))?;
    }
    Ok(())
}

/// 目录类技能快照若缺少 `skill/SKILL.md`，用首个 `.md` 生成入口文件（Claude 技能约定）。
pub fn ensure_skill_snapshot_entrypoint(snap_dir: &Path) -> Result<(), String> {
    let skill_dir = snap_dir.join("skill");
    if !skill_dir.is_dir() {
        return Ok(());
    }
    let skill_md = skill_dir.join("SKILL.md");
    if skill_md.is_file() {
        return Ok(());
    }
    let Some(source) = first_file_in_dir_recursive(&skill_dir)? else {
        return Ok(());
    };
    if !source
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("md"))
    {
        return Ok(());
    }
    fs::copy(&source, &skill_md).map_err(|e| format!("生成 SKILL.md 失败: {e}"))?;
    Ok(())
}

pub fn resolve_snapshot_file(item: &LibraryItem, relative_path: &str) -> Result<PathBuf, String> {
    let snap = snapshot_root(item)?;
    if item.kind == MyExtensionKind::Skill {
        ensure_skill_snapshot_entrypoint(&snap)?;
    }
    let target = safe_join_snapshot(&snap, relative_path)?;
    if !target.exists() {
        return Err(format!("文件不存在: {}", target.display()));
    }
    let resolved = normalize_existing_path(&target);
    if !resolved.starts_with(&snap) {
        return Err("文件路径越界".to_string());
    }
    if !resolved.is_file() {
        return Err("只能编辑文件，不能打开目录".to_string());
    }
    Ok(resolved)
}

pub fn read_snapshot_file_text(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_EDIT_BYTES {
        return Err(format!(
            "文件超过 {}MB，请在扩展库目录中用外部编辑器打开",
            MAX_EDIT_BYTES / 1024 / 1024
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("读取失败（可能为二进制文件）: {e}"))
}

pub fn language_from_path(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or_default() {
        "md" | "markdown" => "markdown",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" => "typescript",
        "py" => "python",
        "sh" | "bash" | "zsh" => "shell",
        "rs" => "rust",
        _ => "plaintext",
    }
}

pub fn resolve_primary_content_path(item: &LibraryItem) -> Result<PathBuf, String> {
    let snap = item_snapshot_path(item)?;
    let direct = match item.kind {
        MyExtensionKind::Mcp => Some(snap.join("mcp-server.json")),
        MyExtensionKind::Hook => Some(snap.join("hooks-settings.json")),
        MyExtensionKind::Skill => {
            let skill_dir = snap.join("skill");
            let skill_md = skill_dir.join("SKILL.md");
            if skill_md.is_file() {
                Some(skill_md)
            } else {
                first_file_in_dir_recursive(&skill_dir)?
            }
        }
        MyExtensionKind::Script => {
            let script_dir = snap.join("script");
            if script_dir.is_dir() {
                first_file_in_dir_recursive(&script_dir)?
            } else {
                first_file_in_dir_recursive(&snap)?
            }
        }
        MyExtensionKind::Plugin => first_file_in_dir_recursive(&snap.join("plugin"))?,
        MyExtensionKind::Package => first_file_in_dir_recursive(&snap)?,
    };
    if let Some(path) = direct {
        if path.is_file() {
            return Ok(path);
        }
    }
    first_file_in_dir_recursive(&snap)?
        .ok_or_else(|| "未找到可编辑内容文件".to_string())
}

/// 快照内是否至少有一个可编辑文件（用于录入后校验）。
pub fn snapshot_has_editable_content(kind: MyExtensionKind, snap_dir: &Path) -> bool {
    match kind {
        MyExtensionKind::Mcp => snap_dir.join("mcp-server.json").is_file(),
        MyExtensionKind::Hook => snap_dir.join("hooks-settings.json").is_file(),
        MyExtensionKind::Skill => first_file_in_dir_recursive(&snap_dir.join("skill"))
            .ok()
            .flatten()
            .is_some(),
        MyExtensionKind::Script => {
            let script_dir = snap_dir.join("script");
            if script_dir.is_dir() {
                first_file_in_dir_recursive(&script_dir)
                    .ok()
                    .flatten()
                    .is_some()
            } else {
                first_file_in_dir_recursive(snap_dir)
                    .ok()
                    .flatten()
                    .is_some()
            }
        }
        MyExtensionKind::Plugin => first_file_in_dir_recursive(&snap_dir.join("plugin"))
            .ok()
            .flatten()
            .is_some(),
        MyExtensionKind::Package => first_file_in_dir_recursive(snap_dir)
            .ok()
            .flatten()
            .is_some(),
    }
}

fn first_file_in_dir_recursive(dir: &Path) -> Result<Option<PathBuf>, String> {
    if !dir.is_dir() {
        return Ok(None);
    }
    let mut files: Vec<PathBuf> = Vec::new();
    collect_files_recursive(dir, &mut files)?;
    files.sort();
    Ok(files.into_iter().next())
}

fn collect_files_recursive(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        if ft.is_symlink() {
            let Ok(resolved) = resolve_symlink_for_copy(&path) else {
                continue;
            };
            if resolved.is_dir() {
                collect_files_recursive(&resolved, out)?;
            } else if resolved.is_file() && !is_meta_json(&resolved) {
                out.push(resolved);
            }
            continue;
        }
        if ft.is_dir() {
            collect_files_recursive(&path, out)?;
        } else if ft.is_file() && !is_meta_json(&path) {
            out.push(path);
        }
    }
    Ok(())
}

fn is_meta_json(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()) == Some("meta.json")
}

pub fn upsert_item(item: LibraryItem) -> Result<LibraryItem, String> {
    let mut manifest = load_manifest()?;
    if let Some(idx) = manifest.items.iter().position(|i| i.id == item.id) {
        manifest.items[idx] = item.clone();
    } else {
        manifest.items.push(item.clone());
    }
    save_manifest(&manifest)?;
    Ok(item)
}

pub fn remove_item(id: &str) -> Result<(), String> {
    let mut manifest = load_manifest()?;
    let Some(pos) = manifest.items.iter().position(|i| i.id == id) else {
        return Err(format!("扩展库中未找到: {id}"));
    };
    let removed = manifest.items.remove(pos);
    save_manifest(&manifest)?;
    let snap = library_home()?.join(&removed.snapshot_dir);
    if snap.exists() {
        if snap.is_dir() {
            fs::remove_dir_all(&snap).map_err(|e| format!("删除快照目录失败: {e}"))?;
        } else {
            fs::remove_file(&snap).map_err(|e| format!("删除快照文件失败: {e}"))?;
        }
    }
    Ok(())
}

pub fn new_item_dir(id: &str) -> Result<PathBuf, String> {
    let dir = library_home()?.join(ITEMS_DIR).join(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).ok();
    }
    fs::create_dir_all(&dir).map_err(|e| format!("创建快照目录失败: {e}"))?;
    Ok(dir)
}

pub fn find_by_name_kind(name: &str, kind: MyExtensionKind) -> Option<LibraryItem> {
    load_manifest()
        .ok()?
        .items
        .into_iter()
        .find(|i| i.name == name && i.kind == kind)
}

pub fn copy_dir_recursive(source: &Path, dest: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!("{} 不是目录", source.display()));
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let s = entry.path();
        let d = dest.join(entry.file_name());
        if ft.is_symlink() {
            let Ok(resolved) = resolve_symlink_for_copy(&s) else {
                continue;
            };
            if resolved.is_dir() {
                copy_dir_recursive(&resolved, &d)?;
            } else if resolved.is_file() {
                if let Some(parent) = d.parent() {
                    fs::create_dir_all(parent).ok();
                }
                fs::copy(&resolved, &d)
                    .map_err(|e| format!("复制 {} 失败: {e}", resolved.display()))?;
            }
            continue;
        }
        if ft.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else if ft.is_file() {
            if let Some(parent) = d.parent() {
                fs::create_dir_all(parent).ok();
            }
            fs::copy(&s, &d).map_err(|e| format!("复制 {} 失败: {e}", s.display()))?;
        }
    }
    Ok(())
}

fn resolve_symlink_for_copy(path: &Path) -> Result<PathBuf, String> {
    let target = fs::read_link(path).map_err(|e| format!("读取符号链接失败: {e}"))?;
    let resolved = if target.is_absolute() {
        target
    } else {
        path.parent()
            .map(|p| p.join(&target))
            .unwrap_or(target)
    };
    if !resolved.exists() {
        return Err(format!(
            "符号链接目标不存在: {} → {}",
            path.display(),
            resolved.display()
        ));
    }
    Ok(resolved)
}

pub fn copy_file_to_dir(source: &Path, dest_dir: &Path, file_name: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(file_name);
    fs::copy(source, &dest).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn ensure_skill_snapshot_entrypoint_creates_skill_md_from_first_markdown() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let snap = tmp.path();
        let skill_dir = snap.join("skill");
        fs::create_dir_all(&skill_dir).expect("skill dir");
        let md = skill_dir.join("api-extract.md");
        fs::File::create(&md)
            .and_then(|mut f| f.write_all(b"# api-extract"))
            .expect("write md");

        ensure_skill_snapshot_entrypoint(snap).expect("ensure");

        let skill_md = skill_dir.join("SKILL.md");
        assert!(skill_md.is_file());
        let body = fs::read_to_string(&skill_md).expect("read SKILL.md");
        assert!(body.contains("api-extract"));
        assert!(md.is_file());
    }
}
