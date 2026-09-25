//! 协作需求：会话派发意图（讨论 / 规划 / 执行）、创建、运行中修订、控制状态、主责移交与快照。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::agents::{self, AgentBinding, AgentConfig};
use super::decisions::{self, OpenDecision};
use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model::{self, DecisionRow, RequirementRow};
use super::runtime::{self, CapabilityMatrix, ResolveInput};
use super::util::{derive_title, hash_json, new_id, now_ms, request_record, request_replay, tx};
use super::RepoDirectory;

fn active_config(conn: &Connection, agent_id: &str) -> CResult<(agents::AgentProfile, AgentConfig)> {
    let profile = agents::get_agent(conn, agent_id)?;
    let config = if profile.active_revision > 0 {
        agents::get_revision(conn, agent_id, profile.active_revision)?.config
    } else {
        AgentConfig::default()
    };
    Ok((profile, config))
}

/// Coordinator home: default binding in the owner project, else the first binding.
pub fn primary_binding(conn: &Connection, agent_id: &str, owner_project: Option<&str>) -> CResult<Option<AgentBinding>> {
    let bindings = agents::list_bindings(conn, agent_id, false)?;
    if let Some(p) = owner_project {
        if let Some(b) = bindings.iter().find(|b| b.project_id == p && b.is_default) {
            return Ok(Some(b.clone()));
        }
        if let Some(b) = bindings.iter().find(|b| b.project_id == p) {
            return Ok(Some(b.clone()));
        }
    }
    Ok(bindings.into_iter().next())
}

