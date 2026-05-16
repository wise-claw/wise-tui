//! PRD split artifact pipeline (stages 1 + 2.2).
//!
//! Tauri 命令把前端拆分产物落盘到 `.trellis/tasks/<父>/<子>/`，统一通过 `task.py`
//! 作为唯一写入入口；并提供 cluster-级 splitter subagent 派发（dispatch_cluster），
//! 持久化原始 I/O 到 `~/.wise/prd-runs/<runId>/`。
//!
//! 严禁直写 `task.json` 创建新任务；仅在 `task.py create` 完成后追加 schema 扩展字段
//! （`repositoryId` / `clusterId`），符合 schema 向后兼容约束。

use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env, trim_model_cli_arg};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

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
    source_task_id: String,
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
    #[serde(default)]
    classification: Option<String>,
    #[serde(default)]
    design_markdown: Option<String>,
    #[serde(default)]
    implement_markdown: Option<String>,
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
pub(crate) struct MaterializedChildTaskOutput {
    source_task_id: String,
    task_name: String,
    task_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaterializeTasksOutput {
    parent_task_name: String,
    child_task_names: Vec<String>,
    child_tasks: Vec<MaterializedChildTaskOutput>,
    warnings: Vec<String>,
}

#[tauri::command]
pub(crate) async fn prd_split_create_parent_task(
    input: CreateParentTaskInput,
) -> Result<CreateParentTaskOutput, String> {
    let project_root = validate_project_root(&input.project_root_path)?;
    let slug = derive_slug(&input.title, &input.cluster_id);

    let rel_path =
        run_task_py_create(&project_root, &input.title, &slug, &input.description, None).await?;
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
    let mut child_tasks = Vec::with_capacity(input.child_tasks.len());
    let mut warnings: Vec<String> = Vec::new();

    for child in &input.child_tasks {
        let rel_path = run_task_py_create(
            &project_root,
            &child.title,
            &child.slug,
            &format!(
                "Source requirements: {}",
                child.source_requirement_ids.join(", ")
            ),
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
        let classification = child
            .classification
            .clone()
            .filter(|s| s == "lightweight" || s == "complex")
            .unwrap_or_else(|| "lightweight".to_string());

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
            meta.insert("classification".to_string(), json!(classification));
            if let Some(anchor) = anchors.as_ref() {
                meta.insert("taskAnchors".to_string(), anchor.clone());
            }
            Ok(())
        })?;

        fs::write(child_path.join("prd.md"), &child.prd_markdown)
            .map_err(|e| format!("写子任务 prd.md 失败 ({child_name}): {e}"))?;

        if let Some(design) = child
            .design_markdown
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            fs::write(child_path.join("design.md"), format!("{design}\n"))
                .map_err(|e| format!("写子任务 design.md 失败 ({child_name}): {e}"))?;
        }
        if let Some(impl_md) = child
            .implement_markdown
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            fs::write(child_path.join("implement.md"), format!("{impl_md}\n"))
                .map_err(|e| format!("写子任务 implement.md 失败 ({child_name}): {e}"))?;
        }

        child_task_names.push(child_name);
        child_tasks.push(MaterializedChildTaskOutput {
            source_task_id: child.source_task_id.clone(),
            task_name: child_task_names.last().cloned().unwrap_or_default(),
            task_path: child_path.to_string_lossy().to_string(),
        });
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
        child_tasks,
        warnings,
    })
}

// ── Stage 3: scan project for existing PRD-split parent tasks ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannedParentTask {
    parent_task_name: String,
    parent_task_path: String,
    cluster_id: String,
    primary_repository_id: Option<i64>,
    requirements_index_json: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanProjectParentsOutput {
    parents: Vec<ScannedParentTask>,
}

