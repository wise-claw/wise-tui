//! 协作数据的行结构与加载函数。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use super::error::{CResult, CollabError};
use super::util::{parse_json_or, parse_value};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub image_paths: Vec<String>,
    pub owner_project_id: Option<String>,
    pub owner_agent_id: Option<String>,
    pub profile_revision: Option<i64>,
    pub business_status: String,
    pub control_status: String,
    pub stage: String,
    pub revision: i64,
    pub requirement_revision: i64,
    pub active_plan_revision: i64,
    pub plan_approval_required: bool,
    pub acceptance_policy: String,
    pub collaboration_mode: String,
    pub generation: i64,
    pub priority: i64,
    pub sort_order: i64,
    pub max_concurrent_attempts: i64,
    pub execution_attempt_budget: i64,
    pub repair_round_budget: i64,
    pub budget_ms: Option<i64>,
    pub extra_scope: Vec<i64>,
    pub origin_session_id: Option<String>,
    pub legacy_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

const REQ_COLS: &str = "id, title, body, image_paths_json, owner_project_id, owner_agent_id, profile_revision,
    business_status, control_status, stage, revision, requirement_revision, active_plan_revision,
    plan_approval_required, acceptance_policy, collaboration_mode, generation, priority, sort_order,
    max_concurrent_attempts, execution_attempt_budget, repair_round_budget, budget_ms, extra_scope_json,
    origin_session_id, legacy_id, created_at, updated_at";

fn map_req(r: &rusqlite::Row<'_>) -> rusqlite::Result<RequirementRow> {
    Ok(RequirementRow {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        image_paths: parse_json_or(&r.get::<_, String>(3)?, Vec::new()),
        owner_project_id: r.get(4)?,
        owner_agent_id: r.get(5)?,
        profile_revision: r.get(6)?,
        business_status: r.get(7)?,
        control_status: r.get(8)?,
        stage: r.get(9)?,
        revision: r.get(10)?,
        requirement_revision: r.get(11)?,
        active_plan_revision: r.get(12)?,
        plan_approval_required: r.get::<_, i64>(13)? != 0,
        acceptance_policy: r.get(14)?,
        collaboration_mode: r.get(15)?,
        generation: r.get(16)?,
        priority: r.get(17)?,
        sort_order: r.get(18)?,
        max_concurrent_attempts: r.get(19)?,
        execution_attempt_budget: r.get(20)?,
        repair_round_budget: r.get(21)?,
        budget_ms: r.get(22)?,
        extra_scope: parse_json_or(&r.get::<_, String>(23)?, Vec::new()),
        origin_session_id: r.get(24)?,
        legacy_id: r.get(25)?,
        created_at: r.get(26)?,
        updated_at: r.get(27)?,
    })
}

pub fn load_requirement(conn: &Connection, id: &str) -> CResult<RequirementRow> {
    conn.query_row(
        &format!("SELECT {REQ_COLS} FROM collab_requirements WHERE id = ?1"),
        params![id],
        map_req,
    )
    .optional()?
    .ok_or_else(|| CollabError::not_found("协作需求", id))
}

