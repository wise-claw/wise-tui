//! 协作计划发布：结构 / 授权 / 委派 / DAG 校验，按影响生成沿用 / 重做 / 新增 / 取消清单。
//!
//! 需要审批或越权扩展仓库范围时只保存为 proposed 计划并建决策；否则事务内激活。

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::decisions::{self, OpenDecision};
use super::error::{codes, CResult, CollabError};
use super::events::{append_event, send_message, NewMessage};
use super::model::{self, DecisionRow, RequirementRow};
use super::util::{hash_json, new_id, now_ms, request_record, request_replay, tx};
use super::RepoDirectory;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanOutput {
    pub artifact: String,
    pub kind: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanTask {
    pub key: String,
    pub title: String,
    pub repository_id: Option<i64>,
    pub project_id: Option<String>,
    pub role: String,
    pub kind: String,
    pub executor_agent_id: Option<String>,
    pub goal: String,
    pub acceptance: Vec<String>,
    pub inputs: Vec<Value>,
    pub outputs: Vec<PlanOutput>,
    pub verification: Value,
    pub notes: String,
    pub runtime_target: Option<String>,
    pub priority: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanDependency {
    pub task: String,
    pub producer: String,
    pub gate: String,
    pub artifact: Option<String>,
    pub required_version: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScopeRequest {
    pub repository_id: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanInput {
    pub request_id: String,
    pub expected_revision: Option<i64>,
    pub collaboration_mode: Option<String>,
    pub summary: String,
    pub rationale: Value,
    pub tasks: Vec<PlanTask>,
    pub dependencies: Vec<PlanDependency>,
    pub scope_requests: Vec<ScopeRequest>,
}

/// Who publishes: an attempt (owner planner) or the user from the UI.
#[derive(Debug, Clone, Default)]
pub struct PlanSource {
    pub attempt_id: Option<String>,
    pub task_id: Option<String>,
    pub by_user: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanImpact {
    pub task_key: String,
    pub task_id: Option<String>,
    pub action: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanPublishResult {
    pub requirement_id: String,
    pub plan_revision: i64,
    pub state: String,
    pub impacts: Vec<PlanImpact>,
    pub decision_id: Option<String>,
    pub warnings: Vec<String>,
}

fn normalize_kind(kind: &str) -> &'static str {
    match kind.trim() {
        "qa" => "qa",
        "env" => "env",
        _ => "implement",
    }
}

fn normalize_gate(gate: &str) -> &'static str {
    match gate.trim() {
        "task_succeeded" => "task_succeeded",
        "contract_available" => "contract_available",
        _ => "artifact_ready",
    }
}

/// Repositories the requirement may touch: participant projects + authorized extra scope.
pub fn authorized_repositories(conn: &Connection, req: &RequirementRow) -> CResult<HashSet<i64>> {
    let mut out: HashSet<i64> = req.extra_scope.iter().copied().collect();
    let mut projects: Vec<String> = model::requirement_projects(conn, &req.id)?.into_iter().map(|(p, _)| p).collect();
    if let Some(owner) = req.owner_project_id.as_deref() {
        if !projects.iter().any(|p| p == owner) {
            projects.push(owner.to_string());
        }
    }
    for p in projects {
        let mut stmt = conn.prepare("SELECT repository_id FROM project_repositories WHERE project_id = ?1")?;
        let ids: Vec<i64> = stmt.query_map(params![p], |r| r.get(0))?.collect::<Result<_, _>>()?;
        out.extend(ids);
    }
    if let Some(agent) = req.owner_agent_id.as_deref() {
        for b in super::agents::list_bindings(conn, agent, false)? {
            if projects_contains(conn, req, &b.project_id)? {
                out.insert(b.repository_id);
            }
        }
    }
    Ok(out)
}

fn projects_contains(conn: &Connection, req: &RequirementRow, project_id: &str) -> CResult<bool> {
    if req.owner_project_id.as_deref() == Some(project_id) {
        return Ok(true);
    }
    Ok(model::requirement_projects(conn, &req.id)?.iter().any(|(p, _)| p == project_id))
}

fn project_for_repository(conn: &Connection, req: &RequirementRow, repository_id: i64) -> CResult<Option<String>> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(owner) = req.owner_project_id.as_deref() {
        candidates.push(owner.to_string());
    }
    for (p, _) in model::requirement_projects(conn, &req.id)? {
        if !candidates.contains(&p) {
            candidates.push(p);
        }
    }
    for p in &candidates {
        if super::agents::repository_in_project(conn, p, repository_id)? {
            return Ok(Some(p.clone()));
        }
    }
    Ok(conn
        .query_row(
            "SELECT project_id FROM project_repositories WHERE repository_id = ?1 ORDER BY display_order ASC LIMIT 1",
            params![repository_id],
            |r| r.get(0),
        )
        .optional()?)
}

fn task_spec(t: &PlanTask) -> Value {
    json!({
        "goal": t.goal.trim(),
        "acceptance": t.acceptance,
        "inputs": t.inputs,
        "outputs": t.outputs,
        "verification": t.verification,
        "notes": t.notes.trim(),
        "role": t.role.trim(),
    })
}

struct ResolvedTask {
    plan: PlanTask,
    kind: &'static str,
    project_id: Option<String>,
    executor: Option<String>,
    profile_revision: Option<i64>,
    delegation_depth: i64,
    spec: Value,
    spec_hash: String,
    dep_signature: String,
}

struct Validated {
    tasks: Vec<ResolvedTask>,
    deps: Vec<PlanDependency>,
    mode: String,
    scope_expansion: Vec<ScopeRequest>,
    warnings: Vec<String>,
}

fn validate(conn: &Connection, req: &RequirementRow, input: &PlanInput, repos: &RepoDirectory, source: &PlanSource) -> CResult<Validated> {
    let invalid = |msg: String| CollabError::new(codes::INVALID_PLAN, msg);
    if input.tasks.is_empty() {
        return Err(invalid("计划至少包含一个仓库任务".into()));
    }
    if input.tasks.len() > 50 {
        return Err(invalid("单个计划最多 50 个任务".into()));
    }
    let mode = match input.collaboration_mode.as_deref().map(str::trim) {
        Some("contract_parallel") => "contract_parallel".to_string(),
        Some("serial") => "serial".to_string(),
        _ => req.collaboration_mode.clone(),
    };

    // Single-level delegation: a delegated executor cannot publish plans that delegate further.
    if let Some(task_id) = source.task_id.as_deref() {
        let src = model::load_task(conn, task_id)?;
        if src.delegation_depth >= 1 || src.kind != "plan" {
            return Err(CollabError::new(
                codes::FORBIDDEN,
                "只有需求主责智能体的规划任务可以发布计划；被委派的执行者不能再委派",
            ));
        }
    }

    let authorized = authorized_repositories(conn, req)?;
    let owner_agent = req.owner_agent_id.clone();
    let delegation_allowed: Vec<String> = match owner_agent.as_deref() {
        Some(agent) => {
            let profile = super::agents::get_agent(conn, agent)?;
            if profile.active_revision > 0 {
                super::agents::get_revision(conn, agent, profile.active_revision)?
                    .config
                    .delegation_policy
                    .allowed_executor_agent_ids
            } else {
                Vec::new()
            }
        }
        None => Vec::new(),
    };
    let scope_ids: HashSet<i64> = input.scope_requests.iter().map(|s| s.repository_id).collect();
    let mut scope_expansion: Vec<ScopeRequest> = Vec::new();
    let mut warnings = Vec::new();
    let mut keys: HashSet<String> = HashSet::new();
    let mut tasks: Vec<ResolvedTask> = Vec::new();
    for t in &input.tasks {
        let key = t.key.trim().to_string();
        if key.is_empty() || key.len() > 64 {
            return Err(invalid("任务 key 不能为空且不超过 64 字符".into()));
        }
        if !keys.insert(key.clone()) {
            return Err(invalid(format!("任务 key 重复：{key}")));
        }
        if t.title.trim().is_empty() {
            return Err(invalid(format!("任务 {key} 缺少标题")));
        }
        let Some(repo_id) = t.repository_id else {
            return Err(CollabError::new(codes::AMBIGUOUS_TARGET, format!("任务 {key} 未指定目标仓库")).with_tasks(vec![key]));
        };
        if !repos.contains_key(&repo_id) {
            return Err(CollabError::new(codes::AMBIGUOUS_TARGET, format!("任务 {key} 的仓库 #{repo_id} 不在 Wise 仓库列表中")));
        }
        if !authorized.contains(&repo_id) {
            if scope_ids.contains(&repo_id) || source.by_user {
                if !scope_expansion.iter().any(|s| s.repository_id == repo_id) {
                    let reason = input
                        .scope_requests
                        .iter()
                        .find(|s| s.repository_id == repo_id)
                        .map(|s| s.reason.clone())
                        .unwrap_or_default();
                    scope_expansion.push(ScopeRequest { repository_id: repo_id, reason });
                }
            } else {
                return Err(CollabError::new(
                    codes::SCOPE_NOT_AUTHORIZED,
                    format!("任务 {key} 的仓库「{}」不在需求授权范围内；如确需修改请在 scopeRequests 中说明理由", repos[&repo_id].name),
                )
                .with_tasks(vec![key]));
            }
        }
        for o in &t.outputs {
            if o.artifact.trim().is_empty() {
                return Err(invalid(format!("任务 {key} 的输出缺少 artifact 名称")));
            }
        }
        let project_id = match t.project_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(p) => Some(p.to_string()),
            None => project_for_repository(conn, req, repo_id)?,
        };
        let requested = t.executor_agent_id.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let owner_bound = match owner_agent.as_deref() {
            Some(owner) => super::agents::find_binding(conn, owner, project_id.as_deref(), repo_id)?.is_some(),
            None => false,
        };
        let executor = match requested {
            Some(agent) => Some(agent),
            None if owner_bound => owner_agent.clone(),
            None => match project_id.as_deref() {
                Some(p) => super::agents::default_agent_for(conn, p, repo_id)?,
                None => None,
            },
        };
        let mut delegation_depth = 0;
        let mut profile_revision = None;
        if let Some(agent) = executor.as_deref() {
            if super::agents::find_binding(conn, agent, project_id.as_deref(), repo_id)?.is_none() {
                return Err(CollabError::new(
                    codes::SCOPE_NOT_AUTHORIZED,
                    format!("任务 {key} 的执行智能体未绑定仓库 #{repo_id}"),
                ));
            }
            if owner_agent.as_deref().is_some_and(|o| o != agent) {
                if !delegation_allowed.iter().any(|a| a == agent) {
                    return Err(CollabError::new(
                        codes::INVALID_PLAN,
                        format!("任务 {key} 委派给的智能体不在主责智能体的委派策略中"),
                    ));
                }
                delegation_depth = 1;
            }
            let profile = super::agents::get_agent(conn, agent)?;
            if profile.status != "enabled" {
                warnings.push(format!("任务 {key} 的执行智能体「{}」当前未启用，启用前不会开始", profile.name));
            }
            profile_revision = Some(profile.active_revision).filter(|r| *r > 0);
        } else {
            warnings.push(format!("任务 {key} 的仓库没有绑定可用智能体，将以普通会话执行"));
        }
        let spec = task_spec(t);
        let spec_hash = hash_json(&json!({ "spec": spec, "repo": repo_id, "executor": executor, "kind": normalize_kind(&t.kind) }));
        tasks.push(ResolvedTask {
            plan: PlanTask { key: key.clone(), ..t.clone() },
            kind: normalize_kind(&t.kind),
            project_id,
            executor,
            profile_revision,
            delegation_depth,
            spec,
            spec_hash,
            dep_signature: String::new(),
        });
    }

    let mut deps: Vec<PlanDependency> = Vec::new();
    let mut seen_edges: HashSet<(String, String, String)> = HashSet::new();
    for d in &input.dependencies {
        let task = d.task.trim().to_string();
        let producer = d.producer.trim().to_string();
        if !keys.contains(&task) || !keys.contains(&producer) {
            return Err(invalid(format!("依赖引用了不存在的任务：{task} ← {producer}")));
        }
        if task == producer {
            return Err(invalid(format!("任务 {task} 不能依赖自身")));
        }
        let gate = normalize_gate(&d.gate);
        if gate == "contract_available" && mode != "contract_parallel" {
            return Err(invalid("contract_available 依赖仅在“契约并行”协作方式下可用".into()));
        }
        let artifact = d.artifact.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        if let Some(name) = artifact.as_deref() {
            let producer_task = tasks.iter().find(|t| t.plan.key == producer).expect("producer exists");
            if !producer_task.plan.outputs.iter().any(|o| o.artifact.trim() == name) {
                return Err(invalid(format!("依赖 {task} ← {producer} 引用的交付包 {name} 不是生产任务声明的输出")));
            }
        }
        if seen_edges.insert((task.clone(), producer.clone(), gate.to_string())) {
            deps.push(PlanDependency {
                task,
                producer,
                gate: gate.into(),
                artifact,
                required_version: d.required_version,
            });
        }
    }
    // Kahn topological sort rejects cycles.
    let mut indegree: HashMap<&str, usize> = tasks.iter().map(|t| (t.plan.key.as_str(), 0)).collect();
    let mut edges: HashMap<&str, Vec<&str>> = HashMap::new();
    for d in &deps {
        *indegree.get_mut(d.task.as_str()).expect("task") += 1;
        edges.entry(d.producer.as_str()).or_default().push(d.task.as_str());
    }
    let mut queue: VecDeque<&str> = indegree.iter().filter(|(_, n)| **n == 0).map(|(k, _)| *k).collect();
    let mut visited = 0;
    while let Some(k) = queue.pop_front() {
        visited += 1;
        for next in edges.get(k).cloned().unwrap_or_default() {
            let n = indegree.get_mut(next).expect("next");
            *n -= 1;
            if *n == 0 {
                queue.push_back(next);
            }
        }
    }
    if visited != tasks.len() {
        let cyclic: Vec<String> = indegree.iter().filter(|(_, n)| **n > 0).map(|(k, _)| k.to_string()).collect();
        return Err(invalid(format!("任务依赖存在循环：{}", cyclic.join(", "))).with_tasks(cyclic));
    }
    for t in tasks.iter_mut() {
        let mut sig: Vec<String> = deps
            .iter()
            .filter(|d| d.task == t.plan.key)
            .map(|d| format!("{}|{}|{}|{:?}", d.producer, d.gate, d.artifact.clone().unwrap_or_default(), d.required_version))
            .collect();
        sig.sort();
        t.dep_signature = sig.join(";");
    }
    Ok(Validated { tasks, deps, mode, scope_expansion, warnings })
}

fn dep_signature_of_existing(conn: &Connection, task_id: &str) -> CResult<String> {
    let mut stmt = conn.prepare(
        "SELECT p.task_key, d.gate_kind, COALESCE(d.artifact_selector, ''), d.required_version
         FROM collab_dependencies d JOIN collab_tasks p ON p.id = d.producer_task_id WHERE d.task_id = ?1",
    )?;
    let mut sig: Vec<String> = stmt
        .query_map(params![task_id], |r| {
            Ok(format!(
                "{}|{}|{}|{:?}",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<i64>>(3)?
            ))
        })?
        .collect::<Result<_, _>>()?;
    sig.sort();
    Ok(sig.join(";"))
}

fn compute_impacts(conn: &Connection, req: &RequirementRow, v: &Validated) -> CResult<Vec<PlanImpact>> {
    let existing: BTreeMap<String, model::TaskRow> = model::list_tasks(conn, &req.id, true)?
        .into_iter()
        .filter(|t| t.kind != "plan" && t.kind != "repair")
        .map(|t| (t.task_key.clone(), t))
        .collect();
    let mut out = Vec::new();
    for t in &v.tasks {
        match existing.get(&t.plan.key) {
            None => out.push(PlanImpact { task_key: t.plan.key.clone(), task_id: None, action: "add".into(), reason: "新增任务".into() }),
            Some(old) => {
                let same_spec = old.spec_hash == t.spec_hash;
                let same_deps = dep_signature_of_existing(conn, &old.id)? == t.dep_signature;
                let reusable_result = old.state != "failed" && old.state != "cancelled";
                if same_spec && same_deps && reusable_result {
                    out.push(PlanImpact {
                        task_key: t.plan.key.clone(),
                        task_id: Some(old.id.clone()),
                        action: "keep".into(),
                        reason: "任务规格与输入未变化，沿用原结果与进度".into(),
                    });
                } else {
                    let reason = if !same_spec { "任务规格变化" } else if !same_deps { "输入依赖变化" } else { "原结果不可沿用" };
                    out.push(PlanImpact {
                        task_key: t.plan.key.clone(),
                        task_id: Some(old.id.clone()),
                        action: "redo".into(),
                        reason: reason.into(),
                    });
                }
            }
        }
    }
    for (key, old) in &existing {
        if !v.tasks.iter().any(|t| &t.plan.key == key) {
            out.push(PlanImpact {
                task_key: key.clone(),
                task_id: Some(old.id.clone()),
                action: "cancel".into(),
                reason: "新计划不再包含该任务".into(),
            });
        }
    }
    Ok(out)
}

pub fn publish_plan(
    conn: &Connection,
    requirement_id: &str,
    input: &PlanInput,
    source: &PlanSource,
    repos: &RepoDirectory,
) -> CResult<PlanPublishResult> {
    tx(conn, |conn| {
        let payload_hash = hash_json(&serde_json::to_value(input)?);
        if let Some(prev) = request_replay(conn, &input.request_id, "publish_plan", &payload_hash)? {
            return Ok(serde_json::from_value(prev.clone()).unwrap_or_else(|_| PlanPublishResult {
                requirement_id: requirement_id.to_string(),
                plan_revision: prev.get("planRevision").and_then(Value::as_i64).unwrap_or(0),
                state: prev.get("state").and_then(Value::as_str).unwrap_or("").to_string(),
                impacts: Vec::new(),
                decision_id: None,
                warnings: Vec::new(),
            }));
        }
        let req = model::load_requirement(conn, requirement_id)?;
        if matches!(req.control_status.as_str(), "cancelling" | "cancelled") {
            return Err(CollabError::new(codes::REQUIREMENT_CANCELLED, "需求已取消，不能发布计划"));
        }
        if let Some(expected) = input.expected_revision {
            if expected != req.revision {
                return Err(CollabError::revision_conflict(req.revision));
            }
        }
        let v = validate(conn, &req, input, repos, source)?;
        let impacts = compute_impacts(conn, &req, &v)?;
        let revision: i64 = conn.query_row(
            "SELECT COALESCE(MAX(revision), 0) + 1 FROM collab_plan_revisions WHERE requirement_id = ?1",
            params![req.id],
            |r| r.get(0),
        )?;
        let now = now_ms();
        // A plan edited by the user is itself the approval, including any scope it adds.
        let needs_approval = !source.by_user && (req.plan_approval_required || !v.scope_expansion.is_empty());
        let plan_json = json!({
            "summary": input.summary,
            "collaborationMode": v.mode,
            "tasks": v.tasks.iter().map(|t| json!({
                "key": t.plan.key, "title": t.plan.title.trim(), "repositoryId": t.plan.repository_id,
                "projectId": t.project_id, "role": t.plan.role, "kind": t.kind, "executorAgentId": t.executor,
                "spec": t.spec, "specHash": t.spec_hash, "delegationDepth": t.delegation_depth,
                "profileRevision": t.profile_revision, "runtimeTarget": t.plan.runtime_target, "priority": t.plan.priority,
            })).collect::<Vec<_>>(),
            "dependencies": v.deps,
            "scopeRequests": v.scope_expansion,
            "warnings": v.warnings,
        });
        let kind = if req.active_plan_revision == 0 { "initial" } else if req.requirement_revision > 1 { "revision" } else { "replan" };
        conn.execute(
            "INSERT INTO collab_plan_revisions (requirement_id, revision, plan_json, rationale_json, state, revision_kind, created_by_attempt_id, created_at)
             VALUES (?1, ?2, ?3, ?4, 'proposed', ?5, ?6, ?7)",
            params![
                req.id,
                revision,
                plan_json.to_string(),
                if input.rationale.is_null() { "{}".to_string() } else { input.rationale.to_string() },
                kind,
                source.attempt_id,
                now
            ],
        )?;
        for i in &impacts {
            conn.execute(
                "INSERT INTO collab_revision_impacts (id, requirement_id, from_plan_revision, to_plan_revision, requirement_revision,
                    task_key, task_id, action, reason, input_hash, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    new_id("imp"),
                    req.id,
                    req.active_plan_revision,
                    revision,
                    req.requirement_revision,
                    i.task_key,
                    i.task_id,
                    i.action,
                    i.reason,
                    payload_hash,
                    now
                ],
            )?;
        }
        append_event(
            conn,
            &req.id,
            "plan.proposed",
            json!({ "planRevision": revision, "impacts": impacts, "needsApproval": needs_approval }),
            source.task_id.as_deref(),
            source.attempt_id.as_deref(),
        )?;
        let mut decision_id = None;
        let state = if needs_approval {
            let (kind, title, options) = if !v.scope_expansion.is_empty() {
                (
                    "scope_expansion",
                    format!("计划 v{revision} 请求扩展到未授权仓库，需要确认"),
                    json!([{ "id": "approve", "label": "授权并采用计划" }, { "id": "reject", "label": "拒绝，按原范围重新规划" }]),
                )
            } else {
                (
                    "plan_approval",
                    format!("计划 v{revision} 待审批"),
                    json!([{ "id": "approve", "label": "采用计划" }, { "id": "reject", "label": "退回重新规划" }]),
                )
            };
            let d = decisions::open(
                conn,
                OpenDecision {
                    requirement_id: req.id.clone(),
                    kind: kind.into(),
                    dedupe_key: format!("plan:{revision}"),
                    title,
                    task_ids: vec![],
                    blocked_ops: vec!["plan_activation".into()],
                    evidence: json!({ "planRevision": revision, "impacts": impacts, "scopeRequests": v.scope_expansion, "summary": input.summary }),
                    options,
                },
            )?;
            decision_id = Some(d.id);
            "proposed"
        } else {
            if source.by_user && !v.scope_expansion.is_empty() {
                grant_scope(conn, &req.id, &serde_json::to_value(&v.scope_expansion)?)?;
            }
            activate_plan(conn, &req.id, revision)?;
            "active"
        };
        let result = PlanPublishResult {
            requirement_id: req.id.clone(),
            plan_revision: revision,
            state: state.into(),
            impacts,
            decision_id,
            warnings: v.warnings.clone(),
        };
        request_record(conn, &input.request_id, "publish_plan", &payload_hash, &serde_json::to_value(&result)?)?;
        Ok(result)
    })
}

/// Applies a stored plan revision: keep / redo / add / cancel tasks and rewire dependencies.
pub fn activate_plan(conn: &Connection, requirement_id: &str, revision: i64) -> CResult<()> {
    let req = model::load_requirement(conn, requirement_id)?;
    let (plan_raw, state): (String, String) = conn
        .query_row(
            "SELECT plan_json, state FROM collab_plan_revisions WHERE requirement_id = ?1 AND revision = ?2",
            params![req.id, revision],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| CollabError::not_found("计划版本", &revision.to_string()))?;
    if state != "proposed" {
        return Err(CollabError::state(format!("计划 v{revision} 当前为 {state}，不能激活")));
    }
    let plan: Value = serde_json::from_str(&plan_raw)?;
    let now = now_ms();
    let tasks = plan.get("tasks").and_then(Value::as_array).cloned().unwrap_or_default();
    let deps: Vec<PlanDependency> = serde_json::from_value(plan.get("dependencies").cloned().unwrap_or(json!([])))?;
    let mode = plan.get("collaborationMode").and_then(Value::as_str).unwrap_or("serial").to_string();

    let existing: BTreeMap<String, model::TaskRow> = model::list_tasks(conn, &req.id, true)?
        .into_iter()
        .filter(|t| t.kind != "plan" && t.kind != "repair")
        .map(|t| (t.task_key.clone(), t))
        .collect();
    let mut key_to_id: HashMap<String, String> = HashMap::new();
    let mut impacts: Vec<PlanImpact> = Vec::new();
    for t in &tasks {
        let key = t.get("key").and_then(Value::as_str).unwrap_or_default().to_string();
        let spec_hash = t.get("specHash").and_then(Value::as_str).unwrap_or_default().to_string();
        let old = existing.get(&key);
        let new_sig = {
            let mut sig: Vec<String> = deps
                .iter()
                .filter(|d| d.task == key)
                .map(|d| format!("{}|{}|{}|{:?}", d.producer, d.gate, d.artifact.clone().unwrap_or_default(), d.required_version))
                .collect();
            sig.sort();
            sig.join(";")
        };
        if let Some(old) = old {
            let keep = old.spec_hash == spec_hash
                && dep_signature_of_existing(conn, &old.id)? == new_sig
                && old.state != "failed"
                && old.state != "cancelled";
            if keep {
                conn.execute(
                    "UPDATE collab_tasks SET plan_revision = ?2, updated_at = ?3 WHERE id = ?1",
                    params![old.id, revision, now],
                )?;
                key_to_id.insert(key.clone(), old.id.clone());
                impacts.push(PlanImpact { task_key: key, task_id: Some(old.id.clone()), action: "keep".into(), reason: String::new() });
                continue;
            }
        }
        let id = new_id("task");
        let spec_revision = old.map(|o| o.spec_revision + 1).unwrap_or(1);
        conn.execute(
            "INSERT INTO collab_tasks (
                id, requirement_id, plan_revision, task_key, title, project_id, repository_id, role, kind, state, active,
                spec_revision, spec_json, spec_hash, executor_agent_id, profile_revision, delegation_depth, runtime_target,
                attempt_budget, next_action, priority, queued_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'waiting_dependencies', 1, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'start', ?18, ?19, ?19, ?19)",
            params![
                id,
                req.id,
                revision,
                key,
                t.get("title").and_then(Value::as_str).unwrap_or(&key),
                t.get("projectId").and_then(Value::as_str),
                t.get("repositoryId").and_then(Value::as_i64),
                t.get("role").and_then(Value::as_str).unwrap_or(""),
                t.get("kind").and_then(Value::as_str).unwrap_or("implement"),
                spec_revision,
                t.get("spec").cloned().unwrap_or(json!({})).to_string(),
                spec_hash,
                t.get("executorAgentId").and_then(Value::as_str),
                t.get("profileRevision").and_then(Value::as_i64),
                t.get("delegationDepth").and_then(Value::as_i64).unwrap_or(0),
                t.get("runtimeTarget").and_then(Value::as_str).unwrap_or("local"),
                req.execution_attempt_budget,
                t.get("priority").and_then(Value::as_i64).unwrap_or(0),
                now
            ],
        )?;
        if let Some(old) = old {
            supersede_task(conn, old, &id, "新计划重做该任务")?;
            // Redo continues from the old checkpoint when one exists.
            if let Some(cp) = old.checkpoint_id.as_deref() {
                conn.execute(
                    "UPDATE collab_tasks SET checkpoint_id = ?2, next_action = 'resume' WHERE id = ?1",
                    params![id, cp],
                )?;
            }
            impacts.push(PlanImpact { task_key: key.clone(), task_id: Some(id.clone()), action: "redo".into(), reason: String::new() });
        } else {
            impacts.push(PlanImpact { task_key: key.clone(), task_id: Some(id.clone()), action: "add".into(), reason: String::new() });
        }
        key_to_id.insert(key, id);
    }
    for (key, old) in &existing {
        if !key_to_id.contains_key(key) {
            supersede_task(conn, old, "", "新计划取消该任务")?;
            impacts.push(PlanImpact { task_key: key.clone(), task_id: Some(old.id.clone()), action: "cancel".into(), reason: String::new() });
        }
    }
    for d in &deps {
        let (Some(task_id), Some(producer_id)) = (key_to_id.get(&d.task), key_to_id.get(&d.producer)) else {
            continue;
        };
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM collab_dependencies WHERE task_id = ?1 AND producer_task_id = ?2 AND gate_kind = ?3
               AND COALESCE(artifact_selector, '') = COALESCE(?4, '')",
            params![task_id, producer_id, d.gate, d.artifact],
            |r| r.get(0),
        )?;
        if exists > 0 {
            conn.execute(
                "UPDATE collab_dependencies SET plan_revision = ?3 WHERE task_id = ?1 AND producer_task_id = ?2",
                params![task_id, producer_id, revision],
            )?;
            continue;
        }
        conn.execute(
            "INSERT INTO collab_dependencies (id, requirement_id, plan_revision, task_id, producer_task_id, gate_kind,
                artifact_selector, required_version, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![new_id("dep"), req.id, revision, task_id, producer_id, d.gate, d.artifact, d.required_version, now],
        )?;
    }
    conn.execute(
        "UPDATE collab_plan_revisions SET state = 'superseded' WHERE requirement_id = ?1 AND state = 'active'",
        params![req.id],
    )?;
    conn.execute(
        "UPDATE collab_plan_revisions SET state = 'active', activated_at = ?3 WHERE requirement_id = ?1 AND revision = ?2",
        params![req.id, revision, now],
    )?;
    conn.execute(
        "UPDATE collab_requirements SET active_plan_revision = ?2, collaboration_mode = ?3, stage = 'executing',
            revision = revision + 1, updated_at = ?4 WHERE id = ?1",
        params![req.id, revision, mode, now],
    )?;
    // Every participating project becomes visible on the requirement.
    for t in &tasks {
        if let Some(p) = t.get("projectId").and_then(Value::as_str) {
            if req.owner_project_id.as_deref() != Some(p) {
                model::add_requirement_project(conn, &req.id, p, "participant")?;
            }
        }
    }
    append_event(conn, &req.id, "plan.activated", json!({ "planRevision": revision, "impacts": impacts }), None, None)?;
    for (key, id) in &key_to_id {
        if impacts.iter().any(|i| &i.task_key == key && i.action != "keep") {
            send_message(
                conn,
                &req.id,
                NewMessage::new("task.planned", json!({ "planRevision": revision, "taskKey": key }))
                    .to_task(id)
                    .with_id(format!("msg-plan-{}-{revision}-{key}", req.id)),
            )?;
        }
    }
    decisions::cancel_matching(conn, &req.id, "plan:")?;
    super::scheduler::evaluate_requirement(conn, &req.id)?;
    Ok(())
}

