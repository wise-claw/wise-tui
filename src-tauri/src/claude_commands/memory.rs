use super::disk_sessions::encoded_claude_project_dir;
use super::shared::{canonicalize_existing_project_dir, read_json_file};
use crate::project_workspace_paths::expand_tilde_in_path;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeMemorySettingSource {
    scope: String,
    source_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeMemoryFileItem {
    id: String,
    kind: String,
    scope: String,
    label: String,
    source_path: String,
    exists: bool,
    char_count: u64,
    line_count: u64,
    loaded_at_startup: bool,
    path_patterns: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeMemoryStatusResponse {
    auto_memory_enabled: bool,
    auto_memory_enabled_source: ClaudeMemorySettingSource,
    auto_memory_directory: Option<String>,
    auto_memory_directory_source: Option<ClaudeMemorySettingSource>,
    auto_memory_path: String,
    files: Vec<ClaudeMemoryFileItem>,
}

fn settings_path_for_scope(scope: &str, project_root: Option<&Path>) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(crate::claude_config_dir::user_claude_dir().join("settings.json")),
        "project" => {
            let root = project_root.ok_or_else(|| "project scope 需要有效 projectPath".to_string())?;
            Ok(root.join(".claude").join("settings.json"))
        }
        "local" => {
            let root = project_root.ok_or_else(|| "local scope 需要有效 projectPath".to_string())?;
            Ok(root.join(".claude").join("settings.local.json"))
        }
        _ => Err(format!("未知 settings scope: {}", scope)),
    }
}

fn read_bool_setting(path: &Path, key: &str) -> Option<bool> {
    read_json_file(path).and_then(|v| v.get(key).and_then(|x| x.as_bool()))
}

fn read_string_setting(path: &Path, key: &str) -> Option<String> {
    read_json_file(path)
        .and_then(|v| v.get(key).and_then(|x| x.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)))
}

fn resolve_effective_bool_setting(
    key: &str,
    project_root: Option<&Path>,
    default_value: bool,
) -> (bool, ClaudeMemorySettingSource) {
    let scopes = [
        ("local", settings_path_for_scope("local", project_root).ok()),
        ("project", settings_path_for_scope("project", project_root).ok()),
        ("user", settings_path_for_scope("user", None).ok()),
    ];
    for (scope, path) in scopes {
        let Some(path) = path else { continue };
        if let Some(value) = read_bool_setting(&path, key) {
            return (
                value,
                ClaudeMemorySettingSource {
                    scope: scope.to_string(),
                    source_path: path.to_string_lossy().to_string(),
                },
            );
        }
    }
    (
        default_value,
        ClaudeMemorySettingSource {
            scope: "default".to_string(),
            source_path: String::new(),
        },
    )
}

fn resolve_effective_string_setting(
    key: &str,
    project_root: Option<&Path>,
) -> Option<(String, ClaudeMemorySettingSource)> {
    let scopes = [
        ("local", settings_path_for_scope("local", project_root).ok()),
        ("project", settings_path_for_scope("project", project_root).ok()),
        ("user", settings_path_for_scope("user", None).ok()),
    ];
    for (scope, path) in scopes {
        let Some(path) = path else { continue };
        if let Some(value) = read_string_setting(&path, key) {
            return Some((
                value,
                ClaudeMemorySettingSource {
                    scope: scope.to_string(),
                    source_path: path.to_string_lossy().to_string(),
                },
            ));
        }
    }
    None
}

fn resolve_auto_memory_dir(project_root: Option<&Path>) -> Result<PathBuf, String> {
    if let Some((custom, _source)) = resolve_effective_string_setting("autoMemoryDirectory", project_root) {
        let expanded = expand_tilde_in_path(custom.trim());
        return Ok(expanded);
    }
    let Some(root) = project_root else {
        return Ok(crate::claude_config_dir::user_claude_dir().join("projects").join("_no-project_").join("memory"));
    };
    let encoded = encoded_claude_project_dir(root)?;
    Ok(crate::claude_config_dir::user_claude_dir().join("projects").join(encoded).join("memory"))
}

fn stat_markdown_file(path: &Path) -> (bool, u64, u64) {
    if !path.is_file() {
        return (false, 0, 0);
    }
    let Ok(meta) = fs::metadata(path) else {
        return (false, 0, 0);
    };
    let Ok(content) = fs::read_to_string(path) else {
        return (true, meta.len() as u64, 0);
    };
    let line_count = content.lines().count() as u64;
    (true, content.len() as u64, line_count)
}

fn parse_rule_path_patterns(content: &str) -> Vec<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Vec::new();
    }
    let Some(end) = trimmed[3..].find("\n---") else {
        return Vec::new();
    };
    let frontmatter = &trimmed[3..3 + end];
    let mut out = Vec::new();
    let mut in_paths = false;
    for line in frontmatter.lines() {
        let t = line.trim();
        if t.starts_with("paths:") {
            in_paths = true;
            let inline = t.strip_prefix("paths:").unwrap_or("").trim();
            if inline.starts_with('[') && inline.ends_with(']') {
                let inner = inline.trim_start_matches('[').trim_end_matches(']');
                for part in inner.split(',') {
                    let p = part.trim().trim_matches('"').trim_matches('\'');
                    if !p.is_empty() {
                        out.push(p.to_string());
                    }
                }
                in_paths = false;
            }
            continue;
        }
        if in_paths {
            if t.starts_with("- ") {
                let p = t[2..].trim().trim_matches('"').trim_matches('\'');
                if !p.is_empty() {
                    out.push(p.to_string());
                }
                continue;
            }
            if !t.is_empty() && !t.starts_with('-') {
                in_paths = false;
            }
        }
    }
    out
}

