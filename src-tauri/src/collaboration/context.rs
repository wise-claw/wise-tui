//! 上下文包：按任务身份汇总需求、任务规格、上游交付、待复验修正、收件箱、检查点、授权资源与已验证记忆，
//! 并保存 input_manifest（资源版本 / hash / 授权版本），用于事后解释 Agent 当时看到了什么。

use rusqlite::Connection;
use serde_json::{json, Value};

use super::error::CResult;
use super::events::{advance_delivery, task_inbox};
use super::memory::{self, MemoryScope};
use super::model::{self, RequirementRow, TaskRow};
use super::resources::{self, Principal};
use super::runtime::EffectiveConfigManifest;
use super::util::truncate_chars;
use super::{RepoDirectory, RepoInfo};

const BODY_LIMIT: usize = 12_000;

fn action_hint(action: &str) -> &'static str {
    match action {
        "resume" => "从检查点继续：先阅读检查点与收件箱，确认工作区状态后继续未完成事项。",
        "retry" => "上一尝试失败，先阅读失败原因，修正后重新完成任务。",
        "retest_then_continue" => "先用修正版本复验下方“待复验修正”，提交复验回执，再继续原任务。",
        "replan" => "需求有追加输入或计划被退回：基于当前计划生成新计划（沿用未受影响任务），重新发布。",
        "takeover" => "你刚接任主责：阅读当前计划与进度，必要时发布新计划版本，继续协调。",
        "rework" => "验收被驳回：按收件箱中的验收意见返工。",
        "redeliver" => "之前的交付版本已失效：重新部署 / 修复后发布新的交付版本。",
        _ => "开始执行该任务。",
    }
}

fn repo_json(r: &RepoInfo) -> Value {
    json!({ "id": r.id, "name": r.name, "path": r.path, "roleTags": r.role_tags })
}

fn planning_scope(conn: &Connection, req: &RequirementRow, repos: &RepoDirectory) -> CResult<Value> {
    let authorized = super::plans::authorized_repositories(conn, req)?;
    let mut ids: Vec<i64> = authorized.into_iter().collect();
    ids.sort();
    let mut out = Vec::new();
    for id in ids {
        let Some(repo) = repos.get(&id) else { continue };
        let agents: Vec<Value> = super::agents::list_bindings_for_repository(conn, id)?
            .into_iter()
            .filter(|b| b.status == "active")
            .filter_map(|b| {
                let p = super::agents::get_agent(conn, &b.agent_id).ok()?;
                Some(json!({
                    "agentId": p.id, "name": p.name, "status": p.status, "projectId": b.project_id,
                    "responsibility": b.responsibility, "roleTags": b.role_tags, "accessScope": b.access_scope,
                }))
            })
            .collect();
        let mut v = repo_json(repo);
        v["agents"] = json!(agents);
        out.push(v);
    }
    let current: Vec<Value> = model::list_tasks(conn, &req.id, true)?
        .into_iter()
        .filter(|t| t.kind != "plan")
        .map(|t| json!({ "key": t.task_key, "title": t.title, "state": t.state, "repositoryId": t.repository_id, "kind": t.kind, "specHash": t.spec_hash }))
        .collect();
    let delegation: Vec<String> = match req.owner_agent_id.as_deref() {
        Some(a) => {
            let p = super::agents::get_agent(conn, a)?;
            if p.active_revision > 0 {
                super::agents::get_revision(conn, a, p.active_revision)?.config.delegation_policy.allowed_executor_agent_ids
            } else {
                Vec::new()
            }
        }
        None => Vec::new(),
    };
    Ok(json!({
        "authorizedRepositories": out,
        "currentPlanTasks": current,
        "activePlanRevision": req.active_plan_revision,
        "collaborationMode": req.collaboration_mode,
        "delegationAllowedAgentIds": delegation,
        "planApprovalRequired": req.plan_approval_required,
    }))
}