fn create_planner_task(
    conn: &Connection,
    req: &RequirementRow,
    agent_id: &str,
    binding: &AgentBinding,
    profile_revision: i64,
    action: &str,
) -> CResult<String> {
    let now = now_ms();
    let id = new_id("task");
    let spec = json!({
        "goal": "理解需求、判断涉及的仓库与责任，发布可执行的协作计划；只在主责范围内协调，不直接修改业务代码",
        "acceptance": ["通过 wise-collab plan 发布计划", "计划中每个任务都指定目标仓库、输出与验证方式"],
        "role": "coordinator",
    });
    conn.execute(
        "INSERT INTO collab_tasks (
            id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind, state, active,
            spec_json, spec_hash, executor_agent_id, profile_revision, attempt_budget, next_action, priority, queued_at,
            created_at, updated_at
         ) VALUES (?1, ?2, 0, 'PLAN', '需求规划与协调', ?3, ?4, 'coordinator', 'plan', 'ready', 1,
            ?5, ?6, ?7, ?8, ?9, ?10, 10, ?11, ?11, ?11)",
        params![
            id,
            req.id,
            binding.project_id,
            binding.repository_id,
            spec.to_string(),
            hash_json(&spec),
            agent_id,
            profile_revision,
            req.execution_attempt_budget,
            action,
            now
        ],
    )?;
    append_event(conn, &req.id, "task.created", json!({ "taskId": id, "kind": "plan", "agentId": agent_id }), Some(&id), None)?;
    Ok(id)
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DispatchIntentInput {
    pub request_id: String,
    pub origin_session_id: Option<String>,
    pub origin_message_id: Option<String>,
    pub agent_id: String,
    /// `discuss` / `plan` / `execute`.
    pub mode: String,
    /// Existing requirement to append to (revision) instead of creating a new one.
    pub requirement_id: Option<String>,
    pub project_context: Option<String>,
    pub title: Option<String>,
    pub body: String,
    pub attachments: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispatchResult {
    pub request_id: String,
    pub mode: String,
    pub agent_id: String,
    pub requirement_id: Option<String>,
    pub state: String,
    pub message: String,
    /// Discuss mode: a read-only conversation with the agent's own identity.
    pub discussion: Option<Value>,
    pub replayed: bool,
}

pub fn dispatch_to_agent(
    conn: &Connection,
    input: &DispatchIntentInput,
    repos: &RepoDirectory,
    matrix: &CapabilityMatrix,
) -> CResult<DispatchResult> {
    tx(conn, |conn| {
        let request_id = input.request_id.trim();
        if request_id.is_empty() {
            return Err(CollabError::invalid("派发需要 requestId"));
        }
        let mode = match input.mode.trim() {
            "discuss" => "discuss",
            "plan" => "plan",
            "execute" => "execute",
            other => return Err(CollabError::invalid(format!("未知派发模式：{other}"))),
        };
        let body = input.body.trim();
        if body.is_empty() {
            return Err(CollabError::invalid("派发内容不能为空"));
        }
        let payload_hash = hash_json(&json!({
            "agent": input.agent_id.trim(), "mode": mode, "body": body, "req": input.requirement_id,
            "project": input.project_context, "attachments": input.attachments,
        }));
        let existing: Option<(String, String)> = conn
            .query_row(
                "SELECT payload_hash, result_json FROM agent_dispatch_intents WHERE request_id = ?1",
                params![request_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((hash, result)) = existing {
            if hash != payload_hash {
                return Err(CollabError::new(codes::REQUEST_ID_REUSED, "requestId 已用于不同的派发内容"));
            }
            let mut prev: DispatchResult = serde_json::from_str(&result)?;
            prev.replayed = true;
            return Ok(prev);
        }

        let agent_id = input.agent_id.trim();
        let (profile, config) = active_config(conn, agent_id)?;
        let bindings = agents::list_bindings(conn, agent_id, false)?;
        if bindings.is_empty() {
            return Err(CollabError::new(codes::AMBIGUOUS_TARGET, format!("智能体「{}」尚未绑定任何仓库", profile.name))
                .suggest("bind_repository"));
        }
        let project_context = input
            .project_context
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .or_else(|| profile.default_owner_project_id.clone());
        let binding = primary_binding(conn, agent_id, project_context.as_deref())?.expect("bindings not empty");
        let now = now_ms();

        let mut result = DispatchResult {
            request_id: request_id.into(),
            mode: mode.into(),
            agent_id: agent_id.into(),
            ..Default::default()
        };
        if mode == "discuss" {
            if profile.active_revision == 0 {
                return Err(CollabError::new(codes::AGENT_DISABLED, "智能体尚未发布配置，无法以其身份讨论"));
            }
            let repo = repos.get(&binding.repository_id);
            let manifest = runtime::resolve(
                conn,
                &ResolveInput {
                    agent_id,
                    revision: None,
                    project_id: Some(&binding.project_id),
                    repository_id: Some(binding.repository_id),
                    repository_path: repo.map(|r| r.path.as_str()),
                    known_mcp_server_ids: None,
                    require_enabled: false,
                },
                matrix,
            )?;
            let spawn = runtime::spawn_config(conn, &manifest, true, Vec::new())?;
            let prompt = format!(
                "【讨论模式】你是仓库智能体「{}」。本轮只讨论与分析：不要修改文件、不要创建需求或启动执行。\n\n{}",
                profile.name, body
            );
            result.state = "discussing".into();
            result.message = format!("已与「{}」开启讨论（只读，不创建需求）", profile.name);
            result.discussion = Some(json!({
                "repositoryId": binding.repository_id,
                "repositoryPath": repo.map(|r| r.path.clone()),
                "projectId": binding.project_id,
                "prompt": prompt,
                "spawn": spawn,
                "manifest": manifest,
            }));
        } else if let Some(existing_req) = input.requirement_id.as_deref().filter(|s| !s.trim().is_empty()) {
            let revised = revise_locked(conn, existing_req, None, body, &input.attachments, false, Some(request_id))?;
            result.requirement_id = Some(revised.id.clone());
            result.state = "revising".into();
            result.message = "已追加到现有需求，主责智能体将生成影响清单".into();
        } else {
            if profile.status != "enabled" {
                return Err(CollabError::new(
                    codes::AGENT_DISABLED,
                    format!("智能体「{}」当前为 {}，不接受新需求", profile.name, profile.status),
                )
                .suggest("enable_agent"));
            }
            let id = new_id("req");
            let title = input
                .title
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| derive_title(body));
            let rp = &config.run_policy;
            let owner_project = project_context.clone().or(Some(binding.project_id.clone()));
            conn.execute(
                "INSERT INTO collab_requirements (
                    id, title, body, image_paths_json, owner_project_id, owner_agent_id, profile_revision, stage,
                    plan_approval_required, acceptance_policy, max_concurrent_attempts, execution_attempt_budget,
                    repair_round_budget, budget_ms, origin_session_id, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'planning', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
                params![
                    id,
                    title,
                    body,
                    json!(input.attachments).to_string(),
                    owner_project,
                    agent_id,
                    profile.active_revision,
                    (mode == "plan") as i64,
                    rp.acceptance_policy,
                    rp.max_concurrent_attempts,
                    rp.execution_attempt_budget,
                    rp.repair_round_budget,
                    rp.budget_ms,
                    input.origin_session_id,
                    now
                ],
            )?;
            conn.execute(
                "INSERT INTO collab_requirement_revisions (requirement_id, revision, kind, body, input, state, created_at)
                 VALUES (?1, 1, 'initial', ?2, ?2, 'applied', ?3)",
                params![id, body, now],
            )?;
            if let Some(p) = owner_project.as_deref() {
                model::add_requirement_project(conn, &id, p, "owner")?;
            }
            if let Some(s) = input.origin_session_id.as_deref() {
                model::link_session(conn, &id, s, "origin")?;
            }
            let req = model::load_requirement(conn, &id)?;
            append_event(
                conn,
                &id,
                "requirement.created",
                json!({ "ownerAgentId": agent_id, "mode": mode, "originSessionId": input.origin_session_id }),
                None,
                Some(request_id),
            )?;
            create_planner_task(conn, &req, agent_id, &binding, profile.active_revision, "plan")?;
            result.requirement_id = Some(id);
            result.state = "planning".into();
            result.message = if mode == "plan" {
                format!("「{}」将先产出计划，采用前需要你确认", profile.name)
            } else {
                format!("「{}」将自主规划并按仓库派发执行", profile.name)
            };
        }
        conn.execute(
            "INSERT INTO agent_dispatch_intents (
                request_id, origin_session_id, origin_message_id, agent_id, mode, requirement_id, project_context,
                body, attachments_json, payload_hash, state, result_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)",
            params![
                request_id,
                input.origin_session_id,
                input.origin_message_id,
                agent_id,
                mode,
                result.requirement_id,
                project_context,
                body,
                json!(input.attachments).to_string(),
                payload_hash,
                result.state,
                serde_json::to_string(&result)?,
                now
            ],
        )?;
        Ok(result)
    })
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateRequirementInput {
    pub request_id: String,
    pub title: Option<String>,
    pub body: String,
    pub image_paths: Vec<String>,
    pub owner_project_id: Option<String>,
    pub participant_project_ids: Vec<String>,
    pub owner_agent_id: Option<String>,
    pub collaboration_mode: Option<String>,
    pub plan_approval_required: bool,
    pub acceptance_policy: Option<String>,
    pub max_concurrent_attempts: Option<i64>,
    pub repair_round_budget: Option<i64>,
    pub execution_attempt_budget: Option<i64>,
    pub budget_ms: Option<i64>,
    pub origin_session_id: Option<String>,
}

pub fn create_requirement(conn: &Connection, input: &CreateRequirementInput) -> CResult<RequirementRow> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&serde_json::to_value(input)?);
        if let Some(prev) = request_replay(conn, &input.request_id, "create_requirement", &payload_hash)? {
            return model::load_requirement(conn, prev.get("id").and_then(Value::as_str).unwrap_or_default());
        }
        let body = input.body.trim();
        if body.is_empty() {
            return Err(CollabError::invalid("需求正文不能为空"));
        }
        let owner_project = input.owner_project_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
        if owner_project.is_none() {
            return Err(CollabError::new(codes::AMBIGUOUS_TARGET, "需要指定主责项目"));
        }
        let (profile_revision, policy) = match input.owner_agent_id.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(agent) => {
                let (profile, config) = active_config(conn, agent)?;
                if profile.status != "enabled" {
                    return Err(CollabError::new(codes::AGENT_DISABLED, format!("主责智能体「{}」未启用", profile.name)));
                }
                (Some(profile.active_revision), config.run_policy)
            }
            None => (None, Default::default()),
        };
        let id = new_id("req");
        let now = now_ms();
        let title = input
            .title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| derive_title(body));
        let mode = match input.collaboration_mode.as_deref() {
            Some("contract_parallel") => "contract_parallel",
            _ => "serial",
        };
        let acceptance = match input.acceptance_policy.as_deref() {
            Some("machine") => "machine",
            Some("manual") => "manual",
            _ => policy.acceptance_policy.as_str(),
        };
        conn.execute(
            "INSERT INTO collab_requirements (
                id, title, body, image_paths_json, owner_project_id, owner_agent_id, profile_revision, stage,
                plan_approval_required, acceptance_policy, collaboration_mode, max_concurrent_attempts,
                execution_attempt_budget, repair_round_budget, budget_ms, origin_session_id, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'planning', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
            params![
                id,
                title,
                body,
                json!(input.image_paths).to_string(),
                owner_project,
                input.owner_agent_id.as_deref().filter(|s| !s.trim().is_empty()),
                profile_revision,
                input.plan_approval_required as i64,
                acceptance,
                mode,
                input.max_concurrent_attempts.unwrap_or(policy.max_concurrent_attempts).clamp(1, 8),
                input.execution_attempt_budget.unwrap_or(policy.execution_attempt_budget).clamp(1, 20),
                input.repair_round_budget.unwrap_or(policy.repair_round_budget).clamp(1, 20),
                input.budget_ms.or(policy.budget_ms),
                input.origin_session_id,
                now
            ],
        )?;
        conn.execute(
            "INSERT INTO collab_requirement_revisions (requirement_id, revision, kind, body, input, state, created_at)
             VALUES (?1, 1, 'initial', ?2, ?2, 'applied', ?3)",
            params![id, body, now],
        )?;
        model::add_requirement_project(conn, &id, owner_project.unwrap_or_default(), "owner")?;
        for p in &input.participant_project_ids {
            if !p.trim().is_empty() && Some(p.trim()) != owner_project {
                model::add_requirement_project(conn, &id, p.trim(), "participant")?;
            }
        }
        if let Some(s) = input.origin_session_id.as_deref() {
            model::link_session(conn, &id, s, "origin")?;
        }
        let req = model::load_requirement(conn, &id)?;
        append_event(conn, &id, "requirement.created", json!({ "ownerAgentId": req.owner_agent_id }), None, None)?;
        if let Some(agent) = req.owner_agent_id.as_deref() {
            match primary_binding(conn, agent, owner_project)? {
                Some(b) => {
                    create_planner_task(conn, &req, agent, &b, profile_revision.unwrap_or(0), "plan")?;
                }
                None => {
                    return Err(CollabError::new(codes::AMBIGUOUS_TARGET, "主责智能体尚未绑定仓库").suggest("bind_repository"));
                }
            }
        }
        request_record(conn, &input.request_id, "create_requirement", &payload_hash, &json!({ "id": id }))?;
        model::load_requirement(conn, &id)
    })
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviseInput {
    pub request_id: String,
    pub requirement_id: String,
    pub expected_revision: Option<i64>,
    pub input: String,
    pub attachments: Vec<String>,
    /// User marks this as a business-scope change: needs confirmation before touching the authorized plan.
    pub scope_change: bool,
}

