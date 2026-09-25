//! 验收清单：冻结需求 / 计划版本、任务规格、commit、契约、环境指纹、证据、消费者回执与修正单 revision。
//! 状态变化使清单 stale；验收事务核对清单 hash / revision，否则返回 `STALE_ACCEPTANCE`。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model;
use super::util::{hash_json, new_id, now_ms, parse_value, request_record, request_replay, tx};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceManifest {
    pub id: String,
    pub requirement_id: String,
    pub revision: i64,
    pub manifest: Value,
    pub content_hash: String,
    pub state: String,
    pub policy: String,
    pub conclusion: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

fn map_manifest(r: &rusqlite::Row<'_>) -> rusqlite::Result<AcceptanceManifest> {
    Ok(AcceptanceManifest {
        id: r.get(0)?,
        requirement_id: r.get(1)?,
        revision: r.get(2)?,
        manifest: parse_value(&r.get::<_, String>(3)?),
        content_hash: r.get(4)?,
        state: r.get(5)?,
        policy: r.get(6)?,
        conclusion: r.get::<_, Option<String>>(7)?.as_deref().map(parse_value),
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const COLS: &str = "id, requirement_id, revision, manifest_json, content_hash, state, policy, conclusion_json, created_at, updated_at";

pub fn current_manifest(conn: &Connection, requirement_id: &str) -> CResult<Option<AcceptanceManifest>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLS} FROM collab_acceptance_manifests WHERE requirement_id = ?1 ORDER BY revision DESC LIMIT 1"),
            params![requirement_id],
            map_manifest,
        )
        .optional()?)
}

/// Deterministic content of the manifest (no timestamps, so equal state ⇒ equal hash).
pub fn build_content(conn: &Connection, requirement_id: &str) -> CResult<Value> {
    let req = model::load_requirement(conn, requirement_id)?;
    let tasks: Vec<Value> = model::list_tasks(conn, requirement_id, true)?
        .into_iter()
        .filter(|t| t.state != "cancelled")
        .map(|t| {
            json!({
                "id": t.id, "key": t.task_key, "kind": t.kind, "title": t.title, "repositoryId": t.repository_id,
                "specRevision": t.spec_revision, "specHash": t.spec_hash, "state": t.state,
                "executorAgentId": t.executor_agent_id, "profileRevision": t.profile_revision,
            })
        })
        .collect();
    let mut artifacts: Vec<Value> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for v in model::list_artifact_versions(conn, requirement_id)?.into_iter().rev() {
        if v.validation_state != "valid" || v.is_draft || seen.contains(&v.name) {
            continue;
        }
        seen.push(v.name.clone());
        artifacts.push(json!({
            "id": v.id, "name": v.name, "version": v.version, "commitSha": v.commit_sha, "contractHash": v.contract_hash,
            "deployedCommit": v.deployed_commit, "environmentId": v.environment_id, "runtimeTargetId": v.runtime_target_id,
            "compatibility": v.compatibility, "testEvidence": v.test_evidence,
        }));
    }
    artifacts.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let evidence: Vec<Value> = super::verification::list_runs(conn, requirement_id)?
        .into_iter()
        .filter(|r| r.kind == "command")
        .map(|r| json!({ "id": r.id, "taskId": r.task_id, "command": r.command, "passed": r.passed, "headCommit": r.head_commit, "dirty": r.dirty }))
        .collect();
    let consumers: Vec<Value> = {
        let mut stmt = conn.prepare(
            "SELECT c.task_id, c.artifact_version_id, c.verification FROM collab_artifact_consumers c
             JOIN collab_tasks t ON t.id = c.task_id WHERE t.requirement_id = ?1 AND t.active = 1
             ORDER BY c.task_id, c.artifact_version_id",
        )?;
        let rows = stmt
            .query_map(params![requirement_id], |r| {
                Ok(json!({ "taskId": r.get::<_, String>(0)?, "artifactVersionId": r.get::<_, String>(1)?, "verification": r.get::<_, String>(2)? }))
            })?
            .collect::<Result<_, _>>()?;
        rows
    };
    let changes: Vec<Value> = model::list_changes(conn, requirement_id)?
        .into_iter()
        .map(|c| json!({ "id": c.id, "code": c.code, "state": c.state, "revision": c.revision, "round": c.round }))
        .collect();
    let open_decisions = model::list_decisions(conn, requirement_id, true)?.len();
    Ok(json!({
        "requirementId": req.id,
        "requirementRevision": req.requirement_revision,
        "planRevision": req.active_plan_revision,
        "acceptanceCriteria": req.body,
        "tasks": tasks,
        "artifacts": artifacts,
        "evidence": evidence,
        "consumers": consumers,
        "changes": changes,
        "openDecisions": open_decisions,
    }))
}

