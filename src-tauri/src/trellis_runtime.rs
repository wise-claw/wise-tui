use crate::wise_db;
use regex::Regex;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use uuid::Uuid;
use walkdir::WalkDir;

const TRELLIS_RUNTIME_EVENT: &str = "trellis-runtime-event";
const MAX_COMMAND_OUTPUT_BYTES: usize = 16 * 1024;
const MAX_SPEC_CONTENT_BYTES: usize = 512 * 1024;
const SNAPSHOT_PREVIEW_BYTES: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisRuntimeEventRow {
    event_id: String,
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    task_path: Option<String>,
    task_id: Option<String>,
    event_kind: String,
    platform: Option<String>,
    actor: Option<String>,
    correlation_id: Option<String>,
    parent_event_id: Option<String>,
    payload: Value,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisRuntimeRecordEventInput {
    event_id: Option<String>,
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    task_path: Option<String>,
    task_id: Option<String>,
    event_kind: String,
    platform: Option<String>,
    actor: Option<String>,
    correlation_id: Option<String>,
    parent_event_id: Option<String>,
    payload: Option<Value>,
    created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisRuntimeListEventsInput {
    project_id: Option<String>,
    root_path: Option<String>,
    session_id: Option<String>,
    task_path: Option<String>,
    event_kind: Option<String>,
    from: Option<i64>,
    until: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkflowStep {
    id: String,
    title: String,
    phase_id: String,
    required: bool,
    repeatable: bool,
    once: bool,
    raw_heading: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkflowPhase {
    id: String,
    title: String,
    steps: Vec<TrellisWorkflowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkflowStateBlock {
    status: String,
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkflowPlatformBlock {
    platforms: Vec<String>,
    body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkflowValidationIssue {
    severity: String,
    code: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkflowCompiled {
    project_id: Option<String>,
    root_path: String,
    workflow_path: String,
    phases: Vec<TrellisWorkflowPhase>,
    workflow_states: Vec<TrellisWorkflowStateBlock>,
    platform_blocks: Vec<TrellisWorkflowPlatformBlock>,
    validation_issues: Vec<TrellisWorkflowValidationIssue>,
    compiled_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisRuntimeCompileWorkflowInput {
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisTaskLifecycleInput {
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    action: String,
    task_ref: Option<String>,
    title: Option<String>,
    slug: Option<String>,
    parent: Option<String>,
    context_kind: Option<String>,
    context_file: Option<String>,
    context_reason: Option<String>,
    priority: Option<String>,
    assignee: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisTaskLifecycleResult {
    action: String,
    root_path: String,
    task_path: Option<String>,
    status: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    event: TrellisRuntimeEventRow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisAgentRunRow {
    agent_run_id: String,
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    task_path: Option<String>,
    task_id: Option<String>,
    repository_id: Option<i64>,
    repository_path: Option<String>,
    agent_type: String,
    stage: Option<String>,
    status: String,
    current_file: Option<String>,
    started_at: i64,
    updated_at: i64,
    completed_at: Option<i64>,
    last_heartbeat_at: i64,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisAgentRunInput {
    agent_run_id: Option<String>,
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    task_path: Option<String>,
    task_id: Option<String>,
    repository_id: Option<i64>,
    repository_path: Option<String>,
    agent_type: String,
    stage: Option<String>,
    status: String,
    current_file: Option<String>,
    started_at: Option<i64>,
    last_heartbeat_at: Option<i64>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisAgentOwnershipGraphInput {
    project_id: Option<String>,
    root_path: Option<String>,
    session_id: Option<String>,
    task_path: Option<String>,
    include_completed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisAgentGraphNode {
    id: String,
    node_type: String,
    label: String,
    status: Option<String>,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisAgentGraphEdge {
    id: String,
    source: String,
    target: String,
    edge_type: String,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisAgentOwnershipGraph {
    nodes: Vec<TrellisAgentGraphNode>,
    edges: Vec<TrellisAgentGraphEdge>,
    runs: Vec<TrellisAgentRunRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisSpecRevisionInput {
    revision_id: Option<String>,
    project_id: Option<String>,
    root_path: String,
    file_path: String,
    content: String,
    author: Option<String>,
    reason: Option<String>,
    source: Option<String>,
    task_path: Option<String>,
    created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisSpecRevisionRow {
    revision_id: String,
    project_id: Option<String>,
    root_path: String,
    file_path: String,
    file_hash: String,
    content: String,
    author: Option<String>,
    reason: Option<String>,
    source: Option<String>,
    task_path: Option<String>,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisListSpecRevisionsInput {
    project_id: Option<String>,
    root_path: Option<String>,
    file_path: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisOnboardingInput {
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisOnboardingCheck {
    id: String,
    label: String,
    status: String,
    severity: String,
    detail: String,
    evidence: Value,
    suggested_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisOnboardingState {
    project_id: Option<String>,
    root_path: String,
    status: String,
    checks: Vec<TrellisOnboardingCheck>,
    inspected_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisReplayInput {
    project_id: Option<String>,
    root_path: Option<String>,
    session_id: Option<String>,
    task_path: Option<String>,
    from: Option<i64>,
    until: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisReplayEntry {
    entry_id: String,
    entry_type: String,
    timestamp: i64,
    title: String,
    summary: Option<String>,
    project_id: Option<String>,
    root_path: String,
    session_id: Option<String>,
    task_path: Option<String>,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkspaceSnapshotInput {
    project_id: Option<String>,
    root_path: String,
    source: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisSnapshotFile {
    path: String,
    hash: String,
    size_bytes: u64,
    modified_at: Option<i64>,
    preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkspaceSnapshotRow {
    snapshot_id: String,
    project_id: Option<String>,
    root_path: String,
    source: Option<String>,
    reason: Option<String>,
    manifest: Vec<TrellisSnapshotFile>,
    file_count: i64,
    content_hash: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkspaceSnapshotDiffInput {
    before_snapshot_id: String,
    after_snapshot_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkspaceSnapshotDiffRow {
    path: String,
    change_type: String,
    before_hash: Option<String>,
    after_hash: Option<String>,
    before_size_bytes: Option<u64>,
    after_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrellisWorkspaceSnapshotDiff {
    before_snapshot_id: String,
    after_snapshot_id: String,
    added: Vec<TrellisWorkspaceSnapshotDiffRow>,
    removed: Vec<TrellisWorkspaceSnapshotDiffRow>,
    modified: Vec<TrellisWorkspaceSnapshotDiffRow>,
    unchanged: Vec<TrellisWorkspaceSnapshotDiffRow>,
}

#[tauri::command]
pub(crate) fn trellis_runtime_record_event(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisRuntimeRecordEventInput,
) -> Result<TrellisRuntimeEventRow, String> {
    let row = insert_runtime_event(&db, input)?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn trellis_runtime_list_events(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisRuntimeListEventsInput,
) -> Result<Vec<TrellisRuntimeEventRow>, String> {
    list_runtime_events(&db, input)
}

#[tauri::command]
pub(crate) fn trellis_runtime_compile_workflow(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisRuntimeCompileWorkflowInput,
) -> Result<TrellisWorkflowCompiled, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let compiled = compile_workflow_from_root(input.project_id.clone(), &root)?;
    let event = insert_runtime_event(
        &db,
        TrellisRuntimeRecordEventInput {
            event_id: None,
            project_id: input.project_id,
            root_path: compiled.root_path.clone(),
            session_id: input.session_id,
            task_path: None,
            task_id: None,
            event_kind: "trellis.workflow.compiled".to_string(),
            platform: None,
            actor: None,
            correlation_id: None,
            parent_event_id: None,
            payload: Some(json!({
                "phaseCount": compiled.phases.len(),
                "stepCount": compiled.phases.iter().map(|phase| phase.steps.len()).sum::<usize>(),
                "workflowStateCount": compiled.workflow_states.len(),
                "platformBlockCount": compiled.platform_blocks.len(),
                "validationIssues": compiled.validation_issues,
            })),
            created_at: Some(compiled.compiled_at),
        },
    )?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    Ok(compiled)
}

#[tauri::command]
pub(crate) fn trellis_runtime_run_task_lifecycle(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisTaskLifecycleInput,
) -> Result<TrellisTaskLifecycleResult, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let args = build_task_lifecycle_args(&input)?;
    let script = root.join(".trellis").join("scripts").join("task.py");
    if !script.is_file() {
        return Err(".trellis/scripts/task.py 不存在，无法执行 Trellis lifecycle".to_string());
    }

    let output = Command::new("python3")
        .arg(&script)
        .args(&args)
        .current_dir(&root)
        .output()
        .map_err(|e| format!("启动 task.py 失败: {e}"))?;
    let status = if output.status.success() {
        "succeeded"
    } else {
        "failed"
    }
    .to_string();
    let stdout = truncate_bytes(
        &String::from_utf8_lossy(&output.stdout),
        MAX_COMMAND_OUTPUT_BYTES,
    );
    let stderr = truncate_bytes(
        &String::from_utf8_lossy(&output.stderr),
        MAX_COMMAND_OUTPUT_BYTES,
    );
    let task_path = lifecycle_task_path(&root, &input, &stdout);
    let event = insert_runtime_event(
        &db,
        TrellisRuntimeRecordEventInput {
            event_id: None,
            project_id: input.project_id,
            root_path: root.to_string_lossy().to_string(),
            session_id: input.session_id,
            task_path: task_path.clone(),
            task_id: input.task_ref.clone().or_else(|| input.slug.clone()),
            event_kind: format!("trellis.task.{}", input.action.trim()),
            platform: None,
            actor: None,
            correlation_id: None,
            parent_event_id: None,
            payload: Some(json!({
                "action": input.action,
                "args": args,
                "exitCode": output.status.code(),
                "status": status,
                "stdout": stdout,
                "stderr": stderr,
            })),
            created_at: None,
        },
    )?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    Ok(TrellisTaskLifecycleResult {
        action: input.action,
        root_path: root.to_string_lossy().to_string(),
        task_path,
        status,
        exit_code: output.status.code(),
        stdout,
        stderr,
        event,
    })
}

#[tauri::command]
pub(crate) fn trellis_runtime_upsert_agent_run(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisAgentRunInput,
) -> Result<TrellisAgentRunRow, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let now = unix_now_ms();
    let agent_run_id = normalize_optional(input.agent_run_id)
        .unwrap_or_else(|| format!("trellis_agent_{}", Uuid::new_v4().simple()));
    let agent_type = required(input.agent_type, "agentType")?;
    let status = required(input.status, "status")?;
    let started_at = input.started_at.unwrap_or(now);
    let heartbeat = input.last_heartbeat_at.unwrap_or(now);
    let metadata = input.metadata.unwrap_or_else(|| json!({}));
    ensure_json_object(&metadata, "metadata")?;
    let metadata_json = metadata.to_string();
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO trellis_agent_runs (
               agent_run_id, project_id, root_path, session_id, task_path, task_id, repository_id,
               repository_path, agent_type, stage, status, current_file, started_at, updated_at,
               completed_at, last_heartbeat_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, ?16)
             ON CONFLICT(agent_run_id) DO UPDATE SET
               project_id = excluded.project_id,
               root_path = excluded.root_path,
               session_id = excluded.session_id,
               task_path = excluded.task_path,
               task_id = excluded.task_id,
               repository_id = excluded.repository_id,
               repository_path = excluded.repository_path,
               agent_type = excluded.agent_type,
               stage = excluded.stage,
               status = excluded.status,
               current_file = excluded.current_file,
               updated_at = excluded.updated_at,
               completed_at = CASE WHEN excluded.status IN ('succeeded','failed','cancelled','completed') THEN excluded.updated_at ELSE trellis_agent_runs.completed_at END,
               last_heartbeat_at = excluded.last_heartbeat_at,
               metadata_json = excluded.metadata_json",
            params![
                agent_run_id,
                normalize_optional(input.project_id.clone()),
                root.to_string_lossy(),
                normalize_optional(input.session_id.clone()),
                normalize_optional(input.task_path.clone()),
                normalize_optional(input.task_id.clone()),
                input.repository_id,
                normalize_optional(input.repository_path.clone()),
                agent_type,
                normalize_optional(input.stage.clone()),
                status,
                normalize_optional(input.current_file.clone()),
                started_at,
                now,
                heartbeat,
                metadata_json,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_agent_run(&db, &agent_run_id)?
        .ok_or_else(|| "保存后读取 Trellis agent run 失败".to_string())?;
    let event = insert_runtime_event(
        &db,
        TrellisRuntimeRecordEventInput {
            event_id: None,
            project_id: row.project_id.clone(),
            root_path: row.root_path.clone(),
            session_id: row.session_id.clone(),
            task_path: row.task_path.clone(),
            task_id: row.task_id.clone(),
            event_kind: "trellis.agent.upserted".to_string(),
            platform: None,
            actor: None,
            correlation_id: Some(row.agent_run_id.clone()),
            parent_event_id: None,
            payload: Some(json!({ "agentRun": row })),
            created_at: Some(now),
        },
    )?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    read_agent_run(&db, &agent_run_id)?.ok_or_else(|| "Trellis agent run 未找到".to_string())
}

#[tauri::command]
pub(crate) fn trellis_runtime_get_agent_ownership_graph(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisAgentOwnershipGraphInput,
) -> Result<TrellisAgentOwnershipGraph, String> {
    let runs = list_agent_runs(&db, &input)?;
    Ok(build_agent_graph(runs))
}

#[tauri::command]
pub(crate) fn trellis_runtime_record_spec_revision(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisSpecRevisionInput,
) -> Result<TrellisSpecRevisionRow, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    validate_spec_revision_path(&input.file_path)?;
    if input.content.len() > MAX_SPEC_CONTENT_BYTES {
        return Err(format!(
            "spec content exceeds {MAX_SPEC_CONTENT_BYTES} bytes"
        ));
    }
    let revision_id = normalize_optional(input.revision_id)
        .unwrap_or_else(|| format!("trellis_spec_revision_{}", Uuid::new_v4().simple()));
    let created_at = input.created_at.unwrap_or_else(unix_now_ms);
    let file_hash = sha256_hex(input.content.as_bytes());
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO trellis_spec_revisions (
               revision_id, project_id, root_path, file_path, file_hash, content, author,
               reason, source, task_path, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                revision_id,
                normalize_optional(input.project_id.clone()),
                root.to_string_lossy(),
                input.file_path,
                file_hash,
                input.content,
                normalize_optional(input.author),
                normalize_optional(input.reason),
                normalize_optional(input.source),
                normalize_optional(input.task_path),
                created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_spec_revision(&db, &revision_id)?
        .ok_or_else(|| "保存后读取 spec revision 失败".to_string())?;
    let event = insert_runtime_event(
        &db,
        TrellisRuntimeRecordEventInput {
            event_id: None,
            project_id: row.project_id.clone(),
            root_path: row.root_path.clone(),
            session_id: None,
            task_path: row.task_path.clone(),
            task_id: None,
            event_kind: "trellis.spec.revision.recorded".to_string(),
            platform: None,
            actor: row.author.clone(),
            correlation_id: Some(row.revision_id.clone()),
            parent_event_id: None,
            payload: Some(json!({
                "revisionId": row.revision_id,
                "filePath": row.file_path,
                "fileHash": row.file_hash,
                "reason": row.reason,
                "source": row.source,
            })),
            created_at: Some(row.created_at),
        },
    )?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    Ok(row)
}

#[tauri::command]
pub(crate) fn trellis_runtime_list_spec_revisions(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisListSpecRevisionsInput,
) -> Result<Vec<TrellisSpecRevisionRow>, String> {
    list_spec_revisions(&db, input)
}

#[tauri::command]
pub(crate) fn trellis_runtime_get_onboarding_state(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisOnboardingInput,
) -> Result<TrellisOnboardingState, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let state = build_onboarding_state(input.project_id.clone(), &root);
    let event = insert_runtime_event(
        &db,
        TrellisRuntimeRecordEventInput {
            event_id: None,
            project_id: input.project_id,
            root_path: state.root_path.clone(),
            session_id: input.session_id,
            task_path: None,
            task_id: None,
            event_kind: "trellis.onboarding.inspected".to_string(),
            platform: None,
            actor: None,
            correlation_id: None,
            parent_event_id: None,
            payload: Some(json!({
                "status": state.status,
                "checks": state.checks,
            })),
            created_at: Some(state.inspected_at),
        },
    )?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    Ok(state)
}

#[tauri::command]
pub(crate) fn trellis_runtime_get_replay(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisReplayInput,
) -> Result<Vec<TrellisReplayEntry>, String> {
    let limit = input.limit.unwrap_or(300).clamp(1, 1000);
    let mut entries = Vec::new();
    for event in list_runtime_events(
        &db,
        TrellisRuntimeListEventsInput {
            project_id: input.project_id.clone(),
            root_path: input.root_path.clone(),
            session_id: input.session_id.clone(),
            task_path: input.task_path.clone(),
            event_kind: None,
            from: input.from,
            until: input.until,
            limit: Some(limit),
        },
    )? {
        entries.push(TrellisReplayEntry {
            entry_id: event.event_id,
            entry_type: "event".to_string(),
            timestamp: event.created_at,
            title: event.event_kind,
            summary: event
                .payload
                .get("summary")
                .and_then(Value::as_str)
                .map(str::to_string),
            project_id: event.project_id,
            root_path: event.root_path,
            session_id: event.session_id,
            task_path: event.task_path,
            payload: event.payload,
        });
    }
    for run in list_agent_runs(
        &db,
        &TrellisAgentOwnershipGraphInput {
            project_id: input.project_id.clone(),
            root_path: input.root_path.clone(),
            session_id: input.session_id.clone(),
            task_path: input.task_path.clone(),
            include_completed: Some(true),
        },
    )? {
        if in_range(run.updated_at, input.from, input.until) {
            entries.push(TrellisReplayEntry {
                entry_id: run.agent_run_id.clone(),
                entry_type: "agentRun".to_string(),
                timestamp: run.updated_at,
                title: format!("{} {}", run.agent_type, run.status),
                summary: run.current_file.clone(),
                project_id: run.project_id.clone(),
                root_path: run.root_path.clone(),
                session_id: run.session_id.clone(),
                task_path: run.task_path.clone(),
                payload: json!({ "agentRun": run }),
            });
        }
    }
    for revision in list_spec_revisions(
        &db,
        TrellisListSpecRevisionsInput {
            project_id: input.project_id,
            root_path: input.root_path,
            file_path: None,
            limit: Some(limit),
        },
    )? {
        if in_range(revision.created_at, input.from, input.until)
            && optional_eq(revision.task_path.as_deref(), input.task_path.as_deref())
        {
            entries.push(TrellisReplayEntry {
                entry_id: revision.revision_id.clone(),
                entry_type: "specRevision".to_string(),
                timestamp: revision.created_at,
                title: format!("Spec revision {}", revision.file_path),
                summary: revision.reason.clone(),
                project_id: revision.project_id.clone(),
                root_path: revision.root_path.clone(),
                session_id: None,
                task_path: revision.task_path.clone(),
                payload: json!({
                    "revisionId": revision.revision_id,
                    "filePath": revision.file_path,
                    "fileHash": revision.file_hash,
                    "author": revision.author,
                    "source": revision.source,
                }),
            });
        }
    }
    entries.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.entry_type.cmp(&b.entry_type))
            .then_with(|| a.entry_id.cmp(&b.entry_id))
    });
    if entries.len() > limit as usize {
        entries.truncate(limit as usize);
    }
    Ok(entries)
}

#[tauri::command]
pub(crate) fn trellis_runtime_capture_workspace_snapshot(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisWorkspaceSnapshotInput,
) -> Result<TrellisWorkspaceSnapshotRow, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let manifest = capture_workspace_manifest(&root)?;
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|e| format!("序列化 workspace snapshot 失败: {e}"))?;
    let content_hash = sha256_hex(manifest_json.as_bytes());
    let snapshot_id = format!("trellis_snapshot_{}", Uuid::new_v4().simple());
    let created_at = unix_now_ms();
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO trellis_workspace_snapshots (
               snapshot_id, project_id, root_path, source, reason, manifest_json, file_count,
               content_hash, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                snapshot_id,
                normalize_optional(input.project_id.clone()),
                root.to_string_lossy(),
                normalize_optional(input.source.clone()),
                normalize_optional(input.reason.clone()),
                manifest_json,
                manifest.len() as i64,
                content_hash,
                created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_workspace_snapshot(&db, &snapshot_id)?
        .ok_or_else(|| "保存后读取 workspace snapshot 失败".to_string())?;
    let event = insert_runtime_event(
        &db,
        TrellisRuntimeRecordEventInput {
            event_id: None,
            project_id: row.project_id.clone(),
            root_path: row.root_path.clone(),
            session_id: None,
            task_path: None,
            task_id: None,
            event_kind: "trellis.workspace.snapshot.captured".to_string(),
            platform: None,
            actor: None,
            correlation_id: Some(row.snapshot_id.clone()),
            parent_event_id: None,
            payload: Some(json!({
                "snapshotId": row.snapshot_id,
                "fileCount": row.file_count,
                "contentHash": row.content_hash,
                "source": row.source,
                "reason": row.reason,
            })),
            created_at: Some(row.created_at),
        },
    )?;
    let _ = app.emit(TRELLIS_RUNTIME_EVENT, &event);
    Ok(row)
}

#[tauri::command]
pub(crate) fn trellis_runtime_diff_workspace_snapshots(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: TrellisWorkspaceSnapshotDiffInput,
) -> Result<TrellisWorkspaceSnapshotDiff, String> {
    let before = read_workspace_snapshot(&db, &input.before_snapshot_id)?
        .ok_or_else(|| "before snapshot 未找到".to_string())?;
    let after = read_workspace_snapshot(&db, &input.after_snapshot_id)?
        .ok_or_else(|| "after snapshot 未找到".to_string())?;
    Ok(diff_snapshot_manifests(&before, &after))
}

fn insert_runtime_event(
    db: &wise_db::WiseDb,
    input: TrellisRuntimeRecordEventInput,
) -> Result<TrellisRuntimeEventRow, String> {
    let root = canonicalize_existing_dir(&input.root_path)?;
    let event_id = normalize_optional(input.event_id)
        .unwrap_or_else(|| format!("trellis_event_{}", Uuid::new_v4().simple()));
    let event_kind = required(input.event_kind, "eventKind")?;
    let payload = input.payload.unwrap_or_else(|| json!({}));
    ensure_json_object(&payload, "payload")?;
    let payload_json =
        serde_json::to_string(&payload).map_err(|e| format!("序列化 runtime event 失败: {e}"))?;
    let created_at = input.created_at.unwrap_or_else(unix_now_ms);
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO trellis_runtime_events (
               event_id, project_id, root_path, session_id, task_path, task_id, event_kind,
               platform, actor, correlation_id, parent_event_id, payload_json, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                event_id,
                normalize_optional(input.project_id),
                root.to_string_lossy(),
                normalize_optional(input.session_id),
                normalize_optional(input.task_path),
                normalize_optional(input.task_id),
                event_kind,
                normalize_optional(input.platform),
                normalize_optional(input.actor),
                normalize_optional(input.correlation_id),
                normalize_optional(input.parent_event_id),
                payload_json,
                created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    read_runtime_event(db, &event_id)?.ok_or_else(|| "保存后读取 runtime event 失败".to_string())
}

fn read_runtime_event(
    db: &wise_db::WiseDb,
    event_id: &str,
) -> Result<Option<TrellisRuntimeEventRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        runtime_event_select("WHERE event_id = ?1").as_str(),
        params![event_id],
        runtime_event_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn list_runtime_events(
    db: &wise_db::WiseDb,
    input: TrellisRuntimeListEventsInput,
) -> Result<Vec<TrellisRuntimeEventRow>, String> {
    let project = normalize_optional(input.project_id);
    let root = normalize_optional(input.root_path);
    let session = normalize_optional(input.session_id);
    let task = normalize_optional(input.task_path);
    let kind = normalize_optional(input.event_kind);
    let from = input.from.unwrap_or(0);
    let until = input.until.unwrap_or(i64::MAX);
    let limit = input.limit.unwrap_or(200).clamp(1, 1000);
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let sql = format!(
        "{} WHERE (?1 IS NULL OR project_id = ?1)
             AND (?2 IS NULL OR root_path = ?2)
             AND (?3 IS NULL OR session_id = ?3)
             AND (?4 IS NULL OR task_path = ?4)
             AND (?5 IS NULL OR event_kind = ?5)
             AND created_at >= ?6 AND created_at <= ?7
         ORDER BY created_at ASC, event_id ASC
         LIMIT ?8",
        runtime_event_select("")
    );
    let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(
            params![
                project.as_deref(),
                root.as_deref(),
                session.as_deref(),
                task.as_deref(),
                kind.as_deref(),
                from,
                until,
                limit,
            ],
            runtime_event_from_row,
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn runtime_event_select(where_clause: &str) -> String {
    format!(
        "SELECT event_id, project_id, root_path, session_id, task_path, task_id, event_kind,
                platform, actor, correlation_id, parent_event_id, payload_json, created_at
         FROM trellis_runtime_events {where_clause}"
    )
}

fn runtime_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrellisRuntimeEventRow> {
    let raw: String = row.get(11)?;
    let payload = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(TrellisRuntimeEventRow {
        event_id: row.get(0)?,
        project_id: row.get(1)?,
        root_path: row.get(2)?,
        session_id: row.get(3)?,
        task_path: row.get(4)?,
        task_id: row.get(5)?,
        event_kind: row.get(6)?,
        platform: row.get(7)?,
        actor: row.get(8)?,
        correlation_id: row.get(9)?,
        parent_event_id: row.get(10)?,
        payload,
        created_at: row.get(12)?,
    })
}

fn compile_workflow_from_root(
    project_id: Option<String>,
    root: &Path,
) -> Result<TrellisWorkflowCompiled, String> {
    let workflow_path = root.join(".trellis").join("workflow.md");
    let compiled_at = unix_now_ms();
    if !workflow_path.is_file() {
        return Ok(TrellisWorkflowCompiled {
            project_id,
            root_path: root.to_string_lossy().to_string(),
            workflow_path: workflow_path.to_string_lossy().to_string(),
            phases: Vec::new(),
            workflow_states: Vec::new(),
            platform_blocks: Vec::new(),
            validation_issues: vec![TrellisWorkflowValidationIssue {
                severity: "error".to_string(),
                code: "workflow_missing".to_string(),
                message: ".trellis/workflow.md not found".to_string(),
            }],
            compiled_at,
        });
    }
    let raw = fs::read_to_string(&workflow_path).map_err(|e| e.to_string())?;
    let phases = parse_workflow_phases(&raw);
    let workflow_states = parse_workflow_states(&raw);
    let platform_blocks = parse_platform_blocks(&raw);
    let mut validation_issues = Vec::new();
    if phases.is_empty() {
        validation_issues.push(issue("error", "phase_missing", "No workflow phases found"));
    }
    if phases.iter().all(|phase| phase.steps.is_empty()) {
        validation_issues.push(issue("warning", "step_missing", "No workflow steps found"));
    }
    for status in ["no_task", "planning", "in_progress"] {
        if !workflow_states.iter().any(|block| block.status == status) {
            validation_issues.push(issue(
                "warning",
                "workflow_state_missing",
                &format!("Missing workflow-state block: {status}"),
            ));
        }
    }
    Ok(TrellisWorkflowCompiled {
        project_id,
        root_path: root.to_string_lossy().to_string(),
        workflow_path: workflow_path.to_string_lossy().to_string(),
        phases,
        workflow_states,
        platform_blocks,
        validation_issues,
        compiled_at,
    })
}

fn parse_workflow_phases(raw: &str) -> Vec<TrellisWorkflowPhase> {
    let phase_re = Regex::new(r"^## Phase\s+(\d+):\s*(.+?)\s*$").expect("phase regex");
    let step_re = Regex::new(r"^####\s+(\d+\.\d+)\s+(.+?)\s*$").expect("step regex");
    let mut phases = Vec::<TrellisWorkflowPhase>::new();
    let mut current: Option<TrellisWorkflowPhase> = None;
    for line in raw.lines() {
        if let Some(caps) = phase_re.captures(line) {
            if let Some(phase) = current.take() {
                phases.push(phase);
            }
            let id = caps
                .get(1)
                .map(|m| m.as_str())
                .unwrap_or_default()
                .to_string();
            let title = caps
                .get(2)
                .map(|m| m.as_str())
                .unwrap_or_default()
                .to_string();
            current = Some(TrellisWorkflowPhase {
                id,
                title,
                steps: Vec::new(),
            });
            continue;
        }
        if let Some(caps) = step_re.captures(line) {
            if let Some(phase) = current.as_mut() {
                let id = caps
                    .get(1)
                    .map(|m| m.as_str())
                    .unwrap_or_default()
                    .to_string();
                let title = caps
                    .get(2)
                    .map(|m| m.as_str())
                    .unwrap_or_default()
                    .to_string();
                phase.steps.push(TrellisWorkflowStep {
                    id,
                    title: title.clone(),
                    phase_id: phase.id.clone(),
                    required: title.contains("[required"),
                    repeatable: title.contains("repeatable"),
                    once: title.contains("once"),
                    raw_heading: line.to_string(),
                });
            }
        }
    }
    if let Some(phase) = current {
        phases.push(phase);
    }
    phases
}

fn parse_workflow_states(raw: &str) -> Vec<TrellisWorkflowStateBlock> {
    let re = Regex::new(
        r"(?s)\[workflow-state:([A-Za-z0-9_-]+)\]\s*\n(.*?)\n\s*\[/workflow-state:[A-Za-z0-9_-]+\]",
    )
    .expect("workflow-state regex");
    re.captures_iter(raw)
        .filter_map(|caps| {
            Some(TrellisWorkflowStateBlock {
                status: caps.get(1)?.as_str().to_string(),
                body: caps.get(2)?.as_str().trim().to_string(),
            })
        })
        .collect()
}

fn parse_platform_blocks(raw: &str) -> Vec<TrellisWorkflowPlatformBlock> {
    let marker_re = Regex::new(r"^\[(/?)([A-Za-z][^\[\]]*)\]\s*$").expect("marker regex");
    let mut blocks = Vec::new();
    let mut current_platforms: Option<Vec<String>> = None;
    let mut current_lines = Vec::<String>::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[workflow-state:") || trimmed.starts_with("[/workflow-state:") {
            continue;
        }
        if let Some(caps) = marker_re.captures(trimmed) {
            let closing = caps.get(1).map(|m| m.as_str()).unwrap_or_default() == "/";
            let names: Vec<String> = caps
                .get(2)
                .map(|m| m.as_str())
                .unwrap_or_default()
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
            if !closing {
                current_platforms = Some(names);
                current_lines.clear();
            } else if let Some(platforms) = current_platforms.take() {
                blocks.push(TrellisWorkflowPlatformBlock {
                    platforms,
                    body: current_lines.join("\n").trim().to_string(),
                });
                current_lines.clear();
            }
            continue;
        }
        if current_platforms.is_some() {
            current_lines.push(line.to_string());
        }
    }
    blocks
}

fn build_task_lifecycle_args(input: &TrellisTaskLifecycleInput) -> Result<Vec<String>, String> {
    let action = required(input.action.clone(), "action")?;
    let mut args = vec![action.clone()];
    match action.as_str() {
        "create" => {
            args.push(required_opt(input.title.clone(), "title")?);
            if let Some(slug) = normalize_optional(input.slug.clone()) {
                validate_simple_token(&slug, "slug")?;
                args.extend(["--slug".to_string(), slug]);
            }
            if let Some(parent) = normalize_optional(input.parent.clone()) {
                validate_task_ref(&parent)?;
                args.extend(["--parent".to_string(), parent]);
            }
            if let Some(priority) = normalize_optional(input.priority.clone()) {
                validate_simple_token(&priority, "priority")?;
                args.extend(["--priority".to_string(), priority]);
            }
            if let Some(assignee) = normalize_optional(input.assignee.clone()) {
                validate_simple_token(&assignee, "assignee")?;
                args.extend(["--assignee".to_string(), assignee]);
            }
        }
        "start" | "archive" => {
            args.push(required_opt(input.task_ref.clone(), "taskRef")?);
        }
        "finish" | "current" => {}
        "validate" | "list-context" => {
            args.push(required_opt(input.task_ref.clone(), "taskRef")?);
        }
        "add-context" => {
            args.push(required_opt(input.task_ref.clone(), "taskRef")?);
            args.push(required_opt(input.context_kind.clone(), "contextKind")?);
            args.push(required_opt(input.context_file.clone(), "contextFile")?);
            args.push(required_opt(input.context_reason.clone(), "contextReason")?);
        }
        _ => {
            return Err(format!("Unsupported Trellis lifecycle action: {action}"));
        }
    }
    Ok(args)
}

fn lifecycle_task_path(
    root: &Path,
    input: &TrellisTaskLifecycleInput,
    stdout: &str,
) -> Option<String> {
    if let Some(task_ref) = normalize_optional(input.task_ref.clone()) {
        return Some(normalize_task_path(root, &task_ref));
    }
    for line in stdout.lines() {
        if let Some(rest) = line.split("Created task:").nth(1) {
            return Some(format!(
                ".trellis/tasks/{}",
                rest.trim().trim_end_matches('/').to_string()
            ));
        }
    }
    input.slug.as_ref().map(|slug| {
        let prefix = chrono::Local::now().format("%m-%d").to_string();
        format!(".trellis/tasks/{prefix}-{slug}")
    })
}

fn read_agent_run(
    db: &wise_db::WiseDb,
    agent_run_id: &str,
) -> Result<Option<TrellisAgentRunRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        agent_run_select("WHERE agent_run_id = ?1").as_str(),
        params![agent_run_id],
        agent_run_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn list_agent_runs(
    db: &wise_db::WiseDb,
    input: &TrellisAgentOwnershipGraphInput,
) -> Result<Vec<TrellisAgentRunRow>, String> {
    let project = normalize_optional(input.project_id.clone());
    let root = normalize_optional(input.root_path.clone());
    let session = normalize_optional(input.session_id.clone());
    let task = normalize_optional(input.task_path.clone());
    let include_completed = input.include_completed.unwrap_or(false);
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let sql = format!(
        "{} WHERE (?1 IS NULL OR project_id = ?1)
             AND (?2 IS NULL OR root_path = ?2)
             AND (?3 IS NULL OR session_id = ?3)
             AND (?4 IS NULL OR task_path = ?4)
             AND (?5 OR status NOT IN ('succeeded','failed','cancelled','completed'))
         ORDER BY updated_at DESC",
        agent_run_select("")
    );
    let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(
            params![
                project.as_deref(),
                root.as_deref(),
                session.as_deref(),
                task.as_deref(),
                include_completed,
            ],
            agent_run_from_row,
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn agent_run_select(where_clause: &str) -> String {
    format!(
        "SELECT agent_run_id, project_id, root_path, session_id, task_path, task_id,
                repository_id, repository_path, agent_type, stage, status, current_file,
                started_at, updated_at, completed_at, last_heartbeat_at, metadata_json
         FROM trellis_agent_runs {where_clause}"
    )
}

fn agent_run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrellisAgentRunRow> {
    let raw: String = row.get(16)?;
    let metadata = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(TrellisAgentRunRow {
        agent_run_id: row.get(0)?,
        project_id: row.get(1)?,
        root_path: row.get(2)?,
        session_id: row.get(3)?,
        task_path: row.get(4)?,
        task_id: row.get(5)?,
        repository_id: row.get(6)?,
        repository_path: row.get(7)?,
        agent_type: row.get(8)?,
        stage: row.get(9)?,
        status: row.get(10)?,
        current_file: row.get(11)?,
        started_at: row.get(12)?,
        updated_at: row.get(13)?,
        completed_at: row.get(14)?,
        last_heartbeat_at: row.get(15)?,
        metadata,
    })
}

fn build_agent_graph(runs: Vec<TrellisAgentRunRow>) -> TrellisAgentOwnershipGraph {
    let mut nodes = BTreeMap::<String, TrellisAgentGraphNode>::new();
    let mut edges = Vec::<TrellisAgentGraphEdge>::new();
    for run in &runs {
        let agent_id = format!("agent:{}", run.agent_run_id);
        nodes.insert(
            agent_id.clone(),
            TrellisAgentGraphNode {
                id: agent_id.clone(),
                node_type: "agent".to_string(),
                label: run.agent_type.clone(),
                status: Some(run.status.clone()),
                metadata: json!({ "agentRunId": run.agent_run_id, "currentFile": run.current_file }),
            },
        );
        if let Some(task_path) = run.task_path.as_deref() {
            let task_id = format!("task:{task_path}");
            nodes
                .entry(task_id.clone())
                .or_insert(TrellisAgentGraphNode {
                    id: task_id.clone(),
                    node_type: "task".to_string(),
                    label: run.task_id.clone().unwrap_or_else(|| task_path.to_string()),
                    status: None,
                    metadata: json!({ "taskPath": task_path }),
                });
            edges.push(TrellisAgentGraphEdge {
                id: format!("edge:{}:task", run.agent_run_id),
                source: agent_id.clone(),
                target: task_id,
                edge_type: "ownsTask".to_string(),
                metadata: json!({}),
            });
        }
        if let Some(repo) = run.repository_path.as_deref() {
            let repo_id = format!("repo:{repo}");
            nodes
                .entry(repo_id.clone())
                .or_insert(TrellisAgentGraphNode {
                    id: repo_id.clone(),
                    node_type: "repository".to_string(),
                    label: repo.to_string(),
                    status: None,
                    metadata: json!({ "repositoryId": run.repository_id }),
                });
            edges.push(TrellisAgentGraphEdge {
                id: format!("edge:{}:repo", run.agent_run_id),
                source: agent_id.clone(),
                target: repo_id,
                edge_type: "worksInRepository".to_string(),
                metadata: json!({}),
            });
        }
        if let Some(session) = run.session_id.as_deref() {
            let session_id = format!("session:{session}");
            nodes
                .entry(session_id.clone())
                .or_insert(TrellisAgentGraphNode {
                    id: session_id.clone(),
                    node_type: "session".to_string(),
                    label: session.to_string(),
                    status: None,
                    metadata: json!({}),
                });
            edges.push(TrellisAgentGraphEdge {
                id: format!("edge:{}:session", run.agent_run_id),
                source: session_id,
                target: agent_id.clone(),
                edge_type: "spawnedAgent".to_string(),
                metadata: json!({}),
            });
        }
    }
    TrellisAgentOwnershipGraph {
        nodes: nodes.into_values().collect(),
        edges,
        runs,
    }
}

fn read_spec_revision(
    db: &wise_db::WiseDb,
    revision_id: &str,
) -> Result<Option<TrellisSpecRevisionRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        spec_revision_select("WHERE revision_id = ?1").as_str(),
        params![revision_id],
        spec_revision_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn list_spec_revisions(
    db: &wise_db::WiseDb,
    input: TrellisListSpecRevisionsInput,
) -> Result<Vec<TrellisSpecRevisionRow>, String> {
    let project = normalize_optional(input.project_id);
    let root = normalize_optional(input.root_path);
    let file_path = normalize_optional(input.file_path);
    let limit = input.limit.unwrap_or(100).clamp(1, 500);
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let sql = format!(
        "{} WHERE (?1 IS NULL OR project_id = ?1)
             AND (?2 IS NULL OR root_path = ?2)
             AND (?3 IS NULL OR file_path = ?3)
         ORDER BY created_at DESC, revision_id DESC
         LIMIT ?4",
        spec_revision_select("")
    );
    let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(
            params![
                project.as_deref(),
                root.as_deref(),
                file_path.as_deref(),
                limit
            ],
            spec_revision_from_row,
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn spec_revision_select(where_clause: &str) -> String {
    format!(
        "SELECT revision_id, project_id, root_path, file_path, file_hash, content, author,
                reason, source, task_path, created_at
         FROM trellis_spec_revisions {where_clause}"
    )
}

fn spec_revision_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrellisSpecRevisionRow> {
    Ok(TrellisSpecRevisionRow {
        revision_id: row.get(0)?,
        project_id: row.get(1)?,
        root_path: row.get(2)?,
        file_path: row.get(3)?,
        file_hash: row.get(4)?,
        content: row.get(5)?,
        author: row.get(6)?,
        reason: row.get(7)?,
        source: row.get(8)?,
        task_path: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn build_onboarding_state(project_id: Option<String>, root: &Path) -> TrellisOnboardingState {
    let checks = vec![
        check_path(
            "trellis_dir",
            "Trellis directory",
            &root.join(".trellis"),
            true,
            "Run Trellis init for this project.",
        ),
        check_path(
            "task_py",
            "Task lifecycle script",
            &root.join(".trellis/scripts/task.py"),
            false,
            "Re-run Trellis init or repair scripts.",
        ),
        check_path(
            "workflow",
            "Workflow definition",
            &root.join(".trellis/workflow.md"),
            false,
            "Restore .trellis/workflow.md.",
        ),
        check_path(
            "spec",
            "Spec directory",
            &root.join(".trellis/spec"),
            true,
            "Create project spec layers.",
        ),
        check_path(
            "developer_identity",
            "Developer identity",
            &root.join(".trellis/.developer"),
            false,
            "Run .trellis/scripts/init_developer.py.",
        ),
        check_path(
            "codex_hooks",
            "Codex hooks",
            &root.join(".codex/hooks.json"),
            false,
            "Install or approve Codex hooks.",
        ),
        check_path(
            "claude_hooks",
            "Claude hooks",
            &root.join(".claude/settings.json"),
            false,
            "Install Claude hook settings if Claude is used.",
        ),
        check_path(
            "tasks",
            "Task workspace",
            &root.join(".trellis/tasks"),
            true,
            "Create the first Trellis task.",
        ),
    ];
    let status = if checks
        .iter()
        .any(|c| c.status == "fail" && c.severity == "error")
    {
        "blocked"
    } else if checks.iter().any(|c| c.status == "fail") {
        "warning"
    } else {
        "ready"
    }
    .to_string();
    TrellisOnboardingState {
        project_id,
        root_path: root.to_string_lossy().to_string(),
        status,
        checks,
        inspected_at: unix_now_ms(),
    }
}

fn check_path(
    id: &str,
    label: &str,
    path: &Path,
    required: bool,
    suggested_action: &str,
) -> TrellisOnboardingCheck {
    let exists = path.exists();
    TrellisOnboardingCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: if exists { "pass" } else { "fail" }.to_string(),
        severity: if exists {
            "info"
        } else if required {
            "error"
        } else {
            "warning"
        }
        .to_string(),
        detail: if exists {
            format!("Found {}", display_project_path(path))
        } else {
            format!("Missing {}", display_project_path(path))
        },
        evidence: json!({ "path": path.to_string_lossy(), "exists": exists }),
        suggested_action: if exists {
            None
        } else {
            Some(suggested_action.to_string())
        },
    }
}

fn capture_workspace_manifest(root: &Path) -> Result<Vec<TrellisSnapshotFile>, String> {
    let mut files = Vec::new();
    for rel_root in [".trellis", ".codex", ".claude"] {
        collect_snapshot_files(root, rel_root, &mut files)?;
    }
    let skills_dir = root.join(".agents").join("skills");
    if skills_dir.is_dir() {
        for entry in fs::read_dir(&skills_dir)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && entry.file_name().to_string_lossy().starts_with("trellis-")
            {
                let rel = entry
                    .path()
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .to_string();
                collect_snapshot_files(root, &rel, &mut files)?;
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn collect_snapshot_files(
    root: &Path,
    rel_root: &str,
    out: &mut Vec<TrellisSnapshotFile>,
) -> Result<(), String> {
    let base = root.join(rel_root);
    if !base.exists() {
        return Ok(());
    }
    for entry in WalkDir::new(&base)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| should_enter_snapshot_entry(entry))
        .flatten()
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();
        if !is_snapshot_rel_path_allowed(&rel) {
            continue;
        }
        let data = fs::read(path).map_err(|e| format!("读取 snapshot 文件失败 {rel}: {e}"))?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64);
        out.push(TrellisSnapshotFile {
            path: rel,
            hash: sha256_hex(&data),
            size_bytes: metadata.len(),
            modified_at,
            preview: snapshot_preview(&data),
        });
    }
    Ok(())
}

fn should_enter_snapshot_entry(entry: &walkdir::DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    if name == ".git" || name == "node_modules" || name == "target" {
        return false;
    }
    if name == ".runtime" {
        return false;
    }
    true
}

fn is_snapshot_rel_path_allowed(rel: &str) -> bool {
    rel.starts_with(".trellis/")
        || rel.starts_with(".codex/")
        || rel.starts_with(".claude/")
        || rel.starts_with(".agents/skills/trellis-")
}

fn snapshot_preview(data: &[u8]) -> Option<String> {
    if data.iter().take(SNAPSHOT_PREVIEW_BYTES).any(|b| *b == 0) {
        return None;
    }
    let len = data.len().min(SNAPSHOT_PREVIEW_BYTES);
    let preview = String::from_utf8_lossy(&data[..len]).to_string();
    Some(preview)
}

fn read_workspace_snapshot(
    db: &wise_db::WiseDb,
    snapshot_id: &str,
) -> Result<Option<TrellisWorkspaceSnapshotRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT snapshot_id, project_id, root_path, source, reason, manifest_json, file_count,
                content_hash, created_at
         FROM trellis_workspace_snapshots
         WHERE snapshot_id = ?1",
        params![snapshot_id],
        workspace_snapshot_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn workspace_snapshot_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<TrellisWorkspaceSnapshotRow> {
    let raw: String = row.get(5)?;
    let manifest = serde_json::from_str(&raw).unwrap_or_default();
    Ok(TrellisWorkspaceSnapshotRow {
        snapshot_id: row.get(0)?,
        project_id: row.get(1)?,
        root_path: row.get(2)?,
        source: row.get(3)?,
        reason: row.get(4)?,
        manifest,
        file_count: row.get(6)?,
        content_hash: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn diff_snapshot_manifests(
    before: &TrellisWorkspaceSnapshotRow,
    after: &TrellisWorkspaceSnapshotRow,
) -> TrellisWorkspaceSnapshotDiff {
    let before_map: BTreeMap<String, TrellisSnapshotFile> = before
        .manifest
        .iter()
        .cloned()
        .map(|file| (file.path.clone(), file))
        .collect();
    let after_map: BTreeMap<String, TrellisSnapshotFile> = after
        .manifest
        .iter()
        .cloned()
        .map(|file| (file.path.clone(), file))
        .collect();
    let paths: BTreeSet<String> = before_map.keys().chain(after_map.keys()).cloned().collect();
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut unchanged = Vec::new();
    for path in paths {
        let b = before_map.get(&path);
        let a = after_map.get(&path);
        let row = TrellisWorkspaceSnapshotDiffRow {
            path: path.clone(),
            change_type: match (b, a) {
                (None, Some(_)) => "added",
                (Some(_), None) => "removed",
                (Some(before), Some(after)) if before.hash != after.hash => "modified",
                (Some(_), Some(_)) => "unchanged",
                (None, None) => "unchanged",
            }
            .to_string(),
            before_hash: b.map(|file| file.hash.clone()),
            after_hash: a.map(|file| file.hash.clone()),
            before_size_bytes: b.map(|file| file.size_bytes),
            after_size_bytes: a.map(|file| file.size_bytes),
        };
        match row.change_type.as_str() {
            "added" => added.push(row),
            "removed" => removed.push(row),
            "modified" => modified.push(row),
            _ => unchanged.push(row),
        }
    }
    TrellisWorkspaceSnapshotDiff {
        before_snapshot_id: before.snapshot_id.clone(),
        after_snapshot_id: after.snapshot_id.clone(),
        added,
        removed,
        modified,
        unchanged,
    }
}

fn validate_spec_revision_path(path: &str) -> Result<(), String> {
    let trimmed = required(path.to_string(), "filePath")?;
    if trimmed.starts_with('/') || trimmed.contains('\\') {
        return Err("filePath must be repo-relative".to_string());
    }
    let path_obj = Path::new(&trimmed);
    if path_obj.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("filePath escapes project root".to_string());
    }
    if trimmed == ".trellis/workflow.md" || trimmed.starts_with(".trellis/spec/") {
        return Ok(());
    }
    Err("filePath must be .trellis/workflow.md or .trellis/spec/**".to_string())
}

fn canonicalize_existing_dir(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("rootPath 不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("rootPath 必须是绝对路径".to_string());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("rootPath 不存在或无法访问: {e}"))?;
    if !canon.is_dir() {
        return Err("rootPath 必须是目录".to_string());
    }
    Ok(canon)
}

fn normalize_task_path(root: &Path, task_ref: &str) -> String {
    let trimmed = task_ref.trim().trim_start_matches("./");
    if trimmed.starts_with(".trellis/") {
        return trimmed.to_string();
    }
    if trimmed.starts_with("tasks/") {
        return format!(".trellis/{trimmed}");
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        if let Ok(rel) = path.strip_prefix(root) {
            return rel.to_string_lossy().to_string();
        }
        return trimmed.to_string();
    }
    format!(".trellis/tasks/{trimmed}")
}

fn validate_task_ref(value: &str) -> Result<(), String> {
    let trimmed = required(value.to_string(), "taskRef")?;
    if trimmed.contains("..") || trimmed.contains('\\') {
        return Err("taskRef contains invalid path components".to_string());
    }
    Ok(())
}

fn validate_simple_token(value: &str, field: &str) -> Result<(), String> {
    let trimmed = required(value.to_string(), field)?;
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Ok(());
    }
    Err(format!("{field} contains invalid characters"))
}

fn required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(format!("{field} 不能为空"))
    } else {
        Ok(trimmed.to_string())
    }
}

fn required_opt(value: Option<String>, field: &str) -> Result<String, String> {
    value
        .map(|v| required(v, field))
        .unwrap_or_else(|| Err(format!("{field} 不能为空")))
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn ensure_json_object(value: &Value, field: &str) -> Result<(), String> {
    if value.is_object() {
        Ok(())
    } else {
        Err(format!("{field} must be a JSON object"))
    }
}

fn truncate_bytes(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut cut = max_bytes;
    while cut > 0 && !value.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut out = value[..cut].to_string();
    out.push_str("\n<!-- truncated -->");
    out
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn unix_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn issue(severity: &str, code: &str, message: &str) -> TrellisWorkflowValidationIssue {
    TrellisWorkflowValidationIssue {
        severity: severity.to_string(),
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn optional_eq(left: Option<&str>, right: Option<&str>) -> bool {
    match right {
        Some(expected) => left == Some(expected),
        None => true,
    }
}

fn in_range(timestamp: i64, from: Option<i64>, until: Option<i64>) -> bool {
    timestamp >= from.unwrap_or(0) && timestamp <= until.unwrap_or(i64::MAX)
}

fn display_project_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wise_db;
    use rusqlite::Connection;
    use std::sync::Mutex;

    #[test]
    fn workflow_compiler_extracts_phases_steps_and_states() {
        let raw = r#"
## Phase 1: Plan

[workflow-state:planning]
Plan state.
[/workflow-state:planning]

[codex-inline, Kilo]
Inline content.
[/codex-inline, Kilo]

#### 1.0 Create task `[required · once]`

Text.

## Phase 2: Execute

#### 2.1 Implement `[required · repeatable]`
"#;
        let phases = parse_workflow_phases(raw);
        assert_eq!(phases.len(), 2);
        assert_eq!(phases[0].steps[0].id, "1.0");
        assert!(phases[0].steps[0].required);
        assert!(phases[0].steps[0].once);
        let states = parse_workflow_states(raw);
        assert_eq!(states[0].status, "planning");
        let blocks = parse_platform_blocks(raw);
        assert_eq!(blocks[0].platforms, vec!["codex-inline", "Kilo"]);
    }

    #[test]
    fn spec_revision_path_is_constrained() {
        assert!(validate_spec_revision_path(".trellis/workflow.md").is_ok());
        assert!(validate_spec_revision_path(".trellis/spec/tauri/index.md").is_ok());
        assert!(validate_spec_revision_path("src/main.rs").is_err());
        assert!(validate_spec_revision_path("../.trellis/spec/x.md").is_err());
    }

    #[test]
    fn snapshot_diff_classifies_file_changes() {
        let before = TrellisWorkspaceSnapshotRow {
            snapshot_id: "before".to_string(),
            project_id: None,
            root_path: "/tmp/project".to_string(),
            source: None,
            reason: None,
            manifest: vec![
                file("a.md", "1", 1),
                file("b.md", "2", 2),
                file("same.md", "same", 3),
            ],
            file_count: 3,
            content_hash: "before".to_string(),
            created_at: 1,
        };
        let after = TrellisWorkspaceSnapshotRow {
            snapshot_id: "after".to_string(),
            project_id: None,
            root_path: "/tmp/project".to_string(),
            source: None,
            reason: None,
            manifest: vec![
                file("b.md", "changed", 4),
                file("c.md", "3", 5),
                file("same.md", "same", 3),
            ],
            file_count: 3,
            content_hash: "after".to_string(),
            created_at: 2,
        };
        let diff = diff_snapshot_manifests(&before, &after);
        assert_eq!(
            diff.added
                .iter()
                .map(|r| r.path.as_str())
                .collect::<Vec<_>>(),
            vec!["c.md"]
        );
        assert_eq!(
            diff.removed
                .iter()
                .map(|r| r.path.as_str())
                .collect::<Vec<_>>(),
            vec!["a.md"]
        );
        assert_eq!(
            diff.modified
                .iter()
                .map(|r| r.path.as_str())
                .collect::<Vec<_>>(),
            vec!["b.md"]
        );
        assert_eq!(
            diff.unchanged
                .iter()
                .map(|r| r.path.as_str())
                .collect::<Vec<_>>(),
            vec!["same.md"]
        );
    }

    #[test]
    fn runtime_event_round_trips_through_sqlite() {
        let db = runtime_test_db();
        let root = std::env::temp_dir().join(format!(
            "wise-trellis-runtime-test-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        let root_path = root.to_string_lossy().to_string();

        let inserted = insert_runtime_event(
            &db,
            TrellisRuntimeRecordEventInput {
                event_id: Some("event-1".to_string()),
                project_id: Some("project-1".to_string()),
                root_path: root_path.clone(),
                session_id: Some("session-1".to_string()),
                task_path: Some(".trellis/tasks/task-1".to_string()),
                task_id: Some("task-1".to_string()),
                event_kind: "trellis.hook.completed".to_string(),
                platform: Some("codex".to_string()),
                actor: Some("main-session".to_string()),
                correlation_id: Some("correlation-1".to_string()),
                parent_event_id: None,
                payload: Some(json!({ "hook": "after_start", "ok": true })),
                created_at: Some(1234),
            },
        )
        .expect("insert runtime event");

        assert_eq!(inserted.event_id, "event-1");
        assert_eq!(inserted.payload["hook"], "after_start");

        let listed = list_runtime_events(
            &db,
            TrellisRuntimeListEventsInput {
                project_id: Some("project-1".to_string()),
                root_path: Some(inserted.root_path.clone()),
                session_id: Some("session-1".to_string()),
                task_path: Some(".trellis/tasks/task-1".to_string()),
                event_kind: Some("trellis.hook.completed".to_string()),
                from: Some(0),
                until: Some(2000),
                limit: Some(10),
            },
        )
        .expect("list runtime events");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].event_id, "event-1");
        assert_eq!(listed[0].platform.as_deref(), Some("codex"));
        assert_eq!(listed[0].actor.as_deref(), Some("main-session"));
        assert_eq!(listed[0].payload["ok"], true);

        let _ = fs::remove_dir_all(root);
    }

    fn file(path: &str, hash: &str, size: u64) -> TrellisSnapshotFile {
        TrellisSnapshotFile {
            path: path.to_string(),
            hash: hash.to_string(),
            size_bytes: size,
            modified_at: None,
            preview: None,
        }
    }

    fn runtime_test_db() -> wise_db::WiseDb {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(include_str!("../migrations/022_trellis_runtime.sql"))
            .expect("apply runtime migration");
        wise_db::WiseDb(Mutex::new(conn))
    }
}
