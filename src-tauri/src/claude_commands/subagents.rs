use super::shared::canonicalize_existing_project_dir;
use crate::subagents_parser::{parse_subagent_markdown, validate_claude_subagent_name};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

// ── Claude Code subagents (.claude/agents/*.md, ~/.claude/agents/*.md) ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeSubagentItem {
    id: String,
    scope: String,
    source_path: String,
    name: String,
    description: String,
    model: Option<String>,
    tools: Vec<String>,
    disallowed_tools: Vec<String>,
    permission_mode: Option<String>,
    memory: Option<String>,
    is_collaboration_mode: bool,
    is_active: bool,
    overridden_by_id: Option<String>,
    updated_at_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeSubagentDetail {
    id: String,
    scope: String,
    source_path: String,
    name: String,
    description: String,
    model: Option<String>,
    tools: Vec<String>,
    disallowed_tools: Vec<String>,
    permission_mode: Option<String>,
    memory: Option<String>,
    frontmatter: String,
    prompt: String,
    raw_content: String,
}

fn project_claude_agents_dir(project_path: &str) -> Result<PathBuf, String> {
    let p = project_path.trim();
    if p.is_empty() {
        return Err("项目路径无效".to_string());
    }
    let root = PathBuf::from(p);
    if !root.is_dir() {
        return Err("项目目录不存在".to_string());
    }
    let canon = fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))?;
    Ok(canon.join(".claude").join("agents"))
}

fn user_claude_agents_dir() -> Result<PathBuf, String> {
    Ok(crate::claude_config_dir::user_claude_dir().join("agents"))
}

fn list_subagent_files_from_dir(scope: &str, dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|x| x.to_str()) else {
            continue;
        };
        if ext.to_lowercase() != "md" {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|x| x.to_str()) else {
            continue;
        };
        if validate_claude_subagent_name(stem).is_err() {
            continue;
        }
        out.push((scope.to_string(), path));
    }
    out
}

fn resolve_subagent_file(
    scope: &str,
    name: &str,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    validate_claude_subagent_name(name)?;
    let base = match scope {
        "project" => {
            let p = project_path
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "project scope 需要 projectPath".to_string())?;
            project_claude_agents_dir(&p)?
        }
        "user" => user_claude_agents_dir()?,
        _ => return Err("scope 仅支持 project / user".to_string()),
    };
    Ok(base.join(format!("{}.md", name)))
}

/// 同名校验：project / user 仍按名称合并覆盖关系；`plugin` 按插件包根路径区分，避免多插件同名冲突。
fn subagent_merge_group_key(scope: &str, agent_md_path: &Path, agent_name: &str) -> String {
    if scope == "plugin" {
        if let Some(agents) = agent_md_path.parent() {
            if agents.file_name().and_then(|n| n.to_str()) == Some("agents") {
                if let Some(plugin_root) = agents.parent() {
                    return format!(
                        "plugin|{}|{}",
                        plugin_root.to_string_lossy().replace('\\', "/"),
                        agent_name
                    );
                }
            }
        }
        return format!("plugin|orphan|{}", agent_name);
    }
    agent_name.to_string()
}