/// Unmet conditions for acceptance (empty ⇒ acceptable).
pub fn blockers(conn: &Connection, requirement_id: &str, content: &Value) -> CResult<Vec<String>> {
    let req = model::load_requirement(conn, requirement_id)?;
    let mut out = Vec::new();
    if req.control_status != "active" {
        out.push(format!("需求控制状态为 {}", req.control_status));
    }
    let tasks = content["tasks"].as_array().cloned().unwrap_or_default();
    if tasks.is_empty() {
        out.push("没有可验收的任务".into());
    }
    for t in &tasks {
        if t["state"] != "succeeded" {
            out.push(format!("任务 {} 未完成（{}）", t["key"].as_str().unwrap_or(""), t["state"].as_str().unwrap_or("")));
        }
    }
    for c in content["changes"].as_array().cloned().unwrap_or_default() {
        if !matches!(c["state"].as_str(), Some("closed" | "rejected" | "verified")) {
            out.push(format!("修正单 {} 未关闭", c["code"].as_str().unwrap_or("")));
        }
    }
    if content["openDecisions"].as_u64().unwrap_or(0) > 0 {
        out.push("存在未解决的决策".into());
    }
    for c in content["consumers"].as_array().cloned().unwrap_or_default() {
        if c["verification"] == "failed" {
            out.push(format!("消费者 {} 的接口复验失败", c["taskId"].as_str().unwrap_or("")));
        }
    }
    // Evidence is newest-first: a task's latest Wise run decides; a declared verification needs at least one run.
    let runs = content["evidence"].as_array().cloned().unwrap_or_default();
    for t in &tasks {
        let (id, key) = (t["id"].as_str().unwrap_or(""), t["key"].as_str().unwrap_or(""));
        match runs.iter().find(|r| r["taskId"] == id) {
            Some(r) if r["passed"] != true => out.push(format!("任务 {key} 最新验证运行未通过")),
            None if t["kind"] != "plan" && !super::verification::declared_commands(&model::load_task(conn, id)?).is_empty() => {
                out.push(format!("任务 {key} 缺少 Wise 验证证据"))
            }
            _ => {}
        }
    }
    Ok(out)
}

pub fn refresh_manifest(conn: &Connection, requirement_id: &str) -> CResult<AcceptanceManifest> {
    let req = model::load_requirement(conn, requirement_id)?;
    let content = build_content(conn, requirement_id)?;
    let hash = hash_json(&content);
    if let Some(cur) = current_manifest(conn, requirement_id)? {
        if cur.content_hash == hash && matches!(cur.state.as_str(), "current" | "accepted") {
            return Ok(cur);
        }
        if cur.state == "current" {
            conn.execute(
                "UPDATE collab_acceptance_manifests SET state = 'stale', updated_at = ?2 WHERE id = ?1",
                params![cur.id, now_ms()],
            )?;
        }
    }
    let revision: i64 = conn.query_row(
        "SELECT COALESCE(MAX(revision), 0) + 1 FROM collab_acceptance_manifests WHERE requirement_id = ?1",
        params![requirement_id],
        |r| r.get(0),
    )?;
    let id = new_id("acc");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_acceptance_manifests (id, requirement_id, revision, manifest_json, content_hash, state, policy, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'current', ?6, ?7, ?7)",
        params![id, requirement_id, revision, content.to_string(), hash, req.acceptance_policy, now],
    )?;
    append_event(conn, requirement_id, "acceptance.manifest_created", json!({ "manifestId": id, "revision": revision, "hash": hash }), None, None)?;
    current_manifest(conn, requirement_id)?.ok_or_else(|| CollabError::state("验收清单写入失败"))
}