pub fn list_requirements(conn: &Connection, project_id: Option<&str>, include_done: bool) -> CResult<Vec<RequirementRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {REQ_COLS} FROM collab_requirements r
         WHERE (?1 IS NULL OR r.owner_project_id = ?1
                OR EXISTS (SELECT 1 FROM collab_requirement_projects p WHERE p.requirement_id = r.id AND p.project_id = ?1))
           AND (?2 = 1 OR r.business_status <> 'done')
         ORDER BY CASE r.business_status WHEN 'done' THEN 1 ELSE 0 END, r.sort_order ASC, r.updated_at DESC"
    ))?;
    let rows = stmt
        .query_map(params![project_id, include_done as i64], map_req)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub id: String,
    pub requirement_id: String,
    pub plan_revision: i64,
    pub task_key: String,
    pub title: String,
    pub project_id: Option<String>,
    pub repository_id: Option<i64>,
    pub role: String,
    pub kind: String,
    pub state: String,
    pub active: bool,
    pub revision: i64,
    pub spec_revision: i64,
    pub spec: Value,
    pub spec_hash: String,
    pub executor_agent_id: Option<String>,
    pub profile_revision: Option<i64>,
    pub delegated_by_task_id: Option<String>,
    pub delegation_depth: i64,
    pub runtime_target: String,
    pub workspace_binding: Value,
    pub checkpoint_id: Option<String>,
    pub generation: i64,
    pub failure_count: i64,
    pub attempt_budget: i64,
    pub next_action: String,
    pub change_request_id: Option<String>,
    pub repair_round: Option<i64>,
    pub result: Option<Value>,
    pub priority: i64,
    pub queued_at: i64,
    pub superseded_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl TaskRow {
    pub fn output_artifacts(&self) -> Vec<String> {
        self.spec
            .get("outputs")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|o| {
                        o.get("artifact")
                            .and_then(Value::as_str)
                            .or_else(|| o.as_str())
                            .map(|s| s.trim().to_string())
                    })
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self.state.as_str(), "succeeded" | "cancelled")
    }
}

const TASK_COLS: &str = "id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind,
    state, active, revision, spec_revision, spec_json, spec_hash, executor_agent_id, profile_revision,
    delegated_by_task_id, delegation_depth, runtime_target, workspace_binding_json, checkpoint_id, generation,
    failure_count, attempt_budget, next_action, change_request_id, repair_round, result_json, priority,
    queued_at, superseded_by, created_at, updated_at";

fn map_task(r: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok(TaskRow {
        id: r.get(0)?,
        requirement_id: r.get(1)?,
        plan_revision: r.get(2)?,
        task_key: r.get(3)?,
        title: r.get(4)?,
        project_id: r.get(5)?,
        repository_id: r.get(6)?,
        role: r.get(7)?,
        kind: r.get(8)?,
        state: r.get(9)?,
        active: r.get::<_, i64>(10)? != 0,
        revision: r.get(11)?,
        spec_revision: r.get(12)?,
        spec: parse_value(&r.get::<_, String>(13)?),
        spec_hash: r.get(14)?,
        executor_agent_id: r.get(15)?,
        profile_revision: r.get(16)?,
        delegated_by_task_id: r.get(17)?,
        delegation_depth: r.get(18)?,
        runtime_target: r.get(19)?,
        workspace_binding: parse_value(&r.get::<_, String>(20)?),
        checkpoint_id: r.get(21)?,
        generation: r.get(22)?,
        failure_count: r.get(23)?,
        attempt_budget: r.get(24)?,
        next_action: r.get(25)?,
        change_request_id: r.get(26)?,
        repair_round: r.get(27)?,
        result: r.get::<_, Option<String>>(28)?.as_deref().map(parse_value),
        priority: r.get(29)?,
        queued_at: r.get(30)?,
        superseded_by: r.get(31)?,
        created_at: r.get(32)?,
        updated_at: r.get(33)?,
    })
}

pub fn load_task(conn: &Connection, id: &str) -> CResult<TaskRow> {
    conn.query_row(&format!("SELECT {TASK_COLS} FROM collab_tasks WHERE id = ?1"), params![id], map_task)
        .optional()?
        .ok_or_else(|| CollabError::not_found("仓库任务", id))
}

pub fn list_tasks(conn: &Connection, requirement_id: &str, active_only: bool) -> CResult<Vec<TaskRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM collab_tasks WHERE requirement_id = ?1 AND (?2 = 0 OR active = 1)
         ORDER BY created_at ASC, task_key ASC"
    ))?;
    let rows = stmt
        .query_map(params![requirement_id, active_only as i64], map_task)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn active_task_by_key(conn: &Connection, requirement_id: &str, key: &str) -> CResult<Option<TaskRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {TASK_COLS} FROM collab_tasks WHERE requirement_id = ?1 AND task_key = ?2 AND active = 1 ORDER BY spec_revision DESC LIMIT 1"),
            params![requirement_id, key],
            map_task,
        )
        .optional()?)
}

