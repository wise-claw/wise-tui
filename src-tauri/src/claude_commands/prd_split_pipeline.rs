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
    let entries = fs::read_dir(&tasks_dir)
        .map_err(|e| format!("读取 .trellis/tasks 失败: {e}"))?;
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
}

#[tauri::command]
pub(crate) async fn prd_split_dispatch_cluster(
    input: DispatchClusterInput,
) -> Result<DispatchClusterOutput, String> {
    let project_root = validate_project_root(&input.project_root_path)?;
    // active task 校验：用相对路径或目录名都接受，避免前后端拼路径差异。
    if input.parent_task_path.trim().is_empty() {
        return Err("parent_task_path 不能为空（splitter 调度协议要求 Active task 前缀）".to_string());
    }

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

    // 写入 bundle 文件（前端组装好的输入包：prd.md / requirements-index.json / cluster.json / ...）。
    for (name, content) in &input.bundle {
        // 防御性：禁止路径穿越。
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
        fs::write(&candidate, content)
            .map_err(|e| format!("写 bundle {name} 失败: {e}"))?;
    }

    // 持久化 prompt 与项目根，便于 ops 排错。
    fs::write(run_dir.join("prompt.md"), &input.prompt)
        .map_err(|e| format!("写 prompt.md 失败: {e}"))?;
    fs::write(
        run_dir.join("dispatch.meta.json"),
        serde_json::to_string_pretty(&json!({
            "projectRootPath": project_root.to_string_lossy(),
            "parentTaskPath": input.parent_task_path,
            "clusterId": input.cluster_id,
            "model": input.model,
            "timeoutMs": input.timeout_ms,
        }))
        .unwrap_or_else(|_| "{}".to_string()),
    )
    .map_err(|e| format!("写 dispatch.meta.json 失败: {e}"))?;

    let stdout_path = run_dir.join("claude.stdout.log");
    let stderr_path = run_dir.join("claude.stderr.log");
    let raw_result_path = run_dir.join("split-result.raw.json");

    let claude_path = find_claude_binary()?;
    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(&project_root);
    cmd.arg("-p").arg(&input.prompt);
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
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 Claude 失败: {e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 Claude stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 Claude stderr".to_string())?;

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf).await;
        buf
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let timeout_ms = input.timeout_ms.unwrap_or(180_000).max(1_000);
    let wait = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await;
    let status_result = match wait {
        Ok(s) => s.map_err(|e| format!("Claude 进程等待失败: {e}"))?,
        Err(_) => {
            let _ = child.start_kill();
            return Err(format!("Claude 超时 ({} ms)", timeout_ms));
        }
    };

    let stdout_buf = stdout_task.await.unwrap_or_default();
    let stderr_buf = stderr_task.await.unwrap_or_default();
    fs::write(&stdout_path, &stdout_buf).ok();
    fs::write(&stderr_path, &stderr_buf).ok();

    let stdout_text = String::from_utf8_lossy(&stdout_buf).to_string();
    let raw_output = extract_json_object(&stdout_text);
    if let Some(parsed) = raw_output.as_ref() {
        let pretty = serde_json::to_string_pretty(parsed)
            .unwrap_or_else(|_| stdout_text.clone());
        fs::write(&raw_result_path, &pretty).ok();
    } else {
        fs::write(&raw_result_path, &stdout_text).ok();
    }

    let duration_ms = started.elapsed().as_millis() as u64;
    let exit_code = status_result.code().unwrap_or(-1);

    let stdout_truncated_preview = if stdout_text.len() > 4096 {
        format!("{}…", &stdout_text[..4096])
    } else {
        stdout_text
    };

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

fn unix_ms_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
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
}
