//! Discover MCP / skills / hooks / plugins / scripts in a repository for library capture.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use super::inventory::MyExtensionKind;
use super::library::{find_by_name_kind, list_items};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverCandidate {
    pub candidate_id: String,
    pub kind: MyExtensionKind,
    pub name: String,
    pub description: Option<String>,
    pub source_path: String,
    pub origin_scope: String,
    pub already_in_library: bool,
}

pub fn discover_in_repository(repository_path: &str) -> Result<Vec<DiscoverCandidate>, String> {
    let repo = repository_path.trim();
    if repo.is_empty() {
        return Err("仓库路径无效".to_string());
    }
    let root = PathBuf::from(repo);
    if !root.is_dir() {
        return Err("仓库目录不存在".to_string());
    }

    let mut out: Vec<DiscoverCandidate> = Vec::new();
    let library = list_items().unwrap_or_default();

    discover_project_skills(&mut out, &library, &root)?;
    discover_project_mcp(&mut out, &library, &root)?;
    discover_project_hooks(&mut out, &library, &root)?;
    discover_plugins_and_scripts(&mut out, &library, &root)?;

    out.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

fn push_candidate(
    out: &mut Vec<DiscoverCandidate>,
    library: &[super::library::LibraryItem],
    kind: MyExtensionKind,
    name: &str,
    description: Option<String>,
    source_path: PathBuf,
    origin_scope: &str,
) {
    let already = library.iter().any(|i| i.kind == kind && i.name == name)
        || find_by_name_kind(name, kind).is_some();
    out.push(DiscoverCandidate {
        candidate_id: format!("{kind:?}:{name}:{}", source_path.display()),
        kind,
        name: name.to_string(),
        description,
        source_path: source_path.display().to_string(),
        origin_scope: origin_scope.to_string(),
        already_in_library: already,
    });
}

fn discover_project_skills(
    out: &mut Vec<DiscoverCandidate>,
    library: &[super::library::LibraryItem],
    root: &Path,
) -> Result<(), String> {
    let skills_dir = root.join(".claude").join("skills");
    if !skills_dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let desc = if path.join("SKILL.md").is_file() {
            Some("项目 .claude/skills 技能".to_string())
        } else {
            Some("项目技能目录".to_string())
        };
        push_candidate(out, library, MyExtensionKind::Skill, &name, desc, path, "project");
    }
    Ok(())
}

fn discover_project_mcp(
    out: &mut Vec<DiscoverCandidate>,
    library: &[super::library::LibraryItem],
    root: &Path,
) -> Result<(), String> {
    let mcp_json = root.join(".mcp.json");
    if mcp_json.is_file() {
        if let Ok(v) = read_json_object(&mcp_json) {
            push_mcp_from_settings(out, library, &v, &mcp_json, "project");
        }
    }
    let settings = root.join(".claude").join("settings.json");
    if settings.is_file() {
        if let Ok(v) = read_json_object(&settings) {
            push_mcp_from_settings(out, library, &v, &settings, "legacy_project_settings");
        }
    }
    Ok(())
}

fn push_mcp_from_settings(
    out: &mut Vec<DiscoverCandidate>,
    library: &[super::library::LibraryItem],
    v: &Value,
    path: &Path,
    scope: &str,
) {
    let Some(map) = v
        .get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))
    else {
        return;
    };
    for (name, _cfg) in map {
        push_candidate(
            out,
            library,
            MyExtensionKind::Mcp,
            name,
            Some(format!("MCP · {scope}")),
            path.to_path_buf(),
            scope,
        );
    }
}

fn discover_project_hooks(
    out: &mut Vec<DiscoverCandidate>,
    library: &[super::library::LibraryItem],
    root: &Path,
) -> Result<(), String> {
    for (file, label, scope) in [
        (
            root.join(".claude").join("settings.json"),
            "项目 hooks（settings.json）",
            "project",
        ),
        (
            root.join(".claude").join("settings.local.json"),
            "本地 hooks（settings.local.json）",
            "local",
        ),
    ] {
        if !file.is_file() {
            continue;
        }
        let Ok(v) = read_json_object(&file) else {
            continue;
        };
        if v.get("hooks").and_then(|x| x.as_object()).is_some_and(|m| !m.is_empty()) {
            push_candidate(
                out,
                library,
                MyExtensionKind::Hook,
                &format!("{scope}-hooks"),
                Some(label.to_string()),
                file,
                scope,
            );
        }
    }

    let hooks_dir = root.join(".claude").join("hooks");
    if hooks_dir.is_dir() {
        let has_hooks_json = hooks_dir.join("hooks.json").is_file();
        let has_scripts = fs::read_dir(&hooks_dir)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| {
                let path = entry.path();
                if !path.is_file() {
                    return false;
                }
                let name = entry.file_name().to_string_lossy().to_lowercase();
                name.ends_with(".py")
                    || name.ends_with(".sh")
                    || name.ends_with(".bash")
                    || name.ends_with(".zsh")
                    || name.ends_with(".js")
                    || name.ends_with(".ts")
            });
        if has_hooks_json || has_scripts {
            push_candidate(
                out,
                library,
                MyExtensionKind::Hook,
                "project-hooks-dir",
                Some("项目 hooks 目录（.claude/hooks）".to_string()),
                hooks_dir,
                "project",
            );
        }
    }
    Ok(())
}

fn discover_plugins_and_scripts(
    out: &mut Vec<DiscoverCandidate>,
    library: &[super::library::LibraryItem],
    root: &Path,
) -> Result<(), String> {
    if let Some(cache) = dirs::home_dir().map(|h| h.join(".claude").join("plugins").join("cache")) {
        if cache.is_dir() {
            for entry in fs::read_dir(&cache).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    push_candidate(
                        out,
                        library,
                        MyExtensionKind::Plugin,
                        &name,
                        Some("Claude 插件缓存（只读参考，安装需走插件市场）".to_string()),
                        path,
                        "plugin-cache",
                    );
                }
            }
        }
    }

    for dir in [
        root.join(".wise").join("my-extensions").join("scripts"),
        root.join(".trellis").join("scripts"),
    ] {
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            push_candidate(
                out,
                library,
                MyExtensionKind::Script,
                &name,
                Some("仓库脚本".to_string()),
                path,
                "repository",
            );
        }
    }
    Ok(())
}

fn read_json_object(path: &Path) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if !v.is_object() {
        return Err("JSON 根须为对象".to_string());
    }
    Ok(v)
}
