//! skills.sh 目录搜索 + 通过官方 `skills` CLI 安装/卸载到 Claude Code（项目 `.claude/skills/` 或用户 `~/.claude/skills/`）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::validate_claude_skill_name;

const SKILLS_SH_SEARCH_URL: &str = "https://skills.sh/api/search";
const SKILLS_CLI_PKG: &str = "skills@1.5.6";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillsShSkillEntry {
    pub id: String,
    pub skill_id: String,
    pub name: String,
    pub installs: u64,
    pub source: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsShSearchResponse {
    pub query: String,
    #[serde(rename = "searchType")]
    pub search_type: String,
    pub skills: Vec<SkillsShSkillEntry>,
    pub count: u32,
}

fn install_scope_is_global(scope: &str) -> Result<bool, String> {
    match scope.trim().to_lowercase().as_str() {
        "global" => Ok(true),
        "project" => Ok(false),
        _ => Err("安装范围无效：应为 project 或 global".to_string()),
    }
}

fn validate_project_dir(project_path: &str) -> Result<PathBuf, String> {
    let p = project_path.trim();
    if p.is_empty() {
        return Err("请先选择仓库（技能安装到当前仓库根目录）".to_string());
    }
    let root = PathBuf::from(p);
    if !root.is_dir() {
        return Err("项目目录不存在或不可访问".to_string());
    }
    fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))
}

fn validate_skills_source(source: &str) -> Result<String, String> {
    let s = source.trim();
    if s.is_empty() {
        return Err("技能源为空".to_string());
    }
    if s.starts_with('/') || s.ends_with('/') || s.contains("//") {
        return Err("技能源格式无效".to_string());
    }
    for seg in s.split('/') {
        if seg.is_empty() {
            return Err("技能源格式无效".to_string());
        }
        if !seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        {
            return Err("技能源仅允许字母、数字、._-/ 分段".to_string());
        }
    }
    Ok(s.to_string())
}

#[tauri::command]
pub async fn skills_sh_search(q: String, limit: u32) -> Result<SkillsShSearchResponse, String> {
    let q = q.trim().to_string();
    if q.len() < 2 {
        return Err("搜索词至少 2 个字符".to_string());
    }
    let limit = limit.clamp(1, 50);
    let url = format!(
        "{}?q={}&limit={}",
        SKILLS_SH_SEARCH_URL,
        urlencoding::encode(&q),
        limit
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("WiseDesktop/1.0 (skills.sh search)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("skills.sh 请求失败: HTTP {}", resp.status()));
    }
    resp.json::<SkillsShSearchResponse>()
        .await
        .map_err(|e| format!("解析 skills.sh 响应失败: {}", e))
}

fn npx_program() -> &'static str {
    #[cfg(windows)]
    {
        "npx.cmd"
    }
    #[cfg(not(windows))]
    {
        "npx"
    }
}

fn run_skills_cli(project: &Path, args: &[String]) -> Result<String, String> {
    let out = Command::new(npx_program())
        .arg("--yes")
        .arg(SKILLS_CLI_PKG)
        .args(args.iter().map(|s| s.as_str()))
        .current_dir(project)
        .env("npm_config_yes", "true")
        .output()
        .map_err(|e| format!("无法执行 npx: {}", e))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let combined = format!(
        "{}{}",
        stdout,
        if stderr.is_empty() {
            String::new()
        } else {
            format!("\n--- stderr ---\n{}", stderr)
        }
    );
    if out.status.success() {
        Ok(combined.trim().to_string())
    } else {
        Err(format!(
            "skills CLI 失败（退出码 {:?}）\n{}",
            out.status.code(),
            combined.trim()
        ))
    }
}

#[tauri::command]
pub async fn skills_cli_add_from_registry(
    project_path: String,
    source: String,
    skill_id: String,
    scope: String,
) -> Result<String, String> {
    let global = install_scope_is_global(&scope)?;
    let root = if global {
        dirs::home_dir().ok_or_else(|| "无法解析用户主目录，无法安装全局技能".to_string())?
    } else {
        validate_project_dir(&project_path)?
    };
    let source = validate_skills_source(&source)?;
    validate_claude_skill_name(&skill_id)?;
    let skill_id = skill_id.trim().to_string();

    let mut args = vec![
        "add".to_string(),
        source,
        "-s".to_string(),
        skill_id,
        "-a".to_string(),
        "claude-code".to_string(),
    ];
    if global {
        args.push("-g".to_string());
    }
    args.push("-y".to_string());

    tokio::task::spawn_blocking(move || run_skills_cli(&root, &args))
        .await
        .map_err(|e| format!("安装任务被中断: {}", e))?
}

#[tauri::command]
pub async fn skills_cli_remove_from_registry(
    project_path: String,
    skill_id: String,
    scope: String,
) -> Result<String, String> {
    let global = install_scope_is_global(&scope)?;
    let root = if global {
        dirs::home_dir().ok_or_else(|| "无法解析用户主目录，无法卸载全局技能".to_string())?
    } else {
        validate_project_dir(&project_path)?
    };
    validate_claude_skill_name(&skill_id)?;
    let skill_id = skill_id.trim().to_string();

    let mut args = vec![
        "remove".to_string(),
        skill_id,
        "-y".to_string(),
        "-a".to_string(),
        "claude-code".to_string(),
    ];
    if global {
        args.push("-g".to_string());
    }

    tokio::task::spawn_blocking(move || run_skills_cli(&root, &args))
        .await
        .map_err(|e| format!("卸载任务被中断: {}", e))?
}