#[tauri::command]
pub(crate) fn list_claude_subagents(
    project_path: Option<String>,
) -> Result<Vec<ClaudeSubagentItem>, String> {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    candidates.extend(list_subagent_files_from_dir(
        "user",
        &user_claude_agents_dir()?,
    ));
    if let Some(project_root) = canonicalize_existing_project_dir(project_path.as_deref()) {
        let project_agents_dir = project_root.join(".claude").join("agents");
        candidates.extend(list_subagent_files_from_dir("project", &project_agents_dir));
    }

    let mut seen_agent_paths: HashSet<String> = HashSet::new();
    candidates.retain(|(_, p)| {
        let k = fs::canonicalize(p)
            .unwrap_or_else(|_| p.clone())
            .to_string_lossy()
            .to_string();
        seen_agent_paths.insert(k)
    });

    let mut by_merge_key: HashMap<String, Vec<ClaudeSubagentItem>> = HashMap::new();
    for (scope, path) in candidates {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = parse_subagent_markdown(&raw) else {
            continue;
        };
        let meta = fs::metadata(&path).ok();
        let updated_at_ms = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let merge_key = subagent_merge_group_key(&scope, &path, &parsed.name);
        let id = if scope == "plugin" {
            merge_key.clone()
        } else {
            format!("{}:{}", scope, parsed.name)
        };
        let item = ClaudeSubagentItem {
            id,
            scope: scope.clone(),
            source_path: path.to_string_lossy().to_string(),
            name: parsed.name.clone(),
            description: parsed.description,
            model: parsed.model,
            tools: parsed.tools,
            disallowed_tools: parsed.disallowed_tools,
            permission_mode: parsed.permission_mode,
            memory: parsed.memory,
            is_collaboration_mode: false,
            is_active: false,
            overridden_by_id: None,
            updated_at_ms,
        };
        by_merge_key.entry(merge_key).or_default().push(item);
    }

    let mut out: Vec<ClaudeSubagentItem> = Vec::new();
    for (_, mut arr) in by_merge_key {
        arr.sort_by_key(|x| match x.scope.as_str() {
            "project" => 0i32,
            "user" => 1i32,
            "plugin" => 2i32,
            _ => 99i32,
        });
        if let Some(first_id) = arr.first().map(|x| x.id.clone()) {
            for (idx, it) in arr.iter_mut().enumerate() {
                if idx == 0 {
                    it.is_active = true;
                    it.overridden_by_id = None;
                } else {
                    it.is_active = false;
                    it.overridden_by_id = Some(first_id.clone());
                }
            }
        }
        out.extend(arr);
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.scope.cmp(&b.scope))
    });
    Ok(out)
}

#[tauri::command]
pub(crate) fn list_claude_available_agents(
    project_path: Option<String>,
) -> Result<Vec<String>, String> {
    let mut cmd = Command::new("claude");
    cmd.arg("agents");
    if let Some(project_root) = canonicalize_existing_project_dir(project_path.as_deref()) {
        cmd.current_dir(project_root);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("执行 claude agents 失败: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(if stderr.trim().is_empty() {
            "claude agents 执行失败".to_string()
        } else {
            format!("claude agents 执行失败: {}", stderr.trim())
        });
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut names: Vec<String> = Vec::new();
    for raw in stdout.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.ends_with("active agents")
            || line.ends_with("agents:")
            || line.ends_with("agents")
            || line == "Plugin agents:"
            || line == "Built-in agents:"
        {
            continue;
        }
        let normalized = line.trim_start_matches('-').trim();
        if normalized.is_empty() {
            continue;
        }
        let name = normalized
            .split_once(" · ")
            .map(|(lhs, _)| lhs.trim())
            .unwrap_or(normalized);
        if !name.is_empty() {
            names.push(name.to_string());
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

#[tauri::command]
pub(crate) fn create_claude_subagent(
    scope: String,
    name: String,
    description: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    validate_claude_subagent_name(&name)?;
    let desc = description.trim().to_string();
    if desc.is_empty() {
        return Err("description 不能为空".to_string());
    }
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if path.exists() {
        return Err(format!("subagent 已存在: {}", name));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = format!(
        "---\nname: {}\ndescription: {}\nmodel: inherit\n---\n\nYou are the {} subagent.\n",
        name, desc, name
    );
    fs::write(path, body).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn get_claude_subagent_detail(
    scope: String,
    name: String,
    project_path: Option<String>,
) -> Result<ClaudeSubagentDetail, String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if !path.is_file() {
        return Err("subagent 文件不存在".to_string());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = parse_subagent_markdown(&raw)?;
    Ok(ClaudeSubagentDetail {
        id: format!("{}:{}", scope, parsed.name),
        scope,
        source_path: path.to_string_lossy().to_string(),
        name: parsed.name,
        description: parsed.description,
        model: parsed.model,
        tools: parsed.tools,
        disallowed_tools: parsed.disallowed_tools,
        permission_mode: parsed.permission_mode,
        memory: parsed.memory,
        frontmatter: parsed.frontmatter,
        prompt: parsed.prompt,
        raw_content: raw,
    })
}

#[tauri::command]
pub(crate) fn save_claude_subagent(
    scope: String,
    name: String,
    raw_content: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    validate_claude_subagent_name(&name)?;
    let parsed = parse_subagent_markdown(&raw_content)?;
    if parsed.name != name {
        return Err("frontmatter.name 必须与文件名一致".to_string());
    }
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, raw_content).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn delete_claude_subagent(
    scope: String,
    name: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if !path.is_file() {
        return Err("subagent 文件不存在".to_string());
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}
