//! V1 需求（`app_settings` 中的 `wise.workspaceRequirements.v1`）导入协作层。
//!
//! 显式触发、单事务、可重入（按 legacy_id 去重）；先备份原 JSON；保留原 ID、正文、图片、排序、
//! 时间、状态与会话；open 默认以暂停状态导入避免重复派发；同一事务把 V1 项标记
//! `collaborationRequirementId`，旧自动扫描器据此跳过。校验数量失败整体回滚。

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{codes, CResult, CollabError};
use super::events::append_event;
use super::model;
use super::scheduler::LEASE_MS;
use super::util::{derive_title, hash_json, new_id, new_secret, next_counter, now_ms, tx};
use super::RepoDirectory;

pub const V1_KEY: &str = "wise.workspaceRequirements.v1";
pub const V1_BACKUP_KEY: &str = "wise.workspaceRequirements.v1.backupBeforeCollaboration";

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportInput {
    /// Import only these V1 ids (empty = all).
    pub item_ids: Vec<String>,
    /// Open items start paused so migration never triggers a second dispatch.
    pub open_as_active: bool,
    /// Sessions the UI knows are still running; they bind to a historical attempt instead of re-dispatching.
    pub running_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub total: usize,
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
    pub needs_target: Vec<String>,
    pub bound_running_sessions: Vec<String>,
    pub backup_key: String,
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn project_for_repository(conn: &Connection, repository_id: i64) -> CResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT project_id FROM project_repositories WHERE repository_id = ?1 ORDER BY display_order ASC LIMIT 1",
            params![repository_id],
            |r| r.get(0),
        )
        .optional()?)
}