pub fn revise_requirement(conn: &Connection, input: &ReviseInput) -> CResult<RequirementRow> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&serde_json::to_value(input)?);
        if let Some(prev) = request_replay(conn, &input.request_id, "revise_requirement", &payload_hash)? {
            return model::load_requirement(conn, prev.get("id").and_then(Value::as_str).unwrap_or_default());
        }
        let req = revise_locked(
            conn,
            &input.requirement_id,
            input.expected_revision,
            &input.input,
            &input.attachments,
            input.scope_change,
            Some(&input.request_id),
        )?;
        request_record(conn, &input.request_id, "revise_requirement", &payload_hash, &json!({ "id": req.id }))?;
        Ok(req)
    })
}

fn revise_locked(
    conn: &Connection,
    requirement_id: &str,
    expected_revision: Option<i64>,
    text: &str,
    attachments: &[String],
    scope_change: bool,
    request_id: Option<&str>,
) -> CResult<RequirementRow> {
    let req = model::load_requirement(conn, requirement_id)?;
    if matches!(req.control_status.as_str(), "cancelling" | "cancelled") {
        return Err(CollabError::new(codes::REQUIREMENT_CANCELLED, "需求已取消"));
    }
    if let Some(expected) = expected_revision {
        if expected != req.revision {
            return Err(CollabError::revision_conflict(req.revision));
        }
    }
    let text = text.trim();
    if text.is_empty() {
        return Err(CollabError::invalid("追加内容不能为空"));
    }
    let now = now_ms();
    let req = if req.business_status == "done" {
        // 继续已完成需求：新 generation + 新验收轮次；已通过的验收清单与执行证据保留为历史。
        conn.execute(
            "UPDATE collab_requirements SET business_status = 'open', stage = 'planning', generation = generation + 1,
                revision = revision + 1, updated_at = ?2 WHERE id = ?1",
            params![req.id, now],
        )?;
        append_event(
            conn,
            &req.id,
            "requirement.reopened",
            json!({ "reason": "continue_done", "previousGeneration": req.generation }),
            None,
            request_id,
        )?;
        model::load_requirement(conn, &req.id)?
    } else {
        req
    };
    let next_rev = req.requirement_revision + 1;
    let state = if scope_change && req.active_plan_revision > 0 { "proposed" } else { "applied" };
    conn.execute(
        "INSERT INTO collab_requirement_revisions (requirement_id, revision, kind, body, input, state, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            req.id,
            next_rev,
            if scope_change { "scope_change" } else { "append" },
            format!("{}\n\n## 追加输入 r{next_rev}\n\n{text}", req.body),
            text,
            state,
            now
        ],
    )?;
    if state == "proposed" {
        decisions::open(
            conn,
            OpenDecision {
                requirement_id: req.id.clone(),
                kind: "requirement_revision".into(),
                dedupe_key: format!("revision:{next_rev}"),
                title: format!("需求范围变更（r{next_rev}）待确认；确认前不改动已授权计划"),
                task_ids: vec![],
                blocked_ops: vec!["plan_activation".into()],
                evidence: json!({ "requirementRevision": next_rev, "input": text }),
                options: json!([{ "id": "approve", "label": "确认变更并重新规划" }, { "id": "reject", "label": "不采纳" }]),
            },
        )?;
        conn.execute(
            "UPDATE collab_requirements SET revision = revision + 1, updated_at = ?2 WHERE id = ?1",
            params![req.id, now],
        )?;
    } else {
        apply_revision(conn, &req, next_rev, text, attachments)?;
    }
    append_event(
        conn,
        &req.id,
        "requirement.revised",
        json!({ "requirementRevision": next_rev, "state": state }),
        None,
        request_id,
    )?;
    model::load_requirement(conn, &req.id)
}