fn push_instruction_candidate(
    files: &mut Vec<ClaudeMemoryFileItem>,
    scope: &str,
    path: PathBuf,
    label: &str,
) {
    let (exists, char_count, line_count) = stat_markdown_file(&path);
    files.push(ClaudeMemoryFileItem {
        id: format!("instruction:{}:{}", scope, path.to_string_lossy()),
        kind: "instruction".to_string(),
        scope: scope.to_string(),
        label: label.to_string(),
        source_path: path.to_string_lossy().to_string(),
        exists,
        char_count,
        line_count,
        loaded_at_startup: true,
        path_patterns: Vec::new(),
    });
}

fn push_rules_dir_anchor(
    files: &mut Vec<ClaudeMemoryFileItem>,
    scope: &str,
    dir: &Path,
    label: &str,
) {
    let exists = dir.is_dir();
    files.push(ClaudeMemoryFileItem {
        id: format!("rule_dir:{}:{}", scope, dir.to_string_lossy()),
        kind: "rule".to_string(),
        scope: scope.to_string(),
        label: label.to_string(),
        source_path: dir.to_string_lossy().to_string(),
        exists,
        char_count: 0,
        line_count: 0,
        loaded_at_startup: false,
        path_patterns: Vec::new(),
    });
}

fn collect_rule_files_from_dir(
    files: &mut Vec<ClaudeMemoryFileItem>,
    scope: &str,
    dir: &Path,
) {
    if !dir.is_dir() {
        return;
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("md")) != Some(true) {
                continue;
            }
            let (exists, char_count, line_count) = stat_markdown_file(&path);
            let content = if exists {
                fs::read_to_string(&path).unwrap_or_default()
            } else {
                String::new()
            };
            let path_patterns = parse_rule_path_patterns(&content);
            let label = path
                .strip_prefix(dir)
                .ok()
                .and_then(|p| p.to_str())
                .unwrap_or_else(|| path.file_name().and_then(|x| x.to_str()).unwrap_or("rule.md"))
                .replace('\\', "/");
            files.push(ClaudeMemoryFileItem {
                id: format!("rule:{}:{}", scope, path.to_string_lossy()),
                kind: "rule".to_string(),
                scope: scope.to_string(),
                label,
                source_path: path.to_string_lossy().to_string(),
                exists,
                char_count,
                line_count,
                loaded_at_startup: path_patterns.is_empty(),
                path_patterns,
            });
        }
    }
}

fn collect_rules_scope(
    files: &mut Vec<ClaudeMemoryFileItem>,
    scope: &str,
    dir: &Path,
    label: &str,
) {
    push_rules_dir_anchor(files, scope, dir, label);
    collect_rule_files_from_dir(files, scope, dir);
}

fn collect_auto_memory_files(files: &mut Vec<ClaudeMemoryFileItem>, memory_dir: &Path) {
    if !memory_dir.is_dir() {
        let memory_md = memory_dir.join("MEMORY.md");
        let (exists, char_count, line_count) = stat_markdown_file(&memory_md);
        files.push(ClaudeMemoryFileItem {
            id: format!("auto_memory:{}", memory_md.to_string_lossy()),
            kind: "auto_memory".to_string(),
            scope: "auto".to_string(),
            label: "MEMORY.md".to_string(),
            source_path: memory_md.to_string_lossy().to_string(),
            exists,
            char_count,
            line_count,
            loaded_at_startup: true,
            path_patterns: Vec::new(),
        });
        return;
    }

    let mut md_files: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(memory_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x.eq_ignore_ascii_case("md"))
                    == Some(true)
            {
                md_files.push(path);
            }
        }
    }
    md_files.sort_by(|a, b| {
        let a_mem = a.file_name().and_then(|x| x.to_str()) == Some("MEMORY.md");
        let b_mem = b.file_name().and_then(|x| x.to_str()) == Some("MEMORY.md");
        b_mem.cmp(&a_mem).then_with(|| a.cmp(b))
    });
    for path in md_files {
        let (exists, char_count, line_count) = stat_markdown_file(&path);
        let label = path
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("memory.md")
            .to_string();
        let loaded_at_startup = label == "MEMORY.md";
        files.push(ClaudeMemoryFileItem {
            id: format!("auto_memory:{}", path.to_string_lossy()),
            kind: "auto_memory".to_string(),
            scope: "auto".to_string(),
            label,
            source_path: path.to_string_lossy().to_string(),
            exists,
            char_count,
            line_count,
            loaded_at_startup,
            path_patterns: Vec::new(),
        });
    }
}

