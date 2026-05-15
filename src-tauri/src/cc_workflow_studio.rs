//! CC Workflow Studio (cc-wf-studio) — 仓库内 `.vscode/workflows/*.json` 的列表与读写。
//! 供前端嵌入上游 Webview 时使用；路径严格限制在 workflows 目录下。

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const WORKFLOWS_REL: &str = ".vscode/workflows";
const MAX_WORKFLOW_JSON_BYTES: u64 = 8 * 1024 * 1024;

fn canonical_project_base(project_path: &str) -> Result<PathBuf, String> {
    let project = PathBuf::from(project_path.trim());
    if !project.is_dir() {
        return Err("仓库路径无效或不是目录".into());
    }
    project
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))
}

fn workflows_dir(base: &Path) -> PathBuf {
    base.join(WORKFLOWS_REL)
}

/// 仅允许 `[a-z0-9_-]+` 作为工作流文件名 stem（与上游保存校验一致）。
pub(crate) fn sanitize_workflow_stem(stem: &str) -> Result<String, String> {
    let t = stem.trim();
    if t.is_empty() {
        return Err("工作流 id 不能为空".into());
    }
    if !t
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        return Err("工作流 id 只能包含小写字母、数字、连字符与下划线".into());
    }
    Ok(t.to_string())
}

