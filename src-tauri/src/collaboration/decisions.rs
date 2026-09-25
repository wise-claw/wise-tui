//! 待决策项：按任务 / 操作范围局部阻塞，解决后触发受影响任务重新评估。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model::{self, DecisionRow};
use super::util::{hash_json, new_id, now_ms, request_record, request_replay, tx};

#[derive(Debug, Clone, Default)]
pub struct OpenDecision {
    pub requirement_id: String,
    pub kind: String,
    pub dedupe_key: String,
    pub title: String,
    pub task_ids: Vec<String>,
    /// `["all"]` blocks every task of the requirement.
    pub blocked_ops: Vec<String>,
    pub evidence: Value,
    pub options: Value,
}

/// Idempotent on `(requirementId, dedupeKey)` while open.
pub fn open(conn: &Connection, input: OpenDecision) -> CResult<DecisionRow> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM collab_decisions WHERE requirement_id = ?1 AND dedupe_key = ?2 AND state = 'open'",
            params![input.requirement_id, input.dedupe_key],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        return model::load_decision(conn, &id);
    }
    let id = new_id("dec");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_decisions (
            id, requirement_id, kind, dedupe_key, title, task_ids_json, blocked_ops_json, evidence_json,
            options_json, state, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10, ?10)",
        params![
            id,
            input.requirement_id,
            input.kind,
            input.dedupe_key,
            input.title,
            json!(input.task_ids).to_string(),
            json!(input.blocked_ops).to_string(),
            input.evidence.to_string(),
            if input.options.is_null() { "[]".to_string() } else { input.options.to_string() },
            now
        ],
    )?;
    append_event(
        conn,
        &input.requirement_id,
        "decision.opened",
        json!({ "decisionId": id, "kind": input.kind, "taskIds": input.task_ids }),
        None,
        None,
    )?;
    send_message(
        conn,
        &input.requirement_id,
        NewMessage::new(
            "decision.required",
            json!({ "decisionId": id, "kind": input.kind, "title": input.title, "options": input.options }),
        )
        .correlation(&id)
        .with_id(format!("msg-{id}")),
    )?;
    model::load_decision(conn, &id)
}

pub fn cancel_matching(conn: &Connection, requirement_id: &str, dedupe_prefix: &str) -> CResult<i64> {
    let n = conn.execute(
        "UPDATE collab_decisions SET state = 'cancelled', updated_at = ?3, revision = revision + 1
         WHERE requirement_id = ?1 AND state = 'open' AND dedupe_key LIKE ?2 || '%'",
        params![requirement_id, dedupe_prefix, now_ms()],
    )?;
    Ok(n as i64)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResolveDecisionInput {
    pub decision_id: String,
    pub expected_revision: i64,
    pub option_id: String,
    pub note: String,
    pub evidence: Value,
    /// Option-specific values (e.g. `{ "extraBudget": 2, "targetAgentId": "..." }`).
    pub values: Value,
    pub request_id: String,
}

fn option_allowed(decision: &DecisionRow, option_id: &str) -> bool {
    match decision.options.as_array() {
        Some(items) if !items.is_empty() => items
            .iter()
            .any(|o| o.get("id").and_then(Value::as_str) == Some(option_id)),
        _ => true,
    }
}

pub fn resolve(conn: &Connection, input: &ResolveDecisionInput) -> CResult<DecisionRow> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&json!({
            "d": input.decision_id, "o": input.option_id, "v": input.values, "r": input.expected_revision
        }));
        if let Some(prev) = request_replay(conn, &input.request_id, "resolve_decision", &payload_hash)? {
            let id = prev.get("id").and_then(Value::as_str).unwrap_or(&input.decision_id).to_string();
            return model::load_decision(conn, &id);
        }
        let decision = model::load_decision(conn, &input.decision_id)?;
        if decision.state != "open" {
            return Err(CollabError::state(format!("决策已处于 {} 状态", decision.state)).with_revision(decision.revision));
        }
        if input.expected_revision > 0 && input.expected_revision != decision.revision {
            return Err(CollabError::revision_conflict(decision.revision));
        }
        if !option_allowed(&decision, &input.option_id) {
            return Err(CollabError::new(codes::INVALID_PAYLOAD, format!("选项 {} 不属于该决策", input.option_id)));
        }
        let now = now_ms();
        let resolution = json!({
            "optionId": input.option_id,
            "note": input.note,
            "evidence": input.evidence,
            "values": input.values,
            "resolvedAt": now,
        });
        conn.execute(
            "UPDATE collab_decisions SET state = 'resolved', resolution_json = ?2, revision = revision + 1, updated_at = ?3
             WHERE id = ?1",
            params![decision.id, resolution.to_string(), now],
        )?;
        apply_effects(conn, &decision, input)?;
        append_event(
            conn,
            &decision.requirement_id,
            "decision.resolved",
            json!({ "decisionId": decision.id, "kind": decision.kind, "optionId": input.option_id }),
            Some(&decision.id),
            None,
        )?;
        super::scheduler::evaluate_requirement(conn, &decision.requirement_id)?;
        let row = model::load_decision(conn, &decision.id)?;
        request_record(conn, &input.request_id, "resolve_decision", &payload_hash, &json!({ "id": row.id }))?;
        Ok(row)
    })
}