pub fn ready_tasks(conn: &Connection) -> CResult<Vec<TaskRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM collab_tasks t JOIN collab_requirements r ON r.id = t.requirement_id
         WHERE t.state = 'ready' AND t.active = 1 AND r.control_status = 'active'
         ORDER BY r.priority DESC, t.priority DESC, t.queued_at ASC",
        TASK_COLS
            .split(',')
            .map(|c| format!("t.{}", c.trim()))
            .collect::<Vec<_>>()
            .join(", ")
    ))?;
    let rows = stmt.query_map([], map_task)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyRow {
    pub id: String,
    pub task_id: String,
    pub producer_task_id: String,
    pub gate_kind: String,
    pub artifact_selector: Option<String>,
    pub required_version: Option<i64>,
    pub plan_revision: i64,
}

pub fn list_dependencies(conn: &Connection, requirement_id: &str, plan_revision: i64) -> CResult<Vec<DependencyRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, producer_task_id, gate_kind, artifact_selector, required_version, plan_revision
         FROM collab_dependencies WHERE requirement_id = ?1 AND plan_revision = ?2",
    )?;
    let rows = stmt
        .query_map(params![requirement_id, plan_revision], |r| {
            Ok(DependencyRow {
                id: r.get(0)?,
                task_id: r.get(1)?,
                producer_task_id: r.get(2)?,
                gate_kind: r.get(3)?,
                artifact_selector: r.get(4)?,
                required_version: r.get(5)?,
                plan_revision: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRow {
    pub id: String,
    pub task_id: String,
    pub requirement_id: String,
    pub generation: i64,
    pub session_id: Option<String>,
    pub dispatch_key: String,
    #[serde(skip_serializing)]
    pub secret: String,
    pub action: String,
    pub covered_changes: Value,
    pub input_manifest: Value,
    pub effective_config_manifest: Value,
    pub lease_owner: String,
    pub lease_expiry: i64,
    pub fencing_token: i64,
    pub workspace_key: Option<String>,
    pub state: String,
    pub stop_reason: Option<String>,
    pub result: Option<String>,
    pub result_json: Option<Value>,
    pub reported: Option<Value>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub created_at: i64,
}

const ATTEMPT_COLS: &str = "id, task_id, requirement_id, generation, session_id, dispatch_key, secret, action,
    covered_changes_json, input_manifest_json, effective_config_manifest_json, lease_owner, lease_expiry,
    fencing_token, workspace_key, state, stop_reason, result, result_json, reported_json, started_at,
    finished_at, created_at";

fn map_attempt(r: &rusqlite::Row<'_>) -> rusqlite::Result<AttemptRow> {
    Ok(AttemptRow {
        id: r.get(0)?,
        task_id: r.get(1)?,
        requirement_id: r.get(2)?,
        generation: r.get(3)?,
        session_id: r.get(4)?,
        dispatch_key: r.get(5)?,
        secret: r.get(6)?,
        action: r.get(7)?,
        covered_changes: parse_value(&r.get::<_, String>(8)?),
        input_manifest: parse_value(&r.get::<_, String>(9)?),
        effective_config_manifest: parse_value(&r.get::<_, String>(10)?),
        lease_owner: r.get(11)?,
        lease_expiry: r.get(12)?,
        fencing_token: r.get(13)?,
        workspace_key: r.get(14)?,
        state: r.get(15)?,
        stop_reason: r.get(16)?,
        result: r.get(17)?,
        result_json: r.get::<_, Option<String>>(18)?.as_deref().map(parse_value),
        reported: r.get::<_, Option<String>>(19)?.as_deref().map(parse_value),
        started_at: r.get(20)?,
        finished_at: r.get(21)?,
        created_at: r.get(22)?,
    })
}

pub fn load_attempt(conn: &Connection, id: &str) -> CResult<AttemptRow> {
    conn.query_row(&format!("SELECT {ATTEMPT_COLS} FROM collab_attempts WHERE id = ?1"), params![id], map_attempt)
        .optional()?
        .ok_or_else(|| CollabError::not_found("执行尝试", id))
}

pub fn attempt_by_dispatch_key(conn: &Connection, key: &str) -> CResult<Option<AttemptRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {ATTEMPT_COLS} FROM collab_attempts WHERE dispatch_key = ?1"),
            params![key],
            map_attempt,
        )
        .optional()?)
}

pub fn list_attempts_for_task(conn: &Connection, task_id: &str) -> CResult<Vec<AttemptRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ATTEMPT_COLS} FROM collab_attempts WHERE task_id = ?1 ORDER BY generation ASC"
    ))?;
    let rows = stmt.query_map(params![task_id], map_attempt)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn list_attempts_for_requirement(conn: &Connection, requirement_id: &str) -> CResult<Vec<AttemptRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ATTEMPT_COLS} FROM collab_attempts WHERE requirement_id = ?1 ORDER BY created_at ASC"
    ))?;
    let rows = stmt.query_map(params![requirement_id], map_attempt)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn active_attempts(conn: &Connection) -> CResult<Vec<AttemptRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ATTEMPT_COLS} FROM collab_attempts WHERE state <> 'finished' ORDER BY created_at ASC"
    ))?;
    let rows = stmt.query_map([], map_attempt)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn active_attempt_for_task(conn: &Connection, task_id: &str) -> CResult<Option<AttemptRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {ATTEMPT_COLS} FROM collab_attempts WHERE task_id = ?1 AND state <> 'finished'"),
            params![task_id],
            map_attempt,
        )
        .optional()?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRow {
    pub id: String,
    pub task_id: String,
    pub attempt_id: Option<String>,
    pub code_location: Value,
    pub worktree_digest: String,
    pub completed: Value,
    pub todo: Value,
    pub failing_cases: Value,
    pub locked_versions: Value,
    pub resume_notes: String,
    pub created_at: i64,
}