pub fn mark_stale(conn: &Connection, requirement_id: &str) -> CResult<()> {
    conn.execute(
        "UPDATE collab_acceptance_manifests SET state = 'stale', updated_at = ?2 WHERE requirement_id = ?1 AND state = 'current'",
        params![requirement_id, now_ms()],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AcceptInput {
    pub request_id: String,
    pub requirement_id: String,
    pub manifest_revision: i64,
    pub manifest_hash: String,
    pub expected_revision: Option<i64>,
    pub note: String,
    /// Reject instead of accept: reopen only these tasks with the reviewer's feedback.
    pub reject: bool,
    pub reopen_task_ids: Vec<String>,
}

pub fn accept(conn: &Connection, input: &AcceptInput) -> CResult<AcceptanceManifest> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&serde_json::to_value(input)?);
        let command = if input.reject { "reject_acceptance" } else { "accept_acceptance" };
        if let Some(prev) = request_replay(conn, &input.request_id, command, &payload_hash)? {
            let id = prev.get("id").and_then(Value::as_str).unwrap_or_default();
            return conn
                .query_row(&format!("SELECT {COLS} FROM collab_acceptance_manifests WHERE id = ?1"), params![id], map_manifest)
                .map_err(Into::into);
        }
        let req = model::load_requirement(conn, &input.requirement_id)?;
        if let Some(expected) = input.expected_revision {
            if expected != req.revision {
                return Err(stale_error(conn, &req.id, "需求已变化")?);
            }
        }
        let cur = current_manifest(conn, &req.id)?.ok_or_else(|| CollabError::state("尚无验收清单"))?;
        if cur.revision != input.manifest_revision || cur.content_hash != input.manifest_hash || cur.state != "current" {
            return Err(stale_error(conn, &req.id, "验收清单已更新")?);
        }
        // Re-derive at commit time: the page having shown "passed" is not evidence.
        let content = build_content(conn, &req.id)?;
        if hash_json(&content) != cur.content_hash {
            mark_stale(conn, &req.id)?;
            refresh_manifest(conn, &req.id)?;
            return Err(stale_error(conn, &req.id, "提交时状态已变化")?);
        }
        let now = now_ms();
        if input.reject {
            if input.reopen_task_ids.is_empty() {
                return Err(CollabError::invalid("驳回验收需要指定需重做的任务"));
            }
            for tid in &input.reopen_task_ids {
                let task = model::load_task(conn, tid)?;
                if task.requirement_id != req.id || !task.active {
                    return Err(CollabError::invalid(format!("任务 {tid} 不属于当前验收清单")));
                }
                conn.execute(
                    "UPDATE collab_tasks SET state = 'ready', next_action = 'rework', revision = revision + 1, updated_at = ?2, queued_at = ?2
                     WHERE id = ?1",
                    params![tid, now],
                )?;
                send_message(
                    conn,
                    &req.id,
                    NewMessage::new("acceptance.rejected", json!({ "note": input.note, "manifestRevision": cur.revision }))
                        .to_task(tid)
                        .with_id(format!("msg-acc-reject-{}-{tid}", cur.id)),
                )?;
            }
            conn.execute(
                "UPDATE collab_acceptance_manifests SET state = 'rejected', conclusion_json = ?2, request_id = ?3, updated_at = ?4 WHERE id = ?1",
                params![cur.id, json!({ "accepted": false, "note": input.note, "reopened": input.reopen_task_ids, "at": now }).to_string(), input.request_id, now],
            )?;
            conn.execute(
                "UPDATE collab_requirements SET business_status = 'open', stage = 'executing', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
                params![req.id, now],
            )?;
            append_event(conn, &req.id, "acceptance.rejected", json!({ "manifestId": cur.id, "reopened": input.reopen_task_ids }), None, Some(&input.request_id))?;
            super::scheduler::evaluate_requirement(conn, &req.id)?;
        } else {
            let unmet = blockers(conn, &req.id, &content)?;
            if !unmet.is_empty() {
                return Err(CollabError::new(codes::INVALID_STATE, format!("尚不满足验收条件：{}", unmet.join("；")))
                    .with_details(json!({ "blockers": unmet })));
            }
            finalize_accept(conn, &req.id, &cur, &input.note, &input.request_id, "user")?;
        }
        let out = conn.query_row(&format!("SELECT {COLS} FROM collab_acceptance_manifests WHERE id = ?1"), params![cur.id], map_manifest)?;
        request_record(conn, &input.request_id, command, &payload_hash, &json!({ "id": out.id }))?;
        Ok(out)
    })
}

