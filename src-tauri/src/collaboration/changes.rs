//! 修正单：结构化问题载荷 → 去重 / 合并 → 按类别分流（契约违约生成修复任务、消费者缺陷自修、
//! 环境问题生成环境任务、范围 / 未知转决策）→ 每轮独立 repair task → 多消费者复验回执 → 关闭或下一轮。
//!
//! 轮次以 `(changeRequestId, round)` 幂等；旧轮次的迟到回执返回 `STALE_ROUND`，不会关闭新轮次。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::decisions::{self, OpenDecision};
use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model::{self, ArtifactVersionRow, ChangeRequestRow, DecisionRow, TaskRow};
use super::scheduler::{self, CheckpointInput};
use super::util::{hash_json, new_id, next_counter, now_ms, request_record, request_replay, sha256_hex, tx};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChangePayload {
    pub request_id: String,
    /// `contract_violation` / `consumer_bug` / `environment` / `scope` / `unknown`.
    pub category: String,
    pub summary: String,
    pub artifact: String,
    pub consumed_version: Option<i64>,
    pub operation: String,
    pub field: Option<String>,
    pub assertion: Option<String>,
    pub expected: Value,
    pub actual: Value,
    pub request_ref: Option<String>,
    pub response_ref: Option<String>,
    pub reproduction: Vec<String>,
    pub environment: Value,
    pub impact: String,
    pub acceptance: Vec<String>,
    pub checkpoint: Option<CheckpointInput>,
}

fn blank(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(o) => o.is_empty(),
        _ => false,
    }
}

pub fn normalize_category(c: &str) -> &'static str {
    match c.trim() {
        "contract_violation" => "contract_violation",
        "consumer_bug" => "consumer_bug",
        "environment" => "environment",
        "scope" => "scope",
        _ => "unknown",
    }
}

/// Missing required fields; an incomplete payload never dispatches context-free work.
pub fn missing_fields(p: &ChangePayload) -> Vec<&'static str> {
    let category = normalize_category(&p.category);
    let mut out = Vec::new();
    if p.summary.trim().is_empty() {
        out.push("summary");
    }
    if category != "environment" && category != "scope" {
        if p.artifact.trim().is_empty() {
            out.push("artifact");
        }
        if p.operation.trim().is_empty() {
            out.push("operation");
        }
        if p.field.as_deref().map_or(true, |s| s.trim().is_empty()) && p.assertion.as_deref().map_or(true, |s| s.trim().is_empty()) {
            out.push("field|assertion");
        }
        if blank(&p.expected) {
            out.push("expected");
        }
        if blank(&p.actual) {
            out.push("actual");
        }
    }
    if category == "environment" && blank(&p.environment) {
        out.push("environment");
    }
    if p.reproduction.iter().all(|s| s.trim().is_empty()) {
        out.push("reproduction");
    }
    if p.impact.trim().is_empty() {
        out.push("impact");
    }
    if p.acceptance.iter().all(|s| s.trim().is_empty()) {
        out.push("acceptance");
    }
    out
}

pub fn dedupe_key(requirement_id: &str, p: &ChangePayload, version: Option<i64>) -> String {
    let norm = |s: &str| s.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    sha256_hex(&format!(
        "{}|{}|{:?}|{}|{}|{}",
        requirement_id,
        norm(&p.artifact),
        version,
        norm(&p.operation),
        norm(p.field.as_deref().unwrap_or("")),
        norm(p.assertion.as_deref().unwrap_or(""))
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSubmitResult {
    pub change: ChangeRequestRow,
    pub merged: bool,
    pub consumer_parked: bool,
    pub instruction: String,
}

fn park_consumer(conn: &Connection, task_id: &str) -> CResult<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE collab_tasks SET state = 'waiting_change', next_action = 'retest_then_continue', revision = revision + 1, updated_at = ?2
         WHERE id = ?1 AND state NOT IN ('succeeded', 'cancelled')",
        params![task_id, now],
    )?;
    scheduler::request_stop_for_task(conn, task_id, "waiting_change")?;
    Ok(())
}

fn add_consumer(conn: &Connection, change_id: &str, task_id: &str, round: i64) -> CResult<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO collab_change_consumers (change_request_id, consumer_task_id, round, ack_status, updated_at)
         VALUES (?1, ?2, ?3, 'waiting', ?4)",
        params![change_id, task_id, round, now_ms()],
    )?;
    Ok(n > 0)
}

fn resolve_version(conn: &Connection, requirement_id: &str, name: &str, version: Option<i64>) -> CResult<Option<ArtifactVersionRow>> {
    if name.trim().is_empty() {
        return Ok(None);
    }
    let id: Option<String> = conn
        .query_row(
            "SELECT v.id FROM collab_artifact_versions v JOIN collab_artifacts a ON a.id = v.artifact_id
             WHERE v.requirement_id = ?1 AND a.name = ?2 AND (?3 IS NULL OR v.version = ?3)
             ORDER BY v.version DESC LIMIT 1",
            params![requirement_id, name.trim(), version],
            |r| r.get(0),
        )
        .optional()?;
    id.map(|id| model::load_artifact_version(conn, &id)).transpose()
}

