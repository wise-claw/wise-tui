//! Capture repository assets into the global extension library.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::validate_claude_skill_name;

use super::discover::{discover_in_repository, DiscoverCandidate};
use super::inventory::MyExtensionKind;
use super::library::{
    copy_dir_recursive, copy_file_to_dir, ensure_extension_library_ready,
    ensure_skill_snapshot_entrypoint, find_by_name_kind, new_item_dir,
    snapshot_has_editable_content, upsert_item, LibraryItem,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureArgs {
    pub repository_path: String,
    pub candidate_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureAllArgs {
    pub repository_path: String,
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePathArgs {
    pub repository_path: String,
    pub relative_path: String,
    pub kind: String,
    #[serde(default)]
    pub name: Option<String>,
}

/// 前端可解析：多个 MCP 服务器时需指定 `name`（服务器键名）。
pub const MCP_MULTI_SERVERS_PREFIX: &str = "MCP_MULTI_SERVERS:";

fn find_candidate<'a>(
    candidates: &'a [DiscoverCandidate],
    candidate_id: &str,
) -> Result<&'a DiscoverCandidate, String> {
    candidates
        .iter()
        .find(|c| c.candidate_id == candidate_id)
        .ok_or_else(|| "未找到要收录的候选项".to_string())
}

pub fn capture_candidate(args: CaptureArgs) -> Result<LibraryItem, String> {
    let candidates = discover_in_repository(&args.repository_path)?;
    let candidate = find_candidate(&candidates, &args.candidate_id)?;
    if candidate.already_in_library {
        if let Some(existing) = find_by_name_kind(&candidate.name, candidate.kind) {
            return Ok(existing);
        }
    }
    capture_one(candidate, Some(args.repository_path.trim()))
}

pub fn capture_from_repository_path(args: CapturePathArgs) -> Result<LibraryItem, String> {
    ensure_extension_library_ready()?;
    let repo = args.repository_path.trim();
    if repo.is_empty() {
        return Err("仓库路径无效".to_string());
    }
    let kind = parse_kind_str(args.kind.trim()).ok_or_else(|| "不支持的扩展类型".to_string())?;
    if kind == MyExtensionKind::Package {
        return Err("扩展包请通过扩展市场或示例安装".to_string());
    }
    let (_root, abs_path) = resolve_repo_relative_path(repo, &args.relative_path)?;
    validate_capture_shape(kind, &abs_path)?;

    let (name, description) = match kind {
        MyExtensionKind::Mcp => {
            let (server_name, _) = resolve_mcp_capture(&abs_path, args.name.as_deref())?;
            (
                server_name,
                Some(format!("从仓库录入 MCP · {}", args.relative_path.trim())),
            )
        }
        _ => {
            let name = args
                .name
                .map(|n| n.trim().to_string())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| default_capture_name(&abs_path));
            if kind == MyExtensionKind::Skill {
                validate_claude_skill_name(&name)?;
            }
            (
                name,
                Some(format!("从仓库录入 · {}", args.relative_path.trim())),
            )
        }
    };

    if find_by_name_kind(&name, kind).is_some() {
        return Err(format!(
            "扩展库中已存在同名 {} 条目「{name}」",
            kind_label_cn(kind)
        ));
    }

    let candidate = DiscoverCandidate {
        candidate_id: format!("path:{kind:?}:{name}:{}", abs_path.display()),
        kind,
        name,
        description,
        source_path: abs_path.display().to_string(),
        origin_scope: "project".to_string(),
        already_in_library: false,
    };
    capture_one(&candidate, Some(repo))
}

pub fn capture_all_visible(args: CaptureAllArgs) -> Result<Vec<LibraryItem>, String> {
    let candidates = discover_in_repository(&args.repository_path)?;
    let kind_filter: Option<Vec<MyExtensionKind>> = args.kinds.as_ref().map(|ks| {
        ks.iter()
            .filter_map(|s| parse_kind_str(s))
            .collect()
    });
    let mut saved = Vec::new();
    for c in candidates {
        if c.already_in_library {
            continue;
        }
        if let Some(ref filter) = kind_filter {
            if !filter.contains(&c.kind) {
                continue;
            }
        }
        if let Ok(item) = capture_one(&c, Some(args.repository_path.trim())) {
            saved.push(item);
        }
    }
    Ok(saved)
}

fn kind_label_cn(kind: MyExtensionKind) -> &'static str {
    match kind {
        MyExtensionKind::Package => "扩展包",
        MyExtensionKind::Mcp => "MCP",
        MyExtensionKind::Skill => "技能",
        MyExtensionKind::Plugin => "插件",
        MyExtensionKind::Hook => "Hooks",
        MyExtensionKind::Script => "脚本",
    }
}