fn stale_error(conn: &Connection, requirement_id: &str, why: &str) -> CResult<CollabError> {
    let cur = current_manifest(conn, requirement_id)?;
    let req = model::load_requirement(conn, requirement_id)?;
    Ok(CollabError::new(codes::STALE_ACCEPTANCE, format!("{why}，请刷新差异后重新验收"))
        .with_revision(req.revision)
        .suggest("refresh")
        .with_details(json!({
            "manifestRevision": cur.as_ref().map(|m| m.revision),
            "manifestHash": cur.as_ref().map(|m| m.content_hash.clone()),
        })))
}

fn finalize_accept(conn: &Connection, requirement_id: &str, cur: &AcceptanceManifest, note: &str, request_id: &str, by: &str) -> CResult<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE collab_acceptance_manifests SET state = 'accepted', conclusion_json = ?2, request_id = ?3, updated_at = ?4 WHERE id = ?1",
        params![cur.id, json!({ "accepted": true, "note": note, "by": by, "at": now }).to_string(), request_id, now],
    )?;
    conn.execute(
        "UPDATE collab_requirements SET business_status = 'done', stage = 'done', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
        params![requirement_id, now],
    )?;
    // Verified memories: candidates tied to this requirement become trusted once it is accepted.
    let agents: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT executor_agent_id FROM collab_tasks WHERE requirement_id = ?1 AND executor_agent_id IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![requirement_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    for a in agents {
        let policy_on = super::agents::get_agent(conn, &a)
            .ok()
            .and_then(|p| (p.active_revision > 0).then(|| super::agents::get_revision(conn, &a, p.active_revision).ok()).flatten())
            .map(|r| r.config.memory_policy.enabled && r.config.memory_policy.auto_save_verified)
            .unwrap_or(false);
        if policy_on {
            super::memory::promote_verified_candidates(conn, &a, requirement_id)?;
        }
    }
    super::runtime_resources::release_for_requirement(conn, requirement_id)?;
    append_event(conn, requirement_id, "requirement.done", json!({ "manifestId": cur.id, "by": by }), None, Some(request_id))?;
    send_message(
        conn,
        requirement_id,
        NewMessage::new("requirement.done", json!({ "manifestId": cur.id, "by": by }))
            .with_id(format!("msg-done-{}", cur.id)),
    )?;
    Ok(())
}

/// Machine policy: accept automatically once every condition holds on the current manifest.
pub fn try_machine_accept(conn: &Connection, requirement_id: &str) -> CResult<bool> {
    let Some(cur) = current_manifest(conn, requirement_id)? else { return Ok(false) };
    if cur.state != "current" {
        return Ok(false);
    }
    if !blockers(conn, requirement_id, &cur.manifest)?.is_empty() {
        return Ok(false);
    }
    // Runs are newest-first: the latest run of each task decides, earlier failed retries don't.
    let evidence_ok = cur.manifest["evidence"].as_array().is_some_and(|runs| {
        let mut seen: Vec<&str> = Vec::new();
        let mut all_passed = true;
        for r in runs {
            let task = r["taskId"].as_str().unwrap_or("");
            if seen.contains(&task) {
                continue;
            }
            seen.push(task);
            all_passed &= r["passed"] == true;
        }
        !seen.is_empty() && all_passed
    });
    if !evidence_ok {
        return Ok(false);
    }
    finalize_accept(conn, requirement_id, &cur, "机器验收：所有任务、交付校验与复验证据均通过", &format!("auto:{}", cur.id), "machine")?;
    Ok(true)
}
