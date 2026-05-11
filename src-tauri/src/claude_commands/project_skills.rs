use super::mcp::discover_plugin_roots_under_claude_cache;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

// ── Claude Code project skills (.claude/skills/{name}/SKILL.md) ──

pub(crate) fn validate_claude_skill_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("技能名称不能为空".to_string());
    }
    if name.len() > 128 {
        return Err("技能名称过长（最多 128 字符）".to_string());
    }
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        return Err("仅允许 ASCII 字母、数字、下划线与连字符".to_string());
    }
    Ok(())
}

fn project_claude_skills_dir(project_path: &str) -> Result<PathBuf, String> {
    let p = project_path.trim();
    if p.is_empty() {
        return Err("项目路径无效".to_string());
    }
    let root = PathBuf::from(p);
    if !root.is_dir() {
        return Err("项目目录不存在".to_string());
    }
    let canon = fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))?;
    Ok(canon.join(".claude").join("skills"))
}

fn skill_preview_from_markdown(text: &str) -> Option<String> {
    let mut in_frontmatter = false;
    let mut frontmatter_started = false;

    for line in text.lines() {
        let t = line.trim();
        if !frontmatter_started && t == "---" {
            in_frontmatter = true;
            frontmatter_started = true;
            continue;
        }
        if in_frontmatter {
            if t == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        if t.is_empty() {
            continue;
        }
        let s = t.strip_prefix('#').map(str::trim).unwrap_or(t);
        if s.is_empty() {
            continue;
        }
        let mut out: String = s.chars().take(100).collect();
        if s.chars().count() > 100 {
            out.push('…');
        }
        return Some(out);
    }
    None
}

/// frontmatter 顶层的 `key:` 行（无缩进），用于块标量结束判断。
fn skill_frontmatter_root_key_line(line: &str) -> bool {
    let t = line.trim_start();
    if t.is_empty() || t.starts_with('#') {
        return false;
    }
    if line.starts_with(' ') || line.starts_with('\t') {
        return false;
    }
    let Some((k, _)) = t.split_once(':') else {
        return false;
    };
    let k = k.trim();
    !k.is_empty()
        && k.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 将块标量各行去掉公共前导空白；`fold` 为 true 时按 YAML `>` 的简化语义把行合并为单段空格分隔。
fn skill_description_format_block(lines: &[String], fold: bool) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let non_empty: Vec<&String> = lines.iter().filter(|l| !l.trim().is_empty()).collect();
    let min_indent = if non_empty.is_empty() {
        0usize
    } else {
        non_empty
            .iter()
            .map(|l| l.chars().take_while(|c| *c == ' ' || *c == '\t').count())
            .min()
            .unwrap_or(0)
    };
    let dedented: Vec<String> = lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                l.chars().skip(min_indent).collect::<String>()
            }
        })
        .collect();
    if fold {
        dedented
            .iter()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        dedented.join("\n")
    }
}

/// `SKILL.md` 首段 YAML frontmatter 中的 `description:`（与 Claude Code 技能约定一致）。
/// 支持：单行标量、引号包裹、`|` / `|-` / `>` / `>-` 块标量、以及 `description:` 后仅缩进续行（隐式块）。
fn parse_skill_md_frontmatter_description(text: &str) -> Option<String> {
    let normalized = text.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return None;
    }
    let mut end_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            end_idx = Some(i);
            break;
        }
    }
    let e = end_idx?;
    let fm: &[&str] = &lines[1..e];

    for (idx, line) in fm.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((k, rest)) = t.split_once(':') else {
            continue;
        };
        if k.trim() != "description" {
            continue;
        }

        let mut first = rest;
        if let Some(pos) = first.find(" #") {
            first = &first[..pos];
        }
        let first_trim = first.trim();

        if first_trim.starts_with('|') || first_trim.starts_with('>') {
            let fold = first_trim.starts_with('>');
            let mut raw: Vec<String> = Vec::new();
            for ln in fm.iter().skip(idx + 1) {
                if skill_frontmatter_root_key_line(ln) {
                    break;
                }
                raw.push((*ln).to_string());
            }
            let out = skill_description_format_block(&raw, fold);
            let out = out.trim().to_string();
            if !out.is_empty() {
                return Some(out);
            }
            continue;
        }

        if first_trim.is_empty() {
            let mut raw: Vec<String> = Vec::new();
            for ln in fm.iter().skip(idx + 1) {
                if skill_frontmatter_root_key_line(ln) {
                    break;
                }
                if ln.trim().is_empty() {
                    if raw.is_empty() {
                        continue;
                    }
                    raw.push(String::new());
                    continue;
                }
                let indent = ln.chars().take_while(|c| *c == ' ' || *c == '\t').count();
                if indent == 0 && !raw.is_empty() {
                    break;
                }
                raw.push((*ln).to_string());
            }
            let out = skill_description_format_block(&raw, false);
            let out = out.trim().to_string();
            if !out.is_empty() {
                return Some(out);
            }
            continue;
        }

        let mut val = first_trim.to_string();
        if val.len() >= 2
            && ((val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\'')))
        {
            val = val[1..val.len() - 1].trim().to_string();
        } else if let Some(i) = val.find(" #") {
            val = val[..i].trim_end().to_string();
        }
        if !val.is_empty() {
            return Some(val);
        }
    }
    None
}