fn parse_kind_str(s: &str) -> Option<MyExtensionKind> {
    match s {
        "package" => Some(MyExtensionKind::Package),
        "mcp" => Some(MyExtensionKind::Mcp),
        "skill" => Some(MyExtensionKind::Skill),
        "plugin" => Some(MyExtensionKind::Plugin),
        "hook" => Some(MyExtensionKind::Hook),
        "script" => Some(MyExtensionKind::Script),
        _ => None,
    }
}

fn capture_one(
    candidate: &DiscoverCandidate,
    repository_path: Option<&str>,
) -> Result<LibraryItem, String> {
    ensure_extension_library_ready()?;
    let id = Uuid::new_v4().to_string();
    let snap_dir = new_item_dir(&id)?;
    let rel_dir = format!("items/{id}");

    let meta_path = snap_dir.join("meta.json");
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&CaptureMeta {
            kind: candidate.kind,
            name: candidate.name.clone(),
            source_path: candidate.source_path.clone(),
            origin_scope: candidate.origin_scope.clone(),
            repository_path: repository_path.map(|s| s.to_string()),
        })
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let source = PathBuf::from(&candidate.source_path);
    match candidate.kind {
        MyExtensionKind::Skill => {
            if source.is_dir() {
                copy_dir_recursive(&source, &snap_dir.join("skill"))?;
            } else if source
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("md"))
            {
                let skill_dir = snap_dir.join("skill");
                fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
                copy_file_to_dir(&source, &skill_dir, "SKILL.md")?;
            } else {
                return Err("技能须为目录或 Markdown（.md）文件".to_string());
            }
        }
        MyExtensionKind::Mcp => {
            capture_mcp_snapshot(&source, &candidate.name, &snap_dir)?;
        }
        MyExtensionKind::Hook => {
            if source.is_file() {
                copy_file_to_dir(&source, &snap_dir, "hooks-settings.json")?;
            }
        }
        MyExtensionKind::Script => {
            if source.is_file() {
                let fname = source
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("script");
                copy_file_to_dir(&source, &snap_dir, fname)?;
            } else if source.is_dir() {
                copy_dir_recursive(&source, &snap_dir.join("script"))?;
            }
        }
        MyExtensionKind::Plugin => {
            if source.is_dir() {
                copy_dir_recursive(&source, &snap_dir.join("plugin"))?;
            }
        }
        MyExtensionKind::Package => {
            return Err("请从扩展市场安装扩展包，或使用「安装示例扩展包」".to_string());
        }
    }

    if candidate.kind == MyExtensionKind::Skill {
        ensure_skill_snapshot_entrypoint(&snap_dir)?;
    }

    if !snapshot_has_editable_content(candidate.kind, &snap_dir) {
        let _ = fs::remove_dir_all(&snap_dir);
        return Err(empty_snapshot_message(candidate.kind));
    }

    let item = LibraryItem {
        id: id.clone(),
        kind: candidate.kind,
        name: candidate.name.clone(),
        description: candidate.description.clone(),
        captured_from_repository: repository_path.map(|s| s.to_string()),
        captured_at: Utc::now().to_rfc3339(),
        origin_scope: Some(candidate.origin_scope.clone()),
        snapshot_dir: rel_dir,
    };
    upsert_item(item)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureMeta {
    kind: MyExtensionKind,
    name: String,
    source_path: String,
    origin_scope: String,
    repository_path: Option<String>,
}