#[tauri::command]
pub(crate) async fn prd_split_scan_project_parents(
    project_root_path: String,
) -> Result<ScanProjectParentsOutput, String> {
    let project_root = validate_project_root(&project_root_path)?;
    let tasks_dir = project_root.join(".trellis").join("tasks");
    if !tasks_dir.is_dir() {
        return Ok(ScanProjectParentsOutput { parents: vec![] });
    }
    let mut parents: Vec<ScannedParentTask> = Vec::new();
    let entries = fs::read_dir(&tasks_dir).map_err(|e| format!("读取 .trellis/tasks 失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // archive/ 等非任务目录跳过。
        if name == "archive" {
            continue;
        }
        let task_json_path = path.join("task.json");
        if !task_json_path.is_file() {
            continue;
        }
        let raw = match fs::read_to_string(&task_json_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let cluster_id = match value.get("clusterId").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };
        let primary_repository_id = value.get("repositoryId").and_then(|v| v.as_i64());
        let index_path = path.join("requirements-index.json");
        let requirements_index_json = fs::read_to_string(&index_path).ok();
        parents.push(ScannedParentTask {
            parent_task_name: name,
            parent_task_path: path.to_string_lossy().to_string(),
            cluster_id,
            primary_repository_id,
            requirements_index_json,
        });
    }
    Ok(ScanProjectParentsOutput { parents })
}

// ── Stage 3 (A5): mark dirty cluster's existing children as needing review ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkChildrenStatusInput {
    project_root_path: String,
    parent_task_name: String,
    /// 期望的新 status；目前仅支持 "planning"（语义为 pending_review）。
    new_status: String,
    /// 跳过的子任务目录名（最近一次 dispatch 新建的，无需回退）。
    #[serde(default)]
    exclude_child_names: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkChildrenStatusOutput {
    updated_child_names: Vec<String>,
    skipped: Vec<String>,
}

#[tauri::command]
pub(crate) async fn prd_split_mark_children_status(
    input: MarkChildrenStatusInput,
) -> Result<MarkChildrenStatusOutput, String> {
    if input.new_status != "planning" {
        return Err(format!(
            "目前仅允许 new_status=planning（收到 {}）",
            input.new_status
        ));
    }
    let project_root = validate_project_root(&input.project_root_path)?;
    let parent_dir = project_root
        .join(".trellis")
        .join("tasks")
        .join(&input.parent_task_name);
    let parent_task_json = parent_dir.join("task.json");
    if !parent_task_json.is_file() {
        return Err(format!(
            "父任务 task.json 不存在: {}",
            parent_task_json.to_string_lossy()
        ));
    }
    let raw = fs::read_to_string(&parent_task_json)
        .map_err(|e| format!("读父任务 task.json 失败: {e}"))?;
    let parent_value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("解析父任务 task.json 失败: {e}"))?;
    let children = parent_value
        .get("children")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let exclude: std::collections::HashSet<&str> = input
        .exclude_child_names
        .iter()
        .map(String::as_str)
        .collect();

    let mut updated: Vec<String> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    for child in children {
        let name = match child.as_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        if exclude.contains(name.as_str()) {
            skipped.push(name);
            continue;
        }
        let child_dir = project_root.join(".trellis").join("tasks").join(&name);
        if !child_dir.is_dir() {
            skipped.push(name);
            continue;
        }
        match patch_task_json(&child_dir, |task| {
            task["status"] = json!("planning");
            let meta = task
                .get_mut("meta")
                .and_then(|m| m.as_object_mut())
                .ok_or_else(|| "task.json meta 字段缺失".to_string())?;
            meta.insert(
                "pendingReviewMarkedAtMs".to_string(),
                json!(unix_ms_now() as u64),
            );
            Ok(())
        }) {
            Ok(()) => updated.push(name),
            Err(_) => skipped.push(name),
        }
    }
    Ok(MarkChildrenStatusOutput {
        updated_child_names: updated,
        skipped,
    })
}