pub fn load_checkpoint(conn: &Connection, id: &str) -> CResult<Option<CheckpointRow>> {
    Ok(conn
        .query_row(
            "SELECT id, task_id, attempt_id, code_location_json, worktree_digest, completed_json, todo_json,
                    failing_cases_json, locked_versions_json, resume_notes, created_at
             FROM collab_checkpoints WHERE id = ?1",
            params![id],
            |r| {
                Ok(CheckpointRow {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    attempt_id: r.get(2)?,
                    code_location: parse_value(&r.get::<_, String>(3)?),
                    worktree_digest: r.get(4)?,
                    completed: parse_value(&r.get::<_, String>(5)?),
                    todo: parse_value(&r.get::<_, String>(6)?),
                    failing_cases: parse_value(&r.get::<_, String>(7)?),
                    locked_versions: parse_value(&r.get::<_, String>(8)?),
                    resume_notes: r.get(9)?,
                    created_at: r.get(10)?,
                })
            },
        )
        .optional()?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactVersionRow {
    pub id: String,
    pub artifact_id: String,
    pub name: String,
    pub kind: String,
    pub version: i64,
    pub requirement_id: String,
    pub producer_task_id: String,
    pub attempt_id: Option<String>,
    pub plan_revision: i64,
    pub repository_id: Option<i64>,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub contract: Value,
    pub contract_hash: String,
    pub runtime_target_id: String,
    pub environment_id: Option<String>,
    pub endpoint: Option<String>,
    pub health_url: Option<String>,
    pub deployed_commit: Option<String>,
    pub health_check_at: Option<i64>,
    pub credential_ref: Option<String>,
    pub setup_guide_ref: Option<String>,
    pub fixture_refs: Value,
    pub test_evidence: Value,
    pub compatibility: String,
    pub supersedes_version: Option<i64>,
    pub affected_operations: Value,
    pub changed_fields: Value,
    pub is_draft: bool,
    pub validation_state: String,
    pub validation: Value,
    pub invalid_reason: Option<String>,
    pub created_at: i64,
}

const AV_COLS: &str = "v.id, v.artifact_id, a.name, a.kind, v.version, v.requirement_id, v.producer_task_id, v.attempt_id,
    v.plan_revision, v.repository_id, v.commit_sha, v.branch, v.contract_json, v.contract_hash, v.runtime_target_id,
    v.environment_id, v.endpoint, v.health_url, v.deployed_commit, v.health_check_at, v.credential_ref,
    v.setup_guide_ref, v.fixture_refs_json, v.test_evidence_json, v.compatibility, v.supersedes_version,
    v.affected_operations_json, v.changed_fields_json, v.is_draft, v.validation_state, v.validation_json,
    v.invalid_reason, v.created_at";

fn map_av(r: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactVersionRow> {
    Ok(ArtifactVersionRow {
        id: r.get(0)?,
        artifact_id: r.get(1)?,
        name: r.get(2)?,
        kind: r.get(3)?,
        version: r.get(4)?,
        requirement_id: r.get(5)?,
        producer_task_id: r.get(6)?,
        attempt_id: r.get(7)?,
        plan_revision: r.get(8)?,
        repository_id: r.get(9)?,
        commit_sha: r.get(10)?,
        branch: r.get(11)?,
        contract: parse_value(&r.get::<_, String>(12)?),
        contract_hash: r.get(13)?,
        runtime_target_id: r.get(14)?,
        environment_id: r.get(15)?,
        endpoint: r.get(16)?,
        health_url: r.get(17)?,
        deployed_commit: r.get(18)?,
        health_check_at: r.get(19)?,
        credential_ref: r.get(20)?,
        setup_guide_ref: r.get(21)?,
        fixture_refs: parse_value(&r.get::<_, String>(22)?),
        test_evidence: parse_value(&r.get::<_, String>(23)?),
        compatibility: r.get(24)?,
        supersedes_version: r.get(25)?,
        affected_operations: parse_value(&r.get::<_, String>(26)?),
        changed_fields: parse_value(&r.get::<_, String>(27)?),
        is_draft: r.get::<_, i64>(28)? != 0,
        validation_state: r.get(29)?,
        validation: parse_value(&r.get::<_, String>(30)?),
        invalid_reason: r.get(31)?,
        created_at: r.get(32)?,
    })
}

pub fn load_artifact_version(conn: &Connection, id: &str) -> CResult<ArtifactVersionRow> {
    conn.query_row(
        &format!("SELECT {AV_COLS} FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id WHERE v.id = ?1"),
        params![id],
        map_av,
    )
    .optional()?
    .ok_or_else(|| CollabError::not_found("交付版本", id))
}

pub fn list_artifact_versions(conn: &Connection, requirement_id: &str) -> CResult<Vec<ArtifactVersionRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {AV_COLS} FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id
         WHERE v.requirement_id = ?1 ORDER BY a.name ASC, v.version ASC"
    ))?;
    let rows = stmt.query_map(params![requirement_id], map_av)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// 跨需求的最近交付：每个交付物取最新版本；按仓库过滤时同时包含该仓库消费的交付物。
pub fn list_recent_artifact_versions(conn: &Connection, repository_id: Option<i64>, limit: i64) -> CResult<Vec<ArtifactVersionRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {AV_COLS} FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id
         WHERE v.version = (SELECT MAX(v2.version) FROM collab_artifact_versions v2 WHERE v2.artifact_id = v.artifact_id)
           AND (?1 IS NULL OR v.repository_id = ?1 OR EXISTS (
                SELECT 1 FROM collab_tasks t WHERE t.requirement_id = v.requirement_id AND t.repository_id = ?1))
         ORDER BY v.created_at DESC LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![repository_id, limit.clamp(1, 500)], map_av)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// 跨需求的最近修正单（修正记录），按仓库过滤时匹配提出方或生产方任务所在仓库。