fn apply_revision(conn: &Connection, req: &RequirementRow, revision: i64, text: &str, attachments: &[String]) -> CResult<()> {
    let now = now_ms();
    let mut images = req.image_paths.clone();
    for a in attachments {
        if !images.contains(a) {
            images.push(a.clone());
        }
    }
    let body = format!("{}\n\n## 追加输入 r{revision}\n\n{text}", req.body);
    conn.execute(
        "UPDATE collab_requirements SET body = ?2, image_paths_json = ?3, requirement_revision = ?4,
            business_status = CASE WHEN business_status = 'verifying' THEN 'open' ELSE business_status END,
            revision = revision + 1, updated_at = ?5 WHERE id = ?1",
        params![req.id, body, json!(images).to_string(), revision, now],
    )?;
    conn.execute(
        "UPDATE collab_requirement_revisions SET state = 'applied' WHERE requirement_id = ?1 AND revision = ?2",
        params![req.id, revision],
    )?;
    super::acceptance::mark_stale(conn, &req.id)?;
    // The coordinator re-plans by impact; the running planner attempt (if any) stops at a checkpoint.
    let planner: Option<String> = conn
        .query_row(
            "SELECT id FROM collab_tasks WHERE requirement_id = ?1 AND kind = 'plan' AND active = 1 ORDER BY created_at DESC LIMIT 1",
            params![req.id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(planner) = planner {
        super::scheduler::request_stop_for_task(conn, &planner, "requirement_revised")?;
        conn.execute(
            "UPDATE collab_tasks SET state = CASE WHEN state = 'running' THEN state ELSE 'ready' END,
                next_action = 'replan', revision = revision + 1, updated_at = ?2, queued_at = ?2
             WHERE id = ?1",
            params![planner, now],
        )?;
        send_message(
            conn,
            &req.id,
            NewMessage::new("requirement.revised", json!({ "requirementRevision": revision, "input": text }))
                .to_task(&planner)
                .with_id(format!("msg-revise-{}-{revision}", req.id)),
        )?;
    }
    Ok(())
}

pub fn apply_revision_decision(conn: &Connection, decision: &DecisionRow, input: &super::decisions::ResolveDecisionInput) -> CResult<()> {
    let revision = decision.evidence.get("requirementRevision").and_then(Value::as_i64).unwrap_or(0);
    let text = decision.evidence.get("input").and_then(Value::as_str).unwrap_or_default().to_string();
    if input.option_id == "approve" {
        let req = model::load_requirement(conn, &decision.requirement_id)?;
        apply_revision(conn, &req, revision, &text, &[])?;
    } else {
        conn.execute(
            "UPDATE collab_requirement_revisions SET state = 'rejected' WHERE requirement_id = ?1 AND revision = ?2",
            params![decision.requirement_id, revision],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlInput {
    pub request_id: String,
    pub requirement_id: String,
    /// `pause` / `resume` / `cancel` / `reopen`.
    pub action: String,
    pub expected_revision: Option<i64>,
}

pub fn control(conn: &Connection, input: &ControlInput) -> CResult<RequirementRow> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&serde_json::to_value(input)?);
        if let Some(prev) = request_replay(conn, &input.request_id, "control_requirement", &payload_hash)? {
            return model::load_requirement(conn, prev.get("id").and_then(Value::as_str).unwrap_or_default());
        }
        let req = model::load_requirement(conn, &input.requirement_id)?;
        if let Some(expected) = input.expected_revision {
            if expected != req.revision {
                return Err(CollabError::revision_conflict(req.revision));
            }
        }
        let now = now_ms();
        let set_control = |status: &str| -> CResult<()> {
            conn.execute(
                "UPDATE collab_requirements SET control_status = ?2, revision = revision + 1, updated_at = ?3 WHERE id = ?1",
                params![req.id, status, now],
            )?;
            Ok(())
        };
        match input.action.as_str() {
            "pause" => {
                if req.control_status != "active" {
                    return Err(CollabError::state(format!("当前为 {}，不能暂停", req.control_status)));
                }
                set_control("pausing")?;
                super::scheduler::request_stop_for_requirement(conn, &req.id, "pause")?;
                append_event(conn, &req.id, "requirement.pausing", json!({}), None, Some(&input.request_id))?;
            }
            "resume" => match req.control_status.as_str() {
                "paused" => {
                    set_control("active")?;
                    append_event(conn, &req.id, "requirement.resumed", json!({}), None, Some(&input.request_id))?;
                }
                "pausing" => {
                    return Err(CollabError::new(codes::STOP_PENDING, "仍在等待执行停止，确认停止后才能恢复").retryable());
                }
                other => return Err(CollabError::state(format!("当前为 {other}，不能恢复"))),
            },
            "cancel" => {
                if matches!(req.control_status.as_str(), "cancelling" | "cancelled") {
                    return Ok(req);
                }
                if req.business_status == "done" {
                    return Err(CollabError::state("需求已验收完成，不能取消"));
                }
                set_control("cancelling")?;
                super::scheduler::request_stop_for_requirement(conn, &req.id, "cancel")?;
                append_event(conn, &req.id, "requirement.cancelling", json!({}), None, Some(&input.request_id))?;
            }
            "reopen" => {
                if req.control_status != "cancelled" {
                    return Err(CollabError::state("只有已取消的需求可以重新打开"));
                }
                conn.execute(
                    "UPDATE collab_requirements SET control_status = 'active', generation = generation + 1,
                        stage = CASE WHEN active_plan_revision = 0 THEN 'planning' ELSE 'executing' END,
                        revision = revision + 1, updated_at = ?2 WHERE id = ?1",
                    params![req.id, now],
                )?;
                conn.execute(
                    "UPDATE collab_tasks SET state = 'waiting_dependencies', revision = revision + 1, updated_at = ?2
                     WHERE requirement_id = ?1 AND active = 1 AND state = 'cancelled'",
                    params![req.id, now],
                )?;
                append_event(conn, &req.id, "requirement.reopened", json!({}), None, Some(&input.request_id))?;
            }
            other => return Err(CollabError::invalid(format!("未知控制动作：{other}"))),
        }
        super::scheduler::evaluate_requirement(conn, &req.id)?;
        request_record(conn, &input.request_id, "control_requirement", &payload_hash, &json!({ "id": req.id }))?;
        model::load_requirement(conn, &req.id)
    })
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TransferOwnerInput {
    pub request_id: String,
    pub requirement_id: String,
    pub expected_revision: Option<i64>,
    pub target_agent_id: String,
    pub owner_project_id: Option<String>,
}

pub fn transfer_owner(conn: &Connection, input: &TransferOwnerInput) -> CResult<RequirementRow> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&serde_json::to_value(input)?);
        if let Some(prev) = request_replay(conn, &input.request_id, "transfer_owner", &payload_hash)? {
            return model::load_requirement(conn, prev.get("id").and_then(Value::as_str).unwrap_or_default());
        }
        let req = model::load_requirement(conn, &input.requirement_id)?;
        if let Some(expected) = input.expected_revision {
            if expected != req.revision {
                return Err(CollabError::revision_conflict(req.revision));
            }
        }
        transfer_locked(conn, &req, input.target_agent_id.trim(), input.owner_project_id.as_deref())?;
        request_record(conn, &input.request_id, "transfer_owner", &payload_hash, &json!({ "id": req.id }))?;
        model::load_requirement(conn, &req.id)
    })
}