// ── Stage 2: legacy prd-runs migration ──

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LegacyRunSummary {
    run_id: String,
    run_dir: String,
    created_at_ms: u64,
    prd_preview: String,
    /// 是否含 `split-result.raw.json`（有内容即视为可迁移）。
    has_split_result: bool,
    task_count: u32,
    repository_id: Option<i64>,
    repository_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListLegacyRunsOutput {
    runs: Vec<LegacyRunSummary>,
}

#[tauri::command]
pub(crate) async fn prd_split_list_legacy_runs() -> Result<ListLegacyRunsOutput, String> {
    let base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    if !base.is_dir() {
        return Ok(ListLegacyRunsOutput { runs: vec![] });
    }
    let mut runs: Vec<LegacyRunSummary> = Vec::new();
    let entries = fs::read_dir(&base).map_err(|e| format!("读 prd-runs 失败: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let run_id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if run_id.is_empty() {
            continue;
        }
        let created_at_ms = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let prd_preview = fs::read_to_string(path.join("prd.md"))
            .unwrap_or_default()
            .lines()
            .take(3)
            .collect::<Vec<_>>()
            .join(" / ");
        let split_path = path.join("split-result.raw.json");
        let has_split_result = split_path.is_file();
        let task_count = if has_split_result {
            fs::read_to_string(&split_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                .and_then(|v| {
                    v.get("tasks")
                        .and_then(|t| t.as_array().map(|a| a.len() as u32))
                })
                .unwrap_or(0)
        } else {
            0
        };
        let (repository_id, repository_name) = read_repo_context(&path);
        runs.push(LegacyRunSummary {
            run_id,
            run_dir: path.to_string_lossy().to_string(),
            created_at_ms,
            prd_preview,
            has_split_result,
            task_count,
            repository_id,
            repository_name,
        });
    }
    runs.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
    Ok(ListLegacyRunsOutput { runs })
}

fn read_repo_context(run_dir: &Path) -> (Option<i64>, Option<String>) {
    let raw = match fs::read_to_string(run_dir.join("repo-context.json")) {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return (None, None),
    };
    let id = value.get("repositoryId").and_then(|v| v.as_i64());
    let name = value
        .get("repositoryName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    (id, name)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadLegacyRunInput {
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadLegacyRunOutput {
    run_id: String,
    run_dir: String,
    prd_markdown: String,
    split_result_raw_json: Option<String>,
    requirements_index_json: Option<String>,
    repo_context_json: Option<String>,
    meta_json: Option<String>,
}

#[tauri::command]
pub(crate) async fn prd_split_read_legacy_run(
    input: ReadLegacyRunInput,
) -> Result<ReadLegacyRunOutput, String> {
    if input.run_id.trim().is_empty() || input.run_id.contains('/') || input.run_id.contains("..") {
        return Err("非法 run_id".to_string());
    }
    let base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    let run_dir = base.join(&input.run_id);
    if !run_dir.is_dir() {
        return Err(format!("run 目录不存在: {}", run_dir.to_string_lossy()));
    }
    let read_opt = |name: &str| fs::read_to_string(run_dir.join(name)).ok();
    Ok(ReadLegacyRunOutput {
        run_id: input.run_id,
        run_dir: run_dir.to_string_lossy().to_string(),
        prd_markdown: read_opt("prd.md").unwrap_or_default(),
        split_result_raw_json: read_opt("split-result.raw.json"),
        requirements_index_json: read_opt("requirements-index.json"),
        repo_context_json: read_opt("repo-context.json"),
        meta_json: read_opt("meta.json"),
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
    let task_py = project_root
        .join(".trellis")
        .join("scripts")
        .join("task.py");
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

    let mut child = cmd.spawn().map_err(|e| format!("启动 task.py 失败: {e}"))?;
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
        return Err(format!("task.py create 未输出任务路径。stderr: {}", stderr));
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
    let serialized =
        serde_json::to_string_pretty(&value).map_err(|e| format!("序列化 task.json 失败: {e}"))?;
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

// ── Stage 2.2: cluster dispatch ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DispatchClusterInput {
    project_root_path: String,
    parent_task_path: String,
    cluster_id: String,
    bundle: HashMap<String, String>,
    prompt: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetryRunInput {
    run_id: String,
    project_root_path: String,
    #[serde(default)]
    mission_id: Option<String>,
    cluster_id: String,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DispatchClusterOutput {
    run_id: String,
    run_dir: String,
    exit_code: i32,
    duration_ms: u64,
    stdout_path: String,
    stderr_path: String,
    raw_result_path: String,
    raw_output: Option<Value>,
    stdout_truncated_preview: String,
    claude_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetryRunOutput {
    new_run_id: String,
    new_run_dir: String,
}

#[tauri::command]
pub(crate) async fn prd_split_dispatch_cluster(
    app: tauri::AppHandle,
    input: DispatchClusterInput,
) -> Result<DispatchClusterOutput, String> {
    dispatch_cluster_impl(app, input, false, None).await
}

#[tauri::command]
pub(crate) async fn prd_split_retry_run(
    app: tauri::AppHandle,
    db: tauri::State<'_, crate::wise_db::WiseDb>,
    input: RetryRunInput,
) -> Result<RetryRunOutput, String> {
    let project_root = validate_project_root(&input.project_root_path)?;
    let old_run_id = required(input.run_id, "runId")?;
    let requested_cluster_id = required(input.cluster_id, "clusterId")?;
    let old_run_dir = resolve_prd_run_dir(&old_run_id)?;
    let meta_path = old_run_dir.join("dispatch.meta.json");
    let prompt_path = old_run_dir.join("prompt.md");
    if !meta_path.is_file() {
        return Err(format!(
            "dispatch.meta.json 缺失，无法从 runDir 重试: {}",
            old_run_dir.to_string_lossy()
        ));
    }
    if !prompt_path.is_file() {
        return Err(format!(
            "prompt.md 缺失，无法从 runDir 重试: {}",
            old_run_dir.to_string_lossy()
        ));
    }

    let meta = load_retry_dispatch_meta(&old_run_dir, &requested_cluster_id)?;

    let parent_task_path = meta
        .get("parentTaskPath")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "dispatch.meta.json 缺少 parentTaskPath".to_string())?
        .to_string();
    let timeout_ms = meta.get("timeoutMs").and_then(|v| v.as_u64());
    let model = input.model.or_else(|| {
        meta.get("model")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    });
    let prompt = fs::read_to_string(&prompt_path).map_err(|e| format!("读取 prompt.md 失败: {e}"))?;
    let bundle = read_retry_bundle(&old_run_dir)?;

    let new_run_id = format!(
        "split-{}-{}",
        sanitize_for_filename(&requested_cluster_id),
        unix_ms_now()
    );
    let new_run_dir = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs")
        .join(&new_run_id);
    fs::create_dir_all(&new_run_dir)
        .map_err(|e| format!("创建 retry run_dir 失败 ({}): {e}", new_run_dir.to_string_lossy()))?;
    patch_json_file(old_run_dir.join("run-result.json"), |value| {
        value["superseded_by"] = json!(new_run_id);
        Ok(())
    })?;
    patch_json_file(new_run_dir.join("dispatch.meta.json"), |value| {
        value["retriedFrom"] = json!(old_run_id);
        value["retriedFromRunDir"] = json!(old_run_dir.to_string_lossy());
        if let Some(mission_id) = input.mission_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            value["missionId"] = json!(mission_id);
        }
        Ok(())
    })?;
    record_retry_event(&db, &input.mission_id, &old_run_id, &new_run_id, &requested_cluster_id);

    let app_clone = app.clone();
    let run_id_for_task = new_run_id.clone();
    let run_dir_for_task = new_run_dir.clone();
    tokio::spawn(async move {
        match dispatch_cluster_impl(
            app_clone,
            DispatchClusterInput {
                project_root_path: project_root.to_string_lossy().to_string(),
                parent_task_path,
                cluster_id: requested_cluster_id,
                bundle,
                prompt,
                model,
                timeout_ms,
            },
            true,
            Some((run_id_for_task.clone(), run_dir_for_task.clone())),
        )
        .await
        {
            Ok(_) => {}
            Err(e) => {
                let _ = fs::write(
                    run_dir_for_task.join("run-result.json"),
                    serde_json::to_string_pretty(&json!({
                        "runId": run_id_for_task,
                        "status": "failed",
                        "error": e,
                    }))
                    .unwrap_or_default(),
                );
            }
        }
    });

    Ok(RetryRunOutput {
        new_run_id,
        new_run_dir: new_run_dir.to_string_lossy().to_string(),
    })
}

/// Shared implementation for both foreground and background dispatch.
async fn dispatch_cluster_impl(
    app: tauri::AppHandle,
    input: DispatchClusterInput,
    is_background: bool,
    run_override: Option<(String, PathBuf)>,
) -> Result<DispatchClusterOutput, String> {
    let project_root = validate_project_root(&input.project_root_path)?;
    if input.parent_task_path.trim().is_empty() {
        return Err(
            "parent_task_path 不能为空（splitter 调度协议要求 Active task 前缀）".to_string(),
        );
    }

    let runs_base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    fs::create_dir_all(&runs_base).map_err(|e| format!("创建 ~/.wise/prd-runs 失败: {e}"))?;

    let (run_id, run_dir) = run_override.unwrap_or_else(|| {
        let run_id = format!(
            "split-{}-{}",
            sanitize_for_filename(&input.cluster_id),
            unix_ms_now()
        );
        let run_dir = runs_base.join(&run_id);
        (run_id, run_dir)
    });
    fs::create_dir_all(&run_dir)
        .map_err(|e| format!("创建 run_dir 失败 ({}): {e}", run_dir.to_string_lossy()))?;

    // 写入 bundle 文件。
    for (name, content) in &input.bundle {
        let candidate = run_dir.join(name);
        let parent_canon = run_dir
            .canonicalize()
            .map_err(|e| format!("解析 run_dir 失败: {e}"))?;
        let candidate_parent = candidate.parent().unwrap_or(&run_dir);
        let candidate_parent_canon = match candidate_parent.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                fs::create_dir_all(candidate_parent)
                    .map_err(|e| format!("创建 bundle 目录失败: {e}"))?;
                candidate_parent
                    .canonicalize()
                    .map_err(|e| format!("解析 bundle 目录失败: {e}"))?
            }
        };
        if !candidate_parent_canon.starts_with(&parent_canon) {
            return Err(format!("bundle 文件名越界: {name}"));
        }
        fs::write(&candidate, content).map_err(|e| format!("写 bundle {name} 失败: {e}"))?;
    }

    let effective_prompt = inject_run_dir_into_prompt(&input.prompt, &run_dir);

    fs::write(run_dir.join("prompt.md"), &effective_prompt)
        .map_err(|e| format!("写 prompt.md 失败: {e}"))?;
    let mut meta = json!({
        "projectRootPath": project_root.to_string_lossy(),
        "runDir": run_dir.to_string_lossy(),
        "parentTaskPath": input.parent_task_path,
        "clusterId": input.cluster_id,
        "model": input.model,
        "timeoutMs": input.timeout_ms,
    });
    if let Some(existing) = read_existing_retry_metadata(&run_dir)? {
        merge_object_fields(&mut meta, existing);
    }
    fs::write(
        run_dir.join("dispatch.meta.json"),
        serde_json::to_string_pretty(&meta).unwrap_or_else(|_| "{}".to_string()),
    )
    .map_err(|e| format!("写 dispatch.meta.json 失败: {e}"))?;

    let stdout_path = run_dir.join("claude.stdout.log");
    let stderr_path = run_dir.join("claude.stderr.log");
    let raw_result_path = run_dir.join("split-result.raw.json");

    let cluster_id = input.cluster_id.clone();
    let _ = app.emit(
        "splitter-progress",
        json!({ "clusterId": &cluster_id, "kind": "started", "message": "Claude 启动中…", "progressPercent": 5 }),
    );

    let claude_path = find_claude_binary()?;
    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(&project_root);
    cmd.arg("--bare");
    cmd.arg("-p").arg(&effective_prompt);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--permission-mode").arg("bypassPermissions");
    if let Some(m) = input.model.as_deref().and_then(trim_model_cli_arg) {
        cmd.arg("--model").arg(m);
    }
    cmd.env(
        "HOME",
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));
    cmd.env_remove("TRELLIS_CONTEXT_ID");
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let started = std::time::Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 Claude stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 Claude stderr".to_string())?;

    // Stream stdout line by line, emitting Tauri events.
    let cluster_for_stdout = cluster_id.clone();
    let app_for_stdout = app.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut full = String::new();
        let mut line_count = 0u64;
        let mut last_idle_emit_ms = 0u128;
        loop {
            let line_timeout = tokio::time::sleep(Duration::from_secs(30));
            tokio::select! {
                result = reader.next_line() => {
                    match result {
                        Ok(Some(line)) => {
                            line_count += 1;
                            full.push_str(&line);
                            full.push('\n');
                            let ts = unix_ms_now();
                            let _ = app_for_stdout.emit(
                                "splitter-output",
                                json!({ "clusterId": &cluster_for_stdout, "line": &line, "timestampMs": ts }),
                            );
                            // Progress: 20-80% based on line count estimate.
                            let pct = 20u64.saturating_add(line_count.min(60)).min(80);
                            if line_count <= 60 && line_count % 10 == 0 {
                                let _ = app_for_stdout.emit(
                                    "splitter-progress",
                                    json!({ "clusterId": &cluster_for_stdout, "kind": "stdout-line", "message": "生成任务中…", "progressPercent": pct }),
                                );
                            }
                            if line.trim_start().starts_with('{') {
                                let _ = app_for_stdout.emit(
                                    "splitter-progress",
                                    json!({ "clusterId": &cluster_for_stdout, "kind": "json-detected", "message": "校验结果中…", "progressPercent": 80 }),
                                );
                            }
                        }
                        Ok(None) => break,
                        Err(_) => break,
                    }
                }
                _ = line_timeout => {
                    // Claude often spends longer than 30s thinking before the final JSON. Report
                    // liveness, but keep the pipe open so the eventual result is not discarded.
                    let now = unix_ms_now();
                    if now.saturating_sub(last_idle_emit_ms) >= 30_000 {
                        last_idle_emit_ms = now;
                        let _ = app_for_stdout.emit(
                            "splitter-progress",
                            json!({ "clusterId": &cluster_for_stdout, "kind": "stdout-idle", "message": "等待 Claude 输出…", "progressPercent": 60 }),
                        );
                    }
                }
            }
        }
        full
    });

    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let timeout_ms = input.timeout_ms.filter(|&t| t > 0);
    let (status_result, timed_out) = if let Some(ms) = timeout_ms {
        let wait = tokio::time::timeout(Duration::from_millis(ms.max(1_000)), child.wait()).await;
        match wait {
            Ok(s) => (
                Some(s.map_err(|e| format!("Claude 进程等待失败: {e}"))?),
                false,
            ),
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                (None, true)
            }
        }
    } else {
        // No timeout — wait indefinitely
        let s = child
            .wait()
            .await
            .map_err(|e| format!("Claude 进程等待失败: {e}"))?;
        (Some(s), false)
    };

    let stdout_text = stdout_task.await.unwrap_or_default();
    let stderr_buf = stderr_task.await.unwrap_or_default();
    let mut stderr_text = String::from_utf8_lossy(&stderr_buf).to_string();
    if timed_out {
        let _ = app.emit(
            "splitter-progress",
            json!({ "clusterId": &cluster_id, "kind": "error", "message": "Claude 超时", "progressPercent": 0 }),
        );
        if !stderr_text.ends_with('\n') && !stderr_text.is_empty() {
            stderr_text.push('\n');
        }
        stderr_text.push_str(&format!(
            "Claude timed out after {} ms\n",
            timeout_ms.unwrap_or(0)
        ));
    }
    fs::write(&stdout_path, &stdout_text).ok();
    fs::write(&stderr_path, &stderr_text).ok();
    let claude_session_id = extract_claude_session_id_from_stdout(&stdout_text);
    let raw_output = extract_split_payload_from_stdout(&stdout_text);
    if let Some(parsed) = raw_output.as_ref() {
        let pretty = serde_json::to_string_pretty(parsed).unwrap_or_else(|_| stdout_text.clone());
        fs::write(&raw_result_path, &pretty).ok();
    } else {
        fs::write(&raw_result_path, &stdout_text).ok();
    }

    let duration_ms = started.elapsed().as_millis() as u64;
    let exit_code = if timed_out {
        124
    } else {
        status_result
            .as_ref()
            .and_then(|status| status.code())
            .unwrap_or(-1)
    };

    let success = exit_code == 0 && raw_output.is_some();
    let final_error_message = if timed_out {
        "Claude 超时".to_string()
    } else if raw_output.is_none() {
        "Claude 输出未包含可解析的 splitter JSON".to_string()
    } else {
        "失败".to_string()
    };
    let _ = app.emit(
        "splitter-progress",
        json!({
            "clusterId": &cluster_id,
            "kind": if success { "completed" } else { "error" },
            "message": if success { "完成" } else { final_error_message.as_str() },
            "progressPercent": if success { 100 } else { 0 },
            "exitCode": exit_code,
            "stdoutPath": stdout_path.to_string_lossy(),
            "stderrPath": stderr_path.to_string_lossy(),
        }),
    );
    let _ = app.emit(
        "splitter-complete",
        json!({
            "clusterId": &cluster_id,
            "status": if success { "succeeded" } else { "failed" },
            "runDir": run_dir.to_string_lossy(),
            "durationMs": duration_ms,
        }),
    );

    // Write run-result.json for background recovery.
    let _ = fs::write(
        run_dir.join("run-result.json"),
        serde_json::to_string_pretty(&json!({
            "runId": &run_id,
            "status": if success { "succeeded" } else { "failed" },
            "exitCode": exit_code,
            "durationMs": duration_ms,
            "clusterId": &cluster_id,
            "claudeSessionId": &claude_session_id,
            "stdoutPath": stdout_path.to_string_lossy(),
            "stderrPath": stderr_path.to_string_lossy(),
            "rawResultPath": raw_result_path.to_string_lossy(),
            "error": if timed_out {
                Some(format!("Claude 超时 ({:?} ms)", timeout_ms))
            } else if raw_output.is_none() {
                Some("Claude 输出未包含可解析的 splitter JSON".to_string())
            } else {
                None
            },
        }))
        .unwrap_or_default(),
    );

    let stdout_truncated_preview = truncate_utf8(&stdout_text, 4096);

    if is_background {
        // Background: emit completion and return. The caller (tokio::spawn) doesn't need the Result.
    }

    Ok(DispatchClusterOutput {
        run_id,
        run_dir: run_dir.to_string_lossy().to_string(),
        exit_code,
        duration_ms,
        stdout_path: stdout_path.to_string_lossy().to_string(),
        stderr_path: stderr_path.to_string_lossy().to_string(),
        raw_result_path: raw_result_path.to_string_lossy().to_string(),
        raw_output,
        stdout_truncated_preview,
        claude_session_id,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackgroundRunToken {
    run_id: String,
    run_dir: String,
}

#[tauri::command]
pub(crate) async fn prd_split_dispatch_cluster_background(
    app: tauri::AppHandle,
    input: DispatchClusterInput,
) -> Result<BackgroundRunToken, String> {
    let runs_base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    fs::create_dir_all(&runs_base).map_err(|e| format!("创建 ~/.wise/prd-runs 失败: {e}"))?;

    let run_id = format!(
        "split-{}-{}",
        sanitize_for_filename(&input.cluster_id),
        unix_ms_now()
    );
    let run_dir = runs_base.join(&run_id);
    fs::create_dir_all(&run_dir)
        .map_err(|e| format!("创建 run_dir 失败 ({}): {e}", run_dir.to_string_lossy()))?;

    let run_dir_str = run_dir.to_string_lossy().to_string();
    let app_clone = app.clone();

    let run_id_for_task = run_id.clone();
    let run_dir_for_task = run_dir.clone();

    tokio::spawn(async move {
        match dispatch_cluster_impl(
            app_clone,
            input,
            true,
            Some((run_id_for_task.clone(), run_dir_for_task.clone())),
        )
        .await
        {
            Ok(_) => {}
            Err(e) => {
                let _ = fs::write(
                    run_dir_for_task.join("run-result.json"),
                    serde_json::to_string_pretty(&json!({
                        "runId": run_id_for_task,
                        "status": "failed",
                        "error": e,
                    }))
                    .unwrap_or_default(),
                );
            }
        }
    });

    Ok(BackgroundRunToken {
        run_id,
        run_dir: run_dir_str,
    })
}

fn sanitize_for_filename(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for c in input.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else if c == '/' || c == '\\' || c == ' ' {
            out.push('-');
        }
    }
    while out.starts_with('-') {
        out.remove(0);
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("cluster");
    }
    out
}

fn required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} 不能为空"));
    }
    Ok(trimmed.to_string())
}