fn read_claude_skill_entry(skill_dir: &Path) -> (bool, Option<String>) {
    let md = skill_dir.join("SKILL.md");
    if !md.is_file() {
        return (false, None);
    }
    let Ok(text) = fs::read_to_string(&md) else {
        return (true, None);
    };
    let desc = parse_skill_md_frontmatter_description(&text)
        .or_else(|| skill_preview_from_markdown(&text));
    (true, desc)
}

fn count_skill_files_recursive(dir: &Path) -> usize {
    let mut total = 0usize;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        let p = entry.path();
        if ft.is_file() {
            total += 1;
        } else if ft.is_dir() {
            total += count_skill_files_recursive(&p);
        }
    }
    total
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeProjectSkill {
    name: String,
    has_skill_md: bool,
    description: Option<String>,
    file_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_cache_rel_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_cache_root: Option<String>,
}

fn list_claude_skills_under_dir(skills_dir: &Path) -> Result<Vec<ClaudeProjectSkill>, String> {
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_claude_skill_name(&name).is_err() {
            continue;
        }
        let (has_skill_md, description) = read_claude_skill_entry(&entry.path());
        let file_count = count_skill_files_recursive(&entry.path());
        out.push(ClaudeProjectSkill {
            name,
            has_skill_md,
            description,
            file_count,
            plugin_cache_rel_path: None,
            plugin_cache_root: None,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub(crate) fn list_claude_project_skills(
    project_path: String,
) -> Result<Vec<ClaudeProjectSkill>, String> {
    let skills_dir = project_claude_skills_dir(&project_path)?;
    list_claude_skills_under_dir(&skills_dir)
}

/// 用户级 `~/.claude/skills/`（与官方 `skills` CLI `-g` 一致）。
#[tauri::command]
pub(crate) fn list_claude_user_skills() -> Result<Vec<ClaudeProjectSkill>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let skills_dir = home.join(".claude").join("skills");
    list_claude_skills_under_dir(&skills_dir)
}

#[tauri::command]
pub(crate) fn list_claude_plugin_cache_skills() -> Result<Vec<ClaudeProjectSkill>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let mut out: Vec<ClaudeProjectSkill> = Vec::new();
    for (plugin_rel, root) in discover_plugin_roots_under_claude_cache(&home) {
        let skills_dir = root.join("skills");
        if !skills_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if validate_claude_skill_name(&name).is_err() {
                continue;
            }
            let (has_skill_md, description) = read_claude_skill_entry(&entry.path());
            let file_count = count_skill_files_recursive(&entry.path());
            let root_str = root.to_string_lossy().to_string();
            out.push(ClaudeProjectSkill {
                name,
                has_skill_md,
                description,
                file_count,
                plugin_cache_rel_path: Some(plugin_rel.clone()),
                plugin_cache_root: Some(root_str),
            });
        }
    }
    out.sort_by(|a, b| {
        let ar = a.plugin_cache_rel_path.as_deref().unwrap_or("");
        let br = b.plugin_cache_rel_path.as_deref().unwrap_or("");
        ar.cmp(br)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub(crate) fn create_claude_project_skill(
    project_path: String,
    skill_name: String,
) -> Result<(), String> {
    validate_claude_skill_name(&skill_name)?;
    let skill_name = skill_name.trim().to_string();
    let skills_dir = project_claude_skills_dir(&project_path)?;
    let target = skills_dir.join(&skill_name);
    if target.exists() {
        return Err(format!("技能已存在: {}", skill_name));
    }
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    let body = format!(
        "---\nname: {}\ndescription: 在此填写技能简介\n---\n\n# {}\n\n在此编写技能说明。\n",
        skill_name, skill_name
    );
    fs::write(target.join("SKILL.md"), body).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_claude_project_skill(
    project_path: String,
    skill_name: String,
) -> Result<(), String> {
    validate_claude_skill_name(&skill_name)?;
    let skill_name = skill_name.trim().to_string();
    let skills_dir = project_claude_skills_dir(&project_path)?;
    let target = skills_dir.join(&skill_name);
    if !target.is_dir() {
        return Err(format!("未找到技能: {}", skill_name));
    }
    let skills_canon = fs::canonicalize(&skills_dir).map_err(|e| e.to_string())?;
    let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&skills_canon) {
        return Err("路径校验失败".to_string());
    }
    fs::remove_dir_all(&target_canon).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeProjectSkillFileEntry {
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
}

fn project_claude_skill_dir(project_path: &str, skill_name: &str) -> Result<PathBuf, String> {
    validate_claude_skill_name(skill_name)?;
    let skill_name = skill_name.trim();
    let skills_dir = project_claude_skills_dir(project_path)?;
    let target = skills_dir.join(skill_name);
    if !target.is_dir() {
        return Err(format!("未找到技能: {}", skill_name));
    }
    let skills_canon = fs::canonicalize(&skills_dir).map_err(|e| e.to_string())?;
    let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&skills_canon) {
        return Err("路径校验失败".to_string());
    }
    Ok(target_canon)
}

fn parse_skill_relative_path(rel: &str) -> Result<Vec<String>, String> {
    let s = rel.trim().replace('\\', "/");
    if s.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if s.len() > 512 {
        return Err("路径过长".to_string());
    }
    let parts: Vec<&str> = s.split('/').filter(|x| !x.is_empty()).collect();
    if parts.is_empty() {
        return Err("路径不能为空".to_string());
    }
    for p in &parts {
        if *p == "." || *p == ".." {
            return Err("路径中含非法段".to_string());
        }
    }
    Ok(parts.into_iter().map(|x| x.to_string()).collect())
}

fn skill_join_parts(skill_root: &Path, parts: &[String]) -> PathBuf {
    let mut out = skill_root.to_path_buf();
    for seg in parts {
        out.push(seg);
    }
    out
}

#[tauri::command]
pub(crate) fn list_claude_project_skill_files(
    project_path: String,
    skill_name: String,
) -> Result<Vec<ClaudeProjectSkillFileEntry>, String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let mut out = Vec::new();

    fn walk(
        root: &Path,
        dir: &Path,
        out: &mut Vec<ClaudeProjectSkillFileEntry>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
            let rel = path
                .strip_prefix(root)
                .map_err(|_| "路径前缀异常".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if meta.is_dir() {
                out.push(ClaudeProjectSkillFileEntry {
                    path: rel,
                    is_dir: true,
                    size_bytes: None,
                });
                walk(root, &path, out)?;
            } else if meta.is_file() {
                out.push(ClaudeProjectSkillFileEntry {
                    path: rel,
                    is_dir: false,
                    size_bytes: Some(meta.len()),
                });
            }
        }
        Ok(())
    }

    walk(&skill_root, &skill_root, &mut out)?;
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub(crate) fn get_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
) -> Result<String, String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let path = skill_join_parts(&skill_root, &parts);
    if !path.is_file() {
        return Err("不是文件或文件不存在".to_string());
    }
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with(&skill_root) {
        return Err("路径越界".to_string());
    }
    fs::read_to_string(&canon).map_err(|_| "文件不是 UTF-8 文本或无法读取".to_string())
}

#[tauri::command]
pub(crate) fn save_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let path = skill_join_parts(&skill_root, &parts);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with(&skill_root) {
        return Err("路径越界".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
) -> Result<(), String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let path = skill_join_parts(&skill_root, &parts);
    if !path.exists() {
        return Err("路径不存在".to_string());
    }
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with(&skill_root) {
        return Err("路径越界".to_string());
    }
    let meta = fs::metadata(&canon).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(&canon).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&canon).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn run_formatter_command(bin: &str, args: &[&str], input: &str) -> Result<String, String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|_| format!("未找到格式化工具：{}", bin))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("写入格式化器 stdin 失败: {}", e))?;
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("等待格式化器输出失败: {}", e))?;

    if out.status.success() {
        String::from_utf8(out.stdout).map_err(|_| "格式化输出不是 UTF-8 文本".to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.is_empty() {
            Err(format!("格式化失败：{}", bin))
        } else {
            Err(err)
        }
    }
}

#[tauri::command]
pub(crate) fn format_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
    content: String,
) -> Result<String, String> {
    let _skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let rel = parts.join("/");
    let ext = Path::new(&rel)
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| x.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "md" | "markdown" | "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "json" | "yml"
        | "yaml" => run_formatter_command("prettier", &["--stdin-filepath", &rel], &content),
        "py" => run_formatter_command("ruff", &["format", "-"], &content),
        "sh" | "bash" | "zsh" => run_formatter_command("shfmt", &[], &content),
        _ => Err("该文件类型暂不支持格式化（支持 md/js/py/sh）".to_string()),
    }
}
