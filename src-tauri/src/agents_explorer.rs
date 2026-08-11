//! `.agents` 目录探索：命令 / 技能 / 智能体 / 其他资产。
//!
//! 以只读方式扫描仓库根目录的 `.agents`（Claude Code / Codex / opencode
//! 等引擎共用的命令、技能、智能体约定目录），供「Agents 探索」面板浏览。
//! 不修改、不迁移任何既有数据，属于探索性 Hub 表面。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 预览文件内容的最大字符数（超过截断并在 UI 标注）。
const MAX_PREVIEW_CHARS: usize = 200_000;

const AGENTS_DIR_NAME: &str = ".agents";
const COMMANDS_DIR_NAME: &str = "commands";
const SKILLS_DIR_NAME: &str = "skills";
const AGENTS_DIR_NAME_INNER: &str = "agents";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsCommandEntry {
    /// 命令名（含子目录，如 `review/pr`；不含 `.md` 后缀）。
    pub name: String,
    /// 相对 `.agents` 的路径，如 `commands/review.md`。
    pub rel_path: String,
    /// 绝对路径。
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argument_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsSkillEntry {
    /// 技能名（目录名）。
    pub name: String,
    /// 相对 `.agents` 的路径，如 `skills/weather/SKILL.md`。
    pub rel_path: String,
    /// 绝对路径。
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsAgentEntry {
    /// 智能体名（frontmatter `name`，缺省回退文件名）。
    pub name: String,
    /// 相对 `.agents` 的路径，如 `agents/tester.md`。
    pub rel_path: String,
    /// 绝对路径。
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsOtherEntry {
    /// 名称（文件或目录名）。
    pub name: String,
    /// 相对 `.agents` 的路径。
    pub rel_path: String,
    /// 绝对路径。
    pub path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsDirectoryScan {
    /// `.agents` 绝对路径；目录不存在时为 `None`。
    pub root_path: Option<String>,
    pub exists: bool,
    pub commands: Vec<AgentsCommandEntry>,
    pub skills: Vec<AgentsSkillEntry>,
    pub agents: Vec<AgentsAgentEntry>,
    pub others: Vec<AgentsOtherEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsFileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentsFilePathArg {
    pub path: String,
}

#[tauri::command]
pub fn agents_explorer_scan(repository_path: String) -> Result<AgentsDirectoryScan, String> {
    let root = resolve_repository_root(&repository_path)?;
    let agents_root = root.join(AGENTS_DIR_NAME);
    if !agents_root.is_dir() {
        return Ok(AgentsDirectoryScan {
            root_path: None,
            exists: false,
            commands: Vec::new(),
            skills: Vec::new(),
            agents: Vec::new(),
            others: Vec::new(),
        });
    }

    let commands = scan_commands(&agents_root);
    let skills = scan_skills(&agents_root);
    let agents = scan_agents(&agents_root);
    let others = scan_others(&agents_root);

    Ok(AgentsDirectoryScan {
        root_path: Some(agents_root.to_string_lossy().to_string()),
        exists: true,
        commands,
        skills,
        agents,
        others,
    })
}

#[tauri::command]
pub fn agents_explorer_read_file(arg: AgentsFilePathArg) -> Result<AgentsFileContent, String> {
    let p = PathBuf::from(arg.path);
    if !p.is_file() {
        return Err("文件不存在或不可读".to_string());
    }
    if !is_under_agents_dir(&p) {
        return Err("仅允许读取 .agents 目录内的文件".to_string());
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("读取文件失败: {e}"))?;
    let truncated = raw.chars().count() > MAX_PREVIEW_CHARS;
    let content: String = raw.chars().take(MAX_PREVIEW_CHARS).collect();
    Ok(AgentsFileContent {
        path: p.to_string_lossy().to_string(),
        content,
        truncated,
    })
}

// ── 扫描实现 ──────────────────────────────────────────────────────────────

fn resolve_repository_root(repository_path: &str) -> Result<PathBuf, String> {
    let raw = repository_path.trim();
    if raw.is_empty() {
        return Err("仓库路径为空".to_string());
    }
    let p = PathBuf::from(raw);
    if !p.is_dir() {
        return Err("仓库目录不存在".to_string());
    }
    fs::canonicalize(&p).map_err(|e| format!("无法解析仓库路径: {e}"))
}

fn rel_path_for(agents_root: &Path, path: &Path) -> String {
    path.strip_prefix(agents_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn scan_commands(agents_root: &Path) -> Vec<AgentsCommandEntry> {
    let commands_dir = agents_root.join(COMMANDS_DIR_NAME);
    let mut out = Vec::new();
    collect_command_markdown(&commands_dir, agents_root, &mut out);
    out.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    out
}

fn collect_command_markdown(dir: &Path, agents_root: &Path, out: &mut Vec<AgentsCommandEntry>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            subdirs.push(p);
            continue;
        }
        if !ft.is_file() || !is_markdown(&p) {
            continue;
        }
        let rel = rel_path_for(agents_root, &p);
        let name = markdown_stem(&rel);
        let meta = read_markdown_meta(&p);
        out.push(AgentsCommandEntry {
            name,
            rel_path: rel,
            path: p.to_string_lossy().to_string(),
            description: meta.description,
            allowed_tools: meta.strings.get("allowed-tools").cloned(),
            model: meta.strings.get("model").cloned(),
            argument_hint: meta.strings.get("argument-hint").cloned(),
        });
    }
    subdirs.sort();
    for sub in subdirs {
        collect_command_markdown(&sub, agents_root, out);
    }
}

fn scan_skills(agents_root: &Path) -> Vec<AgentsSkillEntry> {
    let skills_dir = agents_root.join(SKILLS_DIR_NAME);
    let Ok(entries) = fs::read_dir(&skills_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() && !ft.is_symlink() {
            continue;
        }
        let skill_dir = entry.path();
        let skill_md = find_skill_markdown(&skill_dir);
        let Some(skill_md) = skill_md else {
            continue;
        };
        let name = entry
            .file_name()
            .to_string_lossy()
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let rel = rel_path_for(agents_root, &skill_md);
        let meta = read_markdown_meta(&skill_md);
        out.push(AgentsSkillEntry {
            name,
            rel_path: rel,
            path: skill_md.to_string_lossy().to_string(),
            description: meta.description,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn scan_agents(agents_root: &Path) -> Vec<AgentsAgentEntry> {
    let agents_dir = agents_root.join(AGENTS_DIR_NAME_INNER);
    let Ok(entries) = fs::read_dir(&agents_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_file() || !is_markdown(&p) {
            continue;
        }
        let rel = rel_path_for(agents_root, &p);
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let meta = read_markdown_meta(&p);
        let name = meta
            .strings
            .get("name")
            .cloned()
            .filter(|n| !n.is_empty())
            .unwrap_or(stem);
        out.push(AgentsAgentEntry {
            name,
            rel_path: rel,
            path: p.to_string_lossy().to_string(),
            description: meta.description,
            model: meta.strings.get("model").cloned(),
            tools: meta.lists.get("tools").cloned().unwrap_or_default(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn scan_others(agents_root: &Path) -> Vec<AgentsOtherEntry> {
    let Ok(entries) = fs::read_dir(agents_root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(
            name.as_str(),
            COMMANDS_DIR_NAME | SKILLS_DIR_NAME | AGENTS_DIR_NAME_INNER
        ) {
            continue;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        let is_dir = ft.is_dir();
        if !is_dir && !ft.is_file() {
            continue;
        }
        out.push(AgentsOtherEntry {
            name,
            rel_path: rel_path_for(agents_root, &p),
            path: p.to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.rel_path.cmp(&b.rel_path))
    });
    out
}

fn is_markdown(p: &Path) -> bool {
    p.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// `commands/foo/bar.md` → `foo/bar`（命令名，含子命令路径）。
fn markdown_stem(rel: &str) -> String {
    let without_ext = rel
        .strip_suffix(".md")
        .or_else(|| rel.strip_suffix(".MD"))
        .unwrap_or(rel);
    without_ext
        .strip_prefix(COMMANDS_DIR_NAME)
        .and_then(|s| s.strip_prefix('/'))
        .unwrap_or(without_ext)
        .to_string()
}

fn find_skill_markdown(skill_dir: &Path) -> Option<PathBuf> {
    let upper = skill_dir.join("SKILL.md");
    if upper.is_file() {
        return Some(upper);
    }
    let lower = skill_dir.join("skill.md");
    if lower.is_file() {
        return Some(lower);
    }
    None
}

fn is_under_agents_dir(p: &Path) -> bool {
    p.components()
        .any(|c| c.as_os_str().to_string_lossy() == AGENTS_DIR_NAME)
}

// ── Markdown frontmatter 解析（容错，不因缺字段失败） ───────────────────────

#[derive(Debug, Default)]
struct MarkdownMeta {
    description: Option<String>,
    strings: std::collections::HashMap<String, String>,
    lists: std::collections::HashMap<String, Vec<String>>,
}

/// 提取 `---` 包裹的 YAML frontmatter；返回 (frontmatter, 正文)。
fn extract_frontmatter(raw: &str) -> (Option<String>, String) {
    let normalized = raw.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.first().map(|l| l.trim()) != Some("---") {
        return (None, normalized);
    }
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            let fm = lines[1..i].join("\n");
            let body = if i + 1 < lines.len() {
                lines[i + 1..].join("\n")
            } else {
                String::new()
            };
            return (Some(fm), body);
        }
    }
    (None, normalized)
}

fn read_markdown_meta(path: &Path) -> MarkdownMeta {
    let raw = fs::read_to_string(path).unwrap_or_default();
    let (frontmatter, body) = extract_frontmatter(&raw);
    let mut meta = MarkdownMeta::default();
    if let Some(fm) = &frontmatter {
        parse_frontmatter(fm, &mut meta);
    }
    if meta.description.is_none() {
        meta.description = first_content_line(&body);
    }
    meta
}

fn parse_frontmatter(frontmatter: &str, meta: &mut MarkdownMeta) {
    let Ok(value) = serde_yaml::from_str::<serde_yaml::Value>(frontmatter) else {
        return;
    };
    let Some(map) = value.as_mapping() else {
        return;
    };
    for (k, v) in map {
        let Some(key) = k.as_str() else {
            continue;
        };
        match v {
            serde_yaml::Value::String(s) => {
                let s = s.trim().to_string();
                if !s.is_empty() {
                    if key == "description" {
                        meta.description = Some(s.clone());
                    }
                    meta.strings.insert(key.to_string(), s);
                }
            }
            serde_yaml::Value::Number(n) => {
                meta.strings.insert(key.to_string(), n.to_string());
            }
            serde_yaml::Value::Bool(b) => {
                meta.strings.insert(key.to_string(), b.to_string());
            }
            serde_yaml::Value::Sequence(seq) => {
                let list: Vec<String> = seq
                    .iter()
                    .filter_map(|item| match item {
                        serde_yaml::Value::String(s) => {
                            let s = s.trim().to_string();
                            (!s.is_empty()).then_some(s)
                        }
                        _ => None,
                    })
                    .collect();
                if !list.is_empty() {
                    meta.lists.insert(key.to_string(), list);
                }
            }
            _ => {}
        }
    }
    // 命令的 allowed-tools 常写成列表：拼成逗号分隔展示。
    if meta.lists.get("allowed-tools").is_some() && meta.strings.get("allowed-tools").is_none() {
        if let Some(list) = meta.lists.get("allowed-tools") {
            meta.strings.insert(
                "allowed-tools".to_string(),
                list.join(", "),
            );
        }
    }
}

/// 正文第一行有意义的描述（去掉标题、空行、列表标记），截断到 120 字。
fn first_content_line(body: &str) -> Option<String> {
    for line in body.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let s = t
            .strip_prefix('-')
            .or_else(|| t.strip_prefix('*'))
            .map(str::trim)
            .unwrap_or(t);
        if s.is_empty() {
            continue;
        }
        let mut out: String = s.chars().take(120).collect();
        if s.chars().count() > 120 {
            out.push('…');
        }
        return Some(out);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(path, content).expect("write file");
    }

    #[test]
    fn parses_command_frontmatter_and_body_fallback() {
        let dir = tempfile::tempdir().expect("tempdir");
        let agents = dir.path().join(".agents");
        write(
            &agents.join("commands/review.md"),
            "---\ndescription: 代码审查\nallowed-tools:\n  - Bash\n  - Read\nmodel: sonnet\n---\n实际正文内容",
        );
        write(&agents.join("commands/quick.md"), "# 快速命令\n\n没有 frontmatter 的命令说明");

        let scan = agents_explorer_scan(dir.path().to_string_lossy().to_string()).expect("scan");
        assert!(scan.exists);
        assert_eq!(scan.commands.len(), 2);

        let review = scan
            .commands
            .iter()
            .find(|c| c.name == "review")
            .expect("review command");
        assert_eq!(review.description.as_deref(), Some("代码审查"));
        assert_eq!(review.allowed_tools.as_deref(), Some("Bash, Read"));
        assert_eq!(review.model.as_deref(), Some("sonnet"));

        let quick = scan
            .commands
            .iter()
            .find(|c| c.name == "quick")
            .expect("quick command");
        assert_eq!(
            quick.description.as_deref(),
            Some("没有 frontmatter 的命令说明")
        );
    }

    #[test]
    fn scans_skills_agents_and_others() {
        let dir = tempfile::tempdir().expect("tempdir");
        let agents = dir.path().join(".agents");
        write(
            &agents.join("skills/weather/SKILL.md"),
            "---\ndescription: 查询天气\n---\n正文",
        );
        write(
            &agents.join("agents/tester.md"),
            "---\nname: tester\ndescription: 测试智能体\nmodel: gpt-5\ntools: [Bash, Read]\n---\n提示词",
        );
        write(&agents.join("hooks/post-tool.md"), "hook 内容");

        let scan = agents_explorer_scan(dir.path().to_string_lossy().to_string()).expect("scan");
        assert_eq!(scan.skills.len(), 1);
        assert_eq!(scan.skills[0].name, "weather");
        assert_eq!(scan.skills[0].description.as_deref(), Some("查询天气"));
        assert_eq!(scan.agents.len(), 1);
        let agent = &scan.agents[0];
        assert_eq!(agent.name, "tester");
        assert_eq!(agent.model.as_deref(), Some("gpt-5"));
        assert_eq!(agent.tools, vec!["Bash".to_string(), "Read".to_string()]);
        assert!(scan.others.iter().any(|o| o.name == "hooks" && o.is_dir));
    }

    #[test]
    fn missing_agents_dir_returns_empty_scan() {
        let dir = tempfile::tempdir().expect("tempdir");
        let scan = agents_explorer_scan(dir.path().to_string_lossy().to_string()).expect("scan");
        assert!(!scan.exists);
        assert!(scan.root_path.is_none());
        assert!(scan.commands.is_empty());
    }

    #[test]
    fn read_file_requires_agents_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        write(&dir.path().join("outside.md"), "x");
        let outside = dir.path().join("outside.md");
        let err = agents_explorer_read_file(AgentsFilePathArg {
            path: outside.to_string_lossy().to_string(),
        })
        .expect_err("should reject outside files");
        assert!(err.contains(".agents"));
    }
}