/// The live task that owns the artifact (latest spec revision of the producer key).
fn producer_for(conn: &Connection, v: &ArtifactVersionRow) -> CResult<TaskRow> {
    let original = model::load_task(conn, &v.producer_task_id)?;
    if original.active {
        return Ok(original);
    }
    Ok(model::active_task_by_key(conn, &v.requirement_id, &original.task_key)?.unwrap_or(original))
}

pub fn submit_change(conn: &Connection, attempt_id: &str, fencing_token: i64, payload: &ChangePayload) -> CResult<ChangeSubmitResult> {
    tx(conn, |conn| {
        let att = scheduler::live_attempt(conn, attempt_id, fencing_token, true)?;
        let reporter = model::load_task(conn, &att.task_id)?;
        let payload_hash = hash_json(&serde_json::to_value(payload)?);
        if let Some(prev) = request_replay(conn, &payload.request_id, "submit_change", &payload_hash)? {
            let change = model::load_change(conn, prev.get("id").and_then(Value::as_str).unwrap_or_default())?;
            return Ok(ChangeSubmitResult {
                merged: prev.get("merged").and_then(Value::as_bool).unwrap_or(false),
                consumer_parked: prev.get("parked").and_then(Value::as_bool).unwrap_or(false),
                instruction: prev.get("instruction").and_then(Value::as_str).unwrap_or_default().to_string(),
                change,
            });
        }
        let missing = missing_fields(payload);
        if !missing.is_empty() {
            return Err(CollabError::new(
                codes::INVALID_CHANGE_PAYLOAD,
                format!("修正单载荷缺少字段：{}（待补充反馈，不会派单）", missing.join(", ")),
            )
            .with_details(json!({ "missing": missing })));
        }
        let req = model::load_requirement(conn, &reporter.requirement_id)?;
        let category = normalize_category(&payload.category);
        let version = resolve_version(conn, &req.id, &payload.artifact, payload.consumed_version)?;
        if category == "contract_violation" && version.is_none() {
            return Err(CollabError::new(
                codes::INVALID_CHANGE_PAYLOAD,
                format!("未找到消费的交付包 {} v{:?}", payload.artifact, payload.consumed_version),
            ));
        }
        let producer = version.as_ref().map(|v| producer_for(conn, v)).transpose()?;
        if category == "contract_violation" && producer.as_ref().is_some_and(|p| p.task_key == reporter.task_key) {
            return Err(CollabError::invalid("不能对自己生产的交付包提交契约违约修正单"));
        }
        let key = dedupe_key(&req.id, payload, version.as_ref().map(|v| v.version));
        let now = now_ms();

        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM collab_change_requests WHERE requirement_id = ?1 AND dedupe_key = ?2 AND merged_into IS NULL
                   AND state NOT IN ('closed', 'rejected', 'verified') ORDER BY created_at ASC LIMIT 1",
                params![req.id, key],
                |r| r.get(0),
            )
            .optional()?;
        let (change_id, merged, parked) = if let Some(id) = existing {
            let cr = model::load_change(conn, &id)?;
            add_consumer(conn, &cr.id, &reporter.id, cr.round)?;
            park_consumer(conn, &reporter.id)?;
            append_event(
                conn,
                &req.id,
                "change.merged_consumer",
                json!({ "changeRequestId": cr.id, "consumerTaskId": reporter.id, "round": cr.round }),
                Some(&cr.id),
                Some(&att.id),
            )?;
            (cr.id, true, true)
        } else {
            let n = next_counter(conn, &format!("fix:{}", req.id))?;
            let code = format!("FIX-{n}");
            let id = new_id("cr");
            let mut body = serde_json::to_value(payload)?;
            body["consumedArtifactVersionId"] = json!(version.as_ref().map(|v| v.id.clone()));
            body["consumedVersion"] = json!(version.as_ref().map(|v| v.version));
            body["reporterTaskKey"] = json!(reporter.task_key);
            conn.execute(
                "INSERT INTO collab_change_requests (id, requirement_id, code, producer_task_id, reporter_task_id, dedupe_key,
                    category, state, round, round_budget, payload_json, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'open', 1, ?8, ?9, ?10, ?10)",
                params![
                    id,
                    req.id,
                    code,
                    producer.as_ref().map(|p| p.id.clone()),
                    reporter.id,
                    key,
                    category,
                    req.repair_round_budget,
                    body.to_string(),
                    now
                ],
            )?;
            add_consumer(conn, &id, &reporter.id, 1)?;
            append_event(
                conn,
                &req.id,
                "change.opened",
                json!({ "changeRequestId": id, "code": code, "category": category, "reporterTaskId": reporter.id }),
                Some(&id),
                Some(&att.id),
            )?;
            let parked = route_category(conn, &id, category, &reporter)?;
            (id, false, parked)
        };
        if parked {
            if let Some(cp) = payload.checkpoint.as_ref() {
                scheduler::save_checkpoint(conn, &att.id, att.fencing_token, cp)?;
            }
        }
        let change = model::load_change(conn, &change_id)?;
        send_message(
            conn,
            &req.id,
            NewMessage::new(
                "change.requested",
                json!({ "changeRequestId": change.id, "code": change.code, "category": change.category, "summary": payload.summary, "merged": merged }),
            )
            .from_task(Some(&reporter.id))
            .correlation(&change.id)
            .with_id(format!("msg-change-{}-{}", change.id, reporter.id)),
        )?;
        scheduler::evaluate_requirement(conn, &req.id)?;
        let instruction = if parked {
            format!("已登记修正单 {}；请保存检查点后结束本次会话，修正版本就绪后会自动唤醒你先复验再继续。", change.code)
        } else {
            format!("已登记 {}（消费方自身问题），请在本任务内继续修复。", change.code)
        };
        request_record(
            conn,
            &payload.request_id,
            "submit_change",
            &payload_hash,
            &json!({ "id": change.id, "merged": merged, "parked": parked, "instruction": instruction }),
        )?;
        Ok(ChangeSubmitResult { change: model::load_change(conn, &change_id)?, merged, consumer_parked: parked, instruction })
    })
}

