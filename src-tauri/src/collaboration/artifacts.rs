//! 交付包：发布候选版本 → 兼容性判定 → 权威校验（契约完整、commit、受控测试证据、部署指纹、健康检查）。
//!
//! 只有 `apply_validation` 能把版本写为 valid；Agent 只能发布候选。破坏性变更为已成功的消费者
//! 生成显式复验任务，不静默改写此前成功记录。

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::decisions::{self, OpenDecision};
use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model::{self, ArtifactVersionRow, DecisionRow, TaskRow};
use super::util::{hash_json, new_id, now_ms, tx};
use super::verification::{self, HealthOutcome};

pub const HEALTH_TTL_MS: i64 = 30 * 60 * 1000;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PublishArtifactInput {
    pub name: String,
    pub kind: Option<String>,
    pub commit_sha: Option<String>,
    pub branch: Option<String>,
    pub contract: Value,
    pub runtime_target_id: Option<String>,
    pub environment_id: Option<String>,
    pub endpoint: Option<String>,
    pub health_url: Option<String>,
    pub deployed_commit: Option<String>,
    pub credential_ref: Option<String>,
    pub setup_guide_ref: Option<String>,
    pub fixture_refs: Vec<Value>,
    /// Ids of Wise-run verification runs (`wise-collab verify`); agent claims are not evidence.
    pub test_evidence_run_ids: Vec<String>,
    pub is_draft: bool,
    pub affected_operations: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compatibility {
    pub compatibility: String,
    pub changed_fields: Vec<Value>,
    pub affected_operations: Vec<String>,
}

fn op_key(op: &Value) -> Option<String> {
    if let Some(id) = op.get("id").and_then(Value::as_str).filter(|s| !s.trim().is_empty()) {
        return Some(id.trim().to_string());
    }
    let method = op.get("method").and_then(Value::as_str)?;
    let path = op.get("path").and_then(Value::as_str)?;
    Some(format!("{} {}", method.to_ascii_uppercase(), path))
}

fn operations(contract: &Value) -> Option<BTreeMap<String, Value>> {
    let ops = contract.get("operations")?.as_array()?;
    let mut out = BTreeMap::new();
    for op in ops {
        out.insert(op_key(op)?, op.clone());
    }
    Some(out)
}

#[derive(Debug, Clone, PartialEq)]
struct FieldSpec {
    ty: String,
    required: bool,
}

fn fields(section: Option<&Value>) -> BTreeMap<String, FieldSpec> {
    let mut out = BTreeMap::new();
    let Some(section) = section else { return out };
    let map = section.get("fields").unwrap_or(section);
    if let Some(obj) = map.as_object() {
        for (name, spec) in obj {
            let (ty, required) = match spec {
                Value::String(t) => (t.clone(), true),
                Value::Object(o) => (
                    o.get("type").and_then(Value::as_str).unwrap_or("any").to_string(),
                    o.get("required").and_then(Value::as_bool).unwrap_or(true),
                ),
                _ => ("any".into(), true),
            };
            out.insert(name.clone(), FieldSpec { ty, required });
        }
    }
    out
}

/// Deleted fields / type or required-ness tightening are breaking; additions are compatible.
pub fn diff_contract(old: &Value, new: &Value) -> Compatibility {
    let (Some(old_ops), Some(new_ops)) = (operations(old), operations(new)) else {
        let same = hash_json(old) == hash_json(new);
        return Compatibility {
            compatibility: if same { "compatible".into() } else { "unknown".into() },
            changed_fields: Vec::new(),
            affected_operations: Vec::new(),
        };
    };
    let mut breaking = false;
    let mut changed: Vec<Value> = Vec::new();
    let mut affected: Vec<String> = Vec::new();
    let touch = |op: &str, affected: &mut Vec<String>| {
        if !affected.iter().any(|a| a == op) {
            affected.push(op.to_string());
        }
    };
    for (key, old_op) in &old_ops {
        let Some(new_op) = new_ops.get(key) else {
            breaking = true;
            changed.push(json!({ "operation": key, "change": "operation_removed" }));
            touch(key, &mut affected);
            continue;
        };
        for side in ["request", "response"] {
            let of = fields(old_op.get(side));
            let nf = fields(new_op.get(side));
            for (name, ospec) in &of {
                match nf.get(name) {
                    None => {
                        breaking = true;
                        changed.push(json!({ "operation": key, "side": side, "field": name, "change": "removed" }));
                        touch(key, &mut affected);
                    }
                    Some(nspec) if nspec.ty != ospec.ty => {
                        breaking = true;
                        changed.push(json!({ "operation": key, "side": side, "field": name, "change": "type_changed", "from": ospec.ty, "to": nspec.ty }));
                        touch(key, &mut affected);
                    }
                    Some(nspec) if nspec.required != ospec.required => {
                        // request: optional→required breaks callers; response: required→optional breaks readers.
                        let is_break = (side == "request" && nspec.required) || (side == "response" && !nspec.required);
                        if is_break {
                            breaking = true;
                        }
                        changed.push(json!({ "operation": key, "side": side, "field": name, "change": "required_changed", "required": nspec.required, "breaking": is_break }));
                        touch(key, &mut affected);
                    }
                    _ => {}
                }
            }
            for (name, nspec) in &nf {
                if !of.contains_key(name) {
                    let is_break = side == "request" && nspec.required;
                    if is_break {
                        breaking = true;
                    }
                    changed.push(json!({ "operation": key, "side": side, "field": name, "change": "added", "breaking": is_break }));
                    touch(key, &mut affected);
                }
            }
        }
    }
    for key in new_ops.keys() {
        if !old_ops.contains_key(key) {
            changed.push(json!({ "operation": key, "change": "operation_added" }));
        }
    }
    Compatibility {
        compatibility: if breaking { "breaking".into() } else { "compatible".into() },
        changed_fields: changed,
        affected_operations: affected,
    }
}

/// Field-list completeness for the artifact kind.
pub fn contract_problems(kind: &str, contract: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if !contract.is_object() || contract.as_object().is_some_and(|o| o.is_empty()) {
        out.push("契约为空".into());
        return out;
    }
    if kind == "api_contract" {
        match contract.get("operations").and_then(Value::as_array) {
            None => out.push("api_contract 需要 operations 数组".into()),
            Some(ops) if ops.is_empty() => out.push("operations 不能为空".into()),
            Some(ops) => {
                for (i, op) in ops.iter().enumerate() {
                    match op_key(op) {
                        None => out.push(format!("operations[{i}] 缺少 id 或 method+path")),
                        Some(k) => {
                            if op.get("response").is_none() {
                                out.push(format!("接口 {k} 缺少 response 字段定义"));
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

fn needs_endpoint(kind: &str) -> bool {
    matches!(kind, "api_contract" | "service")
}

fn artifact_id(conn: &Connection, requirement_id: &str, name: &str, kind: &str, producer_key: &str) -> CResult<String> {
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM collab_artifacts WHERE requirement_id = ?1 AND name = ?2",
            params![requirement_id, name],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    let id = new_id("art");
    conn.execute(
        "INSERT INTO collab_artifacts (id, requirement_id, name, kind, producer_task_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, requirement_id, name, kind, producer_key, now_ms()],
    )?;
    Ok(id)
}

/// Output names this task may publish (repair tasks publish the artifact under repair).
fn publishable(task: &TaskRow) -> Vec<String> {
    let mut names = task.output_artifacts();
    if let Some(a) = task.spec.get("artifact").and_then(Value::as_str) {
        if !names.iter().any(|n| n == a) {
            names.push(a.to_string());
        }
    }
    names
}

fn declared_kind(task: &TaskRow, name: &str) -> Option<String> {
    task.spec
        .get("outputs")
        .and_then(Value::as_array)?
        .iter()
        .find(|o| o.get("artifact").and_then(Value::as_str) == Some(name))
        .and_then(|o| o.get("kind").and_then(Value::as_str))
        .filter(|k| !k.trim().is_empty())
        .map(str::to_string)
}

/// Candidate version from a live attempt (fencing-checked). Validation happens separately.
pub fn publish_candidate(conn: &Connection, attempt_id: &str, fencing_token: i64, input: &PublishArtifactInput) -> CResult<ArtifactVersionRow> {
    tx(conn, |conn| {
        let att = super::scheduler::live_attempt(conn, attempt_id, fencing_token, true)?;
        let task = model::load_task(conn, &att.task_id)?;
        let name = input.name.trim();
        if name.is_empty() {
            return Err(CollabError::invalid("交付包需要 name"));
        }
        if !publishable(&task).iter().any(|n| n == name) {
            return Err(CollabError::new(
                codes::FORBIDDEN,
                format!("任务「{}」未声明输出 {name}，不能发布该交付包", task.title),
            ));
        }
        let kind = input
            .kind
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| declared_kind(&task, name))
            .unwrap_or_else(|| "api_contract".into());
        let art = artifact_id(conn, &task.requirement_id, name, &kind, &task.task_key)?;
        let version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM collab_artifact_versions WHERE artifact_id = ?1",
            params![art],
            |r| r.get(0),
        )?;
        let previous = model::latest_valid_version(conn, &task.requirement_id, name)?;
        let compat = match previous.as_ref() {
            Some(prev) => diff_contract(&prev.contract, &input.contract),
            None => Compatibility { compatibility: "compatible".into(), changed_fields: vec![], affected_operations: vec![] },
        };
        let mut affected = compat.affected_operations.clone();
        for op in &input.affected_operations {
            if !affected.contains(op) {
                affected.push(op.clone());
            }
        }
        let id = new_id("av");
        let now = now_ms();
        conn.execute(
            "INSERT INTO collab_artifact_versions (
                id, artifact_id, version, requirement_id, producer_task_id, attempt_id, fencing_token, plan_revision,
                repository_id, commit_sha, branch, contract_json, contract_hash, runtime_target_id, environment_id,
                endpoint, health_url, deployed_commit, credential_ref, setup_guide_ref, fixture_refs_json,
                test_evidence_json, compatibility, supersedes_version, affected_operations_json, changed_fields_json,
                is_draft, validation_state, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
                ?22, ?23, ?24, ?25, ?26, ?27, 'pending', ?28)",
            params![
                id,
                art,
                version,
                task.requirement_id,
                task.id,
                att.id,
                att.fencing_token,
                task.plan_revision,
                task.repository_id,
                input.commit_sha.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                input.branch,
                if input.contract.is_null() { "{}".to_string() } else { input.contract.to_string() },
                hash_json(&input.contract),
                input.runtime_target_id.clone().unwrap_or_else(|| task.runtime_target.clone()),
                input.environment_id,
                input.endpoint.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                input.health_url.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                input.deployed_commit.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                input.credential_ref,
                input.setup_guide_ref,
                json!(input.fixture_refs).to_string(),
                json!(input.test_evidence_run_ids).to_string(),
                compat.compatibility,
                previous.as_ref().map(|p| p.version),
                json!(affected).to_string(),
                json!(compat.changed_fields).to_string(),
                input.is_draft as i64,
                now
            ],
        )?;
        append_event(
            conn,
            &task.requirement_id,
            "artifact.published",
            json!({ "artifactVersionId": id, "name": name, "version": version, "compatibility": compat.compatibility, "draft": input.is_draft }),
            Some(&task.id),
            Some(&att.id),
        )?;
        if input.is_draft {
            // Draft contracts unblock `contract_available` consumers in contract-parallel mode only.
            super::scheduler::evaluate_requirement(conn, &task.requirement_id)?;
        }
        model::load_artifact_version(conn, &id)
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationCheck {
    pub id: String,
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

fn check(id: &str, label: &str, passed: bool, detail: impl Into<String>) -> ValidationCheck {
    ValidationCheck { id: id.into(), label: label.into(), passed, detail: detail.into() }
}

/// Pure evaluation of the authoritative checks (health outcome supplied by the async caller).
pub fn evaluate_checks(conn: &Connection, v: &ArtifactVersionRow, health: Option<&HealthOutcome>) -> CResult<Vec<ValidationCheck>> {
    let mut checks = Vec::new();
    let problems = contract_problems(&v.kind, &v.contract);
    checks.push(check("contract", "契约字段完整", problems.is_empty(), if problems.is_empty() { "完整".to_string() } else { problems.join("；") }));
    checks.push(check("draft", "非草稿版本", !v.is_draft, if v.is_draft { "草稿契约只用于契约并行开发" } else { "正式版本" }));
    let commit = v.commit_sha.clone().unwrap_or_default();
    checks.push(check("commit", "绑定仓库 commit", !commit.is_empty(), if commit.is_empty() { "缺少 commitSha".to_string() } else { commit.clone() }));

    let run_ids: Vec<String> = serde_json::from_value(v.test_evidence.clone()).unwrap_or_default();
    if run_ids.is_empty() {
        checks.push(check("evidence", "受控测试证据", false, "未引用任何 Wise 验证运行（wise-collab verify）"));
    }
    for rid in &run_ids {
        match verification::load_run(conn, rid) {
            Err(_) => checks.push(check("evidence", "受控测试证据", false, format!("验证运行 {rid} 不存在"))),
            Ok(run) => {
                let mut reasons = Vec::new();
                if run.task_id != v.producer_task_id {
                    reasons.push("不属于生产任务".to_string());
                }
                if !run.passed {
                    reasons.push(format!("未通过（exit {:?}）", run.exit_code));
                }
                if run.head_commit.as_deref() != Some(commit.as_str()) || commit.is_empty() {
                    reasons.push(format!("运行时 HEAD {:?} 与交付 commit 不一致", run.head_commit));
                }
                if run.dirty {
                    reasons.push("运行时工作区有未提交修改".into());
                }
                checks.push(check(
                    "evidence",
                    "受控测试证据",
                    reasons.is_empty(),
                    if reasons.is_empty() { format!("{} 通过 @ {}", run.command, commit) } else { format!("{}：{}", run.command, reasons.join("；")) },
                ));
            }
        }
    }
    if needs_endpoint(&v.kind) {
        let endpoint = v.endpoint.clone().unwrap_or_default();
        checks.push(check("endpoint", "访问地址", !endpoint.is_empty(), if endpoint.is_empty() { "缺少 endpoint".to_string() } else { endpoint }));
        let deployed = v.deployed_commit.clone().unwrap_or_default();
        let fp_ok = !deployed.is_empty() && deployed == commit;
        checks.push(check(
            "deployed_commit",
            "部署指纹与 commit 一致",
            fp_ok,
            if deployed.is_empty() { "缺少 deployedCommit".to_string() } else if fp_ok { deployed } else { format!("部署 {deployed} ≠ 交付 {commit}") },
        ));
        match (v.health_url.as_deref(), health) {
            (None, _) => checks.push(check("health", "健康检查", false, "缺少 healthUrl")),
            (Some(_), None) => checks.push(check("health", "健康检查", false, "尚未执行健康检查")),
            (Some(_), Some(h)) => {
                let commit_ok = h.reported_commit.as_deref().map_or(true, |c| c == commit || commit.starts_with(c) || c.starts_with(&commit));
                let ok = h.ok && commit_ok;
                let detail = if !h.ok {
                    h.error.clone().unwrap_or_else(|| "健康检查失败".into())
                } else if !commit_ok {
                    format!("健康接口报告 commit {:?} 与交付 commit 不一致", h.reported_commit)
                } else {
                    format!("HTTP {}", h.status.unwrap_or(200))
                };
                checks.push(check("health", "健康检查", ok, detail));
            }
        }
    }
    Ok(checks)
}

/// Writes the authoritative validation result and propagates it (consumers, changes, evaluation).
pub fn apply_validation(conn: &Connection, version_id: &str, health: Option<&HealthOutcome>) -> CResult<ArtifactVersionRow> {
    tx(conn, |conn| {
        let v = model::load_artifact_version(conn, version_id)?;
        if v.validation_state != "pending" && health.is_none() {
            return Ok(v);
        }
        let task = model::load_task(conn, &v.producer_task_id)?;
        if let Some(h) = health {
            verification::record_health(conn, &v.requirement_id, &task.id, h)?;
        }
        let checks = evaluate_checks(conn, &v, health)?;
        let valid = checks.iter().all(|c| c.passed);
        let now = now_ms();
        let state = if valid { "valid" } else if v.is_draft { "pending" } else { "invalid" };
        let reason: Option<String> = (!valid).then(|| {
            checks.iter().filter(|c| !c.passed).map(|c| format!("{}：{}", c.label, c.detail)).collect::<Vec<_>>().join("；")
        });
        conn.execute(
            "UPDATE collab_artifact_versions SET validation_state = ?2, validation_json = ?3, invalid_reason = ?4,
                health_check_at = COALESCE(?5, health_check_at) WHERE id = ?1",
            params![v.id, state, json!({ "checks": checks, "validatedAt": now }).to_string(), reason, health.map(|h| h.checked_at)],
        )?;
        append_event(
            conn,
            &v.requirement_id,
            if valid { "artifact.validated" } else { "artifact.validation_failed" },
            json!({ "artifactVersionId": v.id, "name": v.name, "version": v.version, "reason": reason }),
            Some(&task.id),
            None,
        )?;
        if valid {
            on_valid(conn, &model::load_artifact_version(conn, &v.id)?)?;
        } else if !v.is_draft {
            send_message(
                conn,
                &v.requirement_id,
                NewMessage::new(
                    "artifact.invalid",
                    json!({ "artifactVersionId": v.id, "name": v.name, "version": v.version, "reason": reason, "checks": checks }),
                )
                .to_task(&task.id)
                .with_id(format!("msg-invalid-{}", v.id)),
            )?;
        }
        super::scheduler::evaluate_requirement(conn, &v.requirement_id)?;
        model::load_artifact_version(conn, &v.id)
    })
}

fn on_valid(conn: &Connection, v: &ArtifactVersionRow) -> CResult<()> {
    // Wake dependants; the scheduler re-reads state (messages never flip tasks directly).
    let dependants: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT d.task_id FROM collab_dependencies d JOIN collab_tasks t ON t.id = d.task_id
             WHERE d.producer_task_id = ?1 AND t.active = 1",
        )?;
        let rows = stmt.query_map(params![v.producer_task_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    for task_id in &dependants {
        send_message(
            conn,
            &v.requirement_id,
            NewMessage::new("artifact.ready", json!({ "artifactVersionId": v.id, "name": v.name, "version": v.version }))
                .to_task(task_id)
                .from_task(Some(&v.producer_task_id))
                .with_id(format!("msg-ready-{}-{task_id}", v.id)),
        )?;
    }
    super::changes::on_artifact_valid(conn, v)?;
    if v.supersedes_version.is_some() {
        match v.compatibility.as_str() {
            "breaking" => create_reverify_tasks(conn, v)?,
            "unknown" => {
                let consumers = previous_consumers(conn, v)?;
                if !consumers.is_empty() {
                    decisions::open(
                        conn,
                        OpenDecision {
                            requirement_id: v.requirement_id.clone(),
                            kind: "compat_unknown".into(),
                            dedupe_key: format!("compat:{}", v.id),
                            title: format!("{} v{} 的兼容性无法自动判断", v.name, v.version),
                            task_ids: vec![],
                            blocked_ops: vec![],
                            evidence: json!({ "artifactVersionId": v.id, "consumers": consumers }),
                            options: json!([{ "id": "compatible", "label": "按兼容处理" }, { "id": "breaking", "label": "按破坏性变更处理（消费者复验）" }]),
                        },
                    )?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Succeeded consumer tasks of earlier versions of the same artifact.
fn previous_consumers(conn: &Connection, v: &ArtifactVersionRow) -> CResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT c.task_id FROM collab_artifact_consumers c
         JOIN collab_artifact_versions pv ON pv.id = c.artifact_version_id
         JOIN collab_tasks t ON t.id = c.task_id
         WHERE pv.artifact_id = ?1 AND pv.version < ?2 AND t.active = 1 AND t.state = 'succeeded'",
    )?;
    let rows = stmt.query_map(params![v.artifact_id, v.version], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

fn create_reverify_tasks(conn: &Connection, v: &ArtifactVersionRow) -> CResult<()> {
    let now = now_ms();
    for consumer_id in previous_consumers(conn, v)? {
        // Consumers already tracked by a change request re-test through that request.
        let in_change: i64 = conn.query_row(
            "SELECT COUNT(*) FROM collab_change_consumers cc JOIN collab_change_requests cr ON cr.id = cc.change_request_id
             WHERE cc.consumer_task_id = ?1 AND cr.candidate_artifact_version_id = ?2",
            params![consumer_id, v.id],
            |r| r.get(0),
        )?;
        conn.execute(
            "UPDATE collab_artifact_consumers SET impact = 'reverify', updated_at = ?3 WHERE task_id = ?1
               AND artifact_version_id IN (SELECT id FROM collab_artifact_versions WHERE artifact_id = ?2)",
            params![consumer_id, v.artifact_id, now],
        )?;
        if in_change > 0 {
            continue;
        }
        let consumer = model::load_task(conn, &consumer_id)?;
        let key = format!("REVERIFY-{}-{}-v{}", consumer.task_key, v.name, v.version);
        if model::active_task_by_key(conn, &v.requirement_id, &key)?.is_some() {
            continue;
        }
        let id = new_id("task");
        let spec = json!({
            "goal": format!("{} 发布了破坏性变更 v{}，请在本仓库验证并适配受影响接口", v.name, v.version),
            "acceptance": ["受影响接口的消费方用例在新版本上通过"],
            "inputs": [{ "artifact": v.name, "version": v.version }],
            "affectedOperations": v.affected_operations,
            "changedFields": v.changed_fields,
            "verification": consumer.spec.get("verification").cloned().unwrap_or(json!({})),
            "reverifyOf": consumer.id,
        });
        conn.execute(
            "INSERT INTO collab_tasks (
                id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind, state, active,
                spec_json, spec_hash, executor_agent_id, profile_revision, runtime_target, attempt_budget, next_action,
                queued_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'qa', 'waiting_dependencies', 1, ?9, ?10, ?11, ?12, ?13, ?14,
                'retest_then_continue', ?15, ?15, ?15)",
            params![
                id,
                v.requirement_id,
                consumer.plan_revision,
                key,
                format!("复验 {}：{} v{}", consumer.title, v.name, v.version),
                consumer.project_id,
                consumer.repository_id,
                consumer.role,
                spec.to_string(),
                hash_json(&spec),
                consumer.executor_agent_id,
                consumer.profile_revision,
                consumer.runtime_target,
                consumer.attempt_budget,
                now
            ],
        )?;
        conn.execute(
            "INSERT INTO collab_dependencies (id, requirement_id, plan_revision, task_id, producer_task_id, gate_kind,
                artifact_selector, required_version, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'artifact_ready', ?6, ?7, ?8)",
            params![new_id("dep"), v.requirement_id, consumer.plan_revision, id, v.producer_task_id, v.name, v.version, now],
        )?;
        append_event(
            conn,
            &v.requirement_id,
            "task.reverify_created",
            json!({ "taskId": id, "consumerTaskId": consumer.id, "artifactVersionId": v.id }),
            Some(&id),
            None,
        )?;
    }
    Ok(())
}

pub fn apply_decision(conn: &Connection, decision: &DecisionRow, input: &super::decisions::ResolveDecisionInput) -> CResult<()> {
    let Some(vid) = decision.evidence.get("artifactVersionId").and_then(Value::as_str) else {
        return Ok(());
    };
    let v = model::load_artifact_version(conn, vid)?;
    let compat = if input.option_id == "breaking" { "breaking" } else { "compatible" };
    conn.execute("UPDATE collab_artifact_versions SET compatibility = ?2 WHERE id = ?1", params![v.id, compat])?;
    if compat == "breaking" {
        create_reverify_tasks(conn, &model::load_artifact_version(conn, &v.id)?)?;
    }
    Ok(())
}

/// Environment / commit drift: the version stops satisfying dependencies and acceptance goes stale.
pub fn invalidate_version(conn: &Connection, version_id: &str, reason: &str) -> CResult<ArtifactVersionRow> {
    tx(conn, |conn| {
        let v = model::load_artifact_version(conn, version_id)?;
        if v.validation_state == "invalidated" {
            return Ok(v);
        }
        conn.execute(
            "UPDATE collab_artifact_versions SET validation_state = 'invalidated', invalid_reason = ?2 WHERE id = ?1",
            params![v.id, reason],
        )?;
        append_event(
            conn,
            &v.requirement_id,
            "artifact.invalidated",
            json!({ "artifactVersionId": v.id, "name": v.name, "version": v.version, "reason": reason }),
            Some(&v.producer_task_id),
            None,
        )?;
        send_message(
            conn,
            &v.requirement_id,
            NewMessage::new("artifact.invalid", json!({ "artifactVersionId": v.id, "name": v.name, "reason": reason }))
                .to_task(&v.producer_task_id)
                .with_id(format!("msg-invalidated-{}", v.id)),
        )?;
        // The producer must deliver again: reopen it if it had succeeded on this version.
        let producer = model::load_task(conn, &v.producer_task_id)?;
        if producer.active && producer.state == "succeeded" {
            let now = now_ms();
            conn.execute(
                "UPDATE collab_tasks SET state = 'ready', next_action = 'redeliver', revision = revision + 1, updated_at = ?2, queued_at = ?2
                 WHERE id = ?1",
                params![producer.id, now],
            )?;
        }
        super::acceptance::mark_stale(conn, &v.requirement_id)?;
        super::scheduler::evaluate_requirement(conn, &v.requirement_id)?;
        model::load_artifact_version(conn, &v.id)
    })
}

/// Valid versions whose health check is missing or older than the TTL (re-checked before consumption).
pub fn stale_health_versions(conn: &Connection, ttl_ms: i64) -> CResult<Vec<ArtifactVersionRow>> {
    let now = now_ms();
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT v.id FROM collab_artifact_versions v JOIN collab_requirements r ON r.id = v.requirement_id
             WHERE v.validation_state = 'valid' AND v.health_url IS NOT NULL
               AND (v.health_check_at IS NULL OR v.health_check_at < ?1)
               AND r.business_status <> 'done' AND r.control_status = 'active'",
        )?;
        let rows = stmt.query_map(params![now - ttl_ms], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    ids.iter().map(|id| model::load_artifact_version(conn, id)).collect()
}

/// Periodic re-check result: a failing or drifted service invalidates the version.
pub fn apply_recheck(conn: &Connection, version_id: &str, health: &HealthOutcome) -> CResult<ArtifactVersionRow> {
    let v = tx(conn, |conn| {
        let v = model::load_artifact_version(conn, version_id)?;
        verification::record_health(conn, &v.requirement_id, &v.producer_task_id, health)?;
        conn.execute(
            "UPDATE collab_artifact_versions SET health_check_at = ?2 WHERE id = ?1",
            params![v.id, health.checked_at],
        )?;
        Ok(v)
    })?;
    let commit = v.commit_sha.clone().unwrap_or_default();
    let drift = health.reported_commit.as_deref().is_some_and(|c| !(c == commit || commit.starts_with(c) || c.starts_with(&commit)));
    if !health.ok || drift {
        let reason = if drift {
            format!("运行环境 commit {:?} 已不是交付版本 {commit}", health.reported_commit)
        } else {
            format!("健康检查失败：{}", health.error.clone().unwrap_or_default())
        };
        return invalidate_version(conn, version_id, &reason);
    }
    model::load_artifact_version(conn, version_id)
}

/// Consumer bookkeeping at claim time: records exactly which versions the attempt consumed.
pub fn record_consumption(conn: &Connection, task_id: &str, version: &ArtifactVersionRow, operations: &Value) -> CResult<()> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_artifact_consumers (task_id, artifact_version_id, operations_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(task_id, artifact_version_id) DO UPDATE SET updated_at = excluded.updated_at",
        params![task_id, version.id, operations.to_string(), now],
    )?;
    Ok(())
}

pub fn mark_consumer_verification(conn: &Connection, task_id: &str, version_id: &str, passed: bool) -> CResult<()> {
    conn.execute(
        "UPDATE collab_artifact_consumers SET verification = ?3, impact = CASE WHEN ?3 = 'passed' THEN 'none' ELSE impact END, updated_at = ?4
         WHERE task_id = ?1 AND artifact_version_id = ?2",
        params![task_id, version_id, if passed { "passed" } else { "failed" }, now_ms()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract(fields: Value) -> Value {
        json!({ "operations": [{ "id": "getOrder", "method": "GET", "path": "/orders/:id", "response": { "fields": fields } }] })
    }

    #[test]
    fn removing_a_response_field_is_breaking() {
        let old = contract(json!({ "id": "string", "discountAmount": { "type": "number" } }));
        let new = contract(json!({ "id": "string" }));
        let c = diff_contract(&old, &new);
        assert_eq!(c.compatibility, "breaking");
        assert_eq!(c.affected_operations, vec!["getOrder".to_string()]);
    }

    #[test]
    fn changing_field_type_is_breaking_and_adding_is_compatible() {
        let old = contract(json!({ "id": "string" }));
        assert_eq!(diff_contract(&old, &contract(json!({ "id": "number" }))).compatibility, "breaking");
        assert_eq!(
            diff_contract(&old, &contract(json!({ "id": "string", "discountAmount": "number" }))).compatibility,
            "compatible"
        );
    }

    #[test]
    fn unparseable_contract_change_is_unknown() {
        assert_eq!(diff_contract(&json!({ "schema": "a" }), &json!({ "schema": "b" })).compatibility, "unknown");
        assert_eq!(diff_contract(&json!({ "schema": "a" }), &json!({ "schema": "a" })).compatibility, "compatible");
    }

    #[test]
    fn api_contract_requires_operations_with_responses() {
        assert!(!contract_problems("api_contract", &json!({ "operations": [] })).is_empty());
        assert!(!contract_problems("api_contract", &json!({ "operations": [{ "id": "x" }] })).is_empty());
        assert!(contract_problems("api_contract", &contract(json!({ "id": "string" }))).is_empty());
    }
}