fn capture_mcp_snapshot(settings_path: &Path, server_name: &str, snap_dir: &Path) -> Result<(), String> {
    let raw = fs::read_to_string(settings_path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let entry = extract_mcp_server(&v, server_name)
        .ok_or_else(|| format!("在 {} 中未找到 MCP 服务器 {server_name}", settings_path.display()))?;
    let out = serde_json::json!({
        "serverName": server_name,
        "sourcePathHint": settings_path.display().to_string(),
        "entry": entry,
    });
    fs::write(
        snap_dir.join("mcp-server.json"),
        serde_json::to_string_pretty(&out).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_mcp_server(v: &Value, name: &str) -> Option<Value> {
    let map = v
        .get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))?;
    map.get(name).cloned()
}

fn resolve_repo_relative_path(repo: &str, rel: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = PathBuf::from(repo.trim());
    let root = fs::canonicalize(&root).map_err(|e| format!("无法解析仓库路径: {e}"))?;
    let rel = rel.trim().trim_start_matches('/');
    if rel.is_empty() {
        return Err("请选择一个文件或文件夹".to_string());
    }
    let joined = root.join(rel);
    if !joined.exists() {
        return Err(format!("路径不存在: {}", joined.display()));
    }
    let abs = fs::canonicalize(&joined).unwrap_or(joined);
    if !abs.starts_with(&root) {
        return Err("路径须在仓库内".to_string());
    }
    Ok((root, abs))
}

fn empty_snapshot_message(kind: MyExtensionKind) -> String {
    match kind {
        MyExtensionKind::Skill => {
            "所选目录为空、仅含无效符号链接，或不包含可收录文件；请选含 SKILL.md 或其它文件的目录"
                .to_string()
        }
        MyExtensionKind::Plugin => "所选插件目录为空或无法复制其内容".to_string(),
        MyExtensionKind::Script => "所选脚本路径为空或无法复制其内容".to_string(),
        MyExtensionKind::Hook => "未生成 hooks 快照，请确认 JSON 中含 hooks 配置".to_string(),
        MyExtensionKind::Mcp => "未生成 MCP 快照，请确认配置文件有效".to_string(),
        MyExtensionKind::Package => "扩展包收录不可用".to_string(),
    }
}

fn default_capture_name(abs: &Path) -> String {
    if let Some(stem) = abs.file_stem().and_then(|s| s.to_str()) {
        if abs.extension().is_some_and(|e| e == "json") {
            match stem {
                "settings" => return "project-hooks".to_string(),
                "settings.local" => return "local-hooks".to_string(),
                _ => {}
            }
        }
        return stem.to_string();
    }
    abs.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("extension")
        .to_string()
}

fn validate_capture_shape(kind: MyExtensionKind, path: &Path) -> Result<(), String> {
    match kind {
        MyExtensionKind::Skill => {
            if path.is_dir() {
                return Ok(());
            }
            if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("md")) {
                return Ok(());
            }
            Err("技能须选择目录或 .md 文件".to_string())
        }
        MyExtensionKind::Mcp => {
            if !path.is_file() {
                return Err("MCP 须选择 .mcp.json 或含 mcpServers 的 JSON 配置文件".to_string());
            }
            let v = read_json_object(path)?;
            if mcp_servers_map(&v).is_none() {
                return Err("该 JSON 文件未包含 mcpServers 配置".to_string());
            }
            Ok(())
        }
        MyExtensionKind::Hook => {
            if !path.is_file() {
                return Err("Hooks 须选择 JSON 配置文件（如 .claude/settings.json）".to_string());
            }
            let v = read_json_object(path)?;
            if v.get("hooks")
                .and_then(|x| x.as_object())
                .is_none_or(|m| m.is_empty())
            {
                return Err("该文件未包含非空的 hooks 配置".to_string());
            }
            Ok(())
        }
        MyExtensionKind::Script => {
            if path.is_file() || path.is_dir() {
                Ok(())
            } else {
                Err("脚本须选择文件或目录".to_string())
            }
        }
        MyExtensionKind::Plugin => {
            if path.is_dir() {
                Ok(())
            } else {
                Err("插件须选择目录".to_string())
            }
        }
        MyExtensionKind::Package => Err("不支持扩展包路径录入".to_string()),
    }
}

fn read_json_object(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| format!("JSON 解析失败: {e}"))?;
    if !v.is_object() {
        return Err("JSON 根须为对象".to_string());
    }
    Ok(v)
}

fn mcp_servers_map(v: &Value) -> Option<std::collections::BTreeMap<String, Value>> {
    let obj = v
        .get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))?;
    Some(obj.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
}

fn resolve_mcp_capture(path: &Path, name_hint: Option<&str>) -> Result<(String, PathBuf), String> {
    let v = read_json_object(path)?;
    let map = mcp_servers_map(&v).ok_or_else(|| "该 JSON 文件未包含 mcpServers".to_string())?;
    if map.is_empty() {
        return Err("mcpServers 为空".to_string());
    }
    if let Some(hint) = name_hint.map(str::trim).filter(|s| !s.is_empty()) {
        if map.contains_key(hint) {
            return Ok((hint.to_string(), path.to_path_buf()));
        }
        return Err(format!("未找到 MCP 服务器「{hint}」"));
    }
    if map.len() == 1 {
        let name = map.keys().next().unwrap().clone();
        return Ok((name, path.to_path_buf()));
    }
    let names: Vec<String> = map.keys().cloned().collect();
    Err(format!("{MCP_MULTI_SERVERS_PREFIX}{}", names.join(",")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_capture_name_maps_settings_json() {
        let p = PathBuf::from("/tmp/.claude/settings.json");
        assert_eq!(default_capture_name(&p), "project-hooks");
    }
}