/// Returns whether the reporter must wait (park) for this change.
fn route_category(conn: &Connection, change_id: &str, category: &str, reporter: &TaskRow) -> CResult<bool> {
    let cr = model::load_change(conn, change_id)?;
    let now = now_ms();
    match category {
        "contract_violation" => {
            create_repair_task(conn, &cr, cr.round)?;
            set_state(conn, &cr.id, "fixing")?;
            park_consumer(conn, &reporter.id)?;
            Ok(true)
        }
        "environment" => {
            create_env_task(conn, &cr)?;
            set_state(conn, &cr.id, "fixing")?;
            park_consumer(conn, &reporter.id)?;
            Ok(true)
        }
        "consumer_bug" => {
            conn.execute(
                "UPDATE collab_change_requests SET state = 'closed', resolution_json = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?1",
                params![cr.id, json!({ "handledBy": "consumer", "reason": "消费方自身缺陷，由消费任务自行修复" }).to_string(), now],
            )?;
            conn.execute(
                "UPDATE collab_change_consumers SET ack_status = 'released', updated_at = ?2 WHERE change_request_id = ?1",
                params![cr.id, now],
            )?;
            Ok(false)
        }
        _ => {
            set_state(conn, &cr.id, "needs_decision")?;
            decisions::open(
                conn,
                OpenDecision {
                    requirement_id: cr.requirement_id.clone(),
                    kind: "change_triage".into(),
                    dedupe_key: format!("triage:{}", cr.id),
                    title: format!("修正单 {} 的归属无法自动判断", cr.code),
                    task_ids: vec![reporter.id.clone()],
                    blocked_ops: vec![],
                    evidence: json!({ "changeRequestId": cr.id, "payload": cr.payload }),
                    options: json!([
                        { "id": "contract_violation", "label": "生产方违约，生成修复任务" },
                        { "id": "consumer_bug", "label": "消费方自身问题" },
                        { "id": "environment", "label": "环境问题" },
                        { "id": "reject", "label": "范围外 / 误报，拒绝" }
                    ]),
                },
            )?;
            park_consumer(conn, &reporter.id)?;
            Ok(true)
        }
    }
}

fn set_state(conn: &Connection, change_id: &str, state: &str) -> CResult<()> {
    conn.execute(
        "UPDATE collab_change_requests SET state = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?1",
        params![change_id, state, now_ms()],
    )?;
    Ok(())
}