fn resolve_prd_run_dir(run_id: &str) -> Result<PathBuf, String> {
    if run_id.contains('/') || run_id.contains('\\') || run_id.contains("..") {
        return Err("runId 非法".to_string());
    }
    let runs_base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    let run_dir = runs_base.join(run_id);
    if !run_dir.is_dir() {
        return Err(format!("runDir 不存在: {}", run_dir.to_string_lossy()));
    }
    Ok(run_dir)
}

fn read_retry_bundle(run_dir: &Path) -> Result<HashMap<String, String>, String> {
    let mut bundle = HashMap::new();
    let entries = fs::read_dir(run_dir)
        .map_err(|e| format!("读取 runDir 失败 ({}): {e}", run_dir.to_string_lossy()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取 runDir 条目失败: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if matches!(
            name,
            "prompt.md"
                | "dispatch.meta.json"
                | "run-result.json"
                | "claude.stdout.log"
                | "claude.stderr.log"
                | "split-result.raw.json"
        ) {
            continue;
        }
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            continue;
        }
        let content =
            fs::read_to_string(&path).map_err(|e| format!("读取 bundle {name} 失败: {e}"))?;
        bundle.insert(name.to_string(), content);
    }
    Ok(bundle)
}

fn read_json_file(path: &Path, label: &str) -> Result<Value, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("读取 {label} 失败: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("解析 {label} 失败: {e}"))
}