pub fn import_v1(conn: &Connection, input: &ImportInput, repos: &RepoDirectory) -> CResult<ImportReport> {
    tx(conn, |conn| {
        let raw: Option<String> = conn
            .query_row("SELECT value FROM app_settings WHERE key = ?1", params![V1_KEY], |r| r.get(0))
            .optional()?;
        let raw = raw.unwrap_or_default();
        let mut payload: Value = if raw.trim().is_empty() { json!({ "version": 1, "items": [] }) } else { serde_json::from_str(&raw)? };
        if payload.get("version").and_then(Value::as_i64) != Some(1) {
            return Err(CollabError::new(codes::INVALID_PAYLOAD, "V1 需求数据版本无法识别，未做任何修改"));
        }
        let backup_exists: i64 = conn.query_row("SELECT COUNT(*) FROM app_settings WHERE key = ?1", params![V1_BACKUP_KEY], |r| r.get(0))?;
        if backup_exists == 0 && !raw.trim().is_empty() {
            conn.execute("INSERT INTO app_settings (key, value) VALUES (?1, ?2)", params![V1_BACKUP_KEY, raw])?;
        }
        let only: HashSet<&str> = input.item_ids.iter().map(String::as_str).collect();
        let running: HashSet<&str> = input.running_session_ids.iter().map(String::as_str).collect();
        let mut report = ImportReport { backup_key: V1_BACKUP_KEY.into(), ..Default::default() };
        let now = now_ms();
        let items = payload.get_mut("items").and_then(Value::as_array_mut).ok_or_else(|| CollabError::invalid("V1 数据缺少 items"))?;
        report.total = items.len();
        for item in items.iter_mut() {
            let Some(legacy_id) = str_field(item, "id").map(str::to_string) else { continue };
            if !only.is_empty() && !only.contains(legacy_id.as_str()) {
                continue;
            }
            let existing: Option<String> = conn
                .query_row("SELECT id FROM collab_requirements WHERE legacy_id = ?1", params![legacy_id], |r| r.get(0))
                .optional()?;
            if let Some(id) = existing {
                item["collaborationRequirementId"] = json!(id);
                report.skipped.push(legacy_id);
                continue;
            }
            let body = str_field(item, "bodyMarkdown").or_else(|| str_field(item, "description")).unwrap_or("").to_string();
            let title = str_field(item, "title").map(str::to_string).unwrap_or_else(|| derive_title(&body));
            let status = match str_field(item, "status") {
                Some("done") => "done",
                Some("verifying") => "verifying",
                _ => "open",
            };
            let images: Vec<String> = item
                .get("imagePaths")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            let created_at = item.get("createdAt").and_then(Value::as_i64).unwrap_or(now);
            let updated_at = item.get("updatedAt").and_then(Value::as_i64).unwrap_or(created_at);
            let sort_order = item.get("sortOrder").and_then(Value::as_i64).unwrap_or(created_at);
            let repository_id = str_field(item, "repositoryId").and_then(|s| s.parse::<i64>().ok()).filter(|id| repos.contains_key(id));
            let project_id = match repository_id {
                Some(r) => project_for_repository(conn, r)?,
                None => None,
            };
            let taken: i64 = conn.query_row("SELECT COUNT(*) FROM collab_requirements WHERE id = ?1", params![legacy_id], |r| r.get(0))?;
            let id = if taken == 0 { legacy_id.clone() } else { new_id("req") };
            let control = if status == "open" && !input.open_as_active { "paused" } else { "active" };
            let stage = match status {
                "done" => "done",
                "verifying" => "verifying",
                _ => "executing",
            };
            conn.execute(
                "INSERT INTO collab_requirements (
                    id, title, body, image_paths_json, owner_project_id, business_status, control_status, stage,
                    active_plan_revision, sort_order, legacy_id, legacy_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    title,
                    body,
                    json!(images).to_string(),
                    project_id,
                    status,
                    control,
                    stage,
                    sort_order,
                    legacy_id,
                    item.to_string(),
                    created_at,
                    updated_at
                ],
            )?;
            conn.execute(
                "INSERT INTO collab_requirement_revisions (requirement_id, revision, kind, body, input, state, created_at)
                 VALUES (?1, 1, 'legacy_import', ?2, '', 'applied', ?3)",
                params![id, body, now],
            )?;
            conn.execute(
                "INSERT INTO collab_plan_revisions (requirement_id, revision, plan_json, state, revision_kind, activated_at, created_at)
                 VALUES (?1, 1, ?2, 'active', 'legacy', ?3, ?3)",
                params![id, json!({ "summary": "V1 单仓库需求迁移", "legacy": true }).to_string(), now],
            )?;
            if let Some(p) = project_id.as_deref() {
                model::add_requirement_project(conn, &id, p, "owner")?;
            }
            let executor = match (project_id.as_deref(), repository_id) {
                (Some(p), Some(r)) => super::agents::default_agent_for(conn, p, r)?,
                _ => None,
            };
            let profile_revision: Option<i64> = match executor.as_deref() {
                Some(a) => Some(super::agents::get_agent(conn, a)?.active_revision).filter(|r| *r > 0),
                None => None,
            };
            let task_state = match status {
                "open" => "ready",
                _ => "succeeded",
            };
            let spec = json!({
                "goal": body,
                "legacy": true,
                "legacyStatus": status,
                "note": if status == "done" { "历史验收完成（迁移前完成，未生成新的契约测试证据）" } else { "" },
            });
            let task_id = new_id("task");
            conn.execute(
                "INSERT INTO collab_tasks (
                    id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind, state, active,
                    spec_json, spec_hash, executor_agent_id, profile_revision, attempt_budget, next_action, queued_at,
                    created_at, updated_at
                 ) VALUES (?1, ?2, 1, 'LEGACY', ?3, ?4, ?5, '', 'legacy', ?6, 1, ?7, ?8, ?9, ?10, 3, 'start', ?11, ?12, ?13)",
                params![
                    task_id,
                    id,
                    title,
                    project_id,
                    repository_id,
                    task_state,
                    spec.to_string(),
                    hash_json(&spec),
                    executor,
                    profile_revision,
                    sort_order,
                    created_at,
                    updated_at
                ],
            )?;
            let sessions: Vec<String> = item
                .get("executionSessionIds")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            for s in &sessions {
                model::link_session(conn, &id, s, "legacy")?;
            }
            // A still-running V1 session keeps executing under a historical attempt (never re-dispatched).
            if status == "open" {
                if let Some(live) = sessions.iter().rev().find(|s| running.contains(s.as_str())) {
                    let fencing = next_counter(conn, "fencing")?;
                    conn.execute(
                        "INSERT INTO collab_attempts (id, task_id, requirement_id, generation, session_id, dispatch_key, secret, action,
                            lease_owner, lease_expiry, fencing_token, state, started_at, created_at)
                         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, 'legacy', 'legacy-import', ?7, ?8, 'running', ?9, ?9)",
                        params![new_id("att"), task_id, id, live, format!("{task_id}:1"), new_secret(), now + LEASE_MS, fencing, now],
                    )?;
                    conn.execute(
                        "UPDATE collab_tasks SET state = 'running', generation = 1 WHERE id = ?1",
                        params![task_id],
                    )?;
                    report.bound_running_sessions.push(live.clone());
                }
            }
            if repository_id.is_none() && status != "done" {
                super::decisions::open(
                    conn,
                    super::decisions::OpenDecision {
                        requirement_id: id.clone(),
                        kind: "legacy_target".into(),
                        dedupe_key: format!("legacy_target:{id}"),
                        title: "迁移的需求没有明确归属仓库，请补齐目标仓库".into(),
                        task_ids: vec![task_id.clone()],
                        blocked_ops: vec![],
                        evidence: json!({ "legacyRepositoryId": item.get("repositoryId") }),
                        options: json!([{ "id": "set_target", "label": "指定目标仓库" }, { "id": "cancel_task", "label": "不再执行" }]),
                    },
                )?;
                report.needs_target.push(id.clone());
            }
            append_event(
                conn,
                &id,
                "requirement.imported",
                json!({ "legacyId": legacy_id, "status": status, "sessions": sessions.len() }),
                None,
                None,
            )?;
            item["collaborationRequirementId"] = json!(id);
            report.imported.push(id);
        }
        // Count check before switching reads; any mismatch rolls the whole import back.
        let marked = payload["items"]
            .as_array()
            .map(|a| a.iter().filter(|i| i.get("collaborationRequirementId").is_some()).count())
            .unwrap_or(0);
        let expected = report.imported.len() + report.skipped.len();
        if only.is_empty() && marked != expected {
            return Err(CollabError::new(codes::STORAGE_ERROR, format!("迁移校验失败：标记 {marked} 条，期望 {expected} 条；已回滚")));
        }
        for id in &report.imported {
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM collab_tasks WHERE requirement_id = ?1", params![id], |r| r.get(0))?;
            if n != 1 {
                return Err(CollabError::new(codes::STORAGE_ERROR, format!("迁移校验失败：{id} 任务数 {n}；已回滚")));
            }
        }
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![V1_KEY, payload.to_string()],
        )?;
        Ok(report)
    })
}