/// One repair task per `(changeRequestId, round)`; the historical producer task keeps its success.
fn create_repair_task(conn: &Connection, cr: &ChangeRequestRow, round: i64) -> CResult<String> {
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM collab_tasks WHERE change_request_id = ?1 AND repair_round = ?2 AND kind = 'repair'",
            params![cr.id, round],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let producer_id = cr.producer_task_id.clone().ok_or_else(|| CollabError::state("修正单缺少生产任务"))?;
    let producer = model::load_task(conn, &producer_id)?;
    let artifact = cr.payload.get("artifact").and_then(Value::as_str).unwrap_or_default().to_string();
    let kind = producer
        .spec
        .get("outputs")
        .and_then(Value::as_array)
        .and_then(|o| o.iter().find(|o| o.get("artifact").and_then(Value::as_str) == Some(artifact.as_str())))
        .and_then(|o| o.get("kind").and_then(Value::as_str))
        .unwrap_or("api_contract")
        .to_string();
    let prior_failures: Vec<Value> = cr
        .consumers
        .iter()
        .filter(|c| c.round == round - 1 && c.ack_status == "failed")
        .map(|c| c.evidence.clone())
        .collect();
    let spec = json!({
        "goal": format!("修复 {}：{}", cr.code, cr.payload.get("summary").and_then(Value::as_str).unwrap_or("")),
        "changeRequestId": cr.id,
        "changeCode": cr.code,
        "round": round,
        "artifact": artifact,
        "outputs": [{ "artifact": artifact, "kind": kind }],
        "acceptance": cr.payload.get("acceptance").cloned().unwrap_or(json!([])),
        "verification": producer.spec.get("verification").cloned().unwrap_or(json!({})),
        "payload": cr.payload,
        "previousRoundFailures": prior_failures,
    });
    let id = new_id("task");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_tasks (
            id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind, state, active,
            spec_json, spec_hash, executor_agent_id, profile_revision, runtime_target, workspace_binding_json,
            attempt_budget, next_action, change_request_id, repair_round, priority, queued_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'repair', 'ready', 1, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 'start', ?16, ?17, 5, ?18, ?18, ?18)",
        params![
            id,
            cr.requirement_id,
            producer.plan_revision,
            format!("REPAIR-{}-{round}", cr.code),
            format!("修复 {}（第 {round} 轮）", cr.code),
            producer.project_id,
            producer.repository_id,
            producer.role,
            spec.to_string(),
            hash_json(&spec),
            producer.executor_agent_id,
            producer.profile_revision,
            producer.runtime_target,
            producer.workspace_binding.to_string(),
            producer.attempt_budget,
            cr.id,
            round,
            now
        ],
    )?;
    conn.execute(
        "UPDATE collab_change_requests SET current_repair_task_id = ?2, candidate_artifact_version_id = NULL, updated_at = ?3 WHERE id = ?1",
        params![cr.id, id, now],
    )?;
    send_message(
        conn,
        &cr.requirement_id,
        NewMessage::new(
            if round > 1 { "change.retest_failed" } else { "change.requested" },
            json!({ "changeRequestId": cr.id, "code": cr.code, "round": round, "payload": cr.payload, "previousRoundFailures": spec["previousRoundFailures"] }),
        )
        .to_task(&id)
        .correlation(&cr.id)
        .with_id(format!("msg-{}-round-{round}", cr.id)),
    )?;
    append_event(
        conn,
        &cr.requirement_id,
        "change.repair_task_created",
        json!({ "changeRequestId": cr.id, "taskId": id, "round": round }),
        Some(&cr.id),
        None,
    )?;
    Ok(id)
}

fn create_env_task(conn: &Connection, cr: &ChangeRequestRow) -> CResult<String> {
    let reporter = model::load_task(conn, &cr.reporter_task_id)?;
    let owner = match cr.producer_task_id.as_deref() {
        Some(p) => model::load_task(conn, p)?,
        None => reporter.clone(),
    };
    let key = format!("ENV-{}-{}", cr.code, cr.revision);
    if let Some(t) = model::active_task_by_key(conn, &cr.requirement_id, &key)? {
        return Ok(t.id);
    }
    let spec = json!({
        "goal": format!("修复运行环境问题 {}：{}", cr.code, cr.payload.get("summary").and_then(Value::as_str).unwrap_or("")),
        "changeRequestId": cr.id,
        "environment": cr.payload.get("environment"),
        "acceptance": cr.payload.get("acceptance").cloned().unwrap_or(json!([])),
        "verification": owner.spec.get("verification").cloned().unwrap_or(json!({})),
        "payload": cr.payload,
    });
    let id = new_id("task");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_tasks (
            id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind, state, active,
            spec_json, spec_hash, executor_agent_id, profile_revision, runtime_target, attempt_budget, next_action,
            change_request_id, priority, queued_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'environment', 'env', 'ready', 1, ?8, ?9, ?10, ?11, ?12, ?13, 'start', ?14, 5, ?15, ?15, ?15)",
        params![
            id,
            cr.requirement_id,
            owner.plan_revision,
            key,
            format!("环境修复 {}", cr.code),
            owner.project_id,
            owner.repository_id,
            spec.to_string(),
            hash_json(&spec),
            owner.executor_agent_id,
            owner.profile_revision,
            owner.runtime_target,
            owner.attempt_budget,
            cr.id,
            now
        ],
    )?;
    conn.execute(
        "UPDATE collab_change_requests SET current_repair_task_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![cr.id, id, now],
    )?;
    send_message(
        conn,
        &cr.requirement_id,
        NewMessage::new("change.requested", json!({ "changeRequestId": cr.id, "code": cr.code, "payload": cr.payload }))
            .to_task(&id)
            .correlation(&cr.id)
            .with_id(format!("msg-{}-env-{}", cr.id, cr.revision)),
    )?;
    Ok(id)
}

fn announce_ready(conn: &Connection, cr: &ChangeRequestRow, version: Option<&ArtifactVersionRow>) -> CResult<()> {
    for c in cr.consumers.iter().filter(|c| c.round == cr.round && c.ack_status == "waiting") {
        send_message(
            conn,
            &cr.requirement_id,
            NewMessage {
                change_revision: Some(cr.revision),
                round: Some(cr.round),
                action: Some("retest_then_continue".into()),
                artifact_refs: json!(version.map(|v| vec![json!({ "id": v.name, "version": v.version })]).unwrap_or_default()),
                source_task_id: cr.current_repair_task_id.clone(),
                ..NewMessage::new(
                    "change.ready_for_retest",
                    json!({ "changeRequestId": cr.id, "code": cr.code, "round": cr.round, "version": version.map(|v| v.version) }),
                )
            }
            .to_task(&c.consumer_task_id)
            .correlation(&cr.id)
            .with_id(format!("msg-{}-round-{}-ready-{}", cr.id, cr.round, c.consumer_task_id)),
        )?;
    }
    append_event(
        conn,
        &cr.requirement_id,
        "change.ready_for_retest",
        json!({ "changeRequestId": cr.id, "round": cr.round, "artifactVersionId": version.map(|v| v.id.clone()) }),
        Some(&cr.id),
        None,
    )?;
    Ok(())
}