fn transfer_locked(conn: &Connection, req: &RequirementRow, target: &str, owner_project: Option<&str>) -> CResult<()> {
    if matches!(req.control_status.as_str(), "cancelling" | "cancelled") {
        return Err(CollabError::new(codes::REQUIREMENT_CANCELLED, "需求已取消"));
    }
    if req.owner_agent_id.as_deref() == Some(target) {
        return Err(CollabError::state("目标智能体已是主责"));
    }
    let (profile, _) = active_config(conn, target)?;
    if profile.status != "enabled" {
        return Err(CollabError::new(codes::AGENT_DISABLED, format!("「{}」未启用，不能接任主责", profile.name)));
    }
    let owner_project = owner_project.map(str::to_string).or(req.owner_project_id.clone());
    let Some(binding) = primary_binding(conn, target, owner_project.as_deref())? else {
        return Err(CollabError::new(codes::AMBIGUOUS_TARGET, "目标智能体尚未绑定仓库"));
    };
    let now = now_ms();
    // Stop the old coordinator first; the new planner is gated until that attempt has ended.
    let old_planners: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM collab_tasks WHERE requirement_id = ?1 AND kind = 'plan' AND active = 1")?;
        let rows = stmt.query_map(params![req.id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    for id in &old_planners {
        super::scheduler::request_stop_for_task(conn, id, "owner_transfer")?;
        conn.execute(
            "UPDATE collab_tasks SET active = 0, state = CASE WHEN state = 'succeeded' THEN state ELSE 'cancelled' END,
                revision = revision + 1, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
    }
    conn.execute(
        "UPDATE collab_requirements SET owner_agent_id = ?2, profile_revision = ?3, owner_project_id = ?4,
            revision = revision + 1, updated_at = ?5 WHERE id = ?1",
        params![req.id, target, profile.active_revision, owner_project, now],
    )?;
    if let Some(p) = owner_project.as_deref() {
        model::add_requirement_project(conn, &req.id, p, "owner")?;
    }
    let req2 = model::load_requirement(conn, &req.id)?;
    let action = if req.active_plan_revision > 0 { "takeover" } else { "plan" };
    let task = create_planner_task(conn, &req2, target, &binding, profile.active_revision, action)?;
    append_event(
        conn,
        &req.id,
        "requirement.owner_transferred",
        json!({ "from": req.owner_agent_id, "to": target, "plannerTaskId": task }),
        None,
        None,
    )?;
    send_message(
        conn,
        &req.id,
        NewMessage::new(
            "owner.transferred",
            json!({ "from": req.owner_agent_id, "to": target, "activePlanRevision": req.active_plan_revision }),
        )
        .to_task(&task)
        .with_id(format!("msg-transfer-{}-{task}", req.id)),
    )?;
    Ok(())
}

pub fn apply_transfer_decision(conn: &Connection, decision: &DecisionRow, input: &super::decisions::ResolveDecisionInput) -> CResult<()> {
    if input.option_id != "transfer" {
        return Ok(());
    }
    let target = input
        .values
        .get("targetAgentId")
        .and_then(Value::as_str)
        .ok_or_else(|| CollabError::invalid("移交需要 values.targetAgentId"))?;
    let req = model::load_requirement(conn, &decision.requirement_id)?;
    transfer_locked(conn, &req, target, None)
}

pub fn requirement_counts(conn: &Connection, requirement_id: &str) -> CResult<Value> {
    let mut stmt = conn.prepare(
        "SELECT state, COUNT(*) FROM collab_tasks WHERE requirement_id = ?1 AND active = 1 AND kind <> 'plan' GROUP BY state",
    )?;
    let mut by_state = serde_json::Map::new();
    let mut total = 0;
    for row in stmt.query_map(params![requirement_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (s, n) = row?;
        total += n;
        by_state.insert(s, json!(n));
    }
    let decisions: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collab_decisions WHERE requirement_id = ?1 AND state = 'open'",
        params![requirement_id],
        |r| r.get(0),
    )?;
    let changes: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collab_change_requests WHERE requirement_id = ?1 AND merged_into IS NULL
           AND state NOT IN ('closed', 'rejected', 'verified')",
        params![requirement_id],
        |r| r.get(0),
    )?;
    let running: i64 = conn.query_row(
        "SELECT COUNT(*) FROM collab_attempts WHERE requirement_id = ?1 AND state <> 'finished'",
        params![requirement_id],
        |r| r.get(0),
    )?;
    let repos: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT repository_id) FROM collab_tasks WHERE requirement_id = ?1 AND active = 1 AND kind <> 'plan'",
        params![requirement_id],
        |r| r.get(0),
    )?;
    Ok(json!({
        "tasks": total,
        "byState": by_state,
        "openDecisions": decisions,
        "openChanges": changes,
        "activeAttempts": running,
        "repositories": repos,
    }))
}