fn value_i64(values: &Value, key: &str, default: i64) -> i64 {
    values.get(key).and_then(Value::as_i64).unwrap_or(default)
}

fn apply_effects(conn: &Connection, decision: &DecisionRow, input: &ResolveDecisionInput) -> CResult<()> {
    let now = now_ms();
    let option = input.option_id.as_str();
    match (decision.kind.as_str(), option) {
        ("attempt_budget", "add_budget") => {
            let extra = value_i64(&input.values, "extraBudget", 2).clamp(1, 20);
            for task_id in &decision.task_ids {
                conn.execute(
                    "UPDATE collab_tasks SET attempt_budget = failure_count + ?2,
                        state = CASE WHEN state = 'failed' THEN 'ready' ELSE state END,
                        next_action = 'retry', revision = revision + 1, updated_at = ?3, queued_at = ?3
                     WHERE id = ?1",
                    params![task_id, extra, now],
                )?;
            }
        }
        ("requirement_budget", "add_budget") => {
            let extra = value_i64(&input.values, "extraBudgetMs", 30 * 60 * 1000).max(60_000);
            conn.execute(
                "UPDATE collab_requirements SET budget_ms = COALESCE(budget_ms, 0) + ?2, updated_at = ?3 WHERE id = ?1",
                params![decision.requirement_id, extra, now],
            )?;
        }
        (_, "cancel_task") => {
            for task_id in &decision.task_ids {
                super::scheduler::request_stop_for_task(conn, task_id, "decision_cancel")?;
                conn.execute(
                    "UPDATE collab_tasks SET state = 'cancelled', revision = revision + 1, updated_at = ?2
                     WHERE id = ?1 AND state NOT IN ('succeeded', 'running')",
                    params![task_id, now],
                )?;
            }
        }
        ("binding_revoked", "reassign") | ("reassign", _) => {
            let target = input
                .values
                .get("targetAgentId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| CollabError::invalid("改派需要 values.targetAgentId"))?;
            let profile = super::agents::get_agent(conn, target)?;
            if profile.status != "enabled" {
                return Err(CollabError::new(codes::AGENT_DISABLED, "目标智能体未启用"));
            }
            for task_id in &decision.task_ids {
                let task = model::load_task(conn, task_id)?;
                if let Some(repo) = task.repository_id {
                    if super::agents::find_binding(conn, target, task.project_id.as_deref(), repo)?.is_none() {
                        return Err(CollabError::new(codes::SCOPE_NOT_AUTHORIZED, "目标智能体未绑定该任务的仓库"));
                    }
                }
                conn.execute(
                    "UPDATE collab_tasks SET executor_agent_id = ?2, profile_revision = ?3, revision = revision + 1, updated_at = ?4
                     WHERE id = ?1",
                    params![task_id, target, profile.active_revision, now],
                )?;
            }
        }
        ("plan_approval" | "scope_expansion", _) => super::plans::apply_decision(conn, decision, input)?,
        ("repair_budget" | "dispute" | "change_triage", _) => super::changes::apply_decision(conn, decision, input)?,
        ("compat_unknown", _) => super::artifacts::apply_decision(conn, decision, input)?,
        ("requirement_revision", _) => super::requirements::apply_revision_decision(conn, decision, input)?,
        ("owner_transfer", _) => super::requirements::apply_transfer_decision(conn, decision, input)?,
        _ => {}
    }
    Ok(())
}