/// A validated repair version makes the change retestable (not closed: consumers must re-verify).
pub fn on_artifact_valid(conn: &Connection, v: &ArtifactVersionRow) -> CResult<()> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM collab_change_requests WHERE current_repair_task_id = ?1 AND state = 'fixing' AND merged_into IS NULL",
        )?;
        let rows = stmt.query_map(params![v.producer_task_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    for id in ids {
        let now = now_ms();
        conn.execute(
            "UPDATE collab_change_requests SET state = 'ready_for_retest', candidate_artifact_version_id = ?2,
                revision = revision + 1, updated_at = ?3 WHERE id = ?1",
            params![id, v.id, now],
        )?;
        let cr = model::load_change(conn, &id)?;
        conn.execute(
            "UPDATE collab_change_consumers SET expected_version = ?3, updated_at = ?4
             WHERE change_request_id = ?1 AND round = ?2 AND ack_status = 'waiting'",
            params![cr.id, cr.round, v.version, now],
        )?;
        announce_ready(conn, &model::load_change(conn, &id)?, Some(v))?;
    }
    Ok(())
}

/// Environment tasks have no artifact; their success is the retest signal.
pub fn on_task_succeeded(conn: &Connection, task: &TaskRow) -> CResult<()> {
    if task.kind != "env" {
        return Ok(());
    }
    let Some(cr_id) = task.change_request_id.as_deref() else { return Ok(()) };
    let cr = model::load_change(conn, cr_id)?;
    if cr.state != "fixing" || cr.current_repair_task_id.as_deref() != Some(task.id.as_str()) {
        return Ok(());
    }
    set_state(conn, &cr.id, "ready_for_retest")?;
    announce_ready(conn, &model::load_change(conn, &cr.id)?, None)?;
    Ok(())
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RetestAck {
    pub request_id: String,
    pub change_request_id: String,
    pub round: i64,
    pub version: Option<i64>,
    pub change_revision: Option<i64>,
    pub passed: bool,
    /// Wise verification run ids executed after the candidate version (required for a pass).
    pub verification_run_ids: Vec<String>,
    pub evidence: Value,
    pub summary: String,
}

pub fn acknowledge_retest(conn: &Connection, attempt_id: &str, fencing_token: i64, ack: &RetestAck) -> CResult<ChangeRequestRow> {
    tx(conn, |conn| {
        let att = scheduler::live_attempt(conn, attempt_id, fencing_token, true)?;
        let payload_hash = hash_json(&serde_json::to_value(ack)?);
        if let Some(prev) = request_replay(conn, &ack.request_id, "ack_retest", &payload_hash)? {
            return model::load_change(conn, prev.get("id").and_then(Value::as_str).unwrap_or_default());
        }
        let cr = model::load_change(conn, &ack.change_request_id)?;
        let stale = |msg: String| {
            CollabError::new(codes::STALE_ROUND, msg)
                .with_revision(cr.revision)
                .with_details(json!({ "currentRound": cr.round, "state": cr.state }))
        };
        if ack.round != cr.round {
            return Err(stale(format!("回执属于第 {} 轮，修正单已进入第 {} 轮", ack.round, cr.round)));
        }
        if cr.state != "ready_for_retest" {
            return Err(stale(format!("修正单当前为 {}，不接受复验回执", cr.state)));
        }
        if let Some(rev) = ack.change_revision {
            if rev != cr.revision {
                return Err(stale(format!("修正单已更新到 revision {}", cr.revision)));
            }
        }
        let candidate = cr
            .candidate_artifact_version_id
            .as_deref()
            .map(|id| model::load_artifact_version(conn, id))
            .transpose()?;
        if let Some(v) = candidate.as_ref() {
            if ack.version != Some(v.version) {
                return Err(stale(format!("复验版本应为 {} v{}", v.name, v.version)));
            }
        }
        let consumer = cr
            .consumers
            .iter()
            .find(|c| c.consumer_task_id == att.task_id && c.round == cr.round)
            .ok_or_else(|| CollabError::new(codes::FORBIDDEN, "当前任务不是该修正单本轮的消费者"))?;
        if consumer.ack_status != "waiting" {
            return Ok(cr.clone());
        }
        if ack.passed {
            let since = candidate.as_ref().map(|v| v.created_at).unwrap_or(cr.updated_at.min(cr.created_at));
            let mut ok_runs = 0;
            for rid in &ack.verification_run_ids {
                let run = super::verification::load_run(conn, rid)?;
                if run.task_id == att.task_id && run.passed && run.started_at >= since {
                    ok_runs += 1;
                }
            }
            if ok_runs == 0 {
                return Err(CollabError::new(
                    codes::INVALID_PAYLOAD,
                    "复验通过需要引用本任务在修正版本发布后的 Wise 验证运行（wise-collab verify）",
                ));
            }
        }
        let now = now_ms();
        let evidence = json!({
            "passed": ack.passed,
            "summary": ack.summary,
            "verificationRunIds": ack.verification_run_ids,
            "evidence": ack.evidence,
            "attemptId": att.id,
            "at": now,
        });
        conn.execute(
            "UPDATE collab_change_consumers SET ack_status = ?4, evidence_json = ?5, retest_attempt_id = ?6, updated_at = ?7
             WHERE change_request_id = ?1 AND consumer_task_id = ?2 AND round = ?3",
            params![cr.id, att.task_id, cr.round, if ack.passed { "passed" } else { "failed" }, evidence.to_string(), att.id, now],
        )?;
        if let Some(v) = candidate.as_ref() {
            super::artifacts::mark_consumer_verification(conn, &att.task_id, &v.id, ack.passed)?;
        }
        append_event(
            conn,
            &cr.requirement_id,
            "change.retest_acknowledged",
            json!({ "changeRequestId": cr.id, "consumerTaskId": att.task_id, "round": cr.round, "passed": ack.passed }),
            Some(&cr.id),
            Some(&att.id),
        )?;
        let cr = model::load_change(conn, &cr.id)?;
        if !ack.passed {
            fail_round(conn, &cr, &att.task_id)?;
        } else {
            let pending = cr
                .consumers
                .iter()
                .filter(|c| c.round == cr.round && !matches!(c.ack_status.as_str(), "transferred" | "released"))
                .any(|c| c.ack_status != "passed");
            if !pending {
                close_verified(conn, &cr)?;
            }
        }
        scheduler::evaluate_requirement(conn, &cr.requirement_id)?;
        let out = model::load_change(conn, &cr.id)?;
        request_record(conn, &ack.request_id, "ack_retest", &payload_hash, &json!({ "id": out.id }))?;
        Ok(out)
    })
}

fn close_verified(conn: &Connection, cr: &ChangeRequestRow) -> CResult<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE collab_change_requests SET state = 'verified', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
        params![cr.id, now],
    )?;
    append_event(conn, &cr.requirement_id, "change.verified", json!({ "changeRequestId": cr.id, "round": cr.round }), Some(&cr.id), None)?;
    send_message(
        conn,
        &cr.requirement_id,
        NewMessage::new("change.verified", json!({ "changeRequestId": cr.id, "code": cr.code, "round": cr.round }))
            .correlation(&cr.id)
            .with_id(format!("msg-{}-verified-{}", cr.id, cr.round)),
    )?;
    conn.execute(
        "UPDATE collab_change_requests SET state = 'closed', resolution_json = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?1",
        params![cr.id, json!({ "verifiedRound": cr.round, "closedAt": now }).to_string(), now],
    )?;
    // Merged duplicates follow their primary.
    conn.execute(
        "UPDATE collab_change_requests SET state = 'closed', updated_at = ?2 WHERE merged_into = ?1 AND state NOT IN ('closed', 'rejected')",
        params![cr.id, now],
    )?;
    Ok(())
}