fn upstream(conn: &Connection, req: &RequirementRow, task: &TaskRow) -> CResult<(Vec<Value>, Vec<Value>)> {
    let deps = model::list_dependencies(conn, &req.id, task.plan_revision)?
        .into_iter()
        .filter(|d| d.task_id == task.id)
        .collect::<Vec<_>>();
    let extra: Vec<model::DependencyRow> = {
        // Reverify / repair tasks carry dependencies outside the plan revision.
        let mut stmt = conn.prepare(
            "SELECT id, task_id, producer_task_id, gate_kind, artifact_selector, required_version, plan_revision
             FROM collab_dependencies WHERE task_id = ?1",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![task.id], |r| {
                Ok(model::DependencyRow {
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
        rows
    };
    let mut all = deps;
    for d in extra {
        if !all.iter().any(|x| x.id == d.id) {
            all.push(d);
        }
    }
    let mut items = Vec::new();
    let mut refs = Vec::new();
    for d in all {
        let producer = model::load_task(conn, &d.producer_task_id)?;
        let names = match d.artifact_selector.clone() {
            Some(s) => vec![s],
            None => producer.output_artifacts(),
        };
        for name in names {
            let version = model::latest_valid_version(conn, &req.id, &name)?.or(if d.gate_kind == "contract_available" {
                model::list_artifact_versions(conn, &req.id)?
                    .into_iter()
                    .rev()
                    .find(|v| v.name == name && v.validation_state == "pending")
            } else {
                None
            });
            if let Some(v) = version {
                let ops = task
                    .spec
                    .get("inputs")
                    .and_then(Value::as_array)
                    .and_then(|i| i.iter().find(|x| x.get("artifact").and_then(Value::as_str) == Some(name.as_str())))
                    .and_then(|x| x.get("operations").cloned())
                    .unwrap_or(json!([]));
                super::artifacts::record_consumption(conn, &task.id, &v, &ops)?;
                refs.push(json!({ "id": v.id, "name": v.name, "version": v.version, "contractHash": v.contract_hash, "state": v.validation_state }));
                items.push(json!({
                    "producer": producer.title, "producerTaskKey": producer.task_key, "gate": d.gate_kind,
                    "artifact": v.name, "version": v.version, "validation": v.validation_state, "draft": v.is_draft,
                    "commitSha": v.commit_sha, "endpoint": v.endpoint, "environmentId": v.environment_id,
                    "credentialRef": v.credential_ref, "setupGuideRef": v.setup_guide_ref, "fixtureRefs": v.fixture_refs,
                    "compatibility": v.compatibility, "changedFields": v.changed_fields, "contract": v.contract,
                }));
            }
        }
    }
    Ok((items, refs))
}

#[allow(clippy::too_many_arguments)]
pub fn build_package(
    conn: &Connection,
    req: &RequirementRow,
    task: &TaskRow,
    attempt_id: &str,
    manifest: &EffectiveConfigManifest,
    repo: &RepoInfo,
    repos: &RepoDirectory,
) -> CResult<Value> {
    let attempt = model::load_attempt(conn, attempt_id)?;
    let (upstream_items, artifact_refs) = upstream(conn, req, task)?;

    let inbox = task_inbox(conn, &task.id)?;
    for m in &inbox {
        advance_delivery(conn, &m.id, "task", &task.id, "delivered", None)?;
    }
    let inbox_json: Vec<Value> = inbox
        .iter()
        .map(|m| json!({ "id": m.id, "type": m.kind, "round": m.round, "action": m.action, "body": m.body, "createdAt": m.created_at }))
        .collect();

    let checkpoint = match task.checkpoint_id.as_deref() {
        Some(id) => model::load_checkpoint(conn, id)?,
        None => None,
    };
    let last_failure = task.result.as_ref().and_then(|r| r.get("failureReason")).cloned();

    let who = Principal {
        project_ids: task.project_id.iter().cloned().collect(),
        agent_id: task.executor_agent_id.clone(),
        task_id: Some(task.id.clone()),
        is_user: false,
    };
    let mut knowledge = Vec::new();
    let mut resource_refs = Vec::new();
    for k in &manifest.knowledge {
        match resources::read(conn, &who, &k.resource_id, k.pinned_version) {
            Ok((res, v)) => {
                resource_refs.push(json!({ "id": res.id, "version": v.version, "hash": v.content_hash, "authVersion": res.auth_version, "source": "knowledge_ref" }));
                knowledge.push(json!({ "id": res.id, "title": res.title, "version": v.version, "content": truncate_chars(&v.content, 4_000) }));
            }
            Err(e) => knowledge.push(json!({ "id": k.resource_id, "unavailable": e.message })),
        }
    }
    let query = format!("{} {} {}", req.title, task.title, task.spec.get("goal").and_then(Value::as_str).unwrap_or(""));
    for hit in resources::search(conn, &who, &query, 5)? {
        if resource_refs.iter().any(|r| r["id"] == json!(hit.resource_id)) {
            continue;
        }
        resource_refs.push(json!({ "id": hit.resource_id, "version": hit.version, "hash": hit.content_hash, "authVersion": hit.auth_version, "source": "search" }));
        knowledge.push(json!({ "id": hit.resource_id, "title": hit.title, "version": hit.version, "snippet": hit.snippet, "readWith": "wise-collab resource" }));
    }

    let mut memories = Vec::new();
    let memory_enabled = manifest.memory_policy.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    if let (true, Some(agent)) = (memory_enabled, task.executor_agent_id.as_deref()) {
        let max = manifest.memory_policy.get("maxItems").and_then(Value::as_u64).unwrap_or(20) as usize;
        for m in memory::retrieve_for_task(
            conn,
            &MemoryScope {
                agent_id: agent,
                project_id: task.project_id.as_deref(),
                repository_id: task.repository_id,
                requirement_id: Some(&req.id),
            },
            &query,
            max.clamp(1, 50),
            false,
        )? {
            memories.push(json!({ "id": m.id, "revision": m.revision, "scope": m.scope, "trust": m.trust, "content": m.content }));
        }
    }

    let covered = attempt.covered_changes.clone();
    let mut retests = Vec::new();
    for c in covered.as_array().cloned().unwrap_or_default() {
        if let Some(id) = c.get("changeRequestId").and_then(Value::as_str) {
            let cr = model::load_change(conn, id)?;
            retests.push(json!({
                "changeRequestId": cr.id, "code": cr.code, "round": cr.round, "changeRevision": cr.revision,
                "category": cr.category, "payload": cr.payload, "artifact": c.get("artifact"),
            }));
        }
    }

    let planning = if task.kind == "plan" { Some(planning_scope(conn, req, repos)?) } else { None };
    let cli = super::bridge::cli_path().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "wise-collab".into());

    Ok(json!({
        "requirement": {
            "id": req.id, "title": req.title, "body": truncate_chars(&req.body, BODY_LIMIT), "images": req.image_paths,
            "requirementRevision": req.requirement_revision, "planRevision": req.active_plan_revision,
            "acceptancePolicy": req.acceptance_policy, "collaborationMode": req.collaboration_mode,
        },
        "task": {
            "id": task.id, "key": task.task_key, "title": task.title, "kind": task.kind, "role": task.role,
            "spec": task.spec, "specRevision": task.spec_revision, "nextAction": task.next_action,
            "actionHint": action_hint(&task.next_action), "delegationDepth": task.delegation_depth,
            "repository": repo_json(repo), "failureCount": task.failure_count, "attemptBudget": task.attempt_budget,
            "lastFailure": last_failure,
            "declaredVerification": super::verification::declared_commands(task),
        },
        "agent": {
            "id": manifest.agent_id, "name": manifest.agent_name, "profileRevision": manifest.profile_revision,
            "degradations": manifest.degradations,
        },
        "attempt": { "id": attempt.id, "dispatchKey": attempt.dispatch_key, "generation": attempt.generation },
        "upstream": upstream_items,
        "retests": retests,
        "inbox": inbox_json,
        "checkpoint": checkpoint,
        "knowledge": knowledge,
        "memories": memories,
        "planning": planning,
        "cli": cli,
        "inputManifest": {
            "requirementRevision": req.requirement_revision,
            "planRevision": req.active_plan_revision,
            "taskSpecRevision": task.spec_revision,
            "taskSpecHash": task.spec_hash,
            "profileRevision": manifest.profile_revision,
            "configHash": manifest.config_hash,
            "artifacts": artifact_refs,
            "resources": resource_refs,
            "memories": memories.iter().map(|m| json!({ "id": m["id"], "revision": m["revision"] })).collect::<Vec<_>>(),
            "messages": inbox.iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
            "checkpointId": task.checkpoint_id,
            "coveredChanges": covered,
        },
    }))
}

fn section(out: &mut String, title: &str, body: &str) {
    if body.trim().is_empty() {
        return;
    }
    out.push_str(&format!("## {title}\n\n{}\n\n", body.trim()));
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

pub fn build_prompt(pkg: &Value) -> String {
    let task = &pkg["task"];
    let req = &pkg["requirement"];
    let kind = task["kind"].as_str().unwrap_or("implement");
    let attempt_id = pkg["attempt"]["id"].as_str().unwrap_or("");
    let cli = format!("{} --attempt {}", pkg["cli"].as_str().unwrap_or("wise-collab"), attempt_id);
    let mut out = String::new();
    out.push_str(&format!(
        "# 协作任务：{}\n\n你正在 Wise 多仓库需求协作中执行任务 `{}`（类型 {kind}），工作目录是仓库「{}」（{}）。\n只修改该仓库；跨仓库问题通过协作工具提交，不要直接改其他仓库。\n\n",
        task["title"].as_str().unwrap_or(""),
        task["key"].as_str().unwrap_or(""),
        task["repository"]["name"].as_str().unwrap_or(""),
        task["repository"]["path"].as_str().unwrap_or(""),
    ));
    section(&mut out, &format!("当前动作：{}", task["nextAction"].as_str().unwrap_or("start")), task["actionHint"].as_str().unwrap_or(""));
    section(
        &mut out,
        &format!("需求：{}", req["title"].as_str().unwrap_or("")),
        req["body"].as_str().unwrap_or(""),
    );
    section(&mut out, "任务规格", &pretty(&task["spec"]));
    if let Some(f) = task["lastFailure"].as_str() {
        section(&mut out, "上一次失败原因", f);
    }
    if pkg["upstream"].as_array().is_some_and(|a| !a.is_empty()) {
        section(&mut out, "上游交付（按此版本消费）", &pretty(&pkg["upstream"]));
    }
    if pkg["retests"].as_array().is_some_and(|a| !a.is_empty()) {
        section(
            &mut out,
            "待复验修正（先复验再继续）",
            &format!(
                "{}\n\n复验步骤：运行声明的验证命令 `{cli} verify`，然后 `{cli} retest '{{\"changeRequestId\":\"…\",\"round\":N,\"version\":V,\"passed\":true,\"verificationRunIds\":[\"…\"],\"summary\":\"…\"}}'`。",
                pretty(&pkg["retests"])
            ),
        );
    }
    if pkg["inbox"].as_array().is_some_and(|a| !a.is_empty()) {
        section(&mut out, "收件箱", &pretty(&pkg["inbox"]));
    }
    if !pkg["checkpoint"].is_null() {
        section(&mut out, "检查点", &pretty(&pkg["checkpoint"]));
    }
    if pkg["knowledge"].as_array().is_some_and(|a| !a.is_empty()) {
        section(&mut out, "已授权共享知识", &pretty(&pkg["knowledge"]));
    }
    if pkg["memories"].as_array().is_some_and(|a| !a.is_empty()) {
        section(&mut out, "已验证记忆（仅供参考，与仓库现状冲突时以仓库为准）", &pretty(&pkg["memories"]));
    }
    if let Some(planning) = pkg.get("planning").filter(|p| !p.is_null()) {
        section(
            &mut out,
            "规划范围",
            &format!(
                "{}\n\n只在上述授权仓库中安排任务；确需其他仓库时在 scopeRequests 中说明理由（需用户确认）。\n委派给其他智能体只能单层，且必须在 delegationAllowedAgentIds 内。\n发布计划：`{cli} plan '<JSON>'`，JSON 形如：\n```json\n{{\n  \"requestId\": \"plan-<唯一值>\",\n  \"summary\": \"…\",\n  \"collaborationMode\": \"serial\",\n  \"tasks\": [\n    {{ \"key\": \"BE-1\", \"title\": \"…\", \"repositoryId\": 1, \"role\": \"backend\", \"kind\": \"implement\",\n      \"goal\": \"…\", \"acceptance\": [\"…\"],\n      \"outputs\": [{{ \"artifact\": \"orders-api\", \"kind\": \"api_contract\" }}],\n      \"verification\": {{ \"commands\": [\"bun test\"] }} }},\n    {{ \"key\": \"FE-1\", \"title\": \"…\", \"repositoryId\": 2, \"kind\": \"implement\",\n      \"inputs\": [{{ \"artifact\": \"orders-api\", \"operations\": [\"getOrder\"] }}],\n      \"verification\": {{ \"commands\": [\"bun test\"] }} }}\n  ],\n  \"dependencies\": [{{ \"task\": \"FE-1\", \"producer\": \"BE-1\", \"gate\": \"artifact_ready\", \"artifact\": \"orders-api\" }}],\n  \"scopeRequests\": []\n}}\n```\n只需改一个仓库时计划只含一个任务。重规划时保持未受影响任务的 key 与规格不变，系统会沿用其结果。",
                pretty(planning)
            ),
        );
    }
    let mut tools = format!(
        "所有协作状态都通过 `{cli} <命令> '<JSON>'` 写入（本机 Wise 协调服务，输出为 JSON）：\n\
- `{cli} context`：重新获取本任务上下文\n\
- `{cli} checkpoint '{{\"completed\":[…],\"todo\":[…],\"codeLocation\":{{…}},\"resumeNotes\":\"…\"}}'`：保存检查点（停止或等待前必须保存）\n\
- `{cli} verify '{{\"command\":\"<声明的验证命令>\"}}'`：由 Wise 执行验证并记录证据（只有它产生的 runId 被交付校验采信）\n\
- `{cli} resources '{{\"query\":\"…\"}}'` / `{cli} resource '{{\"id\":\"…\"}}'`：检索 / 读取已授权共享知识\n\
- `{cli} memory '{{\"content\":\"…\",\"scope\":\"repository\",\"evidence\":[…]}}'`：提交记忆候选（验收后才转为已验证）\n\
- `{cli} runtime-use '{{\"resourceId\":\"…\"}}'` / `{cli} runtime-release '{{\"resourceId\":\"…\"}}'`：复用 / 释放已登记的本地服务（最后一个使用者释放后才会停止）\n"
    );
    if matches!(kind, "implement" | "repair" | "env") {
        tools.push_str(&format!(
            "- `{cli} artifact '{{\"name\":\"<声明的输出>\",\"commitSha\":\"…\",\"contract\":{{\"operations\":[…]}},\"endpoint\":\"…\",\"healthUrl\":\"…\",\"deployedCommit\":\"…\",\"testEvidenceRunIds\":[\"…\"]}}'`：发布交付包（先提交代码、部署并 verify；commit 与部署指纹必须一致）\n\
- `{cli} runtime-resource '{{\"name\":\"…\",\"stopMethod\":\"…\",\"endpoint\":\"…\",\"port\":0}}'`：登记你启动的本地服务，便于共享与清理\n"
        ));
    }
    if matches!(kind, "implement" | "qa" | "repair" | "env") {
        tools.push_str(&format!(
            "- `{cli} change '<问题载荷>'`：上游交付不符合契约时提交修正单（category: contract_violation / consumer_bug / environment / scope / unknown；需 artifact、consumedVersion、operation、field 或 assertion、expected、actual、reproduction、impact、acceptance），提交后保存检查点并结束会话，修正就绪后会自动唤醒你\n"
        ));
    }
    if kind == "repair" {
        tools.push_str(&format!(
            "- `{cli} change-rejection '{{\"changeRequestId\":\"…\",\"reason\":\"…\",\"evidence\":{{…}}}}'`：认为不应修复时提交拒绝建议（由主责 / 用户复核，不会直接解除阻塞）\n"
        ));
    }
    if kind == "plan" {
        tools.push_str(&format!("- `{cli} plan '<计划 JSON>'`：发布或修订协作计划\n"));
    }
    section(&mut out, "协作工具", &tools);
    section(
        &mut out,
        "结束要求",
        &format!(
            "完成前必须提交结构化结果：`{cli} result '{{\"status\":\"succeeded\",\"summary\":\"…\"}}'`（失败用 failed，等待外部条件用 blocked）。\n\
Wise 以交付校验、受控验证和结构化结果判断任务状态，不依据聊天文字。会话结束即视为本次尝试结束。"
        ),
    );
    out
}
