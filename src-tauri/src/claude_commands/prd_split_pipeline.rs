//! PRD split artifact pipeline (stage 1).
//!
//! Tauri 命令把前端拆分产物落盘到 `.trellis/tasks/<父>/<子>/`，统一通过 `task.py`
//! 作为唯一写入入口。本模块不修改 `~/.wise/prd-runs/` 行为（旧持久化保持原样）。
//!
//! 严禁直写 `task.json` 创建新任务；仅在 `task.py create` 完成后追加 schema 扩展字段
//! （`repositoryId` / `clusterId`），符合 schema 向后兼容约束。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncReadExt;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateParentTaskInput {
    project_root_path: String,
    cluster_id: String,
    title: String,
    #[serde(default)]
    description: String,
    prd_markdown: String,
    requirements_index_json: String,
    #[serde(default)]
    primary_repository_id: Option<i64>,
    #[serde(default)]
    repository_ids: Vec<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateParentTaskOutput {
    parent_task_name: String,
    parent_task_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChildTaskPayload {
    title: String,
    slug: String,
    prd_markdown: String,
    #[serde(default)]
    repository_id: Option<i64>,
    cluster_id: String,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    dependencies: Vec<String>,
    #[serde(default)]
    source_requirement_ids: Vec<String>,
    #[serde(default)]
    task_anchors: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClusterRefPayload {
    #[allow(dead_code)]
    id: String,
    #[allow(dead_code)]
    title: String,
    #[serde(default)]
    primary_repository_id: Option<i64>,
    #[serde(default)]
    #[allow(dead_code)]
    repository_ids: Vec<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaterializeTasksInput {
    project_root_path: String,
    parent_task_name: String,
    cluster: ClusterRefPayload,
    child_tasks: Vec<ChildTaskPayload>,
    #[serde(default)]
    claude_split_mapping: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaterializeTasksOutput {
    parent_task_name: String,
    child_task_names: Vec<String>,
    warnings: Vec<String>,
}

#[tauri::command]
pub(crate) async fn prd_split_create_parent_task(
    input: CreateParentTaskInput,
) -> Result<CreateParentTaskOutput, String> {
    let project_root = validate_project_root(&input.project_root_path)?;
    let slug = derive_slug(&input.title, &input.cluster_id);

    let rel_path = run_task_py_create(
        &project_root,
        &input.title,
        &slug,
        &input.description,
        None,
    )
    .await?;
    let parent_task_path = project_root.join(&rel_path);
    let parent_task_name = parent_task_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("无法解析父任务目录名: {}", rel_path))?;

    // Patch task.json with schema extensions: repositoryId / clusterId + meta.repositoryIds.
    patch_task_json(&parent_task_path, |task| {
        task["repositoryId"] = json!(input.primary_repository_id);
        task["clusterId"] = json!(input.cluster_id);
        let meta = task
            .get_mut("meta")
            .and_then(|m| m.as_object_mut())
            .ok_or_else(|| "task.json meta 字段缺失".to_string())?;
        meta.insert(
            "clusterRepositoryIds".to_string(),
            json!(input.repository_ids),
        );
        Ok(())
    })?;

    // Overwrite prd.md with the supplied PRD body (cluster banner pre-prepended on TS side).
    fs::write(parent_task_path.join("prd.md"), &input.prd_markdown)
        .map_err(|e| format!("写父任务 prd.md 失败: {e}"))?;

    // Persist requirements-index.json alongside the parent task — single source of truth
    // for downstream diff replay (Stage 3).
    fs::write(
        parent_task_path.join("requirements-index.json"),
        &input.requirements_index_json,
    )
    .map_err(|e| format!("写 requirements-index.json 失败: {e}"))?;

    Ok(CreateParentTaskOutput {
        parent_task_name,
        parent_task_path: parent_task_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub(crate) async fn prd_split_materialize_tasks(
    input: MaterializeTasksInput,
) -> Result<MaterializeTasksOutput, String> {
    let project_root = validate_project_root(&input.project_root_path)?;
    let parent_dir = project_root
        .join(".trellis")
        .join("tasks")
        .join(&input.parent_task_name);
    if !parent_dir.is_dir() {
        return Err(format!(
            "父任务目录不存在: {}",
            parent_dir.to_string_lossy()
        ));
    }

    let mut child_task_names = Vec::with_capacity(input.child_tasks.len());
    let mut warnings: Vec<String> = Vec::new();

    for child in &input.child_tasks {
        let rel_path = run_task_py_create(
            &project_root,
            &child.title,
            &child.slug,
            &format!("Source requirements: {}", child.source_requirement_ids.join(", ")),
            Some(&input.parent_task_name),
        )
        .await?;
        let child_path = project_root.join(&rel_path);
        let child_name = child_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("无法解析子任务目录名: {}", rel_path))?;

        let repo_id = child.repository_id.or(input.cluster.primary_repository_id);
        let cluster_id = child.cluster_id.clone();
        let role = child.role.clone();
        let deps = child.dependencies.clone();
        let req_ids = child.source_requirement_ids.clone();
        let anchors = child.task_anchors.clone();

        patch_task_json(&child_path, |task| {
            task["repositoryId"] = json!(repo_id);
            task["clusterId"] = json!(cluster_id);
            if let Some(role) = role.as_deref() {
                task["dev_type"] = json!(role);
            }
            let meta = task
                .get_mut("meta")
                .and_then(|m| m.as_object_mut())
                .ok_or_else(|| "task.json meta 字段缺失".to_string())?;
            meta.insert("sourceRequirementIds".to_string(), json!(req_ids));
            meta.insert("childDependencies".to_string(), json!(deps));
            if let Some(anchor) = anchors.as_ref() {
                meta.insert("taskAnchors".to_string(), anchor.clone());
            }
            Ok(())
        })?;

        fs::write(child_path.join("prd.md"), &child.prd_markdown)
            .map_err(|e| format!("写子任务 prd.md 失败 ({child_name}): {e}"))?;

        child_task_names.push(child_name);
    }

    // Persist the captured claude split mapping into parent task.json meta.
    if let Some(mapping) = input.claude_split_mapping.clone() {
        if let Err(err) = patch_task_json(&parent_dir, |task| {
            let meta = task
                .get_mut("meta")
                .and_then(|m| m.as_object_mut())
                .ok_or_else(|| "task.json meta 字段缺失".to_string())?;
            meta.insert("claudeSplitMapping".to_string(), mapping.clone());
            Ok(())
        }) {
            warnings.push(format!("写父任务 meta.claudeSplitMapping 失败: {err}"));
        }
    }

    Ok(MaterializeTasksOutput {
        parent_task_name: input.parent_task_name,
        child_task_names,
        warnings,
    })
}

// ── helpers ──

fn validate_project_root(raw: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return Err("project_root_path 必须是绝对路径".to_string());
    }
    let task_py = p.join(".trellis").join("scripts").join("task.py");
    if !task_py.is_file() {
        return Err(format!(
            ".trellis/scripts/task.py 不存在于 {} — 该项目尚未启用 Trellis",
            p.to_string_lossy()
        ));
    }
    Ok(p)
}

async fn run_task_py_create(
    project_root: &Path,
    title: &str,
    slug: &str,
    description: &str,
    parent: Option<&str>,
) -> Result<String, String> {
    let task_py = project_root.join(".trellis").join("scripts").join("task.py");
    let mut cmd = tokio::process::Command::new("python3");
    cmd.current_dir(project_root);
    cmd.arg(task_py).arg("create").arg(title);
    cmd.arg("--slug").arg(slug);
    if !description.trim().is_empty() {
        cmd.arg("--description").arg(description);
    }
    if let Some(parent) = parent {
        cmd.arg("--parent").arg(parent);
    }
    // Prevent the spawned task.py from hijacking the caller's active-task pointer
    // (set_active_task is gated on TRELLIS_CONTEXT_ID; clearing it forces the
    // "degraded mode" path which just creates the task without activation).
    cmd.env_remove("TRELLIS_CONTEXT_ID");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 task.py 失败: {e}"))?;
    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    if let Some(mut s) = child.stdout.take() {
        let _ = s.read_to_end(&mut stdout_buf).await;
    }
    if let Some(mut s) = child.stderr.take() {
        let _ = s.read_to_end(&mut stderr_buf).await;
    }
    let status = child
        .wait()
        .await
        .map_err(|e| format!("task.py 等待失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&stdout_buf).trim().to_string();
    let stderr = String::from_utf8_lossy(&stderr_buf).trim().to_string();
    if !status.success() {
        return Err(format!(
            "task.py create 失败 (exit {:?}). stderr: {}",
            status.code(),
            stderr
        ));
    }
    if stdout.is_empty() {
        return Err(format!(
            "task.py create 未输出任务路径。stderr: {}",
            stderr
        ));
    }
    // stdout is the relative task directory printed last (.trellis/tasks/MM-DD-slug).
    let rel = stdout
        .lines()
        .rev()
        .find(|line| line.contains(".trellis/tasks/"))
        .ok_or_else(|| format!("task.py 输出未包含任务路径: {stdout}"))?
        .to_string();
    Ok(rel)
}

fn patch_task_json<F>(task_dir: &Path, mutator: F) -> Result<(), String>
where
    F: FnOnce(&mut Value) -> Result<(), String>,
{
    let path = task_dir.join("task.json");
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("读 {} 失败: {e}", path.to_string_lossy()))?;
    let mut value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("解析 {} 失败: {e}", path.to_string_lossy()))?;
    if value.get("meta").is_none() {
        value["meta"] = json!({});
    }
    mutator(&mut value)?;
    let serialized = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("序列化 task.json 失败: {e}"))?;
    fs::write(&path, format!("{serialized}\n"))
        .map_err(|e| format!("写 {} 失败: {e}", path.to_string_lossy()))?;
    Ok(())
}

fn derive_slug(title: &str, fallback: &str) -> String {
    let normalized = slugify(title);
    if !normalized.is_empty() {
        return normalized;
    }
    let fallback = slugify(fallback);
    if !fallback.is_empty() {
        return fallback;
    }
    "cluster".to_string()
}

fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_dash = true;
    for c in input.chars() {
        let lower = c.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_normalizes_ascii_only_text() {
        assert_eq!(slugify("Add Login Flow"), "add-login-flow");
        assert_eq!(slugify("  multi   spaces "), "multi-spaces");
    }

    #[test]
    fn slugify_collapses_non_ascii() {
        assert_eq!(slugify("登录 flow"), "flow");
        assert_eq!(slugify("全中文"), "");
    }

    #[test]
    fn derive_slug_falls_back_when_title_empty() {
        assert_eq!(derive_slug("登录", "cluster-fe-01"), "cluster-fe-01");
        assert_eq!(derive_slug("", ""), "cluster");
    }
}
