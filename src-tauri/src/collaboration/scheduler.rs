//! 放行评估、执行领取、租约 / fencing、工作区写锁、停止与失联核对。
//!
//! 调度只读取数据库当前状态做决定：消息只负责唤醒重新评估，不直接把任务改为可运行。
//! 执行桥以 `dispatchKey = taskId:generation` 幂等建会话；迟到的旧 token 不能改写新尝试。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::agents::AgentBinding;
use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model::{self, AttemptRow, DependencyRow, RequirementRow, TaskRow};
use super::runtime::{self, CapabilityMatrix, EffectiveConfigManifest, ResolveInput, SpawnConfig};
use super::util::{new_id, new_secret, next_counter, now_ms, to_json, tx};
use super::{RepoDirectory, RepoInfo};

pub const LEASE_MS: i64 = 120_000;
pub const DEFAULT_GLOBAL_LIMIT: i64 = 4;
const ACTIVE_ATTEMPT_STATES: &str = "('claimed', 'running', 'stop_requested', 'stop_pending', 'lost')";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blocker {
    pub code: String,
    pub message: String,
    pub ref_id: Option<String>,
    /// True when progress needs a human/owner decision rather than normal waiting.
    pub needs_decision: bool,
}

impl Blocker {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            ref_id: None,
            needs_decision: false,
        }
    }

    fn with_ref(mut self, id: &str) -> Self {
        self.ref_id = Some(id.to_string());
        self
    }

    fn decision(mut self) -> Self {
        self.needs_decision = true;
        self
    }
}

fn dependencies_for_task(conn: &Connection, task_id: &str) -> CResult<Vec<DependencyRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, producer_task_id, gate_kind, artifact_selector, required_version, plan_revision
         FROM collab_dependencies WHERE task_id = ?1",
    )?;
    let rows = stmt
        .query_map(params![task_id], |r| {
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

fn contract_published(conn: &Connection, requirement_id: &str, name: &str) -> CResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id
         WHERE v.requirement_id = ?1 AND a.name = ?2 AND v.validation_state IN ('valid', 'pending')
           AND v.contract_json NOT IN ('{}', 'null', '')",
        params![requirement_id, name],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub fn dependency_blocker(conn: &Connection, req: &RequirementRow, dep: &DependencyRow) -> CResult<Option<Blocker>> {
    let producer = model::load_task(conn, &dep.producer_task_id)?;
    let names = match dep.artifact_selector.as_deref() {
        Some(s) if !s.trim().is_empty() => vec![s.trim().to_string()],
        _ => producer.output_artifacts(),
    };
    let wait_task = || {
        Blocker::new(codes::DEPENDENCY_NOT_READY, format!("等待「{}」完成", producer.title)).with_ref(&producer.id)
    };
    match dep.gate_kind.as_str() {
        "task_succeeded" => Ok((producer.state != "succeeded").then(wait_task)),
        "contract_available" if req.collaboration_mode == "contract_parallel" => {
            if names.is_empty() {
                return Ok((producer.state != "succeeded").then(wait_task));
            }
            for name in &names {
                if !contract_published(conn, &req.id, name)? {
                    return Ok(Some(
                        Blocker::new(codes::DEPENDENCY_NOT_READY, format!("等待「{}」发布契约 {name}", producer.title))
                            .with_ref(&producer.id),
                    ));
                }
            }
            Ok(None)
        }
        _ => {
            if names.is_empty() {
                return Ok((producer.state != "succeeded").then(wait_task));
            }
            for name in &names {
                match model::latest_valid_version(conn, &req.id, name)? {
                    None => {
                        return Ok(Some(
                            Blocker::new(
                                codes::DEPENDENCY_NOT_READY,
                                format!("等待「{}」的交付包 {name} 通过校验", producer.title),
                            )
                            .with_ref(&producer.id),
                        ))
                    }
                    Some(v) if dep.required_version.is_some_and(|rv| v.version < rv) => {
                        return Ok(Some(
                            Blocker::new(
                                codes::DEPENDENCY_NOT_READY,
                                format!("需要 {name} v{} 及以上，当前有效版本 v{}", dep.required_version.unwrap_or(0), v.version),
                            )
                            .with_ref(&v.id),
                        ))
                    }
                    Some(v)
                        if v.health_url.is_some()
                            && v.health_check_at.map_or(true, |at| now_ms() - at > super::artifacts::HEALTH_TTL_MS) =>
                    {
                        return Ok(Some(
                            Blocker::new(
                                codes::DEPENDENCY_NOT_READY,
                                format!("{name} v{} 的健康检查已过期，等待重新检查运行环境", v.version),
                            )
                            .with_ref(&v.id),
                        ))
                    }
                    Some(_) => {}
                }
            }
            Ok(None)
        }
    }
}

/// Open change requests that hold this consumer (current round, not yet ready for retest).
pub fn change_blockers(conn: &Connection, task: &TaskRow) -> CResult<Vec<Blocker>> {
    let mut out = Vec::new();
    for cr in model::list_changes(conn, &task.requirement_id)? {
        if !cr.is_open() || cr.merged_into.is_some() {
            continue;
        }
        let waiting = cr
            .consumers
            .iter()
            .any(|c| c.consumer_task_id == task.id && c.round == cr.round && c.ack_status == "waiting");
        if !waiting {
            continue;
        }
        match cr.state.as_str() {
            "ready_for_retest" => {}
            "needs_decision" => out.push(
                Blocker::new(codes::DEPENDENCY_NOT_READY, format!("修正单 {} 需要决策", cr.code))
                    .with_ref(&cr.id)
                    .decision(),
            ),
            _ => out.push(
                Blocker::new(codes::DEPENDENCY_NOT_READY, format!("等待修正单 {}（第 {} 轮）的修正版本", cr.code, cr.round))
                    .with_ref(&cr.id),
            ),
        }
    }
    Ok(out)
}

fn count_active_attempts(conn: &Connection, requirement_id: Option<&str>) -> CResult<i64> {
    let sql = format!(
        "SELECT COUNT(*) FROM collab_attempts WHERE state IN {ACTIVE_ATTEMPT_STATES} AND (?1 IS NULL OR requirement_id = ?1)"
    );
    Ok(conn.query_row(&sql, params![requirement_id], |r| r.get(0))?)
}

/// Every reason the task cannot be claimed right now ("为什么还没启动").
pub fn task_blockers(conn: &Connection, req: &RequirementRow, task: &TaskRow) -> CResult<Vec<Blocker>> {
    let mut out = Vec::new();
    match req.control_status.as_str() {
        "active" => {}
        "pausing" | "paused" => out.push(Blocker::new(codes::INVALID_STATE, "需求已暂停")),
        _ => out.push(Blocker::new(codes::REQUIREMENT_CANCELLED, "需求已取消")),
    }
    if !task.active {
        out.push(Blocker::new(codes::INVALID_STATE, "任务未被当前计划采用"));
    }
    for dep in dependencies_for_task(conn, &task.id)? {
        if let Some(b) = dependency_blocker(conn, req, &dep)? {
            out.push(b);
        }
    }
    out.extend(change_blockers(conn, task)?);
    for d in model::list_decisions(conn, &req.id, true)? {
        if d.blocks_task(&task.id) {
            out.push(Blocker::new(codes::DEPENDENCY_NOT_READY, format!("待决策：{}", d.title)).with_ref(&d.id).decision());
        }
    }
    if let Some(agent_id) = task.executor_agent_id.as_deref() {
        let status: Option<String> = conn
            .query_row("SELECT status FROM repository_agent_profiles WHERE id = ?1", params![agent_id], |r| r.get(0))
            .optional()?;
        match status.as_deref() {
            Some("enabled") => {}
            Some(s) => out.push(
                Blocker::new(codes::AGENT_DISABLED, format!("执行智能体当前为 {s}，不接受新执行"))
                    .with_ref(agent_id)
                    .decision(),
            ),
            None => out.push(Blocker::new(codes::AGENT_DISABLED, "执行智能体不存在").with_ref(agent_id).decision()),
        }
    }
    if task.failure_count >= task.attempt_budget {
        out.push(
            Blocker::new(codes::BUDGET_EXHAUSTED, format!("执行尝试已达上限 {} 次", task.attempt_budget)).decision(),
        );
    }
    if let Some(budget) = req.budget_ms {
        let used = super::usage::requirement_total_ms(conn, &req.id)?;
        if used >= budget {
            out.push(Blocker::new(codes::BUDGET_EXHAUSTED, format!("需求执行时长预算已用尽（{used}/{budget} ms）")).decision());
        }
    }
    if model::active_attempt_for_task(conn, &task.id)?.is_some() {
        out.push(Blocker::new(codes::STOP_PENDING, "任务仍有未结束的执行尝试"));
    }
    if task.kind == "plan" {
        // Owner transfer: the new coordinator waits until the old one has actually stopped.
        let other: i64 = conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM collab_attempts a JOIN collab_tasks t ON t.id = a.task_id
                 WHERE t.requirement_id = ?1 AND t.kind = 'plan' AND t.id <> ?2 AND a.state IN {ACTIVE_ATTEMPT_STATES}"
            ),
            params![req.id, task.id],
            |r| r.get(0),
        )?;
        if other > 0 {
            out.push(Blocker::new(codes::STOP_PENDING, "等待原主责协调执行停止"));
        }
    }
    Ok(out)
}