/// Historical execution log (V1 per-requirement records) joined with new attempts.
pub fn history(conn: &Connection, requirement_id: &str) -> CResult<Value> {
    let req = model::load_requirement(conn, requirement_id)?;
    let legacy_records = match req.legacy_id.as_deref() {
        Some(lid) => conn
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![format!("wise.requirementExecutionRecords.v1:{lid}")],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .map(|raw| serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null))
            .unwrap_or(Value::Null),
        None => Value::Null,
    };
    let attempts = model::list_attempts_for_requirement(conn, requirement_id)?;
    Ok(json!({ "legacyRecords": legacy_records, "attempts": attempts, "legacy": req.legacy_id.is_some() }))
}

/// Resolves the "补齐目标仓库" decision.
pub fn set_legacy_target(conn: &Connection, requirement_id: &str, repository_id: i64, repos: &RepoDirectory) -> CResult<()> {
    tx(conn, |conn| {
        if !repos.contains_key(&repository_id) {
            return Err(CollabError::new(codes::AMBIGUOUS_TARGET, "仓库不在 Wise 仓库列表中"));
        }
        let project = project_for_repository(conn, repository_id)?;
        let now = now_ms();
        conn.execute(
            "UPDATE collab_tasks SET repository_id = ?2, project_id = ?3, revision = revision + 1, updated_at = ?4
             WHERE requirement_id = ?1 AND kind = 'legacy'",
            params![requirement_id, repository_id, project, now],
        )?;
        if let Some(p) = project.as_deref() {
            conn.execute(
                "UPDATE collab_requirements SET owner_project_id = COALESCE(owner_project_id, ?2), updated_at = ?3 WHERE id = ?1",
                params![requirement_id, p, now],
            )?;
            model::add_requirement_project(conn, requirement_id, p, "owner")?;
        }
        conn.execute(
            "UPDATE collab_decisions SET state = 'resolved', resolution_json = ?2, updated_at = ?3
             WHERE requirement_id = ?1 AND kind = 'legacy_target' AND state = 'open'",
            params![requirement_id, json!({ "optionId": "set_target", "repositoryId": repository_id }).to_string(), now],
        )?;
        super::scheduler::evaluate_requirement(conn, requirement_id)
    })
}