fn fail_round(conn: &Connection, cr: &ChangeRequestRow, failing_consumer: &str) -> CResult<()> {
    let now = now_ms();
    park_consumer(conn, failing_consumer)?;
    if cr.category == "environment" {
        // Environment fixes don't consume repair rounds; the same round re-tests after the next env task.
        conn.execute(
            "UPDATE collab_change_consumers SET ack_status = 'waiting', updated_at = ?3
             WHERE change_request_id = ?1 AND round = ?2 AND ack_status IN ('passed', 'failed')",
            params![cr.id, cr.round, now],
        )?;
        conn.execute(
            "UPDATE collab_change_requests SET state = 'fixing', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
            params![cr.id, now],
        )?;
        create_env_task(conn, &model::load_change(conn, &cr.id)?)?;
        return Ok(());
    }
    if cr.round >= cr.round_budget {
        set_state(conn, &cr.id, "needs_decision")?;
        let waiting: Vec<String> = cr.consumers.iter().filter(|c| c.round == cr.round).map(|c| c.consumer_task_id.clone()).collect();
        decisions::open(
            conn,
            OpenDecision {
                requirement_id: cr.requirement_id.clone(),
                kind: "repair_budget".into(),
                dedupe_key: format!("repair_budget:{}:{}", cr.id, cr.round),
                title: format!("修正单 {} 已用完 {} 轮自动修正预算", cr.code, cr.round_budget),
                task_ids: waiting,
                blocked_ops: vec![],
                evidence: json!({ "changeRequestId": cr.id, "round": cr.round }),
                options: json!([
                    { "id": "add_budget", "label": "增加修正轮次继续" },
                    { "id": "reject", "label": "停止修正（消费者按原版本继续或重新规划）" }
                ]),
            },
        )?;
        return Ok(());
    }
    start_next_round(conn, cr)
}

