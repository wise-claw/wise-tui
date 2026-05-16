use crate::wise_db;
use git2::{Repository as GitRepository, Status};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;
use uuid::Uuid;

const ASSIGNMENT_CHANGED_EVENT: &str = "mission-agent-assignment-changed";
const MISSION_UPDATED_EVENT: &str = "mission-updated";
const PREVIEW_TTL_MS: i64 = 30 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionSnapshotRow {
    mission_id: String,
    project_id: Option<String>,
    project_name: Option<String>,
    root_path: String,
    prd_hash: Option<String>,
    title: String,
    stage: String,
    status: String,
    snapshot: Value,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionEventRow {
    event_id: String,
    mission_id: String,
    event_type: String,
    timestamp: i64,
    actor: Option<String>,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionAgentAssignmentRow {
    assignment_id: String,
    mission_id: String,
    agent_run_id: Option<String>,
    project_id: Option<String>,
    task_id: Option<String>,
    cluster_id: Option<String>,
    repository_id: Option<i64>,
    repository_path: Option<String>,
    agent_type: String,
    employee_id: Option<String>,
    stage: String,
    status: String,
    current_file: Option<String>,
    session_id: Option<String>,
    started_at: i64,
    updated_at: i64,
    completed_at: Option<i64>,
    last_heartbeat_at: i64,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionCreateOrResumeInput {
    mission_id: Option<String>,
    project_id: Option<String>,
    project_name: Option<String>,
    root_path: String,
    prd_hash: Option<String>,
    title: Option<String>,
    stage: String,
    status: String,
    snapshot: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionAppendEventInput {
    event_id: Option<String>,
    mission_id: String,
    event_type: String,
    timestamp: Option<i64>,
    actor: Option<String>,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionUpsertAgentAssignmentInput {
    assignment_id: Option<String>,
    agent_run_id: Option<String>,
    mission_id: String,
    project_id: Option<String>,
    task_id: Option<String>,
    cluster_id: Option<String>,
    repository_id: Option<i64>,
    repository_path: Option<String>,
    agent_type: String,
    employee_id: Option<String>,
    stage: String,
    status: String,
    current_file: Option<String>,
    session_id: Option<String>,
    started_at: Option<i64>,
    last_heartbeat_at: Option<i64>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionCompleteAgentAssignmentInput {
    assignment_id: Option<String>,
    agent_run_id: Option<String>,
    status: Option<String>,
    completed_at: Option<i64>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionListAssignmentsInput {
    mission_id: Option<String>,
    project_id: Option<String>,
    include_completed: Option<bool>,
    stale_after_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionTraceRequirement {
    id: String,
    content: String,
    body_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionTraceCluster {
    id: String,
    title: String,
    repository_ids: Vec<i64>,
    primary_repository_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionTraceCodeAnchor {
    raw: String,
    file_path: String,
    line: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionTraceTask {
    task_id: String,
    title: String,
    status: Option<String>,
    role: Option<String>,
    priority: Option<String>,
    cluster_id: Option<String>,
    repository_id: Option<i64>,
    repository_path: Option<String>,
    source_requirement_ids: Vec<String>,
    task_path: Option<String>,
    task_name: Option<String>,
    code_anchors: Vec<MissionTraceCodeAnchor>,
    related_files: Vec<String>,
    assignments: Vec<MissionAgentAssignmentRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionRequirementTrace {
    mission_id: String,
    requirement_id: String,
    requirement: Option<MissionTraceRequirement>,
    clusters: Vec<MissionTraceCluster>,
    tasks: Vec<MissionTraceTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionReassignPreviewInput {
    mission_id: String,
    requirement_id: String,
    target_cluster_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionReassignAgentImpact {
    assignment_id: String,
    task_id: Option<String>,
    cluster_id: Option<String>,
    status: String,
    recommended_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionReassignPreview {
    preview_id: String,
    mission_id: String,
    requirement_id: String,
    source_cluster_id: Option<String>,
    target_cluster_id: String,
    affected_clusters: Vec<String>,
    dirty_cluster_count: i64,
    invalidated_task_ids: Vec<String>,
    manual_edit_cluster_ids: Vec<String>,
    dependency_task_ids: Vec<String>,
    agent_impacts: Vec<MissionReassignAgentImpact>,
    created_at: i64,
    expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionCommitReassignInput {
    mission_id: String,
    preview_id: String,
    actor: Option<String>,
    origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionRecordPlanningMutationInput {
    mission_id: String,
    mutation_type: String,
    actor: Option<String>,
    origin: Option<String>,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionSessionBindingRow {
    session_id: String,
    mission_id: String,
    project_id: Option<String>,
    attached_at: i64,
    updated_at: i64,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionAttachSessionInput {
    session_id: String,
    mission_id: String,
    project_id: Option<String>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionInstructionRow {
    instruction_id: String,
    mission_id: String,
    session_id: Option<String>,
    target_kind: String,
    target_id: Option<String>,
    instruction: String,
    actor: Option<String>,
    status: String,
    created_at: i64,
    delivered_at: Option<i64>,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionAppendInstructionInput {
    instruction_id: Option<String>,
    mission_id: String,
    session_id: Option<String>,
    target_kind: String,
    target_id: Option<String>,
    instruction: String,
    actor: Option<String>,
    metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionAgentCommandRow {
    command_id: String,
    mission_id: String,
    command_type: String,
    target_kind: String,
    target_id: Option<String>,
    assignment_id: Option<String>,
    agent_run_id: Option<String>,
    status: String,
    requested_at: i64,
    completed_at: Option<i64>,
    result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionRecordAgentCommandInput {
    command_id: Option<String>,
    mission_id: String,
    command_type: String,
    target_kind: String,
    target_id: Option<String>,
    assignment_id: Option<String>,
    agent_run_id: Option<String>,
    result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionCompleteAgentCommandInput {
    command_id: String,
    status: String,
    result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionEvidenceRow {
    evidence_id: String,
    mission_id: String,
    task_id: Option<String>,
    requirement_id: Option<String>,
    cluster_id: Option<String>,
    agent_run_id: Option<String>,
    repository_path: Option<String>,
    evidence_type: String,
    status: String,
    summary: Option<String>,
    payload: Value,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionRecordEvidenceInput {
    evidence_id: Option<String>,
    mission_id: String,
    task_id: Option<String>,
    requirement_id: Option<String>,
    cluster_id: Option<String>,
    agent_run_id: Option<String>,
    repository_path: Option<String>,
    evidence_type: String,
    status: String,
    summary: Option<String>,
    payload: Value,
    created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionCaptureGitEvidenceInput {
    mission_id: String,
    task_id: Option<String>,
    requirement_id: Option<String>,
    cluster_id: Option<String>,
    agent_run_id: Option<String>,
    repository_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionListEvidenceInput {
    mission_id: String,
    task_id: Option<String>,
    requirement_id: Option<String>,
    repository_path: Option<String>,
    agent_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionReplayInput {
    mission_id: String,
    requirement_id: Option<String>,
    task_id: Option<String>,
    repository_path: Option<String>,
    agent_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionReplayEntry {
    entry_id: String,
    mission_id: String,
    timestamp: i64,
    entry_type: String,
    title: String,
    summary: Option<String>,
    requirement_id: Option<String>,
    task_id: Option<String>,
    cluster_id: Option<String>,
    repository_path: Option<String>,
    agent_run_id: Option<String>,
    payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionOnboardingHealthInput {
    project_id: Option<String>,
    root_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionOnboardingHealthCheck {
    id: String,
    label: String,
    status: String,
    severity: String,
    detail: String,
    suggested_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MissionOnboardingHealthReport {
    project_id: Option<String>,
    root_path: Option<String>,
    status: String,
    checks: Vec<MissionOnboardingHealthCheck>,
}

#[tauri::command]
pub(crate) fn mission_create_or_resume(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionCreateOrResumeInput,
) -> Result<MissionSnapshotRow, String> {
    let mission_id = normalize_optional(input.mission_id)
        .unwrap_or_else(|| format!("mission_{}", Uuid::new_v4().simple()));
    let root_path = required(input.root_path, "rootPath")?;
    let stage = required(input.stage, "stage")?;
    let status = required(input.status, "status")?;
    ensure_object(&input.snapshot, "snapshot")?;
    let title = normalize_optional(input.title).unwrap_or_else(|| "Mission".to_string());
    let now = unix_now_ms();
    let snapshot_json = serde_json::to_string(&input.snapshot)
        .map_err(|e| format!("序列化 mission snapshot 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO mission_runs (
               mission_id, project_id, project_name, root_path, prd_hash, title, stage, status,
               snapshot_json, created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
             ON CONFLICT(mission_id) DO UPDATE SET
               project_id = excluded.project_id,
               project_name = excluded.project_name,
               root_path = excluded.root_path,
               prd_hash = excluded.prd_hash,
               title = excluded.title,
               stage = excluded.stage,
               status = excluded.status,
               snapshot_json = excluded.snapshot_json,
               updated_at = excluded.updated_at",
            params![
                mission_id,
                normalize_optional(input.project_id),
                normalize_optional(input.project_name),
                root_path,
                normalize_optional(input.prd_hash),
                title,
                stage,
                status,
                snapshot_json,
                now
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    read_mission_snapshot(&db, &mission_id)?.ok_or_else(|| "保存后读取 Mission 失败".to_string())
}

#[tauri::command]
pub(crate) fn mission_get_snapshot(
    db: tauri::State<'_, wise_db::WiseDb>,
    mission_id: String,
) -> Result<Option<MissionSnapshotRow>, String> {
    read_mission_snapshot(&db, required(mission_id, "missionId")?.as_str())
}

#[tauri::command]
pub(crate) fn mission_list_recent(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: Option<String>,
    root_path: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<MissionSnapshotRow>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let project = normalize_optional(project_id);
    let root = normalize_optional(root_path);
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut rows = Vec::new();
    match (project.as_deref(), root.as_deref()) {
        (Some(project_id), _) => {
            let mut stmt = g
                .prepare(
                    "SELECT mission_id, project_id, project_name, root_path, prd_hash, title, stage,
                            status, snapshot_json, created_at, updated_at
                     FROM mission_runs
                     WHERE project_id = ?1
                     ORDER BY updated_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![project_id, limit], mission_snapshot_from_row)
                .map_err(|e| e.to_string())?;
            for row in mapped {
                rows.push(row.map_err(|e| e.to_string())?);
            }
        }
        (None, Some(root_path)) => {
            let mut stmt = g
                .prepare(
                    "SELECT mission_id, project_id, project_name, root_path, prd_hash, title, stage,
                            status, snapshot_json, created_at, updated_at
                     FROM mission_runs
                     WHERE root_path = ?1
                     ORDER BY updated_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![root_path, limit], mission_snapshot_from_row)
                .map_err(|e| e.to_string())?;
            for row in mapped {
                rows.push(row.map_err(|e| e.to_string())?);
            }
        }
        (None, None) => {
            let mut stmt = g
                .prepare(
                    "SELECT mission_id, project_id, project_name, root_path, prd_hash, title, stage,
                            status, snapshot_json, created_at, updated_at
                     FROM mission_runs
                     ORDER BY updated_at DESC
                     LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![limit], mission_snapshot_from_row)
                .map_err(|e| e.to_string())?;
            for row in mapped {
                rows.push(row.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(rows)
}

#[tauri::command]
pub(crate) fn mission_append_event(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionAppendEventInput,
) -> Result<MissionEventRow, String> {
    let event_id = normalize_optional(input.event_id)
        .unwrap_or_else(|| format!("mission_event_{}", Uuid::new_v4().simple()));
    let mission_id = required(input.mission_id, "missionId")?;
    let event_type = required(input.event_type, "eventType")?;
    ensure_object(&input.payload, "payload")?;
    let timestamp = input.timestamp.unwrap_or_else(unix_now_ms);
    let payload_json = serde_json::to_string(&input.payload)
        .map_err(|e| format!("序列化 mission event 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, &mission_id)?;
        g.execute(
            "INSERT INTO mission_events (event_id, mission_id, event_type, timestamp, actor, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![event_id, mission_id, event_type, timestamp, normalize_optional(input.actor), payload_json],
        )
        .map_err(|e| e.to_string())?;
    }
    read_mission_event(&db, &event_id)?.ok_or_else(|| "保存后读取 Mission event 失败".to_string())
}

#[tauri::command]
pub(crate) fn mission_list_events(
    db: tauri::State<'_, wise_db::WiseDb>,
    mission_id: String,
    from: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<MissionEventRow>, String> {
    let mission_id = required(mission_id, "missionId")?;
    let from = from.unwrap_or(0);
    let until = until.unwrap_or(i64::MAX);
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = g
        .prepare(
            "SELECT event_id, mission_id, event_type, timestamp, actor, payload_json
             FROM mission_events
             WHERE mission_id = ?1 AND timestamp >= ?2 AND timestamp <= ?3
             ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![mission_id, from, until], mission_event_from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub(crate) fn mission_get_requirement_trace(
    db: tauri::State<'_, wise_db::WiseDb>,
    mission_id: String,
    requirement_id: String,
) -> Result<MissionRequirementTrace, String> {
    let mission_id = required(mission_id, "missionId")?;
    let requirement_id = required(requirement_id, "requirementId")?;
    let snapshot =
        read_mission_snapshot(&db, &mission_id)?.ok_or_else(|| "Mission 未找到".to_string())?;
    let assignments = list_assignments_for_mission(&db, &mission_id, true, None)?;
    Ok(build_requirement_trace(
        &snapshot.snapshot,
        &assignments,
        &mission_id,
        &requirement_id,
    ))
}

#[tauri::command]
pub(crate) fn mission_upsert_agent_assignment(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionUpsertAgentAssignmentInput,
) -> Result<MissionAgentAssignmentRow, String> {
    let assignment_id = normalize_optional(input.assignment_id)
        .or_else(|| {
            resolve_assignment_id_by_agent_run(&db, input.agent_run_id.as_deref())
                .ok()
                .flatten()
        })
        .unwrap_or_else(|| format!("mission_assignment_{}", Uuid::new_v4().simple()));
    let mission_id = required(input.mission_id, "missionId")?;
    let agent_type = required(input.agent_type, "agentType")?;
    let stage = required(input.stage, "stage")?;
    let status = required(input.status, "status")?;
    let now = unix_now_ms();
    let started_at = input.started_at.unwrap_or(now);
    let heartbeat = input.last_heartbeat_at.unwrap_or(now);
    let metadata = input.metadata.unwrap_or_else(|| json!({}));
    ensure_object(&metadata, "metadata")?;
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("序列化 assignment metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, &mission_id)?;
        g.execute(
            "INSERT INTO mission_agent_assignments (
               assignment_id, mission_id, agent_run_id, project_id, task_id, cluster_id, repository_id,
               repository_path, agent_type, employee_id, stage, status, current_file, session_id,
               started_at, updated_at, completed_at, last_heartbeat_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, NULL, ?17, ?18)
             ON CONFLICT(assignment_id) DO UPDATE SET
               agent_run_id = excluded.agent_run_id,
               project_id = excluded.project_id,
               task_id = excluded.task_id,
               cluster_id = excluded.cluster_id,
               repository_id = excluded.repository_id,
               repository_path = excluded.repository_path,
               agent_type = excluded.agent_type,
               employee_id = excluded.employee_id,
               stage = excluded.stage,
               status = excluded.status,
               current_file = excluded.current_file,
               session_id = excluded.session_id,
               updated_at = excluded.updated_at,
               completed_at = CASE WHEN excluded.status IN ('succeeded','failed','cancelled','completed') THEN excluded.updated_at ELSE mission_agent_assignments.completed_at END,
               last_heartbeat_at = excluded.last_heartbeat_at,
               metadata_json = excluded.metadata_json",
            params![
                assignment_id,
                mission_id,
                normalize_optional(input.agent_run_id),
                normalize_optional(input.project_id),
                normalize_optional(input.task_id),
                normalize_optional(input.cluster_id),
                input.repository_id,
                normalize_optional(input.repository_path),
                agent_type,
                normalize_optional(input.employee_id),
                stage,
                status,
                normalize_optional(input.current_file),
                normalize_optional(input.session_id),
                started_at,
                now,
                heartbeat,
                metadata_json
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_assignment(&db, &assignment_id)?
        .ok_or_else(|| "保存后读取 agent assignment 失败".to_string())?;
    let _ = app.emit(ASSIGNMENT_CHANGED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_complete_agent_assignment(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionCompleteAgentAssignmentInput,
) -> Result<MissionAgentAssignmentRow, String> {
    let assignment_id = normalize_optional(input.assignment_id)
        .or_else(|| {
            resolve_assignment_id_by_agent_run(&db, input.agent_run_id.as_deref())
                .ok()
                .flatten()
        })
        .ok_or_else(|| "assignmentId 或 agentRunId 必填".to_string())?;
    let status = normalize_optional(input.status).unwrap_or_else(|| "completed".to_string());
    let completed_at = input.completed_at.unwrap_or_else(unix_now_ms);
    let metadata_json = if let Some(metadata) = input.metadata {
        ensure_object(&metadata, "metadata")?;
        Some(
            serde_json::to_string(&metadata)
                .map_err(|e| format!("序列化 assignment metadata 失败: {e}"))?,
        )
    } else {
        None
    };
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let updated = if let Some(metadata_json) = metadata_json {
            g.execute(
                "UPDATE mission_agent_assignments
                 SET status = ?1, completed_at = ?2, updated_at = ?2, last_heartbeat_at = ?2, metadata_json = ?3
                 WHERE assignment_id = ?4",
                params![status, completed_at, metadata_json, assignment_id],
            )
        } else {
            g.execute(
                "UPDATE mission_agent_assignments
                 SET status = ?1, completed_at = ?2, updated_at = ?2, last_heartbeat_at = ?2
                 WHERE assignment_id = ?3",
                params![status, completed_at, assignment_id],
            )
        }
        .map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err("agent assignment 未找到".to_string());
        }
    }
    let row = read_assignment(&db, &assignment_id)?
        .ok_or_else(|| "更新后读取 agent assignment 失败".to_string())?;
    let _ = app.emit(ASSIGNMENT_CHANGED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_list_agent_assignments(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionListAssignmentsInput,
) -> Result<Vec<MissionAgentAssignmentRow>, String> {
    let mission_id = normalize_optional(input.mission_id);
    let project_id = normalize_optional(input.project_id);
    if mission_id.is_none() && project_id.is_none() {
        return Err("missionId 或 projectId 必填".to_string());
    }
    if let Some(mission_id) = mission_id {
        return list_assignments_for_mission(
            &db,
            &mission_id,
            input.include_completed.unwrap_or(false),
            input.stale_after_ms,
        );
    }
    list_assignments_for_project(
        &db,
        project_id.as_deref().unwrap_or_default(),
        input.include_completed.unwrap_or(false),
        input.stale_after_ms,
    )
}

#[tauri::command]
pub(crate) fn mission_preview_requirement_reassign(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionReassignPreviewInput,
) -> Result<MissionReassignPreview, String> {
    let mission_id = required(input.mission_id, "missionId")?;
    let requirement_id = required(input.requirement_id, "requirementId")?;
    let target_cluster_id = required(input.target_cluster_id, "targetClusterId")?;
    let snapshot =
        read_mission_snapshot(&db, &mission_id)?.ok_or_else(|| "Mission 未找到".to_string())?;
    if !cluster_exists(&snapshot.snapshot, &target_cluster_id) {
        return Err("目标 cluster 未找到".to_string());
    }
    let assignments = list_assignments_for_mission(&db, &mission_id, true, None)?;
    let preview = build_reassign_preview(
        &snapshot.snapshot,
        &assignments,
        &mission_id,
        &requirement_id,
        &target_cluster_id,
        snapshot.updated_at,
    );
    let payload_json = serde_json::to_string(&preview)
        .map_err(|e| format!("序列化 reassign preview 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        g.execute(
            "INSERT INTO mission_reassign_previews (
               preview_id, mission_id, requirement_id, source_cluster_id, target_cluster_id,
               payload_json, created_at, expires_at, committed_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
             ON CONFLICT(preview_id) DO UPDATE SET
               payload_json = excluded.payload_json,
               created_at = excluded.created_at,
               expires_at = excluded.expires_at,
               committed_at = NULL",
            params![
                preview.preview_id,
                preview.mission_id,
                preview.requirement_id,
                preview.source_cluster_id,
                preview.target_cluster_id,
                payload_json,
                preview.created_at,
                preview.expires_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(preview)
}

#[tauri::command]
pub(crate) fn mission_commit_requirement_reassign(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionCommitReassignInput,
) -> Result<MissionSnapshotRow, String> {
    let mission_id = required(input.mission_id, "missionId")?;
    let preview_id = required(input.preview_id, "previewId")?;
    let actor = normalize_optional(input.actor);
    let origin = normalize_optional(input.origin).unwrap_or_else(|| "panel".to_string());
    let now = unix_now_ms();
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let preview = g
        .query_row(
            "SELECT payload_json FROM mission_reassign_previews
             WHERE preview_id = ?1 AND mission_id = ?2",
            params![preview_id, mission_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "reassign preview 未找到".to_string())?;
    let preview: MissionReassignPreview =
        serde_json::from_str(&preview).map_err(|e| format!("reassign preview JSON 无效: {e}"))?;
    if preview.expires_at < now {
        return Err("reassign preview 已过期".to_string());
    }
    let committed_at: Option<i64> = g
        .query_row(
            "SELECT committed_at FROM mission_reassign_previews WHERE preview_id = ?1",
            params![preview.preview_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    if committed_at.is_some() {
        return Err("reassign preview 已提交".to_string());
    }
    let snapshot_row = g
        .query_row(
            "SELECT mission_id, project_id, project_name, root_path, prd_hash, title, stage,
                    status, snapshot_json, created_at, updated_at
             FROM mission_runs
             WHERE mission_id = ?1",
            params![mission_id],
            mission_snapshot_from_row,
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Mission 未找到".to_string())?;
    let mut snapshot = snapshot_row.snapshot;
    apply_reassign_preview_to_snapshot(&mut snapshot, &preview);
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| format!("序列化 mission snapshot 失败: {e}"))?;
    let event_id = format!("mission_event_{}", Uuid::new_v4().simple());
    let event_payload = json!({
        "preview": preview,
        "origin": origin,
        "actor": actor,
    });
    let tx = g.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE mission_runs SET snapshot_json = ?1, updated_at = ?2 WHERE mission_id = ?3",
        params![snapshot_json, now, snapshot_row.mission_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE mission_reassign_previews SET committed_at = ?1 WHERE preview_id = ?2",
        params![now, preview.preview_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO mission_events (event_id, mission_id, event_type, timestamp, actor, payload_json)
         VALUES (?1, ?2, 'mission.requirement.reassigned', ?3, ?4, ?5)",
        params![
            event_id,
            snapshot_row.mission_id,
            now,
            actor,
            event_payload.to_string()
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(g);
    let updated = read_mission_snapshot(&db, &snapshot_row.mission_id)?
        .ok_or_else(|| "更新后读取 Mission 失败".to_string())?;
    let _ = app.emit(MISSION_UPDATED_EVENT, &updated);
    Ok(updated)
}

#[tauri::command]
pub(crate) fn mission_record_planning_mutation(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionRecordPlanningMutationInput,
) -> Result<MissionEventRow, String> {
    let mission_id = required(input.mission_id, "missionId")?;
    let mutation_type = required(input.mutation_type, "mutationType")?;
    ensure_object(&input.payload, "payload")?;
    let event_type = if mutation_type.starts_with("mission.") {
        mutation_type
    } else {
        format!("mission.planning.{mutation_type}")
    };
    let event = insert_mission_event(
        &db,
        &mission_id,
        &event_type,
        normalize_optional(input.actor),
        json!({
            "origin": normalize_optional(input.origin).unwrap_or_else(|| "panel".to_string()),
            "mutation": input.payload,
        }),
        unix_now_ms(),
    )?;
    let _ = app.emit(MISSION_UPDATED_EVENT, &event);
    Ok(event)
}

#[tauri::command]
pub(crate) fn mission_attach_to_session(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionAttachSessionInput,
) -> Result<MissionSessionBindingRow, String> {
    let session_id = required(input.session_id, "sessionId")?;
    let mission_id = required(input.mission_id, "missionId")?;
    let now = unix_now_ms();
    let metadata = input.metadata.unwrap_or_else(|| json!({}));
    ensure_object(&metadata, "metadata")?;
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("序列化 session metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, &mission_id)?;
        g.execute(
            "INSERT INTO mission_session_bindings (
               session_id, mission_id, project_id, attached_at, updated_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)
             ON CONFLICT(session_id) DO UPDATE SET
               mission_id = excluded.mission_id,
               project_id = excluded.project_id,
               updated_at = excluded.updated_at,
               metadata_json = excluded.metadata_json",
            params![
                session_id,
                mission_id,
                normalize_optional(input.project_id),
                now,
                metadata_json
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_session_binding(&db, &session_id)?
        .ok_or_else(|| "保存后读取 session binding 失败".to_string())?;
    let _ = insert_mission_event(
        &db,
        &row.mission_id,
        "mission.session.attached",
        None,
        json!({ "sessionId": row.session_id, "projectId": row.project_id }),
        now,
    );
    let _ = app.emit(MISSION_UPDATED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_get_session_mission(
    db: tauri::State<'_, wise_db::WiseDb>,
    session_id: String,
) -> Result<Option<MissionSnapshotRow>, String> {
    let session_id = required(session_id, "sessionId")?;
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mission_id: Option<String> = g
        .query_row(
            "SELECT mission_id FROM mission_session_bindings WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    drop(g);
    match mission_id {
        Some(id) => read_mission_snapshot(&db, &id),
        None => Ok(None),
    }
}

#[tauri::command]
pub(crate) fn mission_append_instruction(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionAppendInstructionInput,
) -> Result<MissionInstructionRow, String> {
    let instruction_id = normalize_optional(input.instruction_id)
        .unwrap_or_else(|| format!("mission_instruction_{}", Uuid::new_v4().simple()));
    let mission_id = required(input.mission_id, "missionId")?;
    let target_kind = required(input.target_kind, "targetKind")?;
    let instruction = required(input.instruction, "instruction")?;
    let now = unix_now_ms();
    let metadata = input.metadata.unwrap_or_else(|| json!({}));
    ensure_object(&metadata, "metadata")?;
    let metadata_json = serde_json::to_string(&metadata)
        .map_err(|e| format!("序列化 instruction metadata 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, &mission_id)?;
        g.execute(
            "INSERT INTO mission_instructions (
               instruction_id, mission_id, session_id, target_kind, target_id, instruction,
               actor, status, created_at, delivered_at, metadata_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, NULL, ?9)",
            params![
                instruction_id,
                mission_id,
                normalize_optional(input.session_id),
                target_kind,
                normalize_optional(input.target_id),
                instruction,
                normalize_optional(input.actor),
                now,
                metadata_json
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_instruction(&db, &instruction_id)?
        .ok_or_else(|| "保存后读取 instruction 失败".to_string())?;
    let _ = insert_mission_event(
        &db,
        &row.mission_id,
        "mission.instruction.appended",
        row.actor.clone(),
        json!({
            "instructionId": row.instruction_id,
            "sessionId": row.session_id,
            "targetKind": row.target_kind,
            "targetId": row.target_id,
            "instruction": row.instruction,
        }),
        now,
    );
    let _ = app.emit(MISSION_UPDATED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_record_agent_command(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionRecordAgentCommandInput,
) -> Result<MissionAgentCommandRow, String> {
    let command_id = normalize_optional(input.command_id)
        .unwrap_or_else(|| format!("mission_agent_command_{}", Uuid::new_v4().simple()));
    let mission_id = required(input.mission_id, "missionId")?;
    let command_type = required(input.command_type, "commandType")?;
    let target_kind = required(input.target_kind, "targetKind")?;
    let now = unix_now_ms();
    let result = input
        .result
        .unwrap_or_else(|| default_agent_command_result(&command_type));
    ensure_object(&result, "result")?;
    let status = default_agent_command_status(&command_type);
    let completed_at = if status == "unsupported" {
        Some(now)
    } else {
        None
    };
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, &mission_id)?;
        g.execute(
            "INSERT INTO mission_agent_commands (
               command_id, mission_id, command_type, target_kind, target_id, assignment_id,
               agent_run_id, status, requested_at, completed_at, result_json
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                command_id,
                mission_id,
                command_type,
                target_kind,
                normalize_optional(input.target_id),
                normalize_optional(input.assignment_id),
                normalize_optional(input.agent_run_id),
                status,
                now,
                completed_at,
                result.to_string()
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let row = read_agent_command(&db, &command_id)?
        .ok_or_else(|| "保存后读取 agent command 失败".to_string())?;
    let _ = insert_mission_event(
        &db,
        &row.mission_id,
        &format!("mission.agent_command.{}", row.command_type),
        None,
        json!({
            "commandId": row.command_id,
            "targetKind": row.target_kind,
            "targetId": row.target_id,
            "assignmentId": row.assignment_id,
            "agentRunId": row.agent_run_id,
            "status": row.status,
            "result": row.result,
        }),
        now,
    );
    let _ = app.emit(MISSION_UPDATED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_complete_agent_command(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionCompleteAgentCommandInput,
) -> Result<MissionAgentCommandRow, String> {
    let command_id = required(input.command_id, "commandId")?;
    let status = required(input.status, "status")?;
    let now = unix_now_ms();
    let result = input.result.unwrap_or_else(|| json!({}));
    ensure_object(&result, "result")?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let n = g
            .execute(
                "UPDATE mission_agent_commands
                 SET status = ?1, completed_at = ?2, result_json = ?3
                 WHERE command_id = ?4",
                params![status, now, result.to_string(), command_id],
            )
            .map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("agent command 未找到".to_string());
        }
    }
    let row = read_agent_command(&db, &command_id)?
        .ok_or_else(|| "更新后读取 agent command 失败".to_string())?;
    let _ = insert_mission_event(
        &db,
        &row.mission_id,
        "mission.agent_command.completed",
        None,
        json!({ "commandId": row.command_id, "status": row.status, "result": row.result }),
        now,
    );
    let _ = app.emit(MISSION_UPDATED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_record_evidence(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionRecordEvidenceInput,
) -> Result<MissionEvidenceRow, String> {
    let row = insert_evidence(&db, input)?;
    let _ = app.emit(MISSION_UPDATED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_capture_git_evidence(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionCaptureGitEvidenceInput,
) -> Result<MissionEvidenceRow, String> {
    let mission_id = required(input.mission_id, "missionId")?;
    let repository_path = canonicalize_existing_dir(&input.repository_path)?;
    let payload = capture_git_status_payload(&repository_path)?;
    let file_count = payload
        .get("changedFiles")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(0);
    let row = insert_evidence(
        &db,
        MissionRecordEvidenceInput {
            evidence_id: None,
            mission_id,
            task_id: input.task_id,
            requirement_id: input.requirement_id,
            cluster_id: input.cluster_id,
            agent_run_id: input.agent_run_id,
            repository_path: Some(repository_path.to_string_lossy().to_string()),
            evidence_type: "git_status".to_string(),
            status: "ok".to_string(),
            summary: Some(format!("{file_count} changed file(s)")),
            payload,
            created_at: None,
        },
    )?;
    let _ = app.emit(MISSION_UPDATED_EVENT, &row);
    Ok(row)
}

#[tauri::command]
pub(crate) fn mission_list_evidence(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionListEvidenceInput,
) -> Result<Vec<MissionEvidenceRow>, String> {
    let mission_id = required(input.mission_id, "missionId")?;
    let rows = list_evidence_for_mission(&db, &mission_id)?;
    Ok(rows
        .into_iter()
        .filter(|row| optional_eq(row.task_id.as_deref(), input.task_id.as_deref()))
        .filter(|row| {
            optional_eq(
                row.requirement_id.as_deref(),
                input.requirement_id.as_deref(),
            )
        })
        .filter(|row| {
            optional_eq(
                row.repository_path.as_deref(),
                input.repository_path.as_deref(),
            )
        })
        .filter(|row| optional_eq(row.agent_run_id.as_deref(), input.agent_run_id.as_deref()))
        .collect())
}

#[tauri::command]
pub(crate) fn mission_get_replay(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionReplayInput,
) -> Result<Vec<MissionReplayEntry>, String> {
    let mission_id = required(input.mission_id, "missionId")?;
    let events = list_events_for_mission(&db, &mission_id)?;
    let evidence = list_evidence_for_mission(&db, &mission_id)?;
    let mut entries = Vec::new();
    for event in events {
        if replay_payload_matches(
            &event.payload,
            input.requirement_id.as_deref(),
            input.task_id.as_deref(),
            input.repository_path.as_deref(),
            input.agent_run_id.as_deref(),
        ) {
            entries.push(MissionReplayEntry {
                entry_id: event.event_id,
                mission_id: event.mission_id,
                timestamp: event.timestamp,
                entry_type: "event".to_string(),
                title: event.event_type,
                summary: None,
                requirement_id: string_field(&event.payload, "requirementId"),
                task_id: string_field(&event.payload, "taskId"),
                cluster_id: string_field(&event.payload, "clusterId"),
                repository_path: string_field(&event.payload, "repositoryPath"),
                agent_run_id: string_field(&event.payload, "agentRunId"),
                payload: event.payload,
            });
        }
    }
    for item in evidence {
        if optional_eq(
            item.requirement_id.as_deref(),
            input.requirement_id.as_deref(),
        ) && optional_eq(item.task_id.as_deref(), input.task_id.as_deref())
            && optional_eq(
                item.repository_path.as_deref(),
                input.repository_path.as_deref(),
            )
            && optional_eq(item.agent_run_id.as_deref(), input.agent_run_id.as_deref())
        {
            entries.push(MissionReplayEntry {
                entry_id: item.evidence_id,
                mission_id: item.mission_id,
                timestamp: item.created_at,
                entry_type: "evidence".to_string(),
                title: item.evidence_type,
                summary: item.summary,
                requirement_id: item.requirement_id,
                task_id: item.task_id,
                cluster_id: item.cluster_id,
                repository_path: item.repository_path,
                agent_run_id: item.agent_run_id,
                payload: item.payload,
            });
        }
    }
    entries.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.entry_type.cmp(&b.entry_type))
            .then_with(|| a.entry_id.cmp(&b.entry_id))
    });
    Ok(entries)
}

#[tauri::command]
pub(crate) fn mission_get_onboarding_health(
    db: tauri::State<'_, wise_db::WiseDb>,
    input: MissionOnboardingHealthInput,
) -> Result<MissionOnboardingHealthReport, String> {
    let project_id = normalize_optional(input.project_id);
    let mut root_path = normalize_optional(input.root_path);
    let mut sdd_mode: Option<String> = None;
    let mut main_agent: Option<String> = None;
    let mut repository_ids: Vec<i64> = Vec::new();
    if let Some(project_id) = project_id.as_deref() {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        if let Some((root, sdd, agent)) = g
            .query_row(
                "SELECT root_path, sdd_mode, main_agent FROM projects WHERE id = ?1",
                params![project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            if root_path.is_none() {
                root_path = normalize_optional(Some(root));
            }
            sdd_mode = Some(sdd);
            main_agent = agent;
        }
        let mut stmt = g
            .prepare(
                "SELECT repository_id FROM project_repositories
                 WHERE project_id = ?1
                 ORDER BY display_order ASC, created_at ASC, repository_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(params![project_id], |row| row.get::<_, i64>(0))
            .map_err(|e| e.to_string())?;
        for row in mapped {
            repository_ids.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(build_onboarding_health_report(
        project_id,
        root_path,
        sdd_mode,
        main_agent,
        repository_ids,
    ))
}

fn read_mission_snapshot(
    db: &tauri::State<'_, wise_db::WiseDb>,
    mission_id: &str,
) -> Result<Option<MissionSnapshotRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT mission_id, project_id, project_name, root_path, prd_hash, title, stage,
                status, snapshot_json, created_at, updated_at
         FROM mission_runs
         WHERE mission_id = ?1",
        params![mission_id],
        mission_snapshot_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn read_mission_event(
    db: &tauri::State<'_, wise_db::WiseDb>,
    event_id: &str,
) -> Result<Option<MissionEventRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT event_id, mission_id, event_type, timestamp, actor, payload_json
         FROM mission_events
         WHERE event_id = ?1",
        params![event_id],
        mission_event_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn insert_mission_event(
    db: &tauri::State<'_, wise_db::WiseDb>,
    mission_id: &str,
    event_type: &str,
    actor: Option<String>,
    payload: Value,
    timestamp: i64,
) -> Result<MissionEventRow, String> {
    ensure_object(&payload, "payload")?;
    let event_id = format!("mission_event_{}", Uuid::new_v4().simple());
    let payload_json =
        serde_json::to_string(&payload).map_err(|e| format!("序列化 mission event 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, mission_id)?;
        g.execute(
            "INSERT INTO mission_events (event_id, mission_id, event_type, timestamp, actor, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![event_id, mission_id, event_type, timestamp, actor, payload_json],
        )
        .map_err(|e| e.to_string())?;
    }
    read_mission_event(db, &event_id)?.ok_or_else(|| "保存后读取 Mission event 失败".to_string())
}

fn read_session_binding(
    db: &tauri::State<'_, wise_db::WiseDb>,
    session_id: &str,
) -> Result<Option<MissionSessionBindingRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT session_id, mission_id, project_id, attached_at, updated_at, metadata_json
         FROM mission_session_bindings
         WHERE session_id = ?1",
        params![session_id],
        session_binding_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn session_binding_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionSessionBindingRow> {
    let raw: String = row.get(5)?;
    let metadata = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionSessionBindingRow {
        session_id: row.get(0)?,
        mission_id: row.get(1)?,
        project_id: row.get(2)?,
        attached_at: row.get(3)?,
        updated_at: row.get(4)?,
        metadata,
    })
}

fn read_instruction(
    db: &tauri::State<'_, wise_db::WiseDb>,
    instruction_id: &str,
) -> Result<Option<MissionInstructionRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT instruction_id, mission_id, session_id, target_kind, target_id, instruction,
                actor, status, created_at, delivered_at, metadata_json
         FROM mission_instructions
         WHERE instruction_id = ?1",
        params![instruction_id],
        instruction_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn instruction_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionInstructionRow> {
    let raw: String = row.get(10)?;
    let metadata = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionInstructionRow {
        instruction_id: row.get(0)?,
        mission_id: row.get(1)?,
        session_id: row.get(2)?,
        target_kind: row.get(3)?,
        target_id: row.get(4)?,
        instruction: row.get(5)?,
        actor: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
        delivered_at: row.get(9)?,
        metadata,
    })
}

fn read_agent_command(
    db: &tauri::State<'_, wise_db::WiseDb>,
    command_id: &str,
) -> Result<Option<MissionAgentCommandRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT command_id, mission_id, command_type, target_kind, target_id, assignment_id,
                agent_run_id, status, requested_at, completed_at, result_json
         FROM mission_agent_commands
         WHERE command_id = ?1",
        params![command_id],
        agent_command_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn agent_command_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionAgentCommandRow> {
    let raw: String = row.get(10)?;
    let result = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionAgentCommandRow {
        command_id: row.get(0)?,
        mission_id: row.get(1)?,
        command_type: row.get(2)?,
        target_kind: row.get(3)?,
        target_id: row.get(4)?,
        assignment_id: row.get(5)?,
        agent_run_id: row.get(6)?,
        status: row.get(7)?,
        requested_at: row.get(8)?,
        completed_at: row.get(9)?,
        result,
    })
}

fn insert_evidence(
    db: &tauri::State<'_, wise_db::WiseDb>,
    input: MissionRecordEvidenceInput,
) -> Result<MissionEvidenceRow, String> {
    let evidence_id = normalize_optional(input.evidence_id)
        .unwrap_or_else(|| format!("mission_evidence_{}", Uuid::new_v4().simple()));
    let mission_id = required(input.mission_id, "missionId")?;
    let evidence_type = required(input.evidence_type, "evidenceType")?;
    let status = required(input.status, "status")?;
    ensure_object(&input.payload, "payload")?;
    let created_at = input.created_at.unwrap_or_else(unix_now_ms);
    let payload_json = serde_json::to_string(&input.payload)
        .map_err(|e| format!("序列化 evidence payload 失败: {e}"))?;
    {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        ensure_mission_exists(&g, &mission_id)?;
        g.execute(
            "INSERT INTO mission_evidence (
               evidence_id, mission_id, task_id, requirement_id, cluster_id, agent_run_id,
               repository_path, evidence_type, status, summary, payload_json, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                evidence_id,
                mission_id,
                normalize_optional(input.task_id),
                normalize_optional(input.requirement_id),
                normalize_optional(input.cluster_id),
                normalize_optional(input.agent_run_id),
                normalize_optional(input.repository_path),
                evidence_type,
                status,
                normalize_optional(input.summary),
                payload_json,
                created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    read_evidence(db, &evidence_id)?.ok_or_else(|| "保存后读取 evidence 失败".to_string())
}

fn read_evidence(
    db: &tauri::State<'_, wise_db::WiseDb>,
    evidence_id: &str,
) -> Result<Option<MissionEvidenceRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        evidence_select_sql("WHERE evidence_id = ?1").as_str(),
        params![evidence_id],
        evidence_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn list_evidence_for_mission(
    db: &tauri::State<'_, wise_db::WiseDb>,
    mission_id: &str,
) -> Result<Vec<MissionEvidenceRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let sql = evidence_select_sql("WHERE mission_id = ?1 ORDER BY created_at ASC");
    let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![mission_id], evidence_from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn evidence_select_sql(where_clause: &str) -> String {
    format!(
        "SELECT evidence_id, mission_id, task_id, requirement_id, cluster_id, agent_run_id,
                repository_path, evidence_type, status, summary, payload_json, created_at
         FROM mission_evidence {where_clause}"
    )
}

fn evidence_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionEvidenceRow> {
    let raw: String = row.get(10)?;
    let payload = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionEvidenceRow {
        evidence_id: row.get(0)?,
        mission_id: row.get(1)?,
        task_id: row.get(2)?,
        requirement_id: row.get(3)?,
        cluster_id: row.get(4)?,
        agent_run_id: row.get(5)?,
        repository_path: row.get(6)?,
        evidence_type: row.get(7)?,
        status: row.get(8)?,
        summary: row.get(9)?,
        payload,
        created_at: row.get(11)?,
    })
}

fn list_events_for_mission(
    db: &tauri::State<'_, wise_db::WiseDb>,
    mission_id: &str,
) -> Result<Vec<MissionEventRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = g
        .prepare(
            "SELECT event_id, mission_id, event_type, timestamp, actor, payload_json
             FROM mission_events
             WHERE mission_id = ?1
             ORDER BY timestamp ASC",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![mission_id], mission_event_from_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in mapped {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn read_assignment(
    db: &tauri::State<'_, wise_db::WiseDb>,
    assignment_id: &str,
) -> Result<Option<MissionAgentAssignmentRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        assignment_select_sql("WHERE assignment_id = ?1").as_str(),
        params![assignment_id],
        assignment_from_row,
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn resolve_assignment_id_by_agent_run(
    db: &tauri::State<'_, wise_db::WiseDb>,
    agent_run_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(agent_run_id) = agent_run_id.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    g.query_row(
        "SELECT assignment_id FROM mission_agent_assignments WHERE agent_run_id = ?1",
        params![agent_run_id],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn list_assignments_for_mission(
    db: &tauri::State<'_, wise_db::WiseDb>,
    mission_id: &str,
    include_completed: bool,
    stale_after_ms: Option<i64>,
) -> Result<Vec<MissionAgentAssignmentRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let sql = if include_completed {
        assignment_select_sql("WHERE mission_id = ?1 ORDER BY updated_at DESC")
    } else {
        assignment_select_sql(
            "WHERE mission_id = ?1 AND status NOT IN ('succeeded','failed','cancelled','completed') ORDER BY updated_at DESC",
        )
    };
    let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![mission_id], assignment_from_row)
        .map_err(|e| e.to_string())?;
    collect_assignments(mapped, stale_after_ms)
}

fn list_assignments_for_project(
    db: &tauri::State<'_, wise_db::WiseDb>,
    project_id: &str,
    include_completed: bool,
    stale_after_ms: Option<i64>,
) -> Result<Vec<MissionAgentAssignmentRow>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let sql = if include_completed {
        assignment_select_sql("WHERE project_id = ?1 ORDER BY updated_at DESC")
    } else {
        assignment_select_sql(
            "WHERE project_id = ?1 AND status NOT IN ('succeeded','failed','cancelled','completed') ORDER BY updated_at DESC",
        )
    };
    let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![project_id], assignment_from_row)
        .map_err(|e| e.to_string())?;
    collect_assignments(mapped, stale_after_ms)
}

fn collect_assignments<I>(
    mapped: I,
    stale_after_ms: Option<i64>,
) -> Result<Vec<MissionAgentAssignmentRow>, String>
where
    I: IntoIterator<Item = rusqlite::Result<MissionAgentAssignmentRow>>,
{
    let now = unix_now_ms();
    let mut out = Vec::new();
    for row in mapped {
        let mut item = row.map_err(|e| e.to_string())?;
        if let Some(stale_after) = stale_after_ms.filter(|v| *v > 0) {
            if item.completed_at.is_none()
                && now.saturating_sub(item.last_heartbeat_at) > stale_after
            {
                item.status = "stale".to_string();
            }
        }
        out.push(item);
    }
    Ok(out)
}

fn mission_snapshot_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionSnapshotRow> {
    let raw: String = row.get(8)?;
    let snapshot = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionSnapshotRow {
        mission_id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        root_path: row.get(3)?,
        prd_hash: row.get(4)?,
        title: row.get(5)?,
        stage: row.get(6)?,
        status: row.get(7)?,
        snapshot,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn mission_event_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionEventRow> {
    let raw: String = row.get(5)?;
    let payload = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionEventRow {
        event_id: row.get(0)?,
        mission_id: row.get(1)?,
        event_type: row.get(2)?,
        timestamp: row.get(3)?,
        actor: row.get(4)?,
        payload,
    })
}

fn assignment_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MissionAgentAssignmentRow> {
    let raw: String = row.get(18)?;
    let metadata = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(MissionAgentAssignmentRow {
        assignment_id: row.get(0)?,
        mission_id: row.get(1)?,
        agent_run_id: row.get(2)?,
        project_id: row.get(3)?,
        task_id: row.get(4)?,
        cluster_id: row.get(5)?,
        repository_id: row.get(6)?,
        repository_path: row.get(7)?,
        agent_type: row.get(8)?,
        employee_id: row.get(9)?,
        stage: row.get(10)?,
        status: row.get(11)?,
        current_file: row.get(12)?,
        session_id: row.get(13)?,
        started_at: row.get(14)?,
        updated_at: row.get(15)?,
        completed_at: row.get(16)?,
        last_heartbeat_at: row.get(17)?,
        metadata,
    })
}

fn assignment_select_sql(where_clause: &str) -> String {
    format!(
        "SELECT assignment_id, mission_id, agent_run_id, project_id, task_id, cluster_id,
                repository_id, repository_path, agent_type, employee_id, stage, status,
                current_file, session_id, started_at, updated_at, completed_at,
                last_heartbeat_at, metadata_json
         FROM mission_agent_assignments {where_clause}"
    )
}

fn ensure_mission_exists(conn: &rusqlite::Connection, mission_id: &str) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM mission_runs WHERE mission_id = ?1",
            params![mission_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Err("Mission 未找到".to_string());
    }
    Ok(())
}

fn build_reassign_preview(
    snapshot: &Value,
    assignments: &[MissionAgentAssignmentRow],
    mission_id: &str,
    requirement_id: &str,
    target_cluster_id: &str,
    snapshot_updated_at: i64,
) -> MissionReassignPreview {
    let source_cluster_id = find_cluster_for_requirement(snapshot, requirement_id);
    let mut affected_clusters = Vec::new();
    if let Some(source) = source_cluster_id.as_ref() {
        if source != target_cluster_id {
            affected_clusters.push(source.clone());
        }
    }
    if !affected_clusters
        .iter()
        .any(|cluster_id| cluster_id == target_cluster_id)
    {
        affected_clusters.push(target_cluster_id.to_string());
    }
    affected_clusters.sort();
    let tasks = collect_tasks(snapshot);
    let invalidated_task_ids = tasks
        .values()
        .filter(|task| {
            task.source_requirement_ids
                .iter()
                .any(|id| id == requirement_id)
                || task
                    .cluster_id
                    .as_ref()
                    .is_some_and(|cluster_id| affected_clusters.contains(cluster_id))
        })
        .map(|task| task.task_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let dependency_task_ids = tasks
        .values()
        .filter(|task| {
            task_dependencies(snapshot, &task.task_id)
                .iter()
                .any(|dep| invalidated_task_ids.contains(dep))
        })
        .map(|task| task.task_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let manual_edit_cluster_ids = collect_manual_edit_cluster_ids(snapshot, &affected_clusters);
    let agent_impacts = assignments
        .iter()
        .filter(|assignment| {
            assignment
                .cluster_id
                .as_ref()
                .is_some_and(|cluster_id| affected_clusters.contains(cluster_id))
                || assignment
                    .task_id
                    .as_ref()
                    .is_some_and(|task_id| invalidated_task_ids.contains(task_id))
        })
        .map(|assignment| MissionReassignAgentImpact {
            assignment_id: assignment.assignment_id.clone(),
            task_id: assignment.task_id.clone(),
            cluster_id: assignment.cluster_id.clone(),
            status: assignment.status.clone(),
            recommended_action: if assignment.completed_at.is_none() {
                "cancel_or_retry".to_string()
            } else {
                "retry_if_dirty".to_string()
            },
        })
        .collect();
    let created_at = unix_now_ms();
    MissionReassignPreview {
        preview_id: deterministic_preview_id(
            mission_id,
            requirement_id,
            target_cluster_id,
            snapshot_updated_at,
        ),
        mission_id: mission_id.to_string(),
        requirement_id: requirement_id.to_string(),
        source_cluster_id,
        target_cluster_id: target_cluster_id.to_string(),
        affected_clusters,
        dirty_cluster_count: manual_edit_cluster_ids.len() as i64,
        invalidated_task_ids,
        manual_edit_cluster_ids,
        dependency_task_ids,
        agent_impacts,
        created_at,
        expires_at: created_at.saturating_add(PREVIEW_TTL_MS),
    }
}

fn deterministic_preview_id(
    mission_id: &str,
    requirement_id: &str,
    target_cluster_id: &str,
    snapshot_updated_at: i64,
) -> String {
    let source = format!("{mission_id}:{requirement_id}:{target_cluster_id}:{snapshot_updated_at}");
    format!("mission_preview_{:016x}", fnv1a64(source.as_bytes()))
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn find_cluster_for_requirement(snapshot: &Value, requirement_id: &str) -> Option<String> {
    for cluster in cluster_arrays(snapshot) {
        if string_array_field(cluster, "requirementIds")
            .iter()
            .any(|id| id == requirement_id)
        {
            return string_field(cluster, "id");
        }
    }
    None
}

fn cluster_exists(snapshot: &Value, cluster_id: &str) -> bool {
    cluster_arrays(snapshot)
        .iter()
        .any(|cluster| string_field(cluster, "id").as_deref() == Some(cluster_id))
}

fn collect_manual_edit_cluster_ids(snapshot: &Value, affected_clusters: &[String]) -> Vec<String> {
    let mut out = BTreeSet::new();
    let Some(edits) = snapshot
        .pointer("/editsByCluster")
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    for cluster_id in affected_clusters {
        let Some(value) = edits.get(cluster_id) else {
            continue;
        };
        let has_patches = value
            .get("patches")
            .and_then(Value::as_object)
            .is_some_and(|obj| !obj.is_empty());
        let has_manual = value
            .get("manualTasks")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty());
        let has_deleted = value
            .get("deletedTaskIds")
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty());
        if has_patches || has_manual || has_deleted {
            out.insert(cluster_id.clone());
        }
    }
    out.into_iter().collect()
}

fn task_dependencies(snapshot: &Value, task_id: &str) -> Vec<String> {
    let mut out = Vec::new();
    for run in object_values(snapshot.pointer("/clusterRuns")) {
        for task in run
            .pointer("/normalized/splitTasks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if string_field(task, "id")
                .or_else(|| string_field(task, "taskId"))
                .as_deref()
                == Some(task_id)
            {
                out.extend(string_array_field(task, "dependencies"));
            }
        }
    }
    out
}

fn apply_reassign_preview_to_snapshot(snapshot: &mut Value, preview: &MissionReassignPreview) {
    if !snapshot.is_object() {
        *snapshot = json!({});
    }
    let Some(root) = snapshot.as_object_mut() else {
        return;
    };
    let edits = root
        .entry("clusterPlanEdits".to_string())
        .or_insert_with(|| json!({}));
    if !edits.is_object() {
        *edits = json!({});
    }
    let Some(edits_obj) = edits.as_object_mut() else {
        return;
    };
    let reassigned = edits_obj
        .entry("reassignedRequirements".to_string())
        .or_insert_with(|| json!({}));
    if !reassigned.is_object() {
        *reassigned = json!({});
    }
    if let Some(map) = reassigned.as_object_mut() {
        map.insert(
            preview.requirement_id.clone(),
            Value::String(preview.target_cluster_id.clone()),
        );
    }
    root.insert("lastPlanningMutationAt".to_string(), json!(unix_now_ms()));
    root.insert(
        "lastPlanningMutation".to_string(),
        json!({
            "type": "requirementReassigned",
            "previewId": preview.preview_id,
            "requirementId": preview.requirement_id,
            "sourceClusterId": preview.source_cluster_id,
            "targetClusterId": preview.target_cluster_id,
            "affectedClusters": preview.affected_clusters,
            "invalidatedTaskIds": preview.invalidated_task_ids,
        }),
    );
}

fn default_agent_command_status(command_type: &str) -> String {
    match command_type {
        "pause" => "unsupported".to_string(),
        "cancel" => "requested".to_string(),
        "retry" | "inject_instruction" => "queued".to_string(),
        _ => "recorded".to_string(),
    }
}

fn default_agent_command_result(command_type: &str) -> Value {
    match command_type {
        "pause" => json!({
            "supported": false,
            "message": "Current runtime cannot pause a running process; command is recorded for orchestration."
        }),
        "cancel" => {
            json!({ "supported": false, "message": "Cancel request recorded; runtime-specific cancellation must consume this command." })
        }
        "retry" => json!({ "supported": true, "message": "Retry request recorded." }),
        "inject_instruction" => {
            json!({ "supported": true, "message": "Instruction queued for the target route." })
        }
        _ => json!({ "supported": true }),
    }
}

fn capture_git_status_payload(repository_path: &Path) -> Result<Value, String> {
    let repo = GitRepository::discover(repository_path)
        .map_err(|e| format!("无法读取 Git 仓库状态: {e}"))?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "Git 仓库没有工作区".to_string())?;
    let statuses = repo.statuses(None).map_err(|e| e.to_string())?;
    let mut changed_files = Vec::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or_default().to_string();
        if path.is_empty() {
            continue;
        }
        changed_files.push(json!({
            "path": path,
            "status": git_status_label(entry.status()),
        }));
    }
    Ok(json!({
        "repositoryRoot": workdir.to_string_lossy(),
        "changedFiles": changed_files,
        "changedFileCount": changed_files.len(),
    }))
}

fn git_status_label(status: Status) -> String {
    let mut labels = Vec::new();
    if status.contains(Status::WT_NEW) || status.contains(Status::INDEX_NEW) {
        labels.push("new");
    }
    if status.contains(Status::WT_MODIFIED) || status.contains(Status::INDEX_MODIFIED) {
        labels.push("modified");
    }
    if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
        labels.push("deleted");
    }
    if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
        labels.push("renamed");
    }
    if status.contains(Status::CONFLICTED) {
        labels.push("conflicted");
    }
    if labels.is_empty() {
        labels.push("unknown");
    }
    labels.join(",")
}

fn canonicalize_existing_dir(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path 不能为空".to_string());
    }
    let raw = PathBuf::from(trimmed);
    if !raw.is_absolute() {
        return Err("path 必须是绝对路径".to_string());
    }
    let canonical = fs::canonicalize(&raw).map_err(|e| format!("路径不存在: {e}"))?;
    if !canonical.is_dir() {
        return Err("path 必须是目录".to_string());
    }
    Ok(canonical)
}

fn optional_eq(actual: Option<&str>, expected: Option<&str>) -> bool {
    expected
        .map(|expected| actual == Some(expected))
        .unwrap_or(true)
}

fn replay_payload_matches(
    payload: &Value,
    requirement_id: Option<&str>,
    task_id: Option<&str>,
    repository_path: Option<&str>,
    agent_run_id: Option<&str>,
) -> bool {
    optional_eq(
        string_field(payload, "requirementId").as_deref(),
        requirement_id,
    ) && optional_eq(string_field(payload, "taskId").as_deref(), task_id)
        && optional_eq(
            string_field(payload, "repositoryPath").as_deref(),
            repository_path,
        )
        && optional_eq(string_field(payload, "agentRunId").as_deref(), agent_run_id)
}

fn build_onboarding_health_report(
    project_id: Option<String>,
    root_path: Option<String>,
    sdd_mode: Option<String>,
    main_agent: Option<String>,
    repository_ids: Vec<i64>,
) -> MissionOnboardingHealthReport {
    let mut checks = Vec::new();
    let root = root_path.as_ref().map(PathBuf::from);
    let root_exists = root.as_ref().is_some_and(|path| path.is_dir());
    push_health(
        &mut checks,
        "project_root",
        "Project root",
        root_exists,
        "error",
        root_path
            .as_ref()
            .map(|path| format!("Project root configured: {path}"))
            .unwrap_or_else(|| "Project root is not configured.".to_string()),
        Some("Set the project root to the directory that owns .trellis.".to_string()),
    );
    let trellis_root = root.as_ref().map(|path| path.join(".trellis"));
    push_health(
        &mut checks,
        "trellis_dir",
        ".trellis directory",
        trellis_root.as_ref().is_some_and(|path| path.is_dir()),
        "error",
        ".trellis stores the SDD workflow, specs, tasks, and session context.".to_string(),
        Some("Initialize Trellis for this project.".to_string()),
    );
    push_health(
        &mut checks,
        "workflow_md",
        "Workflow guide",
        trellis_root
            .as_ref()
            .is_some_and(|path| path.join("workflow.md").is_file()),
        "warning",
        ".trellis/workflow.md tells new agents how work should move through the project."
            .to_string(),
        Some("Add or regenerate .trellis/workflow.md.".to_string()),
    );
    push_health(
        &mut checks,
        "trellis_scripts",
        "Trellis scripts",
        trellis_root
            .as_ref()
            .is_some_and(|path| path.join("scripts").is_dir()),
        "warning",
        "Trellis scripts are needed for task lifecycle operations.".to_string(),
        Some("Restore .trellis/scripts for task orchestration.".to_string()),
    );
    push_health(
        &mut checks,
        "project_agents",
        "Project agents",
        root.as_ref()
            .is_some_and(|path| path.join(".agents").join("skills").is_dir())
            || root
                .as_ref()
                .is_some_and(|path| path.join(".claude").join("agents").is_dir()),
        "warning",
        "Project-scoped agents or skills make handoff behavior explicit.".to_string(),
        Some("Add project agent or skill definitions.".to_string()),
    );
    push_health(
        &mut checks,
        "repository_roles",
        "Repository roles",
        !repository_ids.is_empty(),
        "warning",
        format!(
            "{} repository link(s) configured for the project.",
            repository_ids.len()
        ),
        Some("Link repositories and assign role tags.".to_string()),
    );
    push_health(
        &mut checks,
        "main_agent",
        "Main project agent",
        main_agent
            .as_ref()
            .is_some_and(|agent| !agent.trim().is_empty()),
        "info",
        main_agent
            .as_ref()
            .map(|agent| format!("Main agent configured: {agent}"))
            .unwrap_or_else(|| "No main project agent configured.".to_string()),
        Some(
            "Set the main project agent so chat and Mission orchestration can stay aligned."
                .to_string(),
        ),
    );
    push_health(
        &mut checks,
        "sdd_mode",
        "SDD mode",
        sdd_mode.as_deref().unwrap_or("wise_trellis") == "wise_trellis",
        "warning",
        format!(
            "Project SDD mode: {}",
            sdd_mode.unwrap_or_else(|| "wise_trellis".to_string())
        ),
        Some("Use wise_trellis mode for Wise-managed Mission Control.".to_string()),
    );
    let spec_dir_ready = trellis_root
        .as_ref()
        .map(|path| path.join("spec"))
        .is_some_and(|path| dir_has_entries(&path));
    push_health(
        &mut checks,
        "specs",
        "Spec directory",
        spec_dir_ready,
        "warning",
        ".trellis/spec gives new agents coding contracts before implementation.".to_string(),
        Some("Add frontend/backend/spec guide files.".to_string()),
    );
    let has_route = root.as_ref().is_some_and(|path| {
        path.join(".agents/skills/trellis-check/SKILL.md").is_file()
            || path
                .join(".agents/skills/trellis-before-dev/SKILL.md")
                .is_file()
            || path.join(".claude/agents/trellis-implement.md").is_file()
    });
    push_health(
        &mut checks,
        "execution_routes",
        "Implement/check route",
        has_route,
        "warning",
        "At least one implement/check route should be available for Mission execution.".to_string(),
        Some("Install Trellis implement/check skills or agents.".to_string()),
    );
    let status = if checks
        .iter()
        .any(|check| check.status == "fail" && check.severity == "error")
    {
        "blocked"
    } else if checks.iter().any(|check| check.status == "fail") {
        "warning"
    } else {
        "ready"
    }
    .to_string();
    MissionOnboardingHealthReport {
        project_id,
        root_path,
        status,
        checks,
    }
}

fn push_health(
    checks: &mut Vec<MissionOnboardingHealthCheck>,
    id: &str,
    label: &str,
    ok: bool,
    severity: &str,
    detail: String,
    suggested_action: Option<String>,
) {
    checks.push(MissionOnboardingHealthCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: if ok { "pass" } else { "fail" }.to_string(),
        severity: severity.to_string(),
        detail,
        suggested_action: if ok { None } else { suggested_action },
    });
}

fn dir_has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

fn build_requirement_trace(
    snapshot: &Value,
    assignments: &[MissionAgentAssignmentRow],
    mission_id: &str,
    requirement_id: &str,
) -> MissionRequirementTrace {
    let requirements = collect_requirements(snapshot);
    let clusters = collect_clusters(snapshot);
    let tasks = collect_tasks(snapshot);
    let materialized = collect_materialized_tasks(snapshot);
    let assignments_by_task = group_assignments_by_task(assignments);
    let target_requirement = requirements.get(requirement_id).cloned();
    let mut cluster_out = Vec::new();
    for cluster in clusters.values() {
        if cluster_contains_requirement(snapshot, &cluster.id, requirement_id) {
            cluster_out.push(cluster.clone());
        }
    }
    let mut task_out = Vec::new();
    for mut task in tasks.into_values() {
        if !task
            .source_requirement_ids
            .iter()
            .any(|id| id == requirement_id)
        {
            continue;
        }
        if let Some(mat) = materialized.get(&task.task_id) {
            task.task_name = mat.task_name.clone();
            task.task_path = mat.task_path.clone();
        }
        task.assignments = assignments_by_task
            .get(&task.task_id)
            .cloned()
            .unwrap_or_default();
        task_out.push(task);
    }
    task_out.sort_by(|a, b| a.task_id.cmp(&b.task_id));
    cluster_out.sort_by(|a, b| a.id.cmp(&b.id));
    MissionRequirementTrace {
        mission_id: mission_id.to_string(),
        requirement_id: requirement_id.to_string(),
        requirement: target_requirement,
        clusters: cluster_out,
        tasks: task_out,
    }
}

fn collect_requirements(snapshot: &Value) -> BTreeMap<String, MissionTraceRequirement> {
    let mut out = BTreeMap::new();
    let candidates = [
        snapshot.pointer("/requirementsIndex/requirements"),
        snapshot.pointer("/requirementsIndexJson/requirements"),
        snapshot.pointer("/requirements"),
    ];
    for value in candidates.into_iter().flatten() {
        if let Some(items) = value.as_array() {
            for item in items {
                if let Some(id) = string_field(item, "id") {
                    out.insert(
                        id.clone(),
                        MissionTraceRequirement {
                            id,
                            content: string_field(item, "content")
                                .or_else(|| string_field(item, "body"))
                                .or_else(|| string_field(item, "text"))
                                .unwrap_or_default(),
                            body_hash: string_field(item, "bodyHash"),
                        },
                    );
                }
            }
        }
    }
    out
}

fn collect_clusters(snapshot: &Value) -> BTreeMap<String, MissionTraceCluster> {
    let mut out = BTreeMap::new();
    for cluster in cluster_arrays(snapshot) {
        if let Some(id) = string_field(cluster, "id") {
            out.insert(
                id.clone(),
                MissionTraceCluster {
                    id,
                    title: string_field(cluster, "title").unwrap_or_default(),
                    repository_ids: i64_array_field(cluster, "repositoryIds"),
                    primary_repository_id: i64_field(cluster, "primaryRepositoryId"),
                },
            );
        }
    }
    out
}

fn collect_tasks(snapshot: &Value) -> BTreeMap<String, MissionTraceTask> {
    let mut tasks = BTreeMap::new();
    for run in object_values(snapshot.pointer("/clusterRuns")) {
        let cluster_id = string_field(run, "clusterId");
        let status = string_field(run, "status");
        for task in run
            .pointer("/normalized/splitTasks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            insert_task(&mut tasks, task, cluster_id.clone(), status.clone());
        }
    }
    for cluster in cluster_arrays(snapshot) {
        let cluster_id = string_field(cluster, "id");
        for task in cluster
            .pointer("/tasks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            insert_task(&mut tasks, task, cluster_id.clone(), None);
        }
    }
    for task in snapshot
        .pointer("/tasks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        insert_task(
            &mut tasks,
            task,
            string_field(task, "clusterId"),
            string_field(task, "status"),
        );
    }
    tasks
}

fn insert_task(
    tasks: &mut BTreeMap<String, MissionTraceTask>,
    task: &Value,
    cluster_id: Option<String>,
    status: Option<String>,
) {
    let Some(task_id) = string_field(task, "id").or_else(|| string_field(task, "taskId")) else {
        return;
    };
    let source_requirement_ids = string_array_field(task, "sourceRequirementIds");
    let mut related_files = string_array_field(task, "relatedFiles");
    let code_anchors = collect_code_anchors(task);
    for anchor in &code_anchors {
        if !related_files.contains(&anchor.file_path) {
            related_files.push(anchor.file_path.clone());
        }
    }
    let repository_id = i64_field(task, "repositoryId");
    let entry = MissionTraceTask {
        task_id: task_id.clone(),
        title: string_field(task, "title").unwrap_or_else(|| task_id.clone()),
        status,
        role: string_field(task, "role"),
        priority: string_field(task, "priority"),
        cluster_id,
        repository_id,
        repository_path: string_field(task, "repositoryPath"),
        source_requirement_ids,
        task_path: string_field(task, "taskPath"),
        task_name: string_field(task, "taskName"),
        code_anchors,
        related_files,
        assignments: Vec::new(),
    };
    tasks.insert(task_id, entry);
}

#[derive(Clone)]
struct MaterializedTask {
    task_name: Option<String>,
    task_path: Option<String>,
}

fn collect_materialized_tasks(snapshot: &Value) -> BTreeMap<String, MaterializedTask> {
    let mut out = BTreeMap::new();
    for write in snapshot
        .pointer("/writeResults")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for task in write
            .pointer("/childTasks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(source_task_id) = string_field(task, "sourceTaskId") else {
                continue;
            };
            out.insert(
                source_task_id,
                MaterializedTask {
                    task_name: string_field(task, "taskName"),
                    task_path: string_field(task, "taskPath"),
                },
            );
        }
    }
    out
}

fn collect_code_anchors(task: &Value) -> Vec<MissionTraceCodeAnchor> {
    let mut out = Vec::new();
    for raw in string_array_field(task, "sourceRefs") {
        out.push(parse_code_anchor(&raw));
    }
    if let Some(items) = task.get("codeAnchors").and_then(Value::as_array) {
        for item in items {
            if let Some(raw) = string_field(item, "raw") {
                out.push(MissionTraceCodeAnchor {
                    raw: raw.clone(),
                    file_path: string_field(item, "filePath")
                        .unwrap_or_else(|| parse_code_anchor(&raw).file_path),
                    line: i64_field(item, "line"),
                });
            }
        }
    }
    dedupe_code_anchors(out)
}

fn parse_code_anchor(raw: &str) -> MissionTraceCodeAnchor {
    let trimmed = raw.trim();
    let mut file_path = trimmed.to_string();
    let mut line = None;
    if let Some((path, suffix)) = trimmed.rsplit_once(':') {
        if let Ok(parsed) = suffix.parse::<i64>() {
            file_path = path.to_string();
            line = Some(parsed);
        }
    }
    MissionTraceCodeAnchor {
        raw: trimmed.to_string(),
        file_path,
        line,
    }
}

fn dedupe_code_anchors(items: Vec<MissionTraceCodeAnchor>) -> Vec<MissionTraceCodeAnchor> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for item in items {
        let key = format!("{}:{}", item.file_path, item.line.unwrap_or(-1));
        if seen.insert(key) {
            out.push(item);
        }
    }
    out
}

fn group_assignments_by_task(
    assignments: &[MissionAgentAssignmentRow],
) -> BTreeMap<String, Vec<MissionAgentAssignmentRow>> {
    let mut out: BTreeMap<String, Vec<MissionAgentAssignmentRow>> = BTreeMap::new();
    for assignment in assignments {
        if let Some(task_id) = assignment.task_id.as_ref() {
            out.entry(task_id.clone())
                .or_default()
                .push(assignment.clone());
        }
    }
    out
}

fn cluster_contains_requirement(snapshot: &Value, cluster_id: &str, requirement_id: &str) -> bool {
    cluster_arrays(snapshot).into_iter().any(|cluster| {
        string_field(cluster, "id").as_deref() == Some(cluster_id)
            && string_array_field(cluster, "requirementIds")
                .iter()
                .any(|id| id == requirement_id)
    })
}

fn cluster_arrays(snapshot: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    for pointer in ["/plan/clusters", "/basePlan/clusters", "/clusters"] {
        if let Some(items) = snapshot.pointer(pointer).and_then(Value::as_array) {
            out.extend(items);
        }
    }
    out
}

fn object_values(value: Option<&Value>) -> Vec<&Value> {
    value
        .and_then(Value::as_object)
        .map(|obj| obj.values().collect())
        .unwrap_or_default()
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn string_array_field(value: &Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn i64_field(value: &Value, field: &str) -> Option<i64> {
    value.get(field).and_then(Value::as_i64)
}

fn i64_array_field(value: &Value, field: &str) -> Vec<i64> {
    value
        .get(field)
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default()
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} 不能为空"));
    }
    Ok(trimmed.to_string())
}

fn ensure_object(value: &Value, field: &str) -> Result<(), String> {
    if value.is_object() {
        Ok(())
    } else {
        Err(format!("{field} 必须是对象"))
    }
}

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_extracts_requirement_tasks_code_anchors_and_assignments() {
        let snapshot = json!({
            "requirementsIndex": {
                "requirements": [
                    { "id": "REQ-1", "content": "Add JWT auth", "bodyHash": "abc" }
                ]
            },
            "plan": {
                "clusters": [
                    { "id": "c-auth", "title": "Auth", "requirementIds": ["REQ-1"], "repositoryIds": [7], "primaryRepositoryId": 7 }
                ]
            },
            "clusterRuns": {
                "c-auth": {
                    "clusterId": "c-auth",
                    "status": "succeeded",
                    "normalized": {
                        "splitTasks": [
                            {
                                "id": "T-1",
                                "title": "Implement JWT",
                                "role": "backend",
                                "sourceRequirementIds": ["REQ-1"],
                                "sourceRefs": ["src/auth/jwt.service.ts:42"]
                            }
                        ]
                    }
                }
            },
            "writeResults": [
                {
                    "clusterId": "c-auth",
                    "childTasks": [
                        { "sourceTaskId": "T-1", "taskName": "05-16-jwt", "taskPath": "/repo/.trellis/tasks/05-16-jwt" }
                    ]
                }
            ]
        });
        let assignments = vec![MissionAgentAssignmentRow {
            assignment_id: "a1".to_string(),
            mission_id: "m1".to_string(),
            agent_run_id: Some("run1".to_string()),
            project_id: Some("p1".to_string()),
            task_id: Some("T-1".to_string()),
            cluster_id: Some("c-auth".to_string()),
            repository_id: Some(7),
            repository_path: Some("/repo/backend".to_string()),
            agent_type: "trellis-implement".to_string(),
            employee_id: None,
            stage: "implement".to_string(),
            status: "running".to_string(),
            current_file: Some("src/auth/jwt.service.ts".to_string()),
            session_id: Some("s1".to_string()),
            started_at: 1,
            updated_at: 2,
            completed_at: None,
            last_heartbeat_at: 2,
            metadata: json!({}),
        }];

        let trace = build_requirement_trace(&snapshot, &assignments, "m1", "REQ-1");

        assert_eq!(
            trace.requirement.as_ref().map(|r| r.content.as_str()),
            Some("Add JWT auth")
        );
        assert_eq!(trace.clusters.len(), 1);
        assert_eq!(trace.tasks.len(), 1);
        assert_eq!(
            trace.tasks[0].task_path.as_deref(),
            Some("/repo/.trellis/tasks/05-16-jwt")
        );
        assert_eq!(
            trace.tasks[0].code_anchors[0].file_path,
            "src/auth/jwt.service.ts"
        );
        assert_eq!(trace.tasks[0].code_anchors[0].line, Some(42));
        assert_eq!(
            trace.tasks[0].assignments[0].agent_type,
            "trellis-implement"
        );
    }
}