fn patch_json_file(path: PathBuf, patch: impl FnOnce(&mut Value) -> Result<(), String>) -> Result<(), String> {
    let mut value = if path.is_file() {
        read_json_file(&path, path.file_name().and_then(|n| n.to_str()).unwrap_or("json"))?
    } else {
        json!({})
    };
    if !value.is_object() {
        value = json!({});
    }
    patch(&mut value)?;
    fs::write(
        &path,
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string()),
    )
    .map_err(|e| format!("写 {} 失败: {e}", path.to_string_lossy()))
}

fn read_existing_retry_metadata(run_dir: &Path) -> Result<Option<Value>, String> {
    let path = run_dir.join("dispatch.meta.json");
    if !path.is_file() {
        return Ok(None);
    }
    let value = read_json_file(&path, "dispatch.meta.json")?;
    Ok(Some(value))
}

fn load_retry_dispatch_meta(run_dir: &Path, requested_cluster_id: &str) -> Result<Value, String> {
    let meta_path = run_dir.join("dispatch.meta.json");
    if !meta_path.is_file() {
        return Err(format!(
            "dispatch.meta.json 缺失，无法从 runDir 重试: {}",
            run_dir.to_string_lossy()
        ));
    }
    let meta = read_json_file(&meta_path, "dispatch.meta.json")?;
    let old_cluster_id = meta
        .get("clusterId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "dispatch.meta.json 缺少 clusterId".to_string())?;
    if old_cluster_id != requested_cluster_id {
        return Err(format!(
            "clusterId 不匹配：runDir 属于 {old_cluster_id}，请求重试 {requested_cluster_id}"
        ));
    }
    Ok(meta)
}

fn merge_object_fields(target: &mut Value, existing: Value) {
    let (Some(target_obj), Some(existing_obj)) = (target.as_object_mut(), existing.as_object()) else {
        return;
    };
    for key in ["retriedFrom", "retriedFromRunDir", "missionId"] {
        if let Some(value) = existing_obj.get(key) {
            target_obj.insert(key.to_string(), value.clone());
        }
    }
}

fn record_retry_event(
    db: &tauri::State<'_, crate::wise_db::WiseDb>,
    mission_id: &Option<String>,
    old_run_id: &str,
    new_run_id: &str,
    cluster_id: &str,
) {
    let Some(mission_id) = mission_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    let Ok(g) = db.0.lock() else {
        return;
    };
    let event_id = format!("mission_event_{}", uuid::Uuid::new_v4().simple());
    let payload = serde_json::to_string(&json!({
        "oldRunId": old_run_id,
        "newRunId": new_run_id,
        "clusterId": cluster_id,
    }))
    .unwrap_or_else(|_| "{}".to_string());
    let _ = g.execute(
        "INSERT OR IGNORE INTO mission_events (event_id, mission_id, event_type, timestamp, actor, payload_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            event_id,
            mission_id,
            "mission.cluster.retried",
            unix_ms_now() as i64,
            "wise",
            payload
        ],
    );
}