fn start_next_round(conn: &Connection, cr: &ChangeRequestRow) -> CResult<()> {
    let now = now_ms();
    let next = cr.round + 1;
    let consumers: Vec<String> = cr
        .consumers
        .iter()
        .filter(|c| c.round == cr.round && !matches!(c.ack_status.as_str(), "transferred" | "released"))
        .map(|c| c.consumer_task_id.clone())
        .collect();
    conn.execute(
        "UPDATE collab_change_requests SET state = 'fixing', round = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?1",
        params![cr.id, next, now],
    )?;
    for c in &consumers {
        add_consumer(conn, &cr.id, c, next)?;
        // A consumer that passed an earlier round must re-verify the new candidate version.
        conn.execute(
            "UPDATE collab_tasks SET state = 'waiting_change', next_action = 'retest_then_continue', revision = revision + 1, updated_at = ?2
             WHERE id = ?1 AND state = 'succeeded' AND active = 1",
            params![c, now],
        )?;
        park_consumer(conn, c)?;
    }
    create_repair_task(conn, &model::load_change(conn, &cr.id)?, next)?;
    append_event(conn, &cr.requirement_id, "change.round_started", json!({ "changeRequestId": cr.id, "round": next }), Some(&cr.id), None)?;
    Ok(())
}

fn release_consumers(conn: &Connection, cr: &ChangeRequestRow, state: &str, reason: &str) -> CResult<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE collab_change_requests SET state = ?2, resolution_json = ?3, revision = revision + 1, updated_at = ?4 WHERE id = ?1",
        params![cr.id, state, json!({ "reason": reason, "at": now }).to_string(), now],
    )?;
    conn.execute(
        "UPDATE collab_change_consumers SET ack_status = 'released', updated_at = ?2 WHERE change_request_id = ?1 AND ack_status = 'waiting'",
        params![cr.id, now],
    )?;
    for c in cr.consumers.iter().filter(|c| c.round == cr.round) {
        send_message(
            conn,
            &cr.requirement_id,
            NewMessage::new("change.released", json!({ "changeRequestId": cr.id, "code": cr.code, "state": state, "reason": reason }))
                .to_task(&c.consumer_task_id)
                .correlation(&cr.id)
                .with_id(format!("msg-{}-released-{}-{}", cr.id, cr.revision, c.consumer_task_id)),
        )?;
    }
    append_event(conn, &cr.requirement_id, &format!("change.{state}"), json!({ "changeRequestId": cr.id, "reason": reason }), Some(&cr.id), None)?;
    Ok(())
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RejectionProposal {
    pub change_request_id: String,
    pub reason: String,
    pub evidence: Value,
}

/// The assignee may only *propose* rejection; consumers stay blocked until the owner/user decides.
pub fn propose_rejection(conn: &Connection, attempt_id: &str, fencing_token: i64, input: &RejectionProposal) -> CResult<DecisionRow> {
    tx(conn, |conn| {
        let att = scheduler::live_attempt(conn, attempt_id, fencing_token, true)?;
        let cr = model::load_change(conn, &input.change_request_id)?;
        if cr.current_repair_task_id.as_deref() != Some(att.task_id.as_str()) && cr.producer_task_id.as_deref() != Some(att.task_id.as_str()) {
            return Err(CollabError::new(codes::FORBIDDEN, "只有被指派的修复方可以提交拒绝建议"));
        }
        if !cr.is_open() {
            return Err(CollabError::state("修正单已结束"));
        }
        if input.reason.trim().is_empty() {
            return Err(CollabError::invalid("拒绝建议需要理由与证据"));
        }
        let waiting: Vec<String> = cr.consumers.iter().filter(|c| c.round == cr.round).map(|c| c.consumer_task_id.clone()).collect();
        let d = decisions::open(
            conn,
            OpenDecision {
                requirement_id: cr.requirement_id.clone(),
                kind: "dispute".into(),
                dedupe_key: format!("dispute:{}:{}", cr.id, cr.round),
                title: format!("修复方认为 {} 不应修复，需要复核", cr.code),
                task_ids: waiting,
                blocked_ops: vec![],
                evidence: json!({
                    "changeRequestId": cr.id,
                    "proposedBy": att.task_id,
                    "attemptId": att.id,
                    "reason": input.reason,
                    "evidence": input.evidence,
                    "payload": cr.payload,
                }),
                options: json!([
                    { "id": "confirm_reject", "label": "确认误报 / 范围外，解除阻塞" },
                    { "id": "continue_fix", "label": "仍需修复" }
                ]),
            },
        )?;
        append_event(
            conn,
            &cr.requirement_id,
            "change.rejection_proposed",
            json!({ "changeRequestId": cr.id, "decisionId": d.id }),
            Some(&cr.id),
            Some(&att.id),
        )?;
        Ok(d)
    })
}