pub fn list_recent_changes(conn: &Connection, repository_id: Option<i64>, limit: i64) -> CResult<Vec<ChangeRequestRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CR_COLS} FROM collab_change_requests c
         WHERE ?1 IS NULL OR EXISTS (
            SELECT 1 FROM collab_tasks t
            WHERE t.id IN (c.reporter_task_id, c.producer_task_id) AND t.repository_id = ?1)
         ORDER BY c.updated_at DESC LIMIT ?2"
    ))?;
    let mut rows: Vec<ChangeRequestRow> = stmt
        .query_map(params![repository_id, limit.clamp(1, 500)], map_cr)?
        .collect::<Result<_, _>>()?;
    for row in rows.iter_mut() {
        row.consumers = load_consumers(conn, &row.id)?;
    }
    Ok(rows)
}

pub fn latest_valid_version(conn: &Connection, requirement_id: &str, name: &str) -> CResult<Option<ArtifactVersionRow>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {AV_COLS} FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id
                 WHERE v.requirement_id = ?1 AND a.name = ?2 AND v.validation_state = 'valid' AND v.is_draft = 0
                 ORDER BY v.version DESC LIMIT 1"
            ),
            params![requirement_id, name],
            map_av,
        )
        .optional()?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequestRow {
    pub id: String,
    pub requirement_id: String,
    pub code: String,
    pub producer_task_id: Option<String>,
    pub reporter_task_id: String,
    pub dedupe_key: String,
    pub category: String,
    pub state: String,
    pub round: i64,
    pub revision: i64,
    pub round_budget: i64,
    pub payload: Value,
    pub current_repair_task_id: Option<String>,
    pub candidate_artifact_version_id: Option<String>,
    pub merged_into: Option<String>,
    pub resolution: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
    pub consumers: Vec<ChangeConsumerRow>,
}