fn workflow_json_path(base: &Path, stem: &str) -> Result<PathBuf, String> {
    let stem = sanitize_workflow_stem(stem)?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let dir = workflows_dir(&base_canon);
    fs::create_dir_all(&dir).map_err(|e| format!("创建工作流目录失败: {e}"))?;
    let dir_canon = dir
        .canonicalize()
        .map_err(|e| format!("解析工作流目录失败: {e}"))?;
    if !dir_canon.starts_with(&base_canon) {
        return Err("路径越界".into());
    }
    let full = dir_canon.join(format!("{stem}.json"));
    if !full.starts_with(&base_canon) {
        return Err("路径越界".into());
    }
    Ok(full)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CcWorkflowListItem {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub updated_at: String,
}

fn iso_from_system_time(st: std::time::SystemTime) -> String {
    let dt: DateTime<Utc> = st.into();
    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 列出 `.vscode/workflows` 下全部 `*.json` 工作流元数据。
#[tauri::command]
pub fn list_cc_workflow_studio_workflows(
    project_path: String,
) -> Result<Vec<CcWorkflowListItem>, String> {
    let base = canonical_project_base(&project_path)?;
    let dir = workflows_dir(&base);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<CcWorkflowListItem> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| format!("读取工作流目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.ends_with(".json") {
            continue;
        }
        let stem = file_name.trim_end_matches(".json");
        if sanitize_workflow_stem(stem).is_err() {
            continue;
        }
        let path = entry.path();
        let meta = fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {e}"))?;
        let mtime_iso = meta
            .modified()
            .ok()
            .map(iso_from_system_time)
            .unwrap_or_else(|| Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));

        let content = fs::read_to_string(&path).map_err(|e| format!("读取 {file_name} 失败: {e}"))?;
        let val: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
        let name = val
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(stem)
            .to_string();
        let description = val
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let updated_at = val
            .get("updatedAt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or(mtime_iso);

        out.push(CcWorkflowListItem {
            id: stem.to_string(),
            name,
            description,
            updated_at,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// 读取单个工作流 JSON（UTF-8），上限 8MB。
#[tauri::command]
pub fn read_cc_workflow_studio_workflow(
    project_path: String,
    workflow_id: String,
) -> Result<String, String> {
    let base = canonical_project_base(&project_path)?;
    let path = workflow_json_path(&base, &workflow_id)?;
    if !path.is_file() {
        return Err("工作流文件不存在".into());
    }
    let len = fs::metadata(&path)
        .map_err(|e| format!("读取文件信息失败: {e}"))?
        .len();
    if len > MAX_WORKFLOW_JSON_BYTES {
        return Err("工作流 JSON 超过 8MB 上限".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("读取工作流失败: {e}"))
}

/// 读取用户通过系统对话框选择的任意工作流 JSON 文件（UTF-8），用于「加载」导入；上限 8MB。
#[tauri::command]
pub fn read_cc_workflow_studio_import_file(absolute_path: String) -> Result<String, String> {
    let path = PathBuf::from(absolute_path.trim());
    if !path.is_absolute() {
        return Err("导入路径必须为绝对路径".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("文件不存在或无法访问: {e}"))?;
    let meta = fs::metadata(&canon).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if !meta.is_file() {
        return Err("所选路径不是普通文件".into());
    }
    let len = meta.len();
    if len > MAX_WORKFLOW_JSON_BYTES {
        return Err("工作流 JSON 超过 8MB 上限".into());
    }
    fs::read_to_string(&canon).map_err(|e| format!("读取文件失败: {e}"))
}

fn ai_editing_skill_relative_path(provider: &str) -> Result<&'static str, String> {
    match provider.trim() {
        "claude-code" => Ok(".claude/commands/cc-workflow-ai-editor.md"),
        "copilot-cli" | "copilot-chat" => Ok(".github/skills/cc-workflow-ai-editor/SKILL.md"),
        "codex" => Ok(".codex/skills/cc-workflow-ai-editor/SKILL.md"),
        "roo-code" => Ok(".roo/skills/cc-workflow-ai-editor/SKILL.md"),
        "gemini" => Ok(".gemini/skills/cc-workflow-ai-editor/SKILL.md"),
        "antigravity" => Ok(".agent/skills/cc-workflow-ai-editor/SKILL.md"),
        "cursor" => Ok(".cursor/skills/cc-workflow-ai-editor/SKILL.md"),
        other => Err(format!("不支持的 AI 编辑 provider: {other}")),
    }
}

fn write_project_relative_text_file(base: &Path, relative_path: &str, contents: &str) -> Result<(), String> {
    let rel = relative_path.trim().trim_start_matches('/');
    if rel.is_empty() || rel.contains("..") {
        return Err("相对路径无效".into());
    }
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = base_canon.join(rel);
    let parent = full
        .parent()
        .ok_or_else(|| "无效文件路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let parent_canon = parent
        .canonicalize()
        .map_err(|e| format!("解析父目录失败: {e}"))?;
    if !parent_canon.starts_with(&base_canon) {
        return Err("路径越界".into());
    }
    fs::write(&full, contents).map_err(|e| format!("写入文件失败: {e}"))?;
    let full_canon = full
        .canonicalize()
        .map_err(|e| format!("解析文件路径失败: {e}"))?;
    if !full_canon.starts_with(&base_canon) {
        return Err("路径越界".into());
    }
    Ok(())
}

/// 将 AI 编辑 skill 模板写入仓库内 provider 对应路径（覆盖）。
#[tauri::command]
pub fn write_cc_wf_studio_ai_editing_skill(
    project_path: String,
    provider: String,
) -> Result<(), String> {
    let base = canonical_project_base(&project_path)?;
    let rel = ai_editing_skill_relative_path(&provider)?;
    const TEMPLATE: &str =
        include_str!("../../src/features/cc-wf-studio/resources/ai-editing-skill-template.md");
    write_project_relative_text_file(&base, rel, TEMPLATE)
}

/// 写入工作流 JSON（覆盖），上限 8MB；自动创建 `.vscode/workflows`。
#[tauri::command]
pub fn write_cc_workflow_studio_workflow(
    project_path: String,
    workflow_id: String,
    payload: String,
) -> Result<(), String> {
    let base = canonical_project_base(&project_path)?;
    let path = workflow_json_path(&base, &workflow_id)?;
    let bytes = payload.as_bytes().len() as u64;
    if bytes > MAX_WORKFLOW_JSON_BYTES {
        return Err("工作流 JSON 超过 8MB 上限".into());
    }
    // 校验合法 JSON
    let _: Value = serde_json::from_str(&payload).map_err(|e| format!("JSON 无效: {e}"))?;
    fs::write(&path, payload).map_err(|e| format!("写入工作流失败: {e}"))?;
    Ok(())
}