pub fn list_summaries(conn: &Connection, project_id: Option<&str>, include_done: bool) -> CResult<Vec<Value>> {
    let rows = model::list_requirements(conn, project_id, include_done)?;
    let mut out = Vec::new();
    for r in rows {
        let counts = requirement_counts(conn, &r.id)?;
        let projects: Vec<Value> = model::requirement_projects(conn, &r.id)?
            .into_iter()
            .map(|(p, resp)| json!({ "projectId": p, "responsibility": resp }))
            .collect();
        let mut v = serde_json::to_value(&r)?;
        v["counts"] = counts;
        v["projects"] = json!(projects);
        out.push(v);
    }
    Ok(out)
}

pub fn requirement_for_session(conn: &Connection, session_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT requirement_id, relation FROM collab_requirement_sessions WHERE session_id = ?1 ORDER BY created_at DESC",
    )?;
    let pairs: Vec<(String, String)> = stmt
        .query_map(params![session_id.trim()], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut out = Vec::new();
    for (id, relation) in pairs {
        let req = model::load_requirement(conn, &id)?;
        let counts = requirement_counts(conn, &id)?;
        let attempt: Option<Value> = conn
            .query_row(
                "SELECT a.id, a.task_id, t.title, t.task_key, a.state FROM collab_attempts a JOIN collab_tasks t ON t.id = a.task_id
                 WHERE a.session_id = ?1 AND a.requirement_id = ?2 ORDER BY a.created_at DESC LIMIT 1",
                params![session_id.trim(), id],
                |r| {
                    Ok(json!({
                        "attemptId": r.get::<_, String>(0)?,
                        "taskId": r.get::<_, String>(1)?,
                        "taskTitle": r.get::<_, String>(2)?,
                        "taskKey": r.get::<_, String>(3)?,
                        "state": r.get::<_, String>(4)?,
                    }))
                },
            )
            .optional()?;
        out.push(json!({ "relation": relation, "requirement": req, "counts": counts, "attempt": attempt }));
    }
    Ok(out)
}