impl ChangeRequestRow {
    pub fn is_open(&self) -> bool {
        !matches!(self.state.as_str(), "closed" | "rejected" | "verified")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeConsumerRow {
    pub consumer_task_id: String,
    pub round: i64,
    pub expected_version: Option<i64>,
    pub retest_attempt_id: Option<String>,
    pub ack_status: String,
    pub evidence: Value,
    pub updated_at: i64,
}

fn load_consumers(conn: &Connection, change_id: &str) -> CResult<Vec<ChangeConsumerRow>> {
    let mut stmt = conn.prepare(
        "SELECT consumer_task_id, round, expected_version, retest_attempt_id, ack_status, evidence_json, updated_at
         FROM collab_change_consumers WHERE change_request_id = ?1 ORDER BY round ASC, consumer_task_id ASC",
    )?;
    let rows = stmt
        .query_map(params![change_id], |r| {
            Ok(ChangeConsumerRow {
                consumer_task_id: r.get(0)?,
                round: r.get(1)?,
                expected_version: r.get(2)?,
                retest_attempt_id: r.get(3)?,
                ack_status: r.get(4)?,
                evidence: parse_value(&r.get::<_, String>(5)?),
                updated_at: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

const CR_COLS: &str = "id, requirement_id, code, producer_task_id, reporter_task_id, dedupe_key, category, state,
    round, revision, round_budget, payload_json, current_repair_task_id, candidate_artifact_version_id,
    merged_into, resolution_json, created_at, updated_at";

fn map_cr(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChangeRequestRow> {
    Ok(ChangeRequestRow {
        id: r.get(0)?,
        requirement_id: r.get(1)?,
        code: r.get(2)?,
        producer_task_id: r.get(3)?,
        reporter_task_id: r.get(4)?,
        dedupe_key: r.get(5)?,
        category: r.get(6)?,
        state: r.get(7)?,
        round: r.get(8)?,
        revision: r.get(9)?,
        round_budget: r.get(10)?,
        payload: parse_value(&r.get::<_, String>(11)?),
        current_repair_task_id: r.get(12)?,
        candidate_artifact_version_id: r.get(13)?,
        merged_into: r.get(14)?,
        resolution: r.get::<_, Option<String>>(15)?.as_deref().map(parse_value),
        created_at: r.get(16)?,
        updated_at: r.get(17)?,
        consumers: Vec::new(),
    })
}

pub fn load_change(conn: &Connection, id: &str) -> CResult<ChangeRequestRow> {
    let mut row = conn
        .query_row(&format!("SELECT {CR_COLS} FROM collab_change_requests WHERE id = ?1"), params![id], map_cr)
        .optional()?
        .ok_or_else(|| CollabError::not_found("修正单", id))?;
    row.consumers = load_consumers(conn, &row.id)?;
    Ok(row)
}

pub fn list_changes(conn: &Connection, requirement_id: &str) -> CResult<Vec<ChangeRequestRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CR_COLS} FROM collab_change_requests WHERE requirement_id = ?1 ORDER BY created_at ASC"
    ))?;
    let mut rows: Vec<ChangeRequestRow> = stmt.query_map(params![requirement_id], map_cr)?.collect::<Result<_, _>>()?;
    for row in rows.iter_mut() {
        row.consumers = load_consumers(conn, &row.id)?;
    }
    Ok(rows)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRow {
    pub id: String,
    pub requirement_id: String,
    pub kind: String,
    pub dedupe_key: String,
    pub title: String,
    pub task_ids: Vec<String>,
    pub blocked_ops: Vec<String>,
    pub evidence: Value,
    pub options: Value,
    pub state: String,
    pub resolution: Option<Value>,
    pub revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl DecisionRow {
    pub fn blocks_task(&self, task_id: &str) -> bool {
        self.state == "open" && (self.task_ids.iter().any(|t| t == task_id) || self.blocked_ops.iter().any(|o| o == "all"))
    }
}

const DEC_COLS: &str = "id, requirement_id, kind, dedupe_key, title, task_ids_json, blocked_ops_json, evidence_json,
    options_json, state, resolution_json, revision, created_at, updated_at";

fn map_dec(r: &rusqlite::Row<'_>) -> rusqlite::Result<DecisionRow> {
    Ok(DecisionRow {
        id: r.get(0)?,
        requirement_id: r.get(1)?,
        kind: r.get(2)?,
        dedupe_key: r.get(3)?,
        title: r.get(4)?,
        task_ids: parse_json_or(&r.get::<_, String>(5)?, Vec::new()),
        blocked_ops: parse_json_or(&r.get::<_, String>(6)?, Vec::new()),
        evidence: parse_value(&r.get::<_, String>(7)?),
        options: parse_value(&r.get::<_, String>(8)?),
        state: r.get(9)?,
        resolution: r.get::<_, Option<String>>(10)?.as_deref().map(parse_value),
        revision: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
    })
}

pub fn load_decision(conn: &Connection, id: &str) -> CResult<DecisionRow> {
    conn.query_row(&format!("SELECT {DEC_COLS} FROM collab_decisions WHERE id = ?1"), params![id], map_dec)
        .optional()?
        .ok_or_else(|| CollabError::not_found("待决策项", id))
}

pub fn list_decisions(conn: &Connection, requirement_id: &str, open_only: bool) -> CResult<Vec<DecisionRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {DEC_COLS} FROM collab_decisions WHERE requirement_id = ?1 AND (?2 = 0 OR state = 'open') ORDER BY created_at ASC"
    ))?;
    let rows = stmt
        .query_map(params![requirement_id, open_only as i64], map_dec)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn requirement_projects(conn: &Connection, requirement_id: &str) -> CResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT project_id, responsibility FROM collab_requirement_projects WHERE requirement_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(params![requirement_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn add_requirement_project(conn: &Connection, requirement_id: &str, project_id: &str, responsibility: &str) -> CResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO collab_requirement_projects (requirement_id, project_id, responsibility, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![requirement_id, project_id, responsibility, super::util::now_ms()],
    )?;
    Ok(())
}

pub fn link_session(conn: &Connection, requirement_id: &str, session_id: &str, relation: &str) -> CResult<()> {
    if session_id.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT OR IGNORE INTO collab_requirement_sessions (requirement_id, session_id, relation, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![requirement_id, session_id.trim(), relation, super::util::now_ms()],
    )?;
    Ok(())
}

pub fn requirement_sessions(conn: &Connection, requirement_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT session_id, relation, created_at FROM collab_requirement_sessions WHERE requirement_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(params![requirement_id], |r| {
            Ok(serde_json::json!({
                "sessionId": r.get::<_, String>(0)?,
                "relation": r.get::<_, String>(1)?,
                "createdAt": r.get::<_, i64>(2)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}