#[tauri::command]
pub(crate) fn get_claude_memory_status(
    project_path: Option<String>,
) -> Result<ClaudeMemoryStatusResponse, String> {
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let (auto_memory_enabled, auto_memory_enabled_source) =
        resolve_effective_bool_setting("autoMemoryEnabled", project_root.as_deref(), true);
    let auto_memory_directory_source =
        resolve_effective_string_setting("autoMemoryDirectory", project_root.as_deref())
            .map(|(_value, source)| source);
    let auto_memory_directory = resolve_effective_string_setting(
        "autoMemoryDirectory",
        project_root.as_deref(),
    )
    .map(|(value, _source)| value);
    let auto_memory_path = resolve_auto_memory_dir(project_root.as_deref())?
        .to_string_lossy()
        .to_string();

    let mut files: Vec<ClaudeMemoryFileItem> = Vec::new();
    let user_claude = crate::claude_config_dir::user_claude_dir();
    push_instruction_candidate(
        &mut files,
        "user",
        user_claude.join("CLAUDE.md"),
        "CLAUDE.md",
    );
    collect_rules_scope(
        &mut files,
        "user",
        &user_claude.join("rules"),
        "~/.claude/rules/",
    );

    if let Some(root) = project_root.as_ref() {
        push_instruction_candidate(&mut files, "project", root.join("CLAUDE.md"), "CLAUDE.md");
        push_instruction_candidate(
            &mut files,
            "project",
            root.join(".claude").join("CLAUDE.md"),
            ".claude/CLAUDE.md",
        );
        push_instruction_candidate(
            &mut files,
            "local",
            root.join("CLAUDE.local.md"),
            "CLAUDE.local.md",
        );
        push_instruction_candidate(&mut files, "project", root.join("AGENTS.md"), "AGENTS.md");
        collect_rules_scope(
            &mut files,
            "project",
            &root.join(".claude").join("rules"),
            ".claude/rules/",
        );

        let legacy = root.join(".claude").join("project-memory.md");
        let (exists, char_count, line_count) = stat_markdown_file(&legacy);
        if exists {
            files.push(ClaudeMemoryFileItem {
                id: format!("legacy:{}", legacy.to_string_lossy()),
                kind: "legacy".to_string(),
                scope: "project".to_string(),
                label: ".claude/project-memory.md".to_string(),
                source_path: legacy.to_string_lossy().to_string(),
                exists,
                char_count,
                line_count,
                loaded_at_startup: false,
                path_patterns: Vec::new(),
            });
        }
    }

    collect_auto_memory_files(&mut files, Path::new(&auto_memory_path));

    Ok(ClaudeMemoryStatusResponse {
        auto_memory_enabled,
        auto_memory_enabled_source,
        auto_memory_directory,
        auto_memory_directory_source,
        auto_memory_path,
        files,
    })
}

#[tauri::command]
pub(crate) fn ensure_claude_rules_dir(
    scope: String,
    project_path: Option<String>,
) -> Result<String, String> {
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let dir = match scope.trim() {
        "user" => crate::claude_config_dir::user_claude_dir().join("rules"),
        "project" => {
            let root = project_root.ok_or_else(|| "project scope 需要有效 projectPath".to_string())?;
            root.join(".claude").join("rules")
        }
        _ => return Err(format!("未知 rules scope: {}", scope.trim())),
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn set_claude_auto_memory_enabled(
    scope: String,
    enabled: bool,
    project_path: Option<String>,
) -> Result<(), String> {
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let path = settings_path_for_scope(scope.trim(), project_root.as_deref())?;
    let mut root = super::ensure_json_object(&path)?;
    root["autoMemoryEnabled"] = serde_json::Value::Bool(enabled);
    super::write_json_pretty(&path, &root)
}

#[tauri::command]
pub(crate) fn save_claude_auto_memory_file(
    project_path: Option<String>,
    content: String,
) -> Result<String, String> {
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let memory_dir = resolve_auto_memory_dir(project_root.as_deref())?;
    fs::create_dir_all(&memory_dir).map_err(|e| e.to_string())?;
    let path = memory_dir.join("MEMORY.md");
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn read_claude_auto_memory_file(project_path: Option<String>) -> Result<String, String> {
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let memory_dir = resolve_auto_memory_dir(project_root.as_deref())?;
    let path = memory_dir.join("MEMORY.md");
    if !path.is_file() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rule_path_patterns_reads_yaml_list() {
        let content = r#"---
paths:
  - "src/**/*.ts"
  - lib/**/*.rs
---

# Rule
"#;
        let patterns = parse_rule_path_patterns(content);
        assert_eq!(patterns, vec!["src/**/*.ts", "lib/**/*.rs"]);
    }

    #[test]
    fn resolve_auto_memory_dir_uses_encoded_project_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let project = dir.path().join("repo");
        fs::create_dir_all(&project).expect("mkdir project");
        let encoded = encoded_claude_project_dir(&project).expect("encode");
        let resolved = resolve_auto_memory_dir(Some(&project)).expect("resolve");
        assert!(resolved
            .to_string_lossy()
            .ends_with(&format!("projects/{encoded}/memory")));
    }
}