/// Everything the detail view needs, plus the event cursor for incremental refresh.
pub fn snapshot(conn: &Connection, requirement_id: &str) -> CResult<Value> {
    let req = model::load_requirement(conn, requirement_id)?;
    let tasks = model::list_tasks(conn, requirement_id, false)?;
    let deps = model::list_dependencies(conn, requirement_id, req.active_plan_revision)?;
    let attempts = model::list_attempts_for_requirement(conn, requirement_id)?;
    let mut checkpoints = Vec::new();
    for t in tasks.iter().filter(|t| t.active) {
        if let Some(cp) = t.checkpoint_id.as_deref() {
            if let Some(row) = model::load_checkpoint(conn, cp)? {
                checkpoints.push(row);
            }
        }
    }
    let cursor: i64 = conn.query_row(
        "SELECT COALESCE(MAX(aggregate_seq), 0) FROM collab_events WHERE requirement_id = ?1",
        params![requirement_id],
        |r| r.get(0),
    )?;
    let revisions: Vec<Value> = {
        let mut stmt = conn.prepare(
            "SELECT revision, kind, input, state, created_at FROM collab_requirement_revisions WHERE requirement_id = ?1 ORDER BY revision ASC",
        )?;
        let rows = stmt
            .query_map(params![requirement_id], |r| {
                Ok(json!({
                    "revision": r.get::<_, i64>(0)?,
                    "kind": r.get::<_, String>(1)?,
                    "input": r.get::<_, String>(2)?,
                    "state": r.get::<_, String>(3)?,
                    "createdAt": r.get::<_, i64>(4)?,
                }))
            })?
            .collect::<Result<_, _>>()?;
        rows
    };
    let consumers: Vec<Value> = {
        let mut stmt = conn.prepare(
            "SELECT c.task_id, c.artifact_version_id, c.operations_json, c.verification, c.impact, c.updated_at
             FROM collab_artifact_consumers c JOIN collab_tasks t ON t.id = c.task_id WHERE t.requirement_id = ?1",
        )?;
        let rows = stmt
            .query_map(params![requirement_id], |r| {
                Ok(json!({
                    "taskId": r.get::<_, String>(0)?,
                    "artifactVersionId": r.get::<_, String>(1)?,
                    "operations": super::util::parse_value(&r.get::<_, String>(2)?),
                    "verification": r.get::<_, String>(3)?,
                    "impact": r.get::<_, String>(4)?,
                    "updatedAt": r.get::<_, i64>(5)?,
                }))
            })?
            .collect::<Result<_, _>>()?;
        rows
    };
    Ok(json!({
        "requirement": req,
        "projects": model::requirement_projects(conn, requirement_id)?
            .into_iter()
            .map(|(p, r)| json!({ "projectId": p, "responsibility": r }))
            .collect::<Vec<_>>(),
        "sessions": model::requirement_sessions(conn, requirement_id)?,
        "revisions": revisions,
        "plans": super::plans::list_plan_revisions(conn, requirement_id)?,
        "impacts": super::plans::list_impacts(conn, requirement_id)?,
        "tasks": tasks,
        "dependencies": deps,
        "attempts": attempts,
        "checkpoints": checkpoints,
        "artifacts": model::list_artifact_versions(conn, requirement_id)?,
        "artifactConsumers": consumers,
        "verificationRuns": super::verification::list_runs(conn, requirement_id)?,
        "changes": model::list_changes(conn, requirement_id)?,
        "decisions": model::list_decisions(conn, requirement_id, false)?,
        "messages": super::events::list_messages(conn, requirement_id, None, None, 200)?,
        "acceptance": super::acceptance::current_manifest(conn, requirement_id)?,
        "runtimeResources": super::runtime_resources::list_for_requirement(conn, requirement_id)?,
        "resources": super::resources::resources_for_requirement(conn, requirement_id)?,
        "usage": super::usage::summary(conn, requirement_id)?,
        "explanation": super::scheduler::explain_requirement(conn, requirement_id)?,
        "counts": requirement_counts(conn, requirement_id)?,
        "eventCursor": cursor,
    }))
}