/// Old spec leaves the active plan; a running attempt stops at its next checkpoint.
fn supersede_task(conn: &Connection, old: &model::TaskRow, new_id: &str, reason: &str) -> CResult<()> {
    let now = now_ms();
    super::scheduler::request_stop_for_task(conn, &old.id, "plan_revised")?;
    conn.execute(
        "UPDATE collab_tasks SET active = 0, superseded_by = NULLIF(?2, ''),
            state = CASE WHEN state IN ('succeeded') THEN state ELSE 'cancelled' END,
            revision = revision + 1, updated_at = ?3 WHERE id = ?1",
        params![old.id, new_id, now],
    )?;
    append_event(
        conn,
        &old.requirement_id,
        "task.superseded",
        json!({ "taskId": old.id, "supersededBy": new_id, "reason": reason }),
        Some(&old.id),
        None,
    )?;
    Ok(())
}

fn grant_scope(conn: &Connection, requirement_id: &str, scope_requests: &Value) -> CResult<()> {
    let req = model::load_requirement(conn, requirement_id)?;
    let mut scope = req.extra_scope.clone();
    for s in scope_requests.as_array().into_iter().flatten() {
        if let Some(id) = s.get("repositoryId").and_then(Value::as_i64) {
            if !scope.contains(&id) {
                scope.push(id);
            }
        }
    }
    conn.execute(
        "UPDATE collab_requirements SET extra_scope_json = ?2, updated_at = ?3 WHERE id = ?1",
        params![req.id, json!(scope).to_string(), now_ms()],
    )?;
    Ok(())
}