fn unix_ms_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn inject_run_dir_into_prompt(prompt: &str, run_dir: &Path) -> String {
    let run_dir_str = run_dir.to_string_lossy();
    if prompt.contains(run_dir_str.as_ref()) {
        return prompt.to_string();
    }
    let protocol = format!(
        "Run directory: `{}`\nRead all input bundle files from this absolute directory before producing JSON.",
        run_dir_str
    );
    match prompt.split_once('\n') {
        Some((first, rest)) => format!("{first}\n\n{protocol}\n{rest}"),
        None => format!("{prompt}\n\n{protocol}"),
    }
}

fn truncate_utf8(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (idx, ch) in text.chars().enumerate() {
        if idx >= max_chars {
            out.push('…');
            return out;
        }
        out.push(ch);
    }
    out
}

fn extract_claude_session_id_from_stdout(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) != Some("system")
            || value.get("subtype").and_then(|v| v.as_str()) != Some("init")
        {
            continue;
        }
        let sid = value
            .get("session_id")
            .or_else(|| value.get("sessionId"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())?;
        return Some(sid.to_string());
    }
    None
}

fn is_split_payload(value: &Value) -> bool {
    value.is_object() && value.get("tasks").is_some()
}

fn extract_split_payload_from_json_value(value: &Value) -> Option<Value> {
    if is_split_payload(value) {
        return Some(value.clone());
    }
    if value.get("type").and_then(|v| v.as_str()) == Some("result") {
        for key in ["result", "output"] {
            let Some(raw) = value.get(key) else {
                continue;
            };
            if is_split_payload(raw) {
                return Some(raw.clone());
            }
            if let Some(text) = raw.as_str() {
                if let Some(parsed) = extract_json_object(text).filter(is_split_payload) {
                    return Some(parsed);
                }
            }
        }
    }
    if value.get("type").and_then(|v| v.as_str()) == Some("assistant") {
        let blocks = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|content| content.as_array());
        if let Some(blocks) = blocks {
            for block in blocks {
                let text = block
                    .get("text")
                    .and_then(|v| v.as_str())
                    .or_else(|| block.get("thinking").and_then(|v| v.as_str()));
                if let Some(text) = text {
                    if let Some(parsed) = extract_json_object(text).filter(is_split_payload) {
                        return Some(parsed);
                    }
                }
            }
        }
    }
    None
}