pub fn apply_decision(conn: &Connection, decision: &DecisionRow, input: &super::decisions::ResolveDecisionInput) -> CResult<()> {
    let Some(cr_id) = decision.evidence.get("changeRequestId").and_then(Value::as_str) else {
        return Ok(());
    };
    let cr = model::load_change(conn, cr_id)?;
    let now = now_ms();
    match (decision.kind.as_str(), input.option_id.as_str()) {
        ("repair_budget", "add_budget") => {
            let extra = input.values.get("extraRounds").and_then(Value::as_i64).unwrap_or(2).clamp(1, 10);
            conn.execute(
                "UPDATE collab_change_requests SET round_budget = round_budget + ?2, updated_at = ?3 WHERE id = ?1",
                params![cr.id, extra, now],
            )?;
            start_next_round(conn, &model::load_change(conn, &cr.id)?)?;
        }
        ("dispute", "continue_fix") => {
            if let Some(repair) = cr.current_repair_task_id.as_deref() {
                conn.execute(
                    "UPDATE collab_tasks SET state = 'ready', next_action = 'resume', revision = revision + 1, updated_at = ?2, queued_at = ?2
                     WHERE id = ?1 AND state IN ('failed', 'succeeded')",
                    params![repair, now],
                )?;
                send_message(
                    conn,
                    &cr.requirement_id,
                    NewMessage::new("change.dispute_rejected", json!({ "changeRequestId": cr.id, "note": input.note }))
                        .to_task(repair)
                        .with_id(format!("msg-{}-dispute-{}", cr.id, decision.id)),
                )?;
            }
        }
        ("change_triage", option @ ("contract_violation" | "consumer_bug" | "environment")) => {
            conn.execute(
                "UPDATE collab_change_requests SET category = ?2, state = 'triaged', revision = revision + 1, updated_at = ?3 WHERE id = ?1",
                params![cr.id, option, now],
            )?;
            if option == "contract_violation" && cr.producer_task_id.is_none() {
                return Err(CollabError::invalid("无法定位生产任务，不能按契约违约处理"));
            }
            let reporter = model::load_task(conn, &cr.reporter_task_id)?;
            route_category(conn, &cr.id, option, &reporter)?;
        }
        (_, "reject" | "confirm_reject") => {
            release_consumers(conn, &cr, "rejected", if input.note.trim().is_empty() { "决策确认拒绝" } else { input.note.trim() })?;
        }
        _ => {}
    }
    Ok(())
}

/// User merges a duplicate: its consumers transfer to the primary's current round.
pub fn merge_changes(conn: &Connection, duplicate_id: &str, primary_id: &str) -> CResult<ChangeRequestRow> {
    tx(conn, |conn| {
        let dup = model::load_change(conn, duplicate_id)?;
        let primary = model::load_change(conn, primary_id)?;
        if dup.requirement_id != primary.requirement_id || dup.id == primary.id {
            return Err(CollabError::invalid("只能合并同一需求下的不同修正单"));
        }
        if !dup.is_open() || !primary.is_open() {
            return Err(CollabError::state("只能合并未结束的修正单"));
        }
        let now = now_ms();
        for c in dup.consumers.iter().filter(|c| c.round == dup.round && c.ack_status == "waiting") {
            add_consumer(conn, &primary.id, &c.consumer_task_id, primary.round)?;
        }
        conn.execute(
            "UPDATE collab_change_consumers SET ack_status = 'transferred', updated_at = ?2 WHERE change_request_id = ?1 AND ack_status = 'waiting'",
            params![dup.id, now],
        )?;
        conn.execute(
            "UPDATE collab_change_requests SET merged_into = ?2, state = 'closed', resolution_json = ?3, revision = revision + 1, updated_at = ?4 WHERE id = ?1",
            params![dup.id, primary.id, json!({ "duplicateOf": primary.code }).to_string(), now],
        )?;
        append_event(conn, &dup.requirement_id, "change.merged", json!({ "from": dup.id, "into": primary.id }), Some(&primary.id), None)?;
        scheduler::evaluate_requirement(conn, &dup.requirement_id)?;
        model::load_change(conn, &primary.id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_are_listed_for_incomplete_payload() {
        let p = ChangePayload { category: "contract_violation".into(), summary: "缺字段".into(), ..Default::default() };
        let m = missing_fields(&p);
        for f in ["artifact", "operation", "field|assertion", "expected", "actual", "reproduction", "impact", "acceptance"] {
            assert!(m.contains(&f), "{f} should be missing");
        }
    }

    #[test]
    fn dedupe_key_ignores_case_and_whitespace() {
        let a = ChangePayload { artifact: "orders-api".into(), operation: "GET /orders".into(), field: Some("discountAmount".into()), ..Default::default() };
        let b = ChangePayload { artifact: " Orders-API ".into(), operation: "get  /orders".into(), field: Some("DISCOUNTAMOUNT".into()), ..Default::default() };
        assert_eq!(dedupe_key("r", &a, Some(1)), dedupe_key("r", &b, Some(1)));
        assert_ne!(dedupe_key("r", &a, Some(1)), dedupe_key("r", &a, Some(2)));
    }
}