pub fn apply_decision(conn: &Connection, decision: &DecisionRow, input: &super::decisions::ResolveDecisionInput) -> CResult<()> {
    let revision = decision.evidence.get("planRevision").and_then(Value::as_i64).unwrap_or(0);
    let now = now_ms();
    match input.option_id.as_str() {
        "approve" => {
            if decision.kind == "scope_expansion" {
                grant_scope(conn, &decision.requirement_id, decision.evidence.get("scopeRequests").unwrap_or(&Value::Null))?;
            }
            activate_plan(conn, &decision.requirement_id, revision)?;
        }
        _ => {
            conn.execute(
                "UPDATE collab_plan_revisions SET state = 'rejected' WHERE requirement_id = ?1 AND revision = ?2 AND state = 'proposed'",
                params![decision.requirement_id, revision],
            )?;
            // The planner re-plans with the rejection note in its inbox.
            let planner: Option<String> = conn
                .query_row(
                    "SELECT id FROM collab_tasks WHERE requirement_id = ?1 AND kind = 'plan' AND active = 1 ORDER BY created_at DESC LIMIT 1",
                    params![decision.requirement_id],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(planner) = planner {
                conn.execute(
                    "UPDATE collab_tasks SET state = 'ready', next_action = 'replan', revision = revision + 1, updated_at = ?2, queued_at = ?2
                     WHERE id = ?1 AND state NOT IN ('running', 'cancelled')",
                    params![planner, now],
                )?;
                send_message(
                    conn,
                    &decision.requirement_id,
                    NewMessage::new(
                        "plan.rejected",
                        json!({ "planRevision": revision, "note": input.note, "kind": decision.kind }),
                    )
                    .to_task(&planner)
                    .with_id(format!("msg-plan-rejected-{}-{revision}", decision.requirement_id)),
                )?;
            }
        }
    }
    Ok(())
}

pub fn list_plan_revisions(conn: &Connection, requirement_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT revision, plan_json, rationale_json, state, revision_kind, created_by_attempt_id, activated_at, created_at
         FROM collab_plan_revisions WHERE requirement_id = ?1 ORDER BY revision DESC",
    )?;
    let rows = stmt
        .query_map(params![requirement_id], |r| {
            Ok(json!({
                "revision": r.get::<_, i64>(0)?,
                "plan": super::util::parse_value(&r.get::<_, String>(1)?),
                "rationale": super::util::parse_value(&r.get::<_, String>(2)?),
                "state": r.get::<_, String>(3)?,
                "revisionKind": r.get::<_, String>(4)?,
                "createdByAttemptId": r.get::<_, Option<String>>(5)?,
                "activatedAt": r.get::<_, Option<i64>>(6)?,
                "createdAt": r.get::<_, i64>(7)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn list_impacts(conn: &Connection, requirement_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT from_plan_revision, to_plan_revision, requirement_revision, task_key, task_id, action, reason, created_at
         FROM collab_revision_impacts WHERE requirement_id = ?1 ORDER BY created_at DESC, task_key ASC LIMIT 200",
    )?;
    let rows = stmt
        .query_map(params![requirement_id], |r| {
            Ok(json!({
                "fromPlanRevision": r.get::<_, i64>(0)?,
                "toPlanRevision": r.get::<_, i64>(1)?,
                "requirementRevision": r.get::<_, i64>(2)?,
                "taskKey": r.get::<_, String>(3)?,
                "taskId": r.get::<_, Option<String>>(4)?,
                "action": r.get::<_, String>(5)?,
                "reason": r.get::<_, String>(6)?,
                "createdAt": r.get::<_, i64>(7)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}