fn extract_split_payload_from_stdout(stdout: &str) -> Option<Value> {
    let mut assistant_text = String::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(payload) = extract_split_payload_from_json_value(&value) {
                return Some(payload);
            }
            if value.get("type").and_then(|v| v.as_str()) == Some("assistant") {
                if let Some(blocks) = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|content| content.as_array())
                {
                    for block in blocks {
                        if block.get("type").and_then(|v| v.as_str()) != Some("text") {
                            continue;
                        }
                        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                            assistant_text.push_str(text);
                            assistant_text.push('\n');
                        }
                    }
                }
            }
            continue;
        }
        if let Some(parsed) = extract_json_object(trimmed).filter(is_split_payload) {
            return Some(parsed);
        }
    }
    extract_json_object(&assistant_text)
        .or_else(|| extract_json_object(stdout))
        .filter(is_split_payload)
}

/// 从 Claude stdout 文本中提取首个 `{` 起始的合法 JSON 对象。Claude 可能在 JSON 前后
/// 输出推理文字；本函数容忍前缀文本但要求至少有一个能 `serde_json::from_str` 通过的对象。
fn extract_json_object(stdout: &str) -> Option<Value> {
    let trimmed = stdout.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if v.is_object() {
            return Some(v);
        }
    }
    let bytes = trimmed.as_bytes();
    let mut start = None;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (idx, &byte) in bytes.iter().enumerate() {
        let c = byte as char;
        if in_string {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
            }
            '{' => {
                if depth == 0 {
                    start = Some(idx);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(s) = start {
                        let slice = &trimmed[s..=idx];
                        if let Ok(v) = serde_json::from_str::<Value>(slice) {
                            if v.is_object() {
                                return Some(v);
                            }
                        }
                        start = None;
                    }
                }
            }
            _ => {}
        }
    }
    None
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

    #[test]
    fn sanitize_for_filename_keeps_safe_chars() {
        assert_eq!(sanitize_for_filename("cluster-fe-1"), "cluster-fe-1");
        assert_eq!(sanitize_for_filename("a/b\\c d"), "a-b-c-d");
        assert_eq!(sanitize_for_filename("---"), "cluster");
        assert_eq!(sanitize_for_filename("中文"), "cluster");
    }

    #[test]
    fn retry_metadata_reports_missing_dispatch_meta() {
        let temp = test_temp_dir();
        fs::create_dir_all(&temp).unwrap();
        let result = load_retry_dispatch_meta(&temp, "cluster-fe");
        assert!(result.unwrap_err().contains("dispatch.meta.json 缺失"));
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn retry_metadata_rejects_cluster_mismatch() {
        let temp = test_temp_dir();
        fs::create_dir_all(&temp).unwrap();
        fs::write(
            temp.join("dispatch.meta.json"),
            r#"{"clusterId":"cluster-backend","parentTaskPath":".trellis/tasks/parent"}"#,
        )
        .unwrap();
        let result = load_retry_dispatch_meta(&temp, "cluster-fe");
        assert!(result.unwrap_err().contains("clusterId 不匹配"));
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn patch_json_file_writes_superseded_by() {
        let temp = test_temp_dir();
        fs::create_dir_all(&temp).unwrap();
        let path = temp.join("run-result.json");
        fs::write(&path, r#"{"runId":"run-1","status":"failed"}"#).unwrap();
        patch_json_file(path.clone(), |value| {
            value["superseded_by"] = json!("run-2");
            Ok(())
        })
        .unwrap();
        let patched = read_json_file(&path, "run-result.json").unwrap();
        assert_eq!(patched["runId"], "run-1");
        assert_eq!(patched["superseded_by"], "run-2");
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn extract_json_object_handles_clean_json() {
        let out = extract_json_object(r#"{"tasks":[{"id":"t1"}]}"#).unwrap();
        assert!(out.get("tasks").is_some());
    }

    #[test]
    fn extract_json_object_tolerates_preamble() {
        let stdout = "Reasoning...\nHere is the JSON:\n{\"tasks\":[]}\nTrailing comments";
        let out = extract_json_object(stdout).unwrap();
        assert_eq!(out["tasks"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn extract_json_object_ignores_braces_inside_strings() {
        let stdout = r#"prefix {"description":"contains } char","tasks":[]} tail"#;
        let out = extract_json_object(stdout).unwrap();
        assert!(out.get("tasks").is_some());
    }

    #[test]
    fn extract_json_object_returns_none_on_garbage() {
        assert!(extract_json_object("no json here").is_none());
        assert!(extract_json_object("{ unbalanced").is_none());
    }

    #[test]
    fn inject_run_dir_preserves_active_task_first_line() {
        let prompt = "Active task: .trellis/tasks/parent\n\nNow produce JSON.";
        let out = inject_run_dir_into_prompt(prompt, Path::new("/tmp/wise-run"));
        assert!(out.starts_with("Active task: .trellis/tasks/parent\n"));
        assert!(out.contains("Run directory: `/tmp/wise-run`"));
    }

    #[test]
    fn extract_split_payload_reads_stream_json_result() {
        let stdout = concat!(
            r#"{"type":"system","subtype":"init","session_id":"sid-1"}"#,
            "\n",
            r#"{"type":"result","result":"{\"tasks\":[{\"id\":\"t1\"}]}"}"#,
            "\n"
        );
        let out = extract_split_payload_from_stdout(stdout).unwrap();
        assert_eq!(out["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(
            extract_claude_session_id_from_stdout(stdout).as_deref(),
            Some("sid-1")
        );
    }

    #[test]
    fn truncate_utf8_does_not_split_multibyte_chars() {
        assert_eq!(truncate_utf8("中文abc", 3), "中文a…");
    }

    fn test_temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("wise-retry-test-{}", uuid::Uuid::new_v4().simple()))
    }
}