fn workspace_key(task: &TaskRow) -> Option<String> {
    if let Some(path) = task.workspace_binding.get("path").and_then(Value::as_str).filter(|p| !p.trim().is_empty()) {
        return Some(format!("path:{}", path.trim()));
    }
    task.repository_id.map(|id| format!("repo:{id}"))
}

fn workspace_busy(conn: &Connection, key: &str) -> CResult<Option<String>> {
    let holder: Option<String> = conn
        .query_row("SELECT attempt_id FROM collab_workspace_locks WHERE workspace_key = ?1", params![key], |r| r.get(0))
        .optional()?;
    let Some(holder) = holder else { return Ok(None) };
    let state: Option<String> = conn
        .query_row("SELECT state FROM collab_attempts WHERE id = ?1", params![holder], |r| r.get(0))
        .optional()?;
    Ok(match state.as_deref() {
        Some("finished") | None => None,
        Some(_) => Some(holder),
    })
}

fn release_workspace_lock(conn: &Connection, attempt: &AttemptRow) -> CResult<()> {
    if let Some(key) = attempt.workspace_key.as_deref() {
        conn.execute(
            "DELETE FROM collab_workspace_locks WHERE workspace_key = ?1 AND attempt_id = ?2",
            params![key, attempt.id],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClaimInput {
    pub lease_owner: String,
    pub global_limit: Option<i64>,
    pub requirement_id: Option<String>,
    pub task_id: Option<String>,
    pub known_mcp_server_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedTask {
    pub attempt: AttemptRow,
    /// Given to the execution bridge only; the agent CLI authenticates with it.
    pub attempt_secret: String,
    pub task: TaskRow,
    pub requirement_id: String,
    pub requirement_title: String,
    pub repository: Option<RepoInfo>,
    pub session_name: String,
    pub prompt: String,
    pub spawn: SpawnConfig,
    pub manifest: EffectiveConfigManifest,
    pub context: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimOutcome {
    pub claimed: Option<ClaimedTask>,
    pub skipped: Vec<Value>,
    pub global_active: i64,
    pub global_limit: i64,
}

/// Claims at most one ready task (call repeatedly until `claimed` is `None`).
pub fn claim_next(
    conn: &Connection,
    input: &ClaimInput,
    repos: &RepoDirectory,
    matrix: &CapabilityMatrix,
) -> CResult<ClaimOutcome> {
    tx(conn, |conn| {
        expire_leases(conn)?;
        let limit = input.global_limit.unwrap_or(DEFAULT_GLOBAL_LIMIT).clamp(1, 16);
        let global_active = count_active_attempts(conn, None)?;
        let mut skipped = Vec::new();
        if global_active >= limit {
            return Ok(ClaimOutcome { claimed: None, skipped, global_active, global_limit: limit });
        }
        let owner = if input.lease_owner.trim().is_empty() { "wise-main" } else { input.lease_owner.trim() };
        for task in model::ready_tasks(conn)? {
            if input.requirement_id.as_deref().is_some_and(|r| r != task.requirement_id) {
                continue;
            }
            if input.task_id.as_deref().is_some_and(|t| t != task.id) {
                continue;
            }
            let req = model::load_requirement(conn, &task.requirement_id)?;
            let skip = |skipped: &mut Vec<Value>, blockers: Vec<Blocker>| {
                skipped.push(json!({ "taskId": task.id, "requirementId": task.requirement_id, "blockers": blockers }));
            };
            if count_active_attempts(conn, Some(&req.id))? >= req.max_concurrent_attempts {
                skip(&mut skipped, vec![Blocker::new(codes::BUDGET_EXHAUSTED, format!("需求并发上限 {}", req.max_concurrent_attempts))]);
                continue;
            }
            let blockers = task_blockers(conn, &req, &task)?;
            if !blockers.is_empty() {
                skip(&mut skipped, blockers);
                continue;
            }
            let repo = task.repository_id.and_then(|id| repos.get(&id)).cloned();
            let Some(repo) = repo else {
                skip(
                    &mut skipped,
                    vec![Blocker::new(codes::AMBIGUOUS_TARGET, "任务目标仓库不在 Wise 仓库列表中或尚未指定").decision()],
                );
                continue;
            };
            let manifest = match task.executor_agent_id.as_deref() {
                Some(agent_id) => runtime::resolve(
                    conn,
                    &ResolveInput {
                        agent_id,
                        revision: task.profile_revision,
                        project_id: task.project_id.as_deref(),
                        repository_id: task.repository_id,
                        repository_path: Some(&repo.path),
                        known_mcp_server_ids: input.known_mcp_server_ids.as_deref(),
                        require_enabled: true,
                    },
                    matrix,
                )?,
                None => EffectiveConfigManifest {
                    engine_id: "claude".into(),
                    repository_id: task.repository_id,
                    project_id: task.project_id.clone(),
                    resolved_at: now_ms(),
                    ..Default::default()
                },
            };
            if manifest.blocked {
                skip(
                    &mut skipped,
                    manifest
                        .block_reasons
                        .iter()
                        .map(|r| Blocker::new(codes::REQUIRED_CAPABILITY_MISSING, r.clone()).decision())
                        .collect(),
                );
                continue;
            }
            let read_only = task.kind == "plan" || manifest.access_scope.as_deref() == Some("read");
            let ws_key = if read_only { None } else { workspace_key(&task) };
            if let Some(key) = ws_key.as_deref() {
                if let Some(holder) = workspace_busy(conn, key)? {
                    skip(
                        &mut skipped,
                        vec![Blocker::new(codes::STOP_PENDING, "工作区写租约被其他执行占用").with_ref(&holder)],
                    );
                    continue;
                }
            }

            let now = now_ms();
            let generation = task.generation + 1;
            let dispatch_key = format!("{}:{}", task.id, generation);
            let changed = conn.execute(
                "UPDATE collab_tasks SET state = 'running', generation = ?3, revision = revision + 1, updated_at = ?4
                 WHERE id = ?1 AND revision = ?2 AND state = 'ready'",
                params![task.id, task.revision, generation, now],
            )?;
            if changed == 0 {
                skip(&mut skipped, vec![Blocker::new(codes::REVISION_CONFLICT, "任务状态已变化，稍后重新评估")]);
                continue;
            }
            let fencing = next_counter(conn, "fencing")?;
            let attempt_id = new_id("att");
            let secret = new_secret();
            let covered = covered_changes(conn, &task)?;
            conn.execute(
                "INSERT INTO collab_attempts (
                    id, task_id, requirement_id, generation, dispatch_key, secret, action, covered_changes_json,
                    effective_config_manifest_json, lease_owner, lease_expiry, fencing_token, workspace_key, state, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'claimed', ?14)",
                params![
                    attempt_id,
                    task.id,
                    req.id,
                    generation,
                    dispatch_key,
                    secret,
                    task.next_action,
                    covered.to_string(),
                    to_json(&manifest),
                    owner,
                    now + LEASE_MS,
                    fencing,
                    ws_key,
                    now
                ],
            )?;
            if let Some(key) = ws_key.as_deref() {
                conn.execute(
                    "INSERT OR REPLACE INTO collab_workspace_locks (workspace_key, attempt_id, fencing_token, acquired_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![key, attempt_id, fencing, now],
                )?;
            }
            let task = model::load_task(conn, &task.id)?;
            let package = super::context::build_package(conn, &req, &task, &attempt_id, &manifest, &repo, repos)?;
            conn.execute(
                "UPDATE collab_attempts SET input_manifest_json = ?2 WHERE id = ?1",
                params![attempt_id, package.get("inputManifest").cloned().unwrap_or(Value::Null).to_string()],
            )?;
            let prompt = super::context::build_prompt(&package);
            let spawn = if manifest.agent_id.is_empty() {
                SpawnConfig {
                    engine_id: "claude".into(),
                    disallowed_tools: read_only.then(|| runtime::READ_ONLY_DISALLOWED_TOOLS.to_string()),
                    read_only,
                    ..Default::default()
                }
            } else {
                runtime::spawn_config(conn, &manifest, read_only, Vec::new())?
            };
            append_event(
                conn,
                &req.id,
                "attempt.claimed",
                json!({ "taskId": task.id, "attemptId": attempt_id, "dispatchKey": dispatch_key, "fencingToken": fencing }),
                Some(&task.id),
                None,
            )?;
            send_message(
                conn,
                &req.id,
                NewMessage::new(
                    "task.assigned",
                    json!({ "attemptId": attempt_id, "title": task.title, "action": task.next_action, "coveredChanges": covered }),
                )
                .to_task(&task.id)
                .correlation(&task.id)
                .with_id(format!("msg-assign-{dispatch_key}")),
            )?;
            if req.stage == "planning" && task.kind != "plan" {
                conn.execute(
                    "UPDATE collab_requirements SET stage = 'executing', updated_at = ?2 WHERE id = ?1",
                    params![req.id, now],
                )?;
            }
            let attempt = model::load_attempt(conn, &attempt_id)?;
            let session_name = format!("{} · {}", super::util::truncate_chars(&req.title, 24), task.title);
            return Ok(ClaimOutcome {
                claimed: Some(ClaimedTask {
                    attempt,
                    attempt_secret: secret,
                    task,
                    requirement_id: req.id.clone(),
                    requirement_title: req.title.clone(),
                    repository: Some(repo),
                    session_name,
                    prompt,
                    spawn,
                    manifest,
                    context: package,
                }),
                skipped,
                global_active: global_active + 1,
                global_limit: limit,
            });
        }
        Ok(ClaimOutcome { claimed: None, skipped, global_active, global_limit: limit })
    })
}

/// Change requests this attempt re-tests (merged into one attempt per consumer).
fn covered_changes(conn: &Connection, task: &TaskRow) -> CResult<Value> {
    let mut out = Vec::new();
    for cr in model::list_changes(conn, &task.requirement_id)? {
        if cr.state != "ready_for_retest" {
            continue;
        }
        if let Some(c) = cr
            .consumers
            .iter()
            .find(|c| c.consumer_task_id == task.id && c.round == cr.round && c.ack_status == "waiting")
        {
            let version = cr
                .candidate_artifact_version_id
                .as_deref()
                .map(|id| model::load_artifact_version(conn, id))
                .transpose()?;
            out.push(json!({
                "changeRequestId": cr.id,
                "code": cr.code,
                "round": cr.round,
                "changeRevision": cr.revision,
                "expectedVersion": c.expected_version,
                "artifact": version.as_ref().map(|v| json!({ "id": v.id, "name": v.name, "version": v.version })),
            }));
        }
    }
    Ok(Value::Array(out))
}

/// Validates the caller still owns the live attempt (fencing + generation).
pub fn live_attempt(conn: &Connection, attempt_id: &str, fencing_token: i64, allow_stopping: bool) -> CResult<AttemptRow> {
    let att = model::load_attempt(conn, attempt_id)?;
    let stale = || CollabError::new(codes::STALE_ATTEMPT, "执行尝试已过期或已被新的尝试取代，结果不会写入").with_tasks(vec![att.task_id.clone()]);
    if att.fencing_token != fencing_token {
        return Err(stale());
    }
    let ok_state = match att.state.as_str() {
        "claimed" | "running" | "lost" => true,
        "stop_requested" | "stop_pending" => allow_stopping,
        _ => false,
    };
    if !ok_state {
        return Err(stale());
    }
    let task = model::load_task(conn, &att.task_id)?;
    if task.generation != att.generation {
        return Err(stale());
    }
    Ok(att)
}

/// Agent/bridge authentication by attempt secret; returns the attempt for fencing checks.
pub fn authenticate(conn: &Connection, attempt_id: &str, secret: &str) -> CResult<AttemptRow> {
    let att = model::load_attempt(conn, attempt_id)?;
    let a = att.secret.as_bytes();
    let b = secret.trim().as_bytes();
    let mut diff = (a.len() ^ b.len()) as u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    if diff != 0 || a.is_empty() {
        return Err(CollabError::new(codes::FORBIDDEN, "执行身份校验失败"));
    }
    Ok(att)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchCheck {
    pub proceed: bool,
    pub reason: Option<String>,
    pub attempt: AttemptRow,
}

/// Re-checked by the bridge right before spawning (cancel may land between claim and spawn).
pub fn confirm_launch(conn: &Connection, attempt_id: &str, fencing_token: i64) -> CResult<LaunchCheck> {
    tx(conn, |conn| {
        let att = live_attempt(conn, attempt_id, fencing_token, true)?;
        let req = model::load_requirement(conn, &att.requirement_id)?;
        let task = model::load_task(conn, &att.task_id)?;
        let mut reason = None;
        if att.state == "stop_requested" {
            reason = att.stop_reason.clone().or(Some("已请求停止".into()));
        } else if req.control_status != "active" {
            reason = Some(format!("需求控制状态为 {}", req.control_status));
        } else if !task.active {
            reason = Some("任务已被新计划取代".into());
        }
        if let Some(r) = reason.as_deref() {
            finish_locked(conn, &att, "stopped", Some(r), None, None)?;
            return Ok(LaunchCheck { proceed: false, reason, attempt: model::load_attempt(conn, attempt_id)? });
        }
        Ok(LaunchCheck { proceed: true, reason: None, attempt: att })
    })
}

/// Records the session created for a claimed attempt (idempotent for the same session).
pub fn bind_session(conn: &Connection, attempt_id: &str, fencing_token: i64, session_id: &str) -> CResult<AttemptRow> {
    tx(conn, |conn| {
        let att = live_attempt(conn, attempt_id, fencing_token, true)?;
        let session_id = session_id.trim();
        if session_id.is_empty() {
            return Err(CollabError::invalid("sessionId 不能为空"));
        }
        if let Some(existing) = att.session_id.as_deref() {
            if existing != session_id {
                return Err(CollabError::new(codes::INVALID_STATE, "该派发已绑定其他会话，不能重复建会话"));
            }
            return Ok(att);
        }
        let now = now_ms();
        let next_state = if att.state == "claimed" { "running" } else { att.state.as_str() };
        conn.execute(
            "UPDATE collab_attempts SET session_id = ?2, state = ?3, started_at = COALESCE(started_at, ?4), lease_expiry = ?5
             WHERE id = ?1",
            params![att.id, session_id, next_state, now, now + LEASE_MS],
        )?;
        model::link_session(conn, &att.requirement_id, session_id, "execution")?;
        append_event(
            conn,
            &att.requirement_id,
            "attempt.started",
            json!({ "taskId": att.task_id, "attemptId": att.id, "sessionId": session_id }),
            Some(&att.task_id),
            None,
        )?;
        model::load_attempt(conn, attempt_id)
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatAck {
    pub state: String,
    pub stop_requested: bool,
    pub stop_reason: Option<String>,
    pub lease_expiry: i64,
}

pub fn heartbeat(conn: &Connection, attempt_id: &str, fencing_token: i64) -> CResult<HeartbeatAck> {
    tx(conn, |conn| {
        let att = live_attempt(conn, attempt_id, fencing_token, true)?;
        let now = now_ms();
        let state = if att.state == "lost" { "running" } else { att.state.as_str() };
        conn.execute(
            "UPDATE collab_attempts SET lease_expiry = ?2, state = ?3 WHERE id = ?1",
            params![att.id, now + LEASE_MS, state],
        )?;
        Ok(HeartbeatAck {
            state: state.to_string(),
            stop_requested: matches!(state, "stop_requested" | "stop_pending"),
            stop_reason: att.stop_reason.clone(),
            lease_expiry: now + LEASE_MS,
        })
    })
}

/// Expired leases only mean "needs reconciliation"; the workspace lock stays held.
pub fn expire_leases(conn: &Connection) -> CResult<Vec<String>> {
    let now = now_ms();
    let rows: Vec<(String, String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, requirement_id, task_id, state FROM collab_attempts
             WHERE state IN ('claimed', 'running', 'stop_requested') AND lease_expiry < ?1",
        )?;
        let rows = stmt
            .query_map(params![now], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<_, _>>()?;
        rows
    };
    let mut ids = Vec::new();
    for (id, req, task, state) in rows {
        let next = if state == "stop_requested" { "stop_pending" } else { "lost" };
        conn.execute("UPDATE collab_attempts SET state = ?2 WHERE id = ?1", params![id, next])?;
        append_event(conn, &req, &format!("attempt.{next}"), json!({ "taskId": task, "attemptId": id }), Some(&task), None)?;
        if next == "stop_pending" {
            send_message(
                conn,
                &req,
                NewMessage::new("requirement.stop_pending", json!({ "attemptId": id, "taskId": task }))
                    .from_task(Some(&task))
                    .with_id(format!("msg-stop-pending-{id}")),
            )?;
        }
        ids.push(id);
    }
    Ok(ids)
}

pub fn request_stop(conn: &Connection, attempt_id: &str, reason: &str) -> CResult<AttemptRow> {
    let att = model::load_attempt(conn, attempt_id)?;
    if !matches!(att.state.as_str(), "claimed" | "running" | "lost") {
        return Ok(att);
    }
    conn.execute(
        "UPDATE collab_attempts SET state = 'stop_requested', stop_reason = ?2 WHERE id = ?1",
        params![att.id, reason],
    )?;
    append_event(
        conn,
        &att.requirement_id,
        "attempt.stop_requested",
        json!({ "taskId": att.task_id, "attemptId": att.id, "reason": reason }),
        Some(&att.task_id),
        None,
    )?;
    model::load_attempt(conn, attempt_id)
}

/// Bridge could not confirm the process exited in time.
pub fn mark_stop_pending(conn: &Connection, attempt_id: &str) -> CResult<AttemptRow> {
    tx(conn, |conn| {
        let att = model::load_attempt(conn, attempt_id)?;
        if att.state != "stop_requested" {
            return Ok(att);
        }
        conn.execute("UPDATE collab_attempts SET state = 'stop_pending' WHERE id = ?1", params![att.id])?;
        send_message(
            conn,
            &att.requirement_id,
            NewMessage::new("requirement.stop_pending", json!({ "attemptId": att.id, "taskId": att.task_id }))
                .from_task(Some(&att.task_id))
                .with_id(format!("msg-stop-pending-{}", att.id)),
        )?;
        model::load_attempt(conn, attempt_id)
    })
}

pub fn request_stop_for_requirement(conn: &Connection, requirement_id: &str, reason: &str) -> CResult<i64> {
    let mut n = 0;
    for att in model::list_attempts_for_requirement(conn, requirement_id)? {
        if matches!(att.state.as_str(), "claimed" | "running" | "lost") {
            request_stop(conn, &att.id, reason)?;
            n += 1;
        }
    }
    Ok(n)
}

pub fn request_stop_for_task(conn: &Connection, task_id: &str, reason: &str) -> CResult<bool> {
    match model::active_attempt_for_task(conn, task_id)? {
        Some(att) if matches!(att.state.as_str(), "claimed" | "running" | "lost") => {
            request_stop(conn, &att.id, reason)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// Disabling an agent stops its running attempts at the next checkpoint.
pub fn request_stop_for_agent(conn: &Connection, agent_id: &str, reason: &str) -> CResult<i64> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT a.id FROM collab_attempts a JOIN collab_tasks t ON t.id = a.task_id
             WHERE t.executor_agent_id = ?1 AND a.state IN {ACTIVE_ATTEMPT_STATES}"
        ))?;
        let rows = stmt.query_map(params![agent_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    for id in &ids {
        request_stop(conn, id, reason)?;
    }
    Ok(ids.len() as i64)
}

/// Unbinding revokes the agent's access to the repository immediately.
pub fn handle_binding_revoked(conn: &Connection, binding: &AgentBinding) -> CResult<()> {
    let rows: Vec<(String, String, Option<String>)> = {
        let mut stmt = conn.prepare(
            "SELECT t.id, t.requirement_id, a.id FROM collab_tasks t
             LEFT JOIN collab_attempts a ON a.task_id = t.id AND a.state <> 'finished'
             WHERE t.executor_agent_id = ?1 AND t.repository_id = ?2 AND t.active = 1
               AND t.state NOT IN ('succeeded', 'cancelled')",
        )?;
        let rows = stmt
            .query_map(params![binding.agent_id, binding.repository_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        rows
    };
    for (task_id, req_id, attempt_id) in rows {
        if let Some(att) = attempt_id.as_deref() {
            request_stop(conn, att, "binding_revoked")?;
        }
        super::decisions::open(
            conn,
            super::decisions::OpenDecision {
                requirement_id: req_id.clone(),
                kind: "binding_revoked".into(),
                dedupe_key: format!("binding_revoked:{task_id}:{}", binding.id),
                title: "执行智能体已解绑目标仓库，需要改派或重新绑定".into(),
                task_ids: vec![task_id.clone()],
                blocked_ops: vec![],
                evidence: json!({ "bindingId": binding.id, "agentId": binding.agent_id, "repositoryId": binding.repository_id }),
                options: json!([
                    { "id": "reassign", "label": "改派给其他智能体" },
                    { "id": "cancel_task", "label": "取消该任务" }
                ]),
            },
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CheckpointInput {
    pub code_location: Value,
    pub worktree_digest: String,
    pub completed: Value,
    pub todo: Value,
    pub failing_cases: Value,
    pub locked_versions: Value,
    pub resume_notes: String,
}

fn json_or(value: &Value, fallback: Value) -> String {
    if value.is_null() { fallback.to_string() } else { value.to_string() }
}

pub fn save_checkpoint(conn: &Connection, attempt_id: &str, fencing_token: i64, input: &CheckpointInput) -> CResult<String> {
    tx(conn, |conn| {
        let att = live_attempt(conn, attempt_id, fencing_token, true)?;
        let id = new_id("cp");
        let now = now_ms();
        conn.execute(
            "INSERT INTO collab_checkpoints (
                id, task_id, attempt_id, code_location_json, worktree_digest, completed_json, todo_json,
                failing_cases_json, locked_versions_json, resume_notes, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                att.task_id,
                att.id,
                json_or(&input.code_location, json!({})),
                input.worktree_digest.trim(),
                json_or(&input.completed, json!([])),
                json_or(&input.todo, json!([])),
                json_or(&input.failing_cases, json!([])),
                json_or(&input.locked_versions, json!([])),
                input.resume_notes.trim(),
                now
            ],
        )?;
        conn.execute(
            "UPDATE collab_tasks SET checkpoint_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![att.task_id, id, now],
        )?;
        append_event(
            conn,
            &att.requirement_id,
            "checkpoint.saved",
            json!({ "taskId": att.task_id, "attemptId": att.id, "checkpointId": id }),
            Some(&att.task_id),
            None,
        )?;
        Ok(id)
    })
}

/// Structured result reported by the agent (via the bridge CLI) before the session ends.
pub fn record_result(conn: &Connection, attempt_id: &str, fencing_token: i64, report: &Value) -> CResult<AttemptRow> {
    tx(conn, |conn| {
        let att = live_attempt(conn, attempt_id, fencing_token, true)?;
        let status = report.get("status").and_then(Value::as_str).unwrap_or("");
        if !matches!(status, "succeeded" | "failed" | "blocked") {
            return Err(CollabError::new(
                codes::INVALID_PAYLOAD,
                "result.status 必须为 succeeded / failed / blocked",
            ));
        }
        conn.execute(
            "UPDATE collab_attempts SET reported_json = ?2 WHERE id = ?1",
            params![att.id, report.to_string()],
        )?;
        if let Some(items) = report.get("memories").and_then(Value::as_array) {
            let task = model::load_task(conn, &att.task_id)?;
            if let Some(agent_id) = task.executor_agent_id.as_deref() {
                for item in items.iter().take(10) {
                    let content = item.get("content").and_then(Value::as_str).or_else(|| item.as_str()).unwrap_or("");
                    if content.trim().is_empty() {
                        continue;
                    }
                    let scope = item.get("scope").and_then(Value::as_str).unwrap_or("repository");
                    super::memory::add_memory(
                        conn,
                        super::memory::AddMemoryInput {
                            agent_id: agent_id.to_string(),
                            scope: if matches!(scope, "agent" | "repository" | "requirement") { scope.into() } else { "repository".into() },
                            project_id: task.project_id.clone(),
                            repository_id: task.repository_id,
                            requirement_id: Some(task.requirement_id.clone()),
                            content: content.to_string(),
                            trust: Some("candidate".into()),
                            source_attempt_id: Some(att.id.clone()),
                            evidence: item.get("evidence").cloned(),
                            expires_at: None,
                        },
                    )?;
                }
            }
        }
        append_event(
            conn,
            &att.requirement_id,
            "attempt.result_reported",
            json!({ "taskId": att.task_id, "attemptId": att.id, "status": status }),
            Some(&att.task_id),
            None,
        )?;
        model::load_attempt(conn, attempt_id)
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FinishInput {
    pub attempt_id: String,
    pub fencing_token: i64,
    /// `completed` (session idle) / `error` / `stopped` / `session_lost`.
    pub outcome: String,
    pub message: Option<String>,
    pub duration_ms: Option<i64>,
    pub tokens: Option<i64>,
}

/// Session ended: settles the task from the reported result and authoritative evidence.
pub fn finish_attempt(conn: &Connection, input: &FinishInput) -> CResult<AttemptRow> {
    tx(conn, |conn| {
        let att = model::load_attempt(conn, &input.attempt_id)?;
        if att.state == "finished" {
            return Ok(att);
        }
        if att.fencing_token != input.fencing_token {
            return Err(CollabError::new(codes::STALE_ATTEMPT, "执行尝试已被取代，结束回执被忽略"));
        }
        finish_locked(conn, &att, &input.outcome, input.message.as_deref(), input.duration_ms, input.tokens)?;
        model::load_attempt(conn, &att.id)
    })
}

fn output_settlement(conn: &Connection, task: &TaskRow) -> CResult<(&'static str, Option<String>)> {
    let outputs = task.output_artifacts();
    let mut pending = false;
    for name in &outputs {
        let state: Option<String> = conn
            .query_row(
                "SELECT v.validation_state FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id
                 WHERE v.requirement_id = ?1 AND a.name = ?2 AND v.producer_task_id = ?3 AND v.is_draft = 0
                 ORDER BY v.version DESC LIMIT 1",
                params![task.requirement_id, name, task.id],
                |r| r.get(0),
            )
            .optional()?;
        match state.as_deref() {
            Some("valid") => {}
            Some("pending") => pending = true,
            Some(other) => return Ok(("failed", Some(format!("交付包 {name} 校验结果为 {other}")))),
            None => return Ok(("failed", Some(format!("未发布声明的交付包 {name}")))),
        }
    }
    Ok((if pending { "checking" } else { "succeeded" }, None))
}

fn settle_success(conn: &Connection, task: &TaskRow, attempt: &AttemptRow) -> CResult<(&'static str, Option<String>)> {
    match task.kind.as_str() {
        "plan" => {
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM collab_plan_revisions WHERE requirement_id = ?1 AND created_by_attempt_id = ?2",
                params![task.requirement_id, attempt.id],
                |r| r.get(0),
            )?;
            if n > 0 {
                Ok(("succeeded", None))
            } else {
                Ok(("failed", Some("规划会话结束但未通过 wise-collab plan 发布计划".into())))
            }
        }
        "implement" | "repair" | "env" => output_settlement(conn, task),
        _ => Ok(("succeeded", None)),
    }
}

pub(crate) fn finish_locked(
    conn: &Connection,
    att: &AttemptRow,
    outcome: &str,
    message: Option<&str>,
    duration_ms: Option<i64>,
    tokens: Option<i64>,
) -> CResult<()> {
    let now = now_ms();
    let task = model::load_task(conn, &att.task_id)?;
    let req = model::load_requirement(conn, &att.requirement_id)?;
    let duration = duration_ms.unwrap_or_else(|| att.started_at.map(|s| (now - s).max(0)).unwrap_or(0));
    super::usage::record(
        conn,
        &format!("{}:finish", att.id),
        &req.id,
        Some(&att.id),
        "execution",
        duration,
        tokens,
        "wise-bridge",
        if tokens.is_some() { "exact" } else { "estimated" },
    )?;
    release_workspace_lock(conn, att)?;

    let stopped = matches!(att.state.as_str(), "stop_requested" | "stop_pending") || outcome == "stopped";
    let reported_status = att
        .reported
        .as_ref()
        .and_then(|r| r.get("status"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut failure_reason: Option<String> = None;
    let mut next_state: &str;
    let mut next_action = task.next_action.clone();
    let result: &str;

    if task.state == "waiting_change" {
        // A change request parked this consumer; it resumes via retest, not via this attempt.
        next_state = "waiting_change";
        next_action = "retest_then_continue".into();
        result = "parked";
    } else if stopped {
        result = "stopped";
        next_state = if matches!(req.control_status.as_str(), "cancelling" | "cancelled") || !task.active {
            "cancelled"
        } else {
            next_action = "resume".into();
            "ready"
        };
    } else if outcome == "completed" && reported_status.as_deref() == Some("succeeded") {
        let (state, reason) = settle_success(conn, &task, att)?;
        next_state = state;
        failure_reason = reason;
        result = if state == "failed" { "failed" } else { "succeeded" };
    } else if outcome == "completed" && reported_status.as_deref() == Some("blocked") {
        result = "blocked";
        next_state = "ready";
        next_action = "resume".into();
    } else {
        result = "failed";
        next_state = "failed";
        failure_reason = Some(match (outcome, reported_status.as_deref()) {
            ("completed", Some("failed")) => att
                .reported
                .as_ref()
                .and_then(|r| r.get("summary"))
                .and_then(Value::as_str)
                .unwrap_or("智能体报告失败")
                .to_string(),
            ("completed", None) => "会话结束但未通过 wise-collab result 提交结构化结果".into(),
            ("session_lost", _) => "执行会话失联".into(),
            _ => message.unwrap_or("执行出错").to_string(),
        });
    }

    let mut failure_count = task.failure_count;
    if next_state == "failed" {
        failure_count += 1;
        if failure_count < task.attempt_budget {
            next_state = "ready";
            next_action = "retry".into();
        }
    }
    conn.execute(
        "UPDATE collab_attempts SET state = 'finished', result = ?2, result_json = ?3, finished_at = ?4 WHERE id = ?1",
        params![
            att.id,
            result,
            json!({ "outcome": outcome, "message": message, "failureReason": failure_reason }).to_string(),
            now
        ],
    )?;
    let task_result = json!({
        "attemptId": att.id,
        "result": result,
        "reported": att.reported,
        "failureReason": failure_reason,
        "finishedAt": now,
    });
    conn.execute(
        "UPDATE collab_tasks SET state = ?2, next_action = ?3, failure_count = ?4, result_json = ?5,
            revision = revision + 1, updated_at = ?6,
            queued_at = CASE WHEN ?2 = 'ready' THEN ?6 ELSE queued_at END
         WHERE id = ?1",
        params![task.id, next_state, next_action, failure_count, task_result.to_string(), now],
    )?;
    append_event(
        conn,
        &req.id,
        "attempt.finished",
        json!({ "taskId": task.id, "attemptId": att.id, "result": result, "taskState": next_state, "failureReason": failure_reason }),
        Some(&task.id),
        None,
    )?;
    if next_state == "failed" {
        send_message(
            conn,
            &req.id,
            NewMessage::new(
                "task.failed",
                json!({ "title": task.title, "reason": failure_reason, "failureCount": failure_count }),
            )
            .from_task(Some(&task.id))
            .with_id(format!("msg-failed-{}", att.id)),
        )?;
        super::decisions::open(
            conn,
            super::decisions::OpenDecision {
                requirement_id: req.id.clone(),
                kind: "attempt_budget".into(),
                dedupe_key: format!("attempt_budget:{}", task.id),
                title: format!("「{}」连续失败 {} 次，需要决定是否继续", task.title, failure_count),
                task_ids: vec![task.id.clone()],
                blocked_ops: vec![],
                evidence: json!({ "reason": failure_reason, "attemptId": att.id }),
                options: json!([
                    { "id": "add_budget", "label": "增加尝试次数继续" },
                    { "id": "cancel_task", "label": "取消该任务" }
                ]),
            },
        )?;
    } else if next_state == "succeeded" {
        super::changes::on_task_succeeded(conn, &model::load_task(conn, &task.id)?)?;
        send_message(
            conn,
            &req.id,
            NewMessage::new("task.succeeded", json!({ "title": task.title, "attemptId": att.id }))
                .from_task(Some(&task.id))
                .with_id(format!("msg-succeeded-{}", att.id)),
        )?;
    }
    mark_task_inbox_processed(conn, &task.id)?;
    evaluate_requirement(conn, &req.id)?;
    Ok(())
}

fn mark_task_inbox_processed(conn: &Connection, task_id: &str) -> CResult<()> {
    for msg in super::events::task_inbox(conn, task_id)? {
        if msg.kind == "task.assigned" || msg.kind.starts_with("change.") || msg.kind == "artifact.ready" {
            super::events::advance_delivery(conn, &msg.id, "task", task_id, "processed", None)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReconcileInput {
    pub dispatch_key: String,
    /// `running` (process alive) / `idle` / `missing`.
    pub observed: String,
    pub session_id: Option<String>,
}

/// Restart / lease-expiry reconciliation keyed by dispatchKey; never spawns a second run.
pub fn reconcile(conn: &Connection, input: &ReconcileInput) -> CResult<Option<AttemptRow>> {
    tx(conn, |conn| {
        let Some(att) = model::attempt_by_dispatch_key(conn, input.dispatch_key.trim())? else {
            return Ok(None);
        };
        if att.state == "finished" {
            return Ok(Some(att));
        }
        let now = now_ms();
        match input.observed.as_str() {
            "running" => {
                let state = match att.state.as_str() {
                    "lost" | "claimed" => "running",
                    s => s,
                };
                conn.execute(
                    "UPDATE collab_attempts SET state = ?2, lease_expiry = ?3, session_id = COALESCE(session_id, ?4) WHERE id = ?1",
                    params![att.id, state, now + LEASE_MS, input.session_id],
                )?;
            }
            _ => {
                let outcome = if matches!(att.state.as_str(), "stop_requested" | "stop_pending") {
                    "stopped"
                } else if input.observed == "idle" {
                    "completed"
                } else {
                    "session_lost"
                };
                finish_locked(conn, &att, outcome, Some("重启核对"), None, None)?;
            }
        }
        Ok(Some(model::load_attempt(conn, &att.id)?))
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskExplanation {
    pub task_id: String,
    pub task_key: String,
    pub title: String,
    pub state: String,
    pub blockers: Vec<Blocker>,
}

/// Root-cause summary per task; distinguishes normal waiting from decision-needed deadlocks.
pub fn explain_requirement(conn: &Connection, requirement_id: &str) -> CResult<Vec<TaskExplanation>> {
    let req = model::load_requirement(conn, requirement_id)?;
    let mut out = Vec::new();
    for task in model::list_tasks(conn, requirement_id, true)? {
        if task.is_terminal() || task.state == "running" {
            continue;
        }
        let blockers = task_blockers(conn, &req, &task)?;
        out.push(TaskExplanation {
            task_id: task.id.clone(),
            task_key: task.task_key.clone(),
            title: task.title.clone(),
            state: task.state.clone(),
            blockers,
        });
    }
    Ok(out)
}

/// Re-derives task states / control transitions / aggregate status from current DB state.
pub fn evaluate_requirement(conn: &Connection, requirement_id: &str) -> CResult<()> {
    let req = model::load_requirement(conn, requirement_id)?;
    let now = now_ms();
    let active_attempts = count_active_attempts(conn, Some(requirement_id))?;
    match req.control_status.as_str() {
        "pausing" if active_attempts == 0 => {
            conn.execute(
                "UPDATE collab_requirements SET control_status = 'paused', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
                params![req.id, now],
            )?;
            append_event(conn, &req.id, "requirement.paused", json!({}), None, None)?;
            return Ok(());
        }
        "cancelling" if active_attempts == 0 => {
            conn.execute(
                "UPDATE collab_tasks SET state = 'cancelled', revision = revision + 1, updated_at = ?2
                 WHERE requirement_id = ?1 AND state NOT IN ('succeeded', 'cancelled')",
                params![req.id, now],
            )?;
            conn.execute(
                "UPDATE collab_requirements SET control_status = 'cancelled', stage = 'cancelled', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
                params![req.id, now],
            )?;
            conn.execute(
                "UPDATE collab_decisions SET state = 'cancelled', updated_at = ?2 WHERE requirement_id = ?1 AND state = 'open'",
                params![req.id, now],
            )?;
            super::runtime_resources::release_for_requirement(conn, &req.id)?;
            append_event(conn, &req.id, "requirement.cancelled", json!({}), None, None)?;
            return Ok(());
        }
        "active" => {}
        _ => return Ok(()),
    }

    let tasks = model::list_tasks(conn, requirement_id, true)?;
    for task in &tasks {
        match task.state.as_str() {
            "waiting_dependencies" | "ready" | "waiting_change" => {
                let mut dep_blocked = false;
                for dep in dependencies_for_task(conn, &task.id)? {
                    if dependency_blocker(conn, &req, &dep)?.is_some() {
                        dep_blocked = true;
                        break;
                    }
                }
                let change_blocked = !change_blockers(conn, task)?.is_empty();
                let (next, action) = if change_blocked {
                    ("waiting_change", "retest_then_continue".to_string())
                } else if dep_blocked {
                    ("waiting_dependencies", task.next_action.clone())
                } else if task.state == "waiting_change" {
                    ("ready", "retest_then_continue".to_string())
                } else {
                    ("ready", task.next_action.clone())
                };
                if next != task.state || action != task.next_action {
                    conn.execute(
                        "UPDATE collab_tasks SET state = ?2, next_action = ?3, revision = revision + 1, updated_at = ?4,
                            queued_at = CASE WHEN ?2 = 'ready' AND state <> 'ready' THEN ?4 ELSE queued_at END
                         WHERE id = ?1",
                        params![task.id, next, action, now],
                    )?;
                    if next == "ready" {
                        append_event(conn, &req.id, "task.ready", json!({ "taskId": task.id, "action": action }), Some(&task.id), None)?;
                    }
                }
            }
            "checking" => {
                let (state, reason) = output_settlement(conn, task)?;
                if state != "checking" {
                    let (state, failure_count, action) = if state == "failed" {
                        let fc = task.failure_count + 1;
                        if fc < task.attempt_budget { ("ready", fc, "retry") } else { ("failed", fc, "retry") }
                    } else {
                        (state, task.failure_count, task.next_action.as_str())
                    };
                    conn.execute(
                        "UPDATE collab_tasks SET state = ?2, failure_count = ?3, next_action = ?4, revision = revision + 1, updated_at = ?5,
                            queued_at = CASE WHEN ?2 = 'ready' THEN ?5 ELSE queued_at END
                         WHERE id = ?1",
                        params![task.id, state, failure_count, action, now],
                    )?;
                    append_event(
                        conn,
                        &req.id,
                        "task.checked",
                        json!({ "taskId": task.id, "state": state, "reason": reason }),
                        Some(&task.id),
                        None,
                    )?;
                    if state == "succeeded" {
                        super::changes::on_task_succeeded(conn, &model::load_task(conn, &task.id)?)?;
                    }
                }
            }
            _ => {}
        }
    }
    refresh_aggregate(conn, requirement_id)
}

fn refresh_aggregate(conn: &Connection, requirement_id: &str) -> CResult<()> {
    let req = model::load_requirement(conn, requirement_id)?;
    let now = now_ms();
    let tasks = model::list_tasks(conn, requirement_id, true)?;
    let live: Vec<&TaskRow> = tasks.iter().filter(|t| t.state != "cancelled").collect();
    let open_changes = model::list_changes(conn, requirement_id)?
        .into_iter()
        .filter(|c| c.is_open() && c.merged_into.is_none())
        .count();
    let open_decisions = model::list_decisions(conn, requirement_id, true)?.len();
    let all_done = !live.is_empty() && live.iter().all(|t| t.state == "succeeded");
    let only_plan = live.iter().all(|t| t.kind == "plan");
    let stage = if req.business_status == "done" {
        "done"
    } else if req.active_plan_revision == 0 || only_plan {
        "planning"
    } else if all_done && open_changes == 0 && open_decisions == 0 {
        "verifying"
    } else if open_changes > 0 {
        "repairing"
    } else {
        "executing"
    };
    let business = if req.business_status == "done" {
        "done"
    } else if stage == "verifying" {
        "verifying"
    } else {
        "open"
    };
    if stage != req.stage || business != req.business_status {
        conn.execute(
            "UPDATE collab_requirements SET stage = ?2, business_status = ?3, revision = revision + 1, updated_at = ?4 WHERE id = ?1",
            params![req.id, stage, business, now],
        )?;
        if business == "verifying" && req.business_status != "verifying" {
            send_message(
                conn,
                &req.id,
                NewMessage::new("requirement.verifying", json!({ "title": req.title }))
                    .with_id(format!("msg-verifying-{}-{}", req.id, req.revision)),
            )?;
        }
    }
    if business == "verifying" {
        super::acceptance::refresh_manifest(conn, requirement_id)?;
        if req.acceptance_policy == "machine" {
            super::acceptance::try_machine_accept(conn, requirement_id)?;
        }
    } else {
        super::acceptance::mark_stale(conn, requirement_id)?;
    }
    Ok(())
}

pub fn evaluate_all(conn: &Connection) -> CResult<()> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM collab_requirements WHERE business_status <> 'done' AND control_status <> 'cancelled'",
        )?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    for id in ids {
        tx(conn, |conn| evaluate_requirement(conn, &id))?;
    }
    Ok(())
}
