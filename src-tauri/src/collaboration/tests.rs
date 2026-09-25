//! 协作层 SQLite 集成测试：按设计文档 AC 走通派发、计划、调度、交付、修正、验收与迁移。

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::agents::{self, AgentConfig, BindAgentInput, CreateAgentInput};
use super::bridge::{agent_command, Step};
use super::error::codes;
use super::model;
use super::requirements::{self, ControlInput, DispatchIntentInput};
use super::runtime::{self, CapabilityMatrix};
use super::scheduler::{self, ClaimInput, ClaimedTask, FinishInput};
use super::verification::{self, HealthOutcome, PreparedRun, RunOutcome};
use super::{repo_directory, RepoDirectory, RepoInfo};

const WEB: i64 = 1;
const API: i64 = 2;
const OPS: i64 = 3;

struct Env {
    conn: Connection,
    repos: RepoDirectory,
    matrix: CapabilityMatrix,
    owner: String,
    backend: String,
    ops: String,
}

fn temp_repo(name: &str) -> String {
    let dir = std::env::temp_dir().join(format!("wise-collab-test-{}-{name}", super::util::new_id("r")));
    std::fs::create_dir_all(&dir).unwrap();
    dir.to_string_lossy().into_owned()
}

fn enabled_agent(conn: &Connection, name: &str, bindings: &[(&str, i64)], delegates: Vec<String>) -> String {
    let mut cfg = AgentConfig::default();
    cfg.run_policy.isolation = "best_effort".into();
    cfg.delegation_policy.allowed_executor_agent_ids = delegates;
    cfg.agents_md = format!("{name} 的工作规则");
    enabled_agent_with(conn, name, bindings, cfg)
}

fn enabled_agent_with(conn: &Connection, name: &str, bindings: &[(&str, i64)], cfg: AgentConfig) -> String {
    let p = agents::create_agent(
        conn,
        CreateAgentInput { name: name.into(), description: String::new(), avatar_color: None, assistant_id: None, default_owner_project_id: None, config: Some(cfg) },
    )
    .unwrap();
    for (project, repo) in bindings {
        agents::bind_agent(
            conn,
            BindAgentInput {
                agent_id: p.id.clone(),
                project_id: (*project).into(),
                repository_id: *repo,
                responsibility: format!("{name} 负责仓库 #{repo}"),
                role_tags: vec![],
                access_scope: Some("read_write".into()),
                override_cfg: None,
                is_default: true,
            },
        )
        .unwrap();
    }
    let p = agents::get_agent(conn, &p.id).unwrap();
    let rev = agents::publish_agent(conn, &p.id, p.row_version, "v1").unwrap();
    agents::record_check(conn, &p.id, &json!({ "passed": true, "revision": rev.revision }), true).unwrap();
    let p = agents::get_agent(conn, &p.id).unwrap();
    agents::set_agent_status(conn, &p.id, "enable", p.row_version).unwrap();
    p.id
}

fn setup() -> Env {
    let conn = crate::wise_db::open_migrated_test_connection();
    for (id, name) in [("p1", "商城"), ("p2", "运维")] {
        conn.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, 0, 0)", params![id, name]).unwrap();
    }
    for (project, repo, order) in [("p1", WEB, 0), ("p1", API, 1), ("p2", OPS, 0)] {
        conn.execute(
            "INSERT INTO project_repositories (project_id, repository_id, created_at, display_order) VALUES (?1, ?2, 0, ?3)",
            params![project, repo, order],
        )
        .unwrap();
    }
    let repos = repo_directory([
        RepoInfo { id: WEB, name: "web".into(), path: temp_repo("web"), role_tags: vec!["frontend".into()] },
        RepoInfo { id: API, name: "api".into(), path: temp_repo("api"), role_tags: vec!["backend".into()] },
        RepoInfo { id: OPS, name: "ops".into(), path: temp_repo("ops"), role_tags: vec!["ops".into()] },
    ]);
    let backend = enabled_agent(&conn, "后端智能体", &[("p1", API)], vec![]);
    let ops = enabled_agent(&conn, "运维智能体", &[("p2", OPS)], vec![]);
    let owner = enabled_agent(&conn, "商城主责", &[("p1", WEB)], vec![backend.clone(), ops.clone()]);
    let matrix = runtime::load_matrix(&conn).unwrap();
    Env { conn, repos, matrix, owner, backend, ops }
}

fn dispatch(env: &Env, request_id: &str, mode: &str, body: &str) -> requirements::DispatchResult {
    requirements::dispatch_to_agent(
        &env.conn,
        &DispatchIntentInput {
            request_id: request_id.into(),
            origin_session_id: Some("session-origin".into()),
            agent_id: env.owner.clone(),
            mode: mode.into(),
            project_context: Some("p1".into()),
            body: body.into(),
            ..Default::default()
        },
        &env.repos,
        &env.matrix,
    )
    .unwrap()
}

fn try_claim(env: &Env) -> Option<ClaimedTask> {
    scheduler::claim_next(
        &env.conn,
        &ClaimInput { lease_owner: "test".into(), global_limit: Some(4), requirement_id: None, task_id: None, known_mcp_server_ids: None },
        &env.repos,
        &env.matrix,
    )
    .unwrap()
    .claimed
}

fn claim(env: &Env) -> ClaimedTask {
    let c = try_claim(env).expect("a ready task should be claimed");
    let check = scheduler::confirm_launch(&env.conn, &c.attempt.id, c.attempt.fencing_token).unwrap();
    assert!(check.proceed, "launch should proceed: {:?}", check.reason);
    scheduler::bind_session(&env.conn, &c.attempt.id, c.attempt.fencing_token, &format!("session-{}", c.attempt.id)).unwrap();
    c
}

fn run(env: &Env, c: &ClaimedTask, name: &str, body: Value) -> Value {
    let att = model::load_attempt(&env.conn, &c.attempt.id).unwrap();
    match agent_command(&env.conn, &env.repos, &att, name, &body).unwrap() {
        Step::Done(v) => v,
        _ => panic!("{name} should complete synchronously"),
    }
}

fn run_err(env: &Env, c: &ClaimedTask, name: &str, body: Value) -> super::error::CollabError {
    let att = model::load_attempt(&env.conn, &c.attempt.id).unwrap();
    match agent_command(&env.conn, &env.repos, &att, name, &body) {
        Err(e) => e,
        Ok(_) => panic!("{name} should fail"),
    }
}

fn finish(env: &Env, c: &ClaimedTask, outcome: &str) -> model::AttemptRow {
    scheduler::finish_attempt(
        &env.conn,
        &FinishInput {
            attempt_id: c.attempt.id.clone(),
            fencing_token: c.attempt.fencing_token,
            outcome: outcome.into(),
            message: None,
            duration_ms: Some(1_000),
            tokens: None,
        },
    )
    .unwrap()
}

fn succeed(env: &Env, c: &ClaimedTask) {
    run(env, c, "result", json!({ "status": "succeeded", "summary": "完成" }));
    finish(env, c, "completed");
}

fn record_evidence(env: &Env, c: &ClaimedTask, commit: &str, passed: bool) -> String {
    let now = super::util::now_ms();
    verification::record_run(
        &env.conn,
        &PreparedRun {
            requirement_id: c.requirement_id.clone(),
            task_id: c.task.id.clone(),
            attempt_id: Some(c.attempt.id.clone()),
            repository_id: c.task.repository_id,
            command: "bun test".into(),
            cwd: String::new(),
            timeout_ms: 1_000,
        },
        &RunOutcome {
            exit_code: Some(if passed { 0 } else { 1 }),
            output_tail: "ok".into(),
            head_commit: Some(commit.into()),
            dirty: false,
            timed_out: false,
            started_at: now,
            finished_at: now,
        },
    )
    .unwrap()
    .id
}

fn publish_api(env: &Env, c: &ClaimedTask, commit: &str, response_fields: Value) -> model::ArtifactVersionRow {
    let run_id = record_evidence(env, c, commit, true);
    let att = model::load_attempt(&env.conn, &c.attempt.id).unwrap();
    let body = json!({
        "name": "orders-api",
        "commitSha": commit,
        "contract": { "operations": [{ "id": "getOrder", "method": "GET", "path": "/orders/{id}", "response": response_fields }] },
        "endpoint": "http://127.0.0.1:18080",
        "healthUrl": "http://127.0.0.1:18080/health",
        "deployedCommit": commit,
        "testEvidenceRunIds": [run_id],
    });
    let Step::Validate { version_id, .. } = agent_command(&env.conn, &env.repos, &att, "artifact", &body).unwrap() else {
        panic!("formal artifact must go through validation");
    };
    let health = HealthOutcome {
        url: "http://127.0.0.1:18080/health".into(),
        ok: true,
        status: Some(200),
        reported_commit: Some(commit.into()),
        error: None,
        checked_at: super::util::now_ms(),
    };
    super::artifacts::apply_validation(&env.conn, &version_id, Some(&health)).unwrap()
}

fn task_by_key(env: &Env, requirement_id: &str, key: &str) -> model::TaskRow {
    model::active_task_by_key(&env.conn, requirement_id, key).unwrap().unwrap_or_else(|| panic!("task {key} missing"))
}

fn cross_repo_plan() -> Value {
    json!({
        "requestId": "plan-1",
        "summary": "订单详情：后端接口 + 前端页面",
        "tasks": [
            { "key": "BE-1", "title": "订单详情接口", "repositoryId": API, "kind": "implement", "role": "backend",
              "goal": "提供 GET /orders/{id}", "acceptance": ["返回订单状态"],
              "outputs": [{ "artifact": "orders-api", "kind": "api_contract" }],
              "verification": { "commands": ["bun test"] } },
            { "key": "FE-1", "title": "订单详情页", "repositoryId": WEB, "kind": "implement", "role": "frontend",
              "goal": "展示订单状态", "inputs": [{ "artifact": "orders-api", "operations": ["getOrder"] }],
              "verification": { "commands": ["bun test"] } }
        ],
        "dependencies": [{ "task": "FE-1", "producer": "BE-1", "gate": "artifact_ready", "artifact": "orders-api" }]
    })
}

fn plan_requirement(env: &Env, plan: Value) -> (String, ClaimedTask) {
    let d = dispatch(env, "req-1", "execute", "做订单详情页，前端展示后端返回的订单状态");
    let rid = d.requirement_id.clone().unwrap();
    let planner = claim(env);
    assert_eq!(planner.task.kind, "plan");
    assert_eq!(planner.spawn.disallowed_tools.as_deref(), Some(runtime::READ_ONLY_DISALLOWED_TOOLS));
    let out = run(env, &planner, "plan", plan);
    assert_eq!(out["state"], "active", "plan should activate: {out}");
    (rid, planner)
}

// AC-23 / AC-25 / AC-34：单仓库需求也走同一模型；执行模式创建需求 + 主责规划 → 仓库任务 → 验收完成。
#[test]
fn single_repository_requirement_runs_to_acceptance() {
    let env = setup();
    let plan = json!({
        "requestId": "plan-single",
        "summary": "只改前端",
        "tasks": [{ "key": "FE-1", "title": "按钮文案", "repositoryId": WEB, "kind": "implement", "goal": "改文案" }],
        "dependencies": []
    });
    let (rid, planner) = plan_requirement(&env, plan);
    succeed(&env, &planner);
    assert_eq!(model::load_task(&env.conn, &planner.task.id).unwrap().state, "succeeded");

    let fe = claim(&env);
    assert_eq!(fe.task.task_key, "FE-1");
    assert_eq!(fe.task.executor_agent_id.as_deref(), Some(env.owner.as_str()));
    assert!(fe.prompt.contains("wise-collab"));
    assert!(fe.spawn.append_system_prompt.contains("商城主责 的工作规则"));
    succeed(&env, &fe);

    let req = model::load_requirement(&env.conn, &rid).unwrap();
    assert_eq!(req.business_status, "verifying");
    let manifest = super::acceptance::current_manifest(&env.conn, &rid).unwrap().expect("acceptance manifest");
    let done = super::acceptance::accept(
        &env.conn,
        &super::acceptance::AcceptInput {
            request_id: "acc-1".into(),
            requirement_id: rid.clone(),
            manifest_revision: manifest.revision,
            manifest_hash: manifest.content_hash.clone(),
            expected_revision: None,
            note: "通过".into(),
            reject: false,
            reopen_task_ids: vec![],
        },
    )
    .unwrap();
    assert_eq!(done.state, "accepted");
    let done_req = model::load_requirement(&env.conn, &rid).unwrap();
    assert_eq!(done_req.business_status, "done");
    let sessions = model::requirement_sessions(&env.conn, &rid).unwrap();
    assert!(sessions.len() >= 3, "origin + execution sessions linked: {sessions:?}");

    // 继续已完成需求：重开为新 generation，保留已通过的验收清单作为历史，重新规划后产生新验收轮次。
    let reopened = requirements::revise_requirement(
        &env.conn,
        &requirements::ReviseInput {
            request_id: "revise-after-done".into(),
            requirement_id: rid.clone(),
            input: "按钮再加一个图标".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(reopened.business_status, "open");
    assert_eq!(reopened.generation, done_req.generation + 1);
    assert_eq!(reopened.requirement_revision, done_req.requirement_revision + 1);
    let old = super::acceptance::current_manifest(&env.conn, &rid).unwrap().unwrap();
    assert_eq!(old.id, done.id);
    assert_eq!(old.state, "accepted", "previous acceptance evidence is preserved");
    let replanner = claim(&env);
    assert_eq!(replanner.task.kind, "plan", "reopened requirement is re-planned first");
}

// AC-04 / AC-05 / AC-06：串行依赖、交付校验、修正单、修复轮次、消费者复验、验收。
#[test]
fn cross_repository_delivery_change_and_retest() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    succeed(&env, &planner);

    let fe_task = task_by_key(&env, &rid, "FE-1");
    assert_eq!(fe_task.state, "waiting_dependencies");
    let be_task = task_by_key(&env, &rid, "BE-1");
    assert_eq!(be_task.executor_agent_id.as_deref(), Some(env.backend.as_str()), "delegated to backend agent");
    assert_eq!(be_task.delegation_depth, 1);

    let be = claim(&env);
    assert_eq!(be.task.task_key, "BE-1");
    assert!(try_claim(&env).is_none(), "FE must wait for a valid delivery");

    // Evidence whose HEAD differs from the delivered commit is rejected.
    let stale_run = record_evidence(&env, &be, "0000000", true);
    let att = model::load_attempt(&env.conn, &be.attempt.id).unwrap();
    let Step::Validate { version_id, .. } = agent_command(
        &env.conn,
        &env.repos,
        &att,
        "artifact",
        &json!({ "name": "orders-api", "commitSha": "abc1234",
                 "contract": { "operations": [{ "id": "getOrder", "response": { "status": "string" } }] },
                 "endpoint": "http://127.0.0.1:18080", "healthUrl": "http://127.0.0.1:18080/health",
                 "deployedCommit": "abc1234", "testEvidenceRunIds": [stale_run] }),
    )
    .unwrap() else {
        panic!()
    };
    let invalid = super::artifacts::apply_validation(&env.conn, &version_id, None).unwrap();
    assert_eq!(invalid.validation_state, "invalid");
    assert_eq!(model::load_task(&env.conn, &fe_task.id).unwrap().state, "waiting_dependencies");

    let v1 = publish_api(&env, &be, "abc1234", json!({ "status": "string" }));
    assert_eq!(v1.validation_state, "valid");
    succeed(&env, &be);
    assert_eq!(model::load_task(&env.conn, &be_task.id).unwrap().state, "succeeded");
    assert_eq!(model::load_task(&env.conn, &fe_task.id).unwrap().state, "ready");

    let fe = claim(&env);
    assert!(fe.prompt.contains("orders-api"), "upstream delivery is in the context");
    let missing = run_err(&env, &fe, "change", json!({ "requestId": "chg-0", "category": "contract_violation", "artifact": "orders-api" }));
    assert_eq!(missing.code, codes::INVALID_CHANGE_PAYLOAD);
    let change = run(
        &env,
        &fe,
        "change",
        json!({
            "requestId": "chg-1", "category": "contract_violation", "summary": "缺少 statusText",
            "artifact": "orders-api", "consumedVersion": v1.version, "operation": "getOrder", "field": "statusText",
            "expected": { "statusText": "string" }, "actual": { "status": "PAID" },
            "reproduction": ["GET /orders/1"], "impact": "页面无法展示中文状态", "acceptance": ["返回 statusText"],
            "checkpoint": { "completed": ["页面骨架"], "todo": ["状态文案"], "resumeNotes": "等待接口补字段" }
        }),
    );
    assert_eq!(change["consumerParked"], true);
    let change_id = change["change"]["id"].as_str().unwrap().to_string();
    // Same problem again merges instead of creating a second repair.
    let dup = run(
        &env,
        &fe,
        "change",
        json!({
            "requestId": "chg-2", "category": "contract_violation", "summary": "缺少 statusText",
            "artifact": "orders-api", "consumedVersion": v1.version, "operation": "getOrder", "field": "statusText",
            "expected": { "statusText": "string" }, "actual": { "status": "PAID" },
            "reproduction": ["GET /orders/1"], "impact": "页面无法展示中文状态", "acceptance": ["返回 statusText"]
        }),
    );
    assert_eq!(dup["merged"], true);
    finish(&env, &fe, "stopped");
    assert_eq!(model::load_task(&env.conn, &fe_task.id).unwrap().state, "waiting_change");

    let repair = claim(&env);
    assert_eq!(repair.task.kind, "repair");
    assert_eq!(repair.task.repository_id, Some(API));
    let v2 = publish_api(&env, &repair, "def5678", json!({ "status": "string", "statusText": "string" }));
    assert_eq!(v2.validation_state, "valid");
    succeed(&env, &repair);
    let cr = model::load_change(&env.conn, &change_id).unwrap();
    assert_eq!(cr.state, "ready_for_retest");

    let retest = claim(&env);
    assert_eq!(retest.task.id, fe_task.id);
    assert_eq!(retest.task.next_action, "retest_then_continue");
    assert!(retest.prompt.contains(&cr.code));
    // A pass without Wise-run evidence is refused.
    let no_evidence = run_err(
        &env,
        &retest,
        "retest",
        json!({ "requestId": "rt-0", "changeRequestId": change_id, "round": cr.round, "version": v2.version, "passed": true }),
    );
    assert_ne!(no_evidence.code, "");
    let evidence = record_evidence(&env, &retest, "fe00001", true);
    let closed = run(
        &env,
        &retest,
        "retest",
        json!({ "requestId": "rt-1", "changeRequestId": change_id, "round": cr.round, "version": v2.version,
                "passed": true, "verificationRunIds": [evidence], "summary": "复验通过" }),
    );
    assert!(matches!(closed["state"].as_str(), Some("verified") | Some("closed")), "{closed}");
    succeed(&env, &retest);
    assert_eq!(model::load_task(&env.conn, &fe_task.id).unwrap().state, "succeeded");
    assert_eq!(model::load_requirement(&env.conn, &rid).unwrap().business_status, "verifying");

    let manifest = super::acceptance::current_manifest(&env.conn, &rid).unwrap().unwrap();
    let stale = super::acceptance::accept(
        &env.conn,
        &super::acceptance::AcceptInput {
            request_id: "acc-stale".into(),
            requirement_id: rid.clone(),
            manifest_revision: manifest.revision,
            manifest_hash: "not-the-hash".into(),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert_eq!(stale.code, codes::STALE_ACCEPTANCE);
    let snapshot = requirements::snapshot(&env.conn, &rid).unwrap();
    assert!(snapshot["artifacts"].as_array().is_some_and(|a| a.len() >= 3));
    assert!(snapshot["changes"].as_array().is_some_and(|a| !a.is_empty()));

    let recent = model::list_recent_artifact_versions(&env.conn, None, 50).unwrap();
    let api_latest = recent.iter().find(|v| v.name == v2.name).expect("latest api artifact");
    assert_eq!(api_latest.version, v2.version, "only the newest version of each artifact");
    assert_eq!(recent.iter().filter(|v| v.artifact_id == api_latest.artifact_id).count(), 1);
    assert!(!model::list_recent_artifact_versions(&env.conn, Some(WEB), 50).unwrap().is_empty(), "consumer repo sees it");
    assert!(model::list_recent_artifact_versions(&env.conn, Some(999), 50).unwrap().is_empty());
    let changes = model::list_recent_changes(&env.conn, Some(WEB), 50).unwrap();
    assert!(changes.iter().any(|c| c.id == change_id));
    assert!(model::list_recent_changes(&env.conn, Some(999), 50).unwrap().is_empty());
}

// AC-10 / AC-28 / AC-32 / AC-34：同一 requestId 重放不重复创建；不同载荷复用 requestId 报错。
#[test]
fn dispatch_is_idempotent_by_request_id() {
    let env = setup();
    let a = dispatch(&env, "req-idem", "execute", "需求 A");
    let b = dispatch(&env, "req-idem", "execute", "需求 A");
    assert_eq!(a.requirement_id, b.requirement_id);
    assert!(b.replayed);
    let err = requirements::dispatch_to_agent(
        &env.conn,
        &DispatchIntentInput { request_id: "req-idem".into(), agent_id: env.owner.clone(), mode: "execute".into(), body: "需求 B".into(), ..Default::default() },
        &env.repos,
        &env.matrix,
    )
    .unwrap_err();
    assert_eq!(err.code, codes::REQUEST_ID_REUSED);
    let n: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_requirements", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);

    let discuss = dispatch(&env, "req-discuss", "discuss", "先聊聊方案");
    assert!(discuss.requirement_id.is_none(), "discuss mode never creates a requirement");
    assert!(discuss.discussion.is_some());
    let plan = dispatch(&env, "req-plan", "plan", "只出方案");
    let req = model::load_requirement(&env.conn, plan.requirement_id.as_deref().unwrap()).unwrap();
    assert!(req.plan_approval_required);
}

// AC-10：旧 fencing token 的写入被拒绝；租约过期标记失联且不重复派发。
#[test]
fn stale_fencing_and_lease_expiry() {
    let env = setup();
    dispatch(&env, "req-f", "execute", "需求");
    let planner = claim(&env);
    let err = scheduler::heartbeat(&env.conn, &planner.attempt.id, planner.attempt.fencing_token + 100).unwrap_err();
    assert_eq!(err.code, codes::STALE_ATTEMPT);
    env.conn.execute("UPDATE collab_attempts SET lease_expiry = 0 WHERE id = ?1", params![planner.attempt.id]).unwrap();
    let expired = scheduler::expire_leases(&env.conn).unwrap();
    assert_eq!(expired, vec![planner.attempt.id.clone()]);
    assert_eq!(model::load_attempt(&env.conn, &planner.attempt.id).unwrap().state, "lost");
    assert!(try_claim(&env).is_none(), "a lost attempt is reconciled, never re-dispatched blindly");
    let reconciled = scheduler::reconcile(
        &env.conn,
        &scheduler::ReconcileInput { dispatch_key: planner.attempt.dispatch_key.clone(), observed: "missing".into(), session_id: None },
    )
    .unwrap()
    .unwrap();
    assert_eq!(reconciled.state, "finished");
    let again = try_claim(&env).expect("task is ready again after reconciliation");
    assert_eq!(again.task.id, planner.task.id);
    assert!(again.attempt.fencing_token > planner.attempt.fencing_token);
}

// AC-14 / AC-36：暂停 / 继续 / 取消：停止在途尝试，取消释放任务。
#[test]
fn pause_resume_cancel() {
    let env = setup();
    let d = dispatch(&env, "req-c", "execute", "需求");
    let rid = d.requirement_id.unwrap();
    let planner = claim(&env);
    let ctl = |action: &str, rq: &str| requirements::control(&env.conn, &ControlInput { request_id: rq.into(), requirement_id: rid.clone(), action: action.into(), expected_revision: None });
    assert_eq!(ctl("pause", "c1").unwrap().control_status, "pausing");
    let ack = scheduler::heartbeat(&env.conn, &planner.attempt.id, planner.attempt.fencing_token).unwrap();
    assert!(ack.stop_requested);
    assert_eq!(ctl("resume", "c2").unwrap_err().code, codes::STOP_PENDING);
    finish(&env, &planner, "stopped");
    assert_eq!(model::load_requirement(&env.conn, &rid).unwrap().control_status, "paused");
    assert!(try_claim(&env).is_none());
    assert_eq!(ctl("resume", "c3").unwrap().control_status, "active");
    let resumed = claim(&env);
    assert_eq!(resumed.task.id, planner.task.id);
    ctl("cancel", "c4").unwrap();
    finish(&env, &resumed, "stopped");
    let req = model::load_requirement(&env.conn, &rid).unwrap();
    assert_eq!(req.control_status, "cancelled");
    assert!(model::list_tasks(&env.conn, &rid, true).unwrap().iter().all(|t| t.is_terminal()));
}

// AC-38：执行预算耗尽进入决策；追加预算后恢复。
#[test]
fn attempt_budget_opens_decision() {
    let env = setup();
    let plan = json!({ "requestId": "plan-b", "tasks": [{ "key": "FE-1", "title": "改页面", "repositoryId": WEB, "kind": "implement" }] });
    let (rid, planner) = plan_requirement(&env, plan);
    succeed(&env, &planner);
    for _ in 0..3 {
        let fe = claim(&env);
        run(&env, &fe, "result", json!({ "status": "failed", "summary": "编译失败", "failureReason": "tsc" }));
        finish(&env, &fe, "completed");
    }
    let task = task_by_key(&env, &rid, "FE-1");
    assert_eq!(task.state, "failed");
    let decision = model::list_decisions(&env.conn, &rid, true).unwrap().into_iter().find(|d| d.kind == "attempt_budget").expect("budget decision");
    super::decisions::resolve(
        &env.conn,
        &super::decisions::ResolveDecisionInput {
            decision_id: decision.id.clone(),
            expected_revision: decision.revision,
            option_id: "add_budget".into(),
            values: json!({ "extraBudget": 1 }),
            request_id: "dec-1".into(),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(task_by_key(&env, &rid, "FE-1").state, "ready");
}

// AC-17 / AC-29：计划只能落在授权仓库；扩展范围需确认；委派仅单层；DAG 不能成环。
#[test]
fn plan_scope_delegation_and_cycles() {
    let env = setup();
    let d = dispatch(&env, "req-s", "execute", "需求");
    let rid = d.requirement_id.unwrap();
    let planner = claim(&env);
    let unauthorized = run_err(
        &env,
        &planner,
        "plan",
        json!({ "requestId": "p-x", "tasks": [{ "key": "OPS-1", "title": "部署", "repositoryId": OPS, "kind": "env" }] }),
    );
    assert_eq!(unauthorized.code, codes::SCOPE_NOT_AUTHORIZED);
    let cycle = run_err(
        &env,
        &planner,
        "plan",
        json!({ "requestId": "p-cycle",
                "tasks": [{ "key": "A", "title": "A", "repositoryId": WEB }, { "key": "B", "title": "B", "repositoryId": API }],
                "dependencies": [{ "task": "A", "producer": "B", "gate": "task_succeeded" }, { "task": "B", "producer": "A", "gate": "task_succeeded" }] }),
    );
    assert_eq!(cycle.code, codes::INVALID_PLAN);
    let proposed = run(
        &env,
        &planner,
        "plan",
        json!({ "requestId": "p-scope", "tasks": [{ "key": "OPS-1", "title": "部署", "repositoryId": OPS, "kind": "env", "executorAgentId": env.ops }],
                "scopeRequests": [{ "repositoryId": OPS, "reason": "需要部署测试环境" }] }),
    );
    assert_eq!(proposed["state"], "proposed");
    let decision = model::load_decision(&env.conn, proposed["decisionId"].as_str().unwrap()).unwrap();
    assert_eq!(decision.kind, "scope_expansion");
    super::decisions::resolve(
        &env.conn,
        &super::decisions::ResolveDecisionInput {
            decision_id: decision.id.clone(),
            expected_revision: decision.revision,
            option_id: "approve".into(),
            request_id: "dec-s".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let req = model::load_requirement(&env.conn, &rid).unwrap();
    assert!(req.extra_scope.contains(&OPS));
    assert_eq!(task_by_key(&env, &rid, "OPS-1").executor_agent_id.as_deref(), Some(env.ops.as_str()));

    // A delegated executor cannot publish plans (single-level delegation).
    let delegated = requirements::create_requirement(
        &env.conn,
        &requirements::CreateRequirementInput { title: Some("x".into()), body: "x".into(), owner_agent_id: Some(env.backend.clone()), owner_project_id: Some("p1".into()), ..Default::default() },
    );
    assert!(delegated.is_ok());
}

// AC-16：V1 需求迁移：备份、保留 ID/状态/会话、open 暂停导入、可重入、标记旧项。
#[test]
fn legacy_v1_import_is_transactional_and_idempotent() {
    let env = setup();
    let v1 = json!({ "version": 1, "items": [
        { "id": "old-open", "title": "旧需求", "bodyMarkdown": "旧需求正文", "status": "open", "repositoryId": WEB.to_string(),
          "executionSessionIds": ["tab-1"], "createdAt": 10, "updatedAt": 20, "sortOrder": 5 },
        { "id": "old-verify", "title": "待验收", "bodyMarkdown": "x", "status": "verifying", "repositoryId": API.to_string() },
        { "id": "old-done", "title": "已完成", "bodyMarkdown": "y", "status": "done", "repositoryId": null }
    ]});
    env.conn.execute("INSERT INTO app_settings (key, value) VALUES (?1, ?2)", params![super::legacy::V1_KEY, v1.to_string()]).unwrap();
    let report = super::legacy::import_v1(&env.conn, &super::legacy::ImportInput::default(), &env.repos).unwrap();
    assert_eq!(report.imported.len(), 3);
    let open = model::load_requirement(&env.conn, "old-open").unwrap();
    assert_eq!(open.control_status, "paused");
    assert_eq!(open.legacy_id.as_deref(), Some("old-open"));
    assert_eq!(model::load_requirement(&env.conn, "old-verify").unwrap().business_status, "verifying");
    assert_eq!(model::load_requirement(&env.conn, "old-done").unwrap().business_status, "done");
    assert!(try_claim(&env).is_none(), "imported open items are paused and never auto-dispatched");
    let again = super::legacy::import_v1(&env.conn, &super::legacy::ImportInput::default(), &env.repos).unwrap();
    assert_eq!(again.imported.len(), 0);
    assert_eq!(again.skipped.len(), 3);
    let stored: String = env.conn.query_row("SELECT value FROM app_settings WHERE key = ?1", params![super::legacy::V1_KEY], |r| r.get(0)).unwrap();
    let stored: Value = serde_json::from_str(&stored).unwrap();
    assert!(stored["items"].as_array().unwrap().iter().all(|i| i.get("collaborationRequirementId").is_some()));
    let backup: i64 = env.conn.query_row("SELECT COUNT(*) FROM app_settings WHERE key = ?1", params![super::legacy::V1_BACKUP_KEY], |r| r.get(0)).unwrap();
    assert_eq!(backup, 1);
    assert!(model::requirement_sessions(&env.conn, "old-open").unwrap().iter().any(|s| s["sessionId"] == "tab-1"));
}

// AC-12：共享资源按授权读取；撤销后立即不可读；不能存凭据明文。
#[test]
fn resource_authorization_and_revocation() {
    let env = setup();
    use super::resources::{self, CreateResourceInput, Principal};
    let secret = resources::create_resource(
        &env.conn,
        &CreateResourceInput {
            owner_project_id: Some("p1".into()), owner_agent_id: None, kind: "doc".into(), title: "密钥".into(), maintainer: String::new(),
            visibility: "source".into(), space_id: None, repository_id: None, location: String::new(),
            content: "password=hunter2".into(), note: String::new(), source_ref: Value::Null, publisher: "user".into(),
        },
    );
    assert_eq!(secret.unwrap_err().code, codes::INVALID_PAYLOAD);
    let res = resources::create_resource(
        &env.conn,
        &CreateResourceInput {
            owner_project_id: Some("p1".into()), owner_agent_id: None, kind: "doc".into(), title: "订单状态字典".into(), maintainer: String::new(),
            visibility: "source".into(), space_id: None, repository_id: None, location: String::new(),
            content: "PAID=已支付 SHIPPED=已发货".into(), note: String::new(), source_ref: Value::Null, publisher: "user".into(),
        },
    )
    .unwrap();
    let outsider = Principal { project_ids: vec!["p2".into()], agent_id: None, task_id: None, is_user: false };
    assert_eq!(resources::read(&env.conn, &outsider, &res.id, None).unwrap_err().code, codes::FORBIDDEN);
    assert!(resources::search(&env.conn, &outsider, "订单状态", 10).unwrap().is_empty());
    let granted = resources::grant(&env.conn, &res.id, "project", "p2").unwrap();
    assert!(resources::read(&env.conn, &outsider, &res.id, None).is_ok());
    assert!(!resources::search(&env.conn, &outsider, "订单状态", 10).unwrap().is_empty());
    let grant_id: String = env.conn.query_row("SELECT id FROM collab_resource_grants WHERE resource_id = ?1", params![res.id], |r| r.get(0)).unwrap();
    let revoked = resources::revoke(&env.conn, &grant_id).unwrap();
    assert!(revoked.auth_version > granted.auth_version - 1);
    assert_eq!(resources::read(&env.conn, &outsider, &res.id, None).unwrap_err().code, codes::FORBIDDEN);
}

// AC-31 / AC-32：停用智能体停止新执行；严格隔离下引擎能力未验证则阻止执行。
#[test]
fn disabled_agent_and_strict_isolation_block_claims() {
    let env = setup();
    dispatch(&env, "req-d", "execute", "需求");
    let p = agents::get_agent(&env.conn, &env.owner).unwrap();
    agents::set_agent_status(&env.conn, &env.owner, "disable", p.row_version).unwrap();
    assert!(try_claim(&env).is_none());
    let rid: String = env.conn.query_row("SELECT id FROM collab_requirements LIMIT 1", [], |r| r.get(0)).unwrap();
    let explain = scheduler::explain_requirement(&env.conn, &rid).unwrap();
    assert!(serde_json::to_string(&explain).unwrap().contains("AGENT_DISABLED"));

    let mut cfg = AgentConfig::default();
    cfg.run_policy.isolation = "strict".into();
    let strict = agents::create_agent(&env.conn, CreateAgentInput { name: "严格".into(), description: String::new(), avatar_color: None, assistant_id: None, default_owner_project_id: None, config: Some(cfg) }).unwrap();
    let manifest = runtime::resolve(
        &env.conn,
        &runtime::ResolveInput { agent_id: &strict.id, revision: None, project_id: Some("p1"), repository_id: Some(WEB), repository_path: None, known_mcp_server_ids: None, require_enabled: false },
        &env.matrix,
    )
    .unwrap();
    assert!(manifest.blocked, "unverified isolation blocks strict agents");
}

// AC-18：需要用户处理的协作消息进入收件箱；渠道投递可 ack/失败重试，已读推进 UI 投递；outbox 定期压缩。
#[test]
fn channel_inbox_delivery_and_outbox_compaction() {
    let env = setup();
    let plan = json!({ "requestId": "plan-i", "tasks": [{ "key": "FE-1", "title": "改页面", "repositoryId": WEB, "kind": "implement" }] });
    let (rid, planner) = plan_requirement(&env, plan);
    succeed(&env, &planner);
    for _ in 0..3 {
        let fe = claim(&env);
        run(&env, &fe, "result", json!({ "status": "failed", "summary": "编译失败", "failureReason": "tsc" }));
        finish(&env, &fe, "completed");
    }
    let inbox = super::events::channel_inbox(&env.conn, None, 50, false).unwrap();
    assert!(!inbox.is_empty(), "budget exhaustion should notify the user");
    assert!(inbox.iter().all(|e| e.requirement_id == rid && !e.read));
    assert!(inbox.iter().any(|e| e.message.kind == "decision.required"));

    let due = super::events::due_outbox(&env.conn, "channel", 50).unwrap();
    assert_eq!(due.len(), inbox.len());
    super::events::ack_outbox(&env.conn, due[0].id, true, None).unwrap();
    super::events::ack_outbox(&env.conn, due[1].id, false, Some("webhook 502")).unwrap();
    let after = super::events::channel_inbox(&env.conn, None, 50, false).unwrap();
    let delivered_mid = due[0].message.as_ref().unwrap().id.clone();
    let failed_mid = due[1].message.as_ref().unwrap().id.clone();
    let channel_state = |mid: &str| {
        after
            .iter()
            .find(|e| e.message.id == mid)
            .unwrap()
            .message
            .deliveries
            .iter()
            .find(|d| d.target_kind == "channel")
            .unwrap()
            .state
            .clone()
    };
    assert_eq!(channel_state(&delivered_mid), "delivered");
    assert_eq!(channel_state(&failed_mid), "failed");
    let failed = after.iter().find(|e| e.message.id == failed_mid).unwrap();
    assert_eq!(failed.outbox_attempts, 1);
    assert_eq!(failed.outbox_error.as_deref(), Some("webhook 502"));
    assert!(super::events::due_outbox(&env.conn, "channel", 50).unwrap().iter().all(|d| d.id != due[1].id), "failed item backs off");

    assert_eq!(super::events::mark_inbox_read(&env.conn, &[delivered_mid.clone()]).unwrap(), 1);
    assert_eq!(super::events::mark_inbox_read(&env.conn, &[delivered_mid.clone()]).unwrap(), 0, "idempotent");
    let unread = super::events::channel_inbox(&env.conn, None, 50, true).unwrap();
    assert!(unread.iter().all(|e| e.message.id != delivered_mid));
    assert_eq!(unread.len(), inbox.len() - 1);

    let pending_ui: i64 = env
        .conn
        .query_row("SELECT COUNT(*) FROM collab_outbox WHERE channel = 'ui' AND state = 'pending'", [], |r| r.get(0))
        .unwrap();
    assert!(pending_ui > 0);
    env.conn.execute("UPDATE collab_outbox SET created_at = created_at - 3600000 WHERE channel IN ('ui', 'channel')", []).unwrap();
    super::events::compact_outbox(&env.conn).unwrap();
    let (ui_left, channel_left): (i64, i64) = env
        .conn
        .query_row(
            "SELECT SUM(channel = 'ui' AND state = 'pending'), SUM(channel = 'channel' AND state = 'pending') FROM collab_outbox",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ui_left, 0);
    assert!(channel_left > 0, "channel rows are only finished by the pump");
}

fn try_claim_limit(env: &Env, limit: i64) -> Option<ClaimedTask> {
    scheduler::claim_next(
        &env.conn,
        &ClaimInput { lease_owner: "test".into(), global_limit: Some(limit), requirement_id: None, task_id: None, known_mcp_server_ids: None },
        &env.repos,
        &env.matrix,
    )
    .unwrap()
    .claimed
}

fn ctl(env: &Env, rid: &str, action: &str, rq: &str) -> super::error::CResult<model::RequirementRow> {
    requirements::control(&env.conn, &ControlInput { request_id: rq.into(), requirement_id: rid.into(), action: action.into(), expected_revision: None })
}

// AC-01 / AC-02：一条需求覆盖多个仓库任务，每个执行会话使用各自仓库目录；参与项目可见同一需求。
#[test]
fn multi_repository_tasks_use_their_own_directories() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    assert_eq!(planner.repository.as_ref().unwrap().path, env.repos.get(&WEB).unwrap().path, "owner plans inside its bound repository");
    succeed(&env, &planner);
    let be = claim(&env);
    assert_eq!(be.repository.as_ref().unwrap().path, env.repos.get(&API).unwrap().path);
    assert!(be.spawn.append_system_prompt.contains("后端智能体 的工作规则"), "delegated executor runs with its own config");
    assert!(!be.spawn.append_system_prompt.contains("商城主责 的工作规则"));
    assert_eq!(model::load_requirement(&env.conn, &be.requirement_id).unwrap().owner_agent_id.as_deref(), Some(env.owner.as_str()), "ownership is kept");
    let v1 = publish_api(&env, &be, "abc1234", json!({ "status": "string" }));
    succeed(&env, &be);
    let fe = claim(&env);
    assert_eq!(fe.repository.as_ref().unwrap().path, env.repos.get(&WEB).unwrap().path);
    assert!(fe.prompt.contains(&format!("orders-api")) && fe.prompt.contains(&v1.version.to_string()), "consumer gets the pinned version");
    let n: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_requirements", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1, "one requirement, no per-repository copies");

    let other = requirements::create_requirement(
        &env.conn,
        &requirements::CreateRequirementInput {
            request_id: "two-projects".into(),
            body: "商城与运维共同完成".into(),
            owner_agent_id: Some(env.owner.clone()),
            owner_project_id: Some("p1".into()),
            participant_project_ids: vec!["p2".into()],
            ..Default::default()
        },
    )
    .unwrap();
    let visible_p2 = requirements::list_summaries(&env.conn, Some("p2"), true).unwrap();
    assert!(visible_p2.iter().any(|r| r["id"] == other.id.as_str()), "participant project sees the same requirement");
    let _ = rid;
}

// AC-35：运行中补充要求 → 影响清单；无关任务继续；受影响任务重做，旧结果不满足新版本。
#[test]
fn revision_during_execution_lists_impact_and_keeps_unrelated_tasks() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    succeed(&env, &planner);
    let be = claim(&env);
    let old_fe = task_by_key(&env, &rid, "FE-1");

    let revised = requirements::revise_requirement(
        &env.conn,
        &requirements::ReviseInput { request_id: "rv-1".into(), requirement_id: rid.clone(), input: "页面还要展示下单时间".into(), ..Default::default() },
    )
    .unwrap();
    assert_eq!(revised.requirement_revision, 2);
    let ack = scheduler::heartbeat(&env.conn, &be.attempt.id, be.attempt.fencing_token).unwrap();
    assert!(!ack.stop_requested, "unrelated running work continues");

    let replanner = claim(&env);
    assert_eq!(replanner.task.kind, "plan");
    assert_eq!(replanner.task.next_action, "replan");
    let mut plan = cross_repo_plan();
    plan["requestId"] = json!("plan-2");
    plan["tasks"][1]["goal"] = json!("展示订单状态与下单时间");
    let out = run(&env, &replanner, "plan", plan);
    assert_eq!(out["state"], "active");
    let impacts = out["impacts"].as_array().unwrap();
    let action = |key: &str| impacts.iter().find(|i| i["taskKey"] == key).unwrap()["action"].as_str().unwrap().to_string();
    assert_eq!(action("BE-1"), "keep");
    assert_eq!(action("FE-1"), "redo");
    let new_fe = task_by_key(&env, &rid, "FE-1");
    assert_ne!(new_fe.id, old_fe.id, "the old FE task no longer satisfies the new revision");
    assert!(!model::load_task(&env.conn, &old_fe.id).unwrap().active);
    assert_eq!(task_by_key(&env, &rid, "BE-1").id, be.task.id, "BE keeps its task and progress");
    assert!(!super::plans::list_impacts(&env.conn, &rid).unwrap().is_empty(), "impact list is persisted for the UI");
}

// AC-36 / AC-14：取消与完成回调竞争；未停稳显示中间态并保留写锁；取消后不复活。
#[test]
fn cancel_races_with_completion_and_never_revives() {
    let env = setup();
    let plan = json!({ "requestId": "plan-c", "tasks": [{ "key": "FE-1", "title": "改页面", "repositoryId": WEB, "kind": "implement" }] });
    let (rid, planner) = plan_requirement(&env, plan);
    succeed(&env, &planner);
    let fe = claim(&env);
    assert_eq!(ctl(&env, &rid, "cancel", "x1").unwrap().control_status, "cancelling");
    let locks: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_workspace_locks WHERE attempt_id = ?1", params![fe.attempt.id], |r| r.get(0)).unwrap();
    assert_eq!(locks, 1, "write lock is held until the attempt actually stops");
    // The completion callback lands after the cancel request.
    run(&env, &fe, "result", json!({ "status": "succeeded", "summary": "已完成" }));
    finish(&env, &fe, "completed");
    let req = model::load_requirement(&env.conn, &rid).unwrap();
    assert_eq!(req.control_status, "cancelled");
    assert_ne!(req.business_status, "done", "a cancelled requirement is not completed by a late callback");
    assert!(try_claim(&env).is_none(), "nothing is dispatched after cancel");
    let locks: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_workspace_locks WHERE attempt_id = ?1", params![fe.attempt.id], |r| r.get(0)).unwrap();
    assert_eq!(locks, 0);
    assert!(requirements::revise_requirement(
        &env.conn,
        &requirements::ReviseInput { request_id: "rv-c".into(), requirement_id: rid.clone(), input: "再改".into(), ..Default::default() },
    )
    .is_err());
}

// AC-38：全局并发为 1 时排队等待槽位且无死锁；其他需求仍可执行；执行预算不因换会话重置。
#[test]
fn global_limit_queues_without_deadlock_and_budget_survives_sessions() {
    let env = setup();
    let a = dispatch(&env, "req-a", "execute", "需求 A");
    let b = dispatch(&env, "req-b", "execute", "需求 B");
    let first = try_claim_limit(&env, 1).expect("one slot");
    assert!(try_claim_limit(&env, 1).is_none(), "second requirement waits for the slot");
    let check = scheduler::confirm_launch(&env.conn, &first.attempt.id, first.attempt.fencing_token).unwrap();
    assert!(check.proceed);
    finish(&env, &first, "stopped");
    let second = try_claim_limit(&env, 1).expect("slot released");
    let rids = [a.requirement_id.clone().unwrap(), b.requirement_id.clone().unwrap()];
    assert!(rids.contains(&first.requirement_id) && rids.contains(&second.requirement_id));
    scheduler::confirm_launch(&env.conn, &second.attempt.id, second.attempt.fencing_token).unwrap();
    finish(&env, &second, "stopped");
    for (i, r) in rids.iter().enumerate() {
        ctl(&env, r, "cancel", &format!("cancel-{i}")).unwrap();
    }

    let plan = json!({ "requestId": "plan-g", "tasks": [{ "key": "FE-1", "title": "改页面", "repositoryId": WEB, "kind": "implement" }] });
    let d = dispatch(&env, "req-g", "execute", "预算需求");
    let rid = d.requirement_id.unwrap();
    let planner = claim(&env);
    assert_eq!(planner.requirement_id, rid);
    run(&env, &planner, "plan", plan);
    succeed(&env, &planner);
    let mut sessions = Vec::new();
    while let Some(c) = try_claim(&env) {
        assert!(sessions.len() < 5, "budget must stop retries");
        assert_eq!(c.requirement_id, rid);
        scheduler::confirm_launch(&env.conn, &c.attempt.id, c.attempt.fencing_token).unwrap();
        let session = format!("fresh-session-{}", sessions.len());
        scheduler::bind_session(&env.conn, &c.attempt.id, c.attempt.fencing_token, &session).unwrap();
        sessions.push(session);
        finish(&env, &c, "error");
    }
    assert_eq!(sessions.len(), 3, "attempt budget counts across different sessions");
    assert_eq!(task_by_key(&env, &rid, "FE-1").state, "failed");
}

// AC-39：更换主责保留历史身份与检查点，新主责使用自己的配置，私有配置不串用。
#[test]
fn owner_transfer_keeps_history_and_uses_new_config() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    succeed(&env, &planner);
    let new_owner = enabled_agent(&env.conn, "新主责", &[("p1", WEB)], vec![env.backend.clone()]);
    let moved = requirements::transfer_owner(
        &env.conn,
        &requirements::TransferOwnerInput { request_id: "tr-1".into(), requirement_id: rid.clone(), target_agent_id: new_owner.clone(), ..Default::default() },
    )
    .unwrap();
    assert_eq!(moved.owner_agent_id.as_deref(), Some(new_owner.as_str()));
    let old_planner = model::load_task(&env.conn, &planner.task.id).unwrap();
    assert_eq!(old_planner.executor_agent_id.as_deref(), Some(env.owner.as_str()), "history keeps the previous owner identity");
    assert_eq!(old_planner.state, "succeeded");
    let takeover = loop {
        let c = claim(&env);
        if c.task.kind == "plan" {
            break c;
        }
        finish(&env, &c, "stopped");
    };
    assert_eq!(takeover.task.executor_agent_id.as_deref(), Some(new_owner.as_str()));
    assert!(takeover.spawn.append_system_prompt.contains("新主责 的工作规则"));
    assert!(!takeover.spawn.append_system_prompt.contains("商城主责 的工作规则"), "private config is not carried over");
    let events = super::events::events_since(&env.conn, &rid, 0).unwrap();
    assert!(events.iter().any(|e| e["type"] == "requirement.owner_transferred"));
}

fn claim_task(env: &Env, task_id: &str) -> ClaimedTask {
    let c = scheduler::claim_next(
        &env.conn,
        &ClaimInput { lease_owner: "test".into(), global_limit: Some(8), requirement_id: None, task_id: Some(task_id.into()), known_mcp_server_ids: None },
        &env.repos,
        &env.matrix,
    )
    .unwrap()
    .claimed
    .unwrap_or_else(|| panic!("task {task_id} should be claimable"));
    assert!(scheduler::confirm_launch(&env.conn, &c.attempt.id, c.attempt.fencing_token).unwrap().proceed);
    scheduler::bind_session(&env.conn, &c.attempt.id, c.attempt.fencing_token, &format!("session-{}", c.attempt.id)).unwrap();
    c
}

fn two_consumer_plan() -> Value {
    let mut plan = cross_repo_plan();
    plan["requestId"] = json!("plan-2c");
    plan["tasks"].as_array_mut().unwrap().push(json!({
        "key": "FE-2", "title": "订单列表页", "repositoryId": WEB, "kind": "implement", "role": "frontend",
        "goal": "列表展示订单状态", "inputs": [{ "artifact": "orders-api", "operations": ["getOrder"] }],
        "verification": { "commands": ["bun test"] }
    }));
    plan["dependencies"].as_array_mut().unwrap().push(json!({ "task": "FE-2", "producer": "BE-1", "gate": "artifact_ready", "artifact": "orders-api" }));
    plan
}

fn missing_field_change(rq: &str, version: i64, field: &str) -> Value {
    json!({
        "requestId": rq, "category": "contract_violation", "summary": format!("缺少 {field}"),
        "artifact": "orders-api", "consumedVersion": version, "operation": "getOrder", "field": field,
        "expected": { field: "string" }, "actual": { "status": "PAID" },
        "reproduction": ["GET /orders/1"], "impact": "页面无法展示", "acceptance": [format!("返回 {field}")],
        "checkpoint": { "completed": ["页面骨架"], "todo": [field], "resumeNotes": "等待接口补字段" }
    })
}

/// Backend delivered v1; returns (rid, v1, FE-1 id, FE-2 id).
fn delivered_two_consumers(env: &Env) -> (String, model::ArtifactVersionRow, String, String) {
    let (rid, planner) = plan_requirement(env, two_consumer_plan());
    env.conn.execute("UPDATE collab_requirements SET repair_round_budget = 2 WHERE id = ?1", params![rid]).unwrap();
    succeed(env, &planner);
    let be = claim_task(env, &task_by_key(env, &rid, "BE-1").id);
    let v1 = publish_api(env, &be, "abc1234", json!({ "status": "string" }));
    succeed(env, &be);
    let fe1 = task_by_key(env, &rid, "FE-1").id;
    let fe2 = task_by_key(env, &rid, "FE-2").id;
    (rid, v1, fe1, fe2)
}

fn repair_round(env: &Env, change_id: &str, commit: &str, fields: Value) -> model::ArtifactVersionRow {
    let cr = model::load_change(&env.conn, change_id).unwrap();
    let repair = claim_task(env, cr.current_repair_task_id.as_deref().unwrap());
    assert_eq!(repair.task.kind, "repair");
    assert_eq!(repair.task.repair_round, Some(cr.round));
    let v = publish_api(env, &repair, commit, fields);
    succeed(env, &repair);
    assert_eq!(model::load_change(&env.conn, change_id).unwrap().state, "ready_for_retest");
    v
}

fn retest(env: &Env, c: &ClaimedTask, change_id: &str, version: i64, passed: bool, rq: &str) -> Value {
    let cr = model::load_change(&env.conn, change_id).unwrap();
    let run_id = record_evidence(env, c, "fe00001", passed);
    run(
        env,
        c,
        "retest",
        json!({ "requestId": rq, "changeRequestId": change_id, "round": cr.round, "version": version,
                "passed": passed, "verificationRunIds": [run_id], "summary": if passed { "通过" } else { "仍失败" } }),
    )
}

// AC-07 / AC-08：两个前端报告同一缺陷 → 合并且保留两个消费回执；复验失败增加轮次，到上限请求决策；全部通过才关闭。
#[test]
fn merged_consumers_rounds_and_repair_budget() {
    let env = setup();
    let (rid, v1, fe1, fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    let first = run(&env, &a, "change", missing_field_change("c-a", v1.version, "statusText"));
    let change_id = first["change"]["id"].as_str().unwrap().to_string();
    finish(&env, &a, "stopped");
    let b = claim_task(&env, &fe2);
    let second = run(&env, &b, "change", missing_field_change("c-b", v1.version, "statusText"));
    assert_eq!(second["merged"], true);
    assert_eq!(second["change"]["id"], change_id.as_str());
    finish(&env, &b, "stopped");
    let cr = model::load_change(&env.conn, &change_id).unwrap();
    assert_eq!(cr.consumers.iter().filter(|c| c.round == 1).count(), 2, "both consumer receipts are kept");
    let repairs: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_tasks WHERE change_request_id = ?1 AND kind = 'repair'", params![change_id], |r| r.get(0)).unwrap();
    assert_eq!(repairs, 1, "one repair task for the merged problem");

    // Round 1: FE-1 passes, FE-2 fails → round 2 for everyone still involved.
    let v2 = repair_round(&env, &change_id, "def0002", json!({ "status": "string", "statusText": "number" }));
    let a = claim_task(&env, &fe1);
    let after_a = retest(&env, &a, &change_id, v2.version, true, "rt-a1");
    assert_eq!(after_a["state"], "ready_for_retest", "not closed until every consumer passes");
    succeed(&env, &a);
    let b = claim_task(&env, &fe2);
    let after_b = retest(&env, &b, &change_id, v2.version, false, "rt-b1");
    assert_eq!(after_b["round"], 2, "same change request, next round");
    assert_eq!(after_b["state"], "fixing");
    finish(&env, &b, "stopped");
    let t1 = model::load_task(&env.conn, &fe1).unwrap();
    assert_eq!(t1.state, "waiting_change", "a consumer that passed round 1 re-verifies the next candidate");

    // Round 2 fails again → budget (2) exhausted → decision instead of another automatic round.
    let v3 = repair_round(&env, &change_id, "def0003", json!({ "status": "string", "statusText": "number" }));
    let b = claim_task(&env, &fe2);
    let stale = run_err(
        &env,
        &b,
        "retest",
        json!({ "requestId": "rt-old", "changeRequestId": change_id, "round": 1, "version": v2.version, "passed": false }),
    );
    assert_eq!(stale.code, codes::STALE_ROUND, "an old round receipt cannot change the new round");
    let exhausted = retest(&env, &b, &change_id, v3.version, false, "rt-b2");
    assert_eq!(exhausted["state"], "needs_decision");
    assert_eq!(exhausted["round"], 2);
    finish(&env, &b, "stopped");
    let repairs: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_tasks WHERE change_request_id = ?1 AND kind = 'repair'", params![change_id], |r| r.get(0)).unwrap();
    assert_eq!(repairs, 2, "no third automatic round");
    let decision = model::list_decisions(&env.conn, &rid, true).unwrap().into_iter().find(|d| d.kind == "repair_budget").expect("repair budget decision");
    assert!(decision.task_ids.contains(&fe2));
    super::decisions::resolve(
        &env.conn,
        &super::decisions::ResolveDecisionInput {
            decision_id: decision.id.clone(),
            expected_revision: decision.revision,
            option_id: "add_budget".into(),
            values: json!({ "extraRounds": 1 }),
            request_id: "dec-rb".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let cr = model::load_change(&env.conn, &change_id).unwrap();
    assert_eq!((cr.round, cr.state.as_str()), (3, "fixing"));
    let v4 = repair_round(&env, &change_id, "def0004", json!({ "status": "string", "statusText": "string" }));
    let b = claim_task(&env, &fe2);
    let half = retest(&env, &b, &change_id, v4.version, true, "rt-b3");
    assert_eq!(half["state"], "ready_for_retest");
    succeed(&env, &b);
    let a = claim_task(&env, &fe1);
    let closed = retest(&env, &a, &change_id, v4.version, true, "rt-a3");
    assert!(matches!(closed["state"].as_str(), Some("closed") | Some("verified")), "{closed}");
    succeed(&env, &a);
    assert_eq!(model::load_requirement(&env.conn, &rid).unwrap().business_status, "verifying");
}

// AC-09：一个前端被两个问题阻塞，只解决一个时不恢复；另一无关任务可继续。
#[test]
fn consumer_blocked_by_two_changes_waits_for_both() {
    let env = setup();
    let (_rid, v1, fe1, fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    let c1 = run(&env, &a, "change", missing_field_change("c-1", v1.version, "statusText"));
    let c2 = run(&env, &a, "change", missing_field_change("c-2", v1.version, "paidAt"));
    let (id1, id2) = (c1["change"]["id"].as_str().unwrap().to_string(), c2["change"]["id"].as_str().unwrap().to_string());
    assert_ne!(id1, id2, "different problems are different change requests");
    finish(&env, &a, "stopped");
    assert_eq!(model::load_task(&env.conn, &fe2).unwrap().state, "ready", "unrelated consumer keeps going");

    let _ = repair_round(&env, &id1, "def0101", json!({ "status": "string", "statusText": "string" }));
    assert_eq!(model::load_task(&env.conn, &fe1).unwrap().state, "waiting_change", "one fix is not enough");
    let _ = repair_round(&env, &id2, "def0102", json!({ "status": "string", "statusText": "string", "paidAt": "string" }));
    let t = model::load_task(&env.conn, &fe1).unwrap();
    assert_eq!((t.state.as_str(), t.next_action.as_str()), ("ready", "retest_then_continue"));
}

// AC-37：修复方拒绝需证据复核且不能单方面解锁消费者；环境故障不消耗修正轮次。
#[test]
fn rejection_needs_review_and_environment_keeps_rounds() {
    let env = setup();
    let (rid, v1, fe1, fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    let c = run(&env, &a, "change", missing_field_change("c-r", v1.version, "statusText"));
    let change_id = c["change"]["id"].as_str().unwrap().to_string();
    finish(&env, &a, "stopped");
    let cr = model::load_change(&env.conn, &change_id).unwrap();
    let repair = claim_task(&env, cr.current_repair_task_id.as_deref().unwrap());
    let empty = super::changes::propose_rejection(
        &env.conn,
        &repair.attempt.id,
        repair.attempt.fencing_token,
        &super::changes::RejectionProposal { change_request_id: change_id.clone(), reason: " ".into(), evidence: json!({}) },
    );
    assert!(empty.is_err(), "rejection requires a reason and evidence");
    let d = super::changes::propose_rejection(
        &env.conn,
        &repair.attempt.id,
        repair.attempt.fencing_token,
        &super::changes::RejectionProposal { change_request_id: change_id.clone(), reason: "statusText 不在契约内".into(), evidence: json!({ "contract": "v1" }) },
    )
    .unwrap();
    assert_eq!(model::load_task(&env.conn, &fe1).unwrap().state, "waiting_change", "consumer stays blocked until reviewed");
    super::decisions::resolve(
        &env.conn,
        &super::decisions::ResolveDecisionInput { decision_id: d.id.clone(), expected_revision: d.revision, option_id: "confirm_reject".into(), request_id: "dec-rj".into(), ..Default::default() },
    )
    .unwrap();
    finish(&env, &repair, "stopped");
    assert_eq!(model::load_change(&env.conn, &change_id).unwrap().state, "rejected");
    assert_ne!(model::load_task(&env.conn, &fe1).unwrap().state, "waiting_change", "released only after the decision");
    let _ = rid;

    // Environment fault: a failing retest re-runs the env fix in the same round.
    let b = claim_task(&env, &fe2);
    let env_change = run(
        &env,
        &b,
        "change",
        json!({ "requestId": "c-env", "category": "environment", "summary": "测试环境数据库未启动",
                "environment": { "service": "postgres", "error": "ECONNREFUSED" },
                "reproduction": ["bun test"], "impact": "无法联调", "acceptance": ["数据库可连接"] }),
    );
    assert_eq!(env_change["consumerParked"], true);
    let env_id = env_change["change"]["id"].as_str().unwrap().to_string();
    finish(&env, &b, "stopped");
    for i in 0..3 {
        let cr = model::load_change(&env.conn, &env_id).unwrap();
        assert_eq!(cr.round, 1, "environment fixes never consume business repair rounds");
        let fix = claim_task(&env, cr.current_repair_task_id.as_deref().unwrap());
        assert_eq!(fix.task.kind, "env");
        succeed(&env, &fix);
        let b = claim_task(&env, &fe2);
        let rq = format!("rt-env-{i}");
        let run_id = record_evidence(&env, &b, "fe00002", false);
        let out = run(&env, &b, "retest", json!({ "requestId": rq, "changeRequestId": env_id, "round": 1, "passed": false, "verificationRunIds": [run_id] }));
        assert_eq!(out["round"], 1);
        assert_eq!(out["state"], "fixing");
        finish(&env, &b, "stopped");
    }
    assert!(model::list_decisions(&env.conn, &model::load_change(&env.conn, &env_id).unwrap().requirement_id, true)
        .unwrap()
        .iter()
        .all(|d| d.kind != "repair_budget"));
}

fn accept_current(env: &Env, rid: &str, rq: &str) -> super::error::CResult<super::acceptance::AcceptanceManifest> {
    let m = super::acceptance::refresh_manifest(&env.conn, rid).unwrap();
    super::acceptance::accept(
        &env.conn,
        &super::acceptance::AcceptInput { request_id: rq.into(), requirement_id: rid.into(), manifest_revision: m.revision, manifest_hash: m.content_hash, ..Default::default() },
    )
}

// AC-03：后端会话结束但未提供契约 → 前端不启动，展示缺失交付条件。
#[test]
fn producer_without_delivery_keeps_consumer_blocked() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    succeed(&env, &planner);
    let be = claim(&env);
    run(&env, &be, "result", json!({ "status": "succeeded", "summary": "改完了" }));
    finish(&env, &be, "completed");
    let be_task = model::load_task(&env.conn, &be.task.id).unwrap();
    assert_ne!(be_task.state, "succeeded", "declared delivery missing ⇒ not a success");
    let fe = task_by_key(&env, &rid, "FE-1");
    assert_eq!(fe.state, "waiting_dependencies");
    let why = scheduler::explain_requirement(&env.conn, &rid).unwrap();
    let fe_why = why.iter().find(|t| t.task_key == "FE-1").unwrap();
    assert!(!fe_why.blockers.is_empty(), "UI can show the missing delivery condition");
    assert!(serde_json::to_string(&fe_why.blockers).unwrap().contains("orders-api"));
    while let Some(c) = try_claim(&env) {
        assert_ne!(c.task.task_key, "FE-1", "consumer never starts without a valid delivery");
        finish(&env, &c, "stopped");
        break;
    }
}

// AC-19：环境报告的 commit 与交付 commit 不一致 → 校验失败，不用过时环境伪造通过。
#[test]
fn deployed_commit_mismatch_fails_validation() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    succeed(&env, &planner);
    let be = claim(&env);
    let run_id = record_evidence(&env, &be, "abc1234", true);
    let att = model::load_attempt(&env.conn, &be.attempt.id).unwrap();
    let body = |deployed: &str| {
        json!({ "name": "orders-api", "commitSha": "abc1234",
                "contract": { "operations": [{ "id": "getOrder", "method": "GET", "path": "/orders/{id}", "response": { "status": "string" } }] },
                "endpoint": "http://127.0.0.1:18080", "healthUrl": "http://127.0.0.1:18080/health",
                "deployedCommit": deployed, "testEvidenceRunIds": [run_id] })
    };
    let health = |reported: &str| HealthOutcome {
        url: "http://127.0.0.1:18080/health".into(),
        ok: true,
        status: Some(200),
        reported_commit: Some(reported.into()),
        error: None,
        checked_at: super::util::now_ms(),
    };
    let Step::Validate { version_id, .. } = agent_command(&env.conn, &env.repos, &att, "artifact", &body("abc1234")).unwrap() else { panic!() };
    let stale_env = super::artifacts::apply_validation(&env.conn, &version_id, Some(&health("9999999"))).unwrap();
    assert_eq!(stale_env.validation_state, "invalid");
    assert!(stale_env.invalid_reason.unwrap_or_default().contains("commit"));
    let Step::Validate { version_id, .. } = agent_command(&env.conn, &env.repos, &att, "artifact", &body("fffffff")).unwrap() else { panic!() };
    let wrong_deploy = super::artifacts::apply_validation(&env.conn, &version_id, Some(&health("fffffff"))).unwrap();
    assert_eq!(wrong_deploy.validation_state, "invalid", "declared deployment must match the delivered commit");
    assert_eq!(task_by_key(&env, &rid, "FE-1").state, "waiting_dependencies");

    // A valid version that later drifts is invalidated by the recheck.
    let ok = publish_api(&env, &be, "abc1234", json!({ "status": "string" }));
    assert_eq!(ok.validation_state, "valid");
    let drifted = super::artifacts::apply_recheck(&env.conn, &ok.id, &health("1234567")).unwrap();
    assert_eq!(drifted.validation_state, "invalidated");
}

// AC-20：新契约为破坏性变更 → 标记全部受影响消费者并创建复验；复验通过前不能验收。
#[test]
fn breaking_contract_marks_every_consumer_for_reverification() {
    let env = setup();
    let (rid, v1, fe1, fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    record_evidence(&env, &a, "fe00001", true);
    succeed(&env, &a);
    let b = claim_task(&env, &fe2);
    let c = run(&env, &b, "change", missing_field_change("c-br", v1.version, "statusText"));
    let change_id = c["change"]["id"].as_str().unwrap().to_string();
    finish(&env, &b, "stopped");
    // The repair renames `status` → breaking for FE-1, which consumed v1.
    let v2 = repair_round(&env, &change_id, "def0201", json!({ "state": "string", "statusText": "string" }));
    assert_eq!(v2.compatibility, "breaking");
    assert!(!v2.changed_fields.as_array().map(Vec::is_empty).unwrap_or(true), "consumer impact lists changed fields");
    let reverify = model::list_tasks(&env.conn, &rid, true)
        .unwrap()
        .into_iter()
        .find(|t| t.task_key.starts_with("REVERIFY-FE-1"))
        .expect("FE-1 must re-verify the breaking version");
    assert_eq!(reverify.spec["reverifyOf"], fe1.as_str());
    let impact: String = env
        .conn
        .query_row(
            "SELECT impact FROM collab_artifact_consumers WHERE task_id = ?1 AND artifact_version_id = ?2",
            params![fe1, v1.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(impact, "reverify");
    let err = accept_current(&env, &rid, "acc-br").unwrap_err();
    assert!(err.message.contains("REVERIFY") || err.message.contains("未完成"), "{}", err.message);
}

// AC-15 / AC-40：各仓库完成但联合测试失败不能完成；无证据不能完成；陈旧验收被拒绝；验收口径变化有修订记录。
#[test]
fn acceptance_requires_current_manifest_and_passing_evidence() {
    let env = setup();
    let (rid, planner) = plan_requirement(&env, cross_repo_plan());
    succeed(&env, &planner);
    let be = claim(&env);
    publish_api(&env, &be, "abc1234", json!({ "status": "string" }));
    succeed(&env, &be);
    let fe = claim(&env);
    succeed(&env, &fe);
    assert_eq!(model::load_requirement(&env.conn, &rid).unwrap().business_status, "verifying");
    let no_evidence = accept_current(&env, &rid, "acc-0").unwrap_err();
    assert!(no_evidence.message.contains("FE-1 缺少 Wise 验证证据"), "{}", no_evidence.message);
    assert!(!super::acceptance::try_machine_accept(&env.conn, &rid).unwrap());

    // The cross-repository test is re-run and fails even though every repository said "done".
    let fe_task = task_by_key(&env, &rid, "FE-1");
    let now = super::util::now_ms();
    verification::record_run(
        &env.conn,
        &PreparedRun { requirement_id: rid.clone(), task_id: fe_task.id.clone(), attempt_id: None, repository_id: Some(WEB), command: "bun test e2e".into(), cwd: String::new(), timeout_ms: 1_000 },
        &RunOutcome { exit_code: Some(1), output_tail: "order page e2e failed".into(), head_commit: Some("fe00001".into()), dirty: false, timed_out: false, started_at: now, finished_at: now },
    )
    .unwrap();
    let failing = accept_current(&env, &rid, "acc-1").unwrap_err();
    assert!(failing.message.contains("最新验证运行未通过"), "{}", failing.message);
    assert_ne!(model::load_requirement(&env.conn, &rid).unwrap().business_status, "done");

    verification::record_run(
        &env.conn,
        &PreparedRun { requirement_id: rid.clone(), task_id: fe_task.id.clone(), attempt_id: None, repository_id: Some(WEB), command: "bun test e2e".into(), cwd: String::new(), timeout_ms: 1_000 },
        &RunOutcome { exit_code: Some(0), output_tail: "ok".into(), head_commit: Some("fe00002".into()), dirty: false, timed_out: false, started_at: now + 1, finished_at: now + 1 },
    )
    .unwrap();
    let page = super::acceptance::refresh_manifest(&env.conn, &rid).unwrap();
    // The acceptance criteria change while the page is open: an explicit revision, and the old page is stale.
    requirements::revise_requirement(
        &env.conn,
        &requirements::ReviseInput { request_id: "rv-acc".into(), requirement_id: rid.clone(), input: "验收口径：状态文案需中文".into(), ..Default::default() },
    )
    .unwrap();
    let revisions: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_requirement_revisions WHERE requirement_id = ?1", params![rid], |r| r.get(0)).unwrap();
    assert!(revisions >= 1, "acceptance changes are recorded as revisions");
    let stale = super::acceptance::accept(
        &env.conn,
        &super::acceptance::AcceptInput { request_id: "acc-2".into(), requirement_id: rid.clone(), manifest_revision: page.revision, manifest_hash: page.content_hash.clone(), ..Default::default() },
    )
    .unwrap_err();
    assert_eq!(stale.code, codes::STALE_ACCEPTANCE);
    assert_ne!(model::load_requirement(&env.conn, &rid).unwrap().business_status, "done");
}

// AC-17：责任不明或属于新增范围 → 进入决策，不自动派修复、不重复广播。
#[test]
fn unclear_ownership_goes_to_decision_without_broadcast() {
    let env = setup();
    let (rid, v1, fe1, fe2) = delivered_two_consumers(&env);
    let unclear = |rq: &str| {
        json!({ "requestId": rq, "category": "scope", "summary": "需要新增优惠券字段", "artifact": "orders-api",
                "consumedVersion": v1.version, "operation": "getOrder", "field": "coupon",
                "expected": { "coupon": "object" }, "actual": {}, "reproduction": ["GET /orders/1"],
                "impact": "无法展示优惠", "acceptance": ["展示优惠券"] })
    };
    let a = claim_task(&env, &fe1);
    let first = run(&env, &a, "change", unclear("s-1"));
    finish(&env, &a, "stopped");
    let b = claim_task(&env, &fe2);
    let second = run(&env, &b, "change", unclear("s-2"));
    finish(&env, &b, "stopped");
    assert_eq!(second["merged"], true, "same unclear problem is merged, not broadcast twice");
    let change_id = first["change"]["id"].as_str().unwrap();
    assert_eq!(model::load_change(&env.conn, change_id).unwrap().state, "needs_decision");
    let repairs: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_tasks WHERE requirement_id = ?1 AND kind IN ('repair', 'env')", params![rid], |r| r.get(0)).unwrap();
    assert_eq!(repairs, 0, "no automatic repair or scope expansion");
    let triage: Vec<_> = model::list_decisions(&env.conn, &rid, true).unwrap().into_iter().filter(|d| d.kind == "change_triage").collect();
    assert_eq!(triage.len(), 1);
}

// AC-18：修正任务已创建但通知失败 → 任务不丢失不重建；通知独立重试，状态可查询。
#[test]
fn notification_failure_does_not_lose_or_duplicate_tasks() {
    let env = setup();
    let (rid, v1, fe1, _fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    let body = missing_field_change("n-1", v1.version, "statusText");
    let first = run(&env, &a, "change", body.clone());
    let change_id = first["change"]["id"].as_str().unwrap().to_string();
    let repair_id = model::load_change(&env.conn, &change_id).unwrap().current_repair_task_id.unwrap();
    let inbox = super::events::task_inbox(&env.conn, &repair_id).unwrap();
    let msg = inbox.iter().find(|m| m.kind == "change.requested").expect("repair task has a message");
    assert!(super::events::advance_delivery(&env.conn, &msg.id, "task", &repair_id, "failed", Some("session unreachable")).unwrap());
    let replay = run(&env, &a, "change", body);
    assert_eq!(replay["change"]["id"], change_id.as_str(), "replay returns the same change");
    let repairs: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_tasks WHERE requirement_id = ?1 AND kind = 'repair'", params![rid], |r| r.get(0)).unwrap();
    assert_eq!(repairs, 1, "task is neither lost nor re-created");
    assert_eq!(model::load_task(&env.conn, &repair_id).unwrap().state, "ready");
    let status = super::events::load_message(&env.conn, &msg.id).unwrap();
    assert!(serde_json::to_string(&status).unwrap().contains("failed"), "delivery status is queryable");
    // Channel notifications retry independently of the task.
    let due = super::events::due_outbox(&env.conn, "channel", 50).unwrap();
    let item = due.iter().find(|o| o.message.as_ref().is_some_and(|m| m.kind == "change.requested")).expect("channel notification queued");
    super::events::ack_outbox(&env.conn, item.id, false, Some("webhook 502")).unwrap();
    let (attempts, state): (i64, String) = env.conn.query_row("SELECT attempts, state FROM collab_outbox WHERE id = ?1", params![item.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((attempts, state.as_str()), (1, "pending"));
    let repair = claim_task(&env, &repair_id);
    assert_eq!(repair.task.kind, "repair", "execution proceeds despite the failed notification");
}

fn best_effort(name: &str) -> AgentConfig {
    let mut cfg = AgentConfig::default();
    cfg.run_policy.isolation = "best_effort".into();
    cfg.agents_md = format!("{name} 的工作规则");
    cfg
}

fn dispatch_as(env: &Env, agent: &str, rq: &str, mode: &str, body: &str) -> requirements::DispatchResult {
    requirements::dispatch_to_agent(
        &env.conn,
        &DispatchIntentInput { request_id: rq.into(), agent_id: agent.into(), mode: mode.into(), project_context: Some("p1".into()), body: body.into(), ..Default::default() },
        &env.repos,
        &env.matrix,
    )
    .unwrap()
}

fn resolve_for(env: &Env, agent: &str, revision: Option<i64>, repo: i64) -> runtime::EffectiveConfigManifest {
    let path = env.repos.get(&repo).unwrap().path.clone();
    runtime::resolve(
        &env.conn,
        &runtime::ResolveInput { agent_id: agent, revision, project_id: Some("p1"), repository_id: Some(repo), repository_path: Some(&path), known_mcp_server_ids: None, require_enabled: false },
        &env.matrix,
    )
    .unwrap()
}

fn republish(env: &Env, agent: &str, edit: impl FnOnce(&mut AgentConfig)) -> agents::AgentRevision {
    let p = agents::get_agent(&env.conn, agent).unwrap();
    let mut draft = p.draft.clone();
    edit(&mut draft);
    let p = agents::update_agent(&env.conn, agents::UpdateAgentInput { agent_id: agent.into(), expected_row_version: p.row_version, draft: Some(draft), ..Default::default() }).unwrap();
    agents::publish_agent(&env.conn, agent, p.row_version, "update").unwrap()
}

// AC-11 / AC-12：B 引用 A 授权知识 V1，上下文可追溯来源；A 发布 V2 后运行中任务仍读 V1；撤销即时阻断。
#[test]
fn authorized_knowledge_is_pinned_for_running_tasks() {
    let env = setup();
    use super::resources::{self, CreateResourceInput};
    let res = resources::create_resource(
        &env.conn,
        &CreateResourceInput {
            owner_project_id: Some("p2".into()), owner_agent_id: None, kind: "knowledge".into(), title: "订单状态字典".into(), maintainer: String::new(),
            visibility: "source".into(), space_id: None, repository_id: None, location: String::new(),
            content: "V1：PAID=已支付".into(), note: String::new(), source_ref: Value::Null, publisher: "user".into(),
        },
    )
    .unwrap();
    resources::grant(&env.conn, &res.id, "project", "p1").unwrap();
    let mut cfg = best_effort("知识智能体");
    cfg.knowledge_refs = vec![agents::KnowledgeRef { resource_id: res.id.clone(), pinned_version: None, label: "字典".into() }];
    let agent = enabled_agent_with(&env.conn, "知识智能体", &[("p1", WEB)], cfg);
    dispatch_as(&env, &agent, "k-1", "execute", "按字典展示订单状态");
    let planner = claim(&env);
    let refs = planner.context["inputManifest"]["resources"].as_array().unwrap().clone();
    let pinned = refs.iter().find(|r| r["id"] == res.id.as_str()).expect("resource is traceable in the context manifest");
    assert_eq!((pinned["version"].as_i64(), pinned["source"].as_str()), (Some(1), Some("knowledge_ref")));
    assert!(planner.prompt.contains("V1：PAID=已支付"));

    resources::publish_version(&env.conn, &res.id, "V2：PAID=已付款", "改文案", "user", &Value::Null).unwrap();
    let read = run(&env, &planner, "resource", json!({ "id": res.id }));
    assert_eq!(read["version"]["version"], 1, "running attempt keeps V1");
    assert_eq!(run(&env, &planner, "resource", json!({ "id": res.id, "version": 2 }))["version"]["version"], 2, "explicit upgrade only");

    let grant_id: String = env.conn.query_row("SELECT id FROM collab_resource_grants WHERE resource_id = ?1", params![res.id], |r| r.get(0)).unwrap();
    resources::revoke(&env.conn, &grant_id).unwrap();
    assert_eq!(run_err(&env, &planner, "resource", json!({ "id": res.id })).code, codes::FORBIDDEN, "revocation blocks immediately");
}

// AC-13：原会话被关闭 → 新会话带需求、版本、检查点和失败用例继续。
#[test]
fn new_session_resumes_from_checkpoint_with_versions() {
    let env = setup();
    let (_rid, v1, fe1, _fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    let c = run(&env, &a, "change", missing_field_change("cp-1", v1.version, "statusText"));
    let change_id = c["change"]["id"].as_str().unwrap().to_string();
    finish(&env, &a, "stopped");
    let v2 = repair_round(&env, &change_id, "def0301", json!({ "status": "string", "statusText": "string" }));
    let b = claim_task(&env, &fe1);
    assert_ne!(b.attempt.dispatch_key, a.attempt.dispatch_key, "a fresh attempt/session");
    assert!(b.attempt.fencing_token > a.attempt.fencing_token);
    assert_eq!(b.task.next_action, "retest_then_continue");
    assert!(b.context["checkpoint"].is_object(), "checkpoint travels with the task");
    assert!(b.prompt.contains("等待接口补字段"), "resume notes are in the prompt");
    let code = model::load_change(&env.conn, &change_id).unwrap().code;
    assert!(b.prompt.contains(&code), "failing case (change request) is in the prompt");
    assert!(b.context["upstream"].as_array().unwrap().iter().any(|u| u["version"] == v2.version), "new pinned version");
    assert!(b.context["requirement"]["id"].is_string());
}

// AC-24 / AC-25：只说目标时，主责基于绑定仓库与委派对象自主规划；已有接口满足时只建必要任务。
#[test]
fn planner_gets_repository_evidence_and_may_skip_backend() {
    let env = setup();
    dispatch(&env, "p-24", "execute", "实现订单优惠展示");
    let planner = claim(&env);
    let planning = &planner.context["planning"];
    let text = planning.to_string();
    assert!(text.contains("web") && text.contains("api"), "bound repositories are listed: {text}");
    assert!(text.contains("后端智能体"), "delegable specialists are listed");
    let out = run(&env, &planner, "plan", json!({ "requestId": "p-24-plan", "summary": "接口已有 coupon 字段，只改前端",
        "tasks": [{ "key": "FE-1", "title": "优惠展示", "repositoryId": WEB, "kind": "implement", "goal": "展示优惠" }] }));
    assert_eq!(out["state"], "active");
    let rid = planner.requirement_id.clone();
    let tasks: Vec<_> = model::list_tasks(&env.conn, &rid, true).unwrap().into_iter().filter(|t| t.kind != "plan").collect();
    assert_eq!(tasks.len(), 1, "binding a backend repository does not force a backend task");
}

// AC-28 / AC-34：同名对象按稳定 ID 路由；续办追加到指定需求；先规划模式等待开始执行。
#[test]
fn routing_by_stable_id_and_plan_mode_waits() {
    let env = setup();
    let twin_a = enabled_agent_with(&env.conn, "同名智能体", &[("p1", WEB)], best_effort("同名A"));
    let twin_b = enabled_agent_with(&env.conn, "同名智能体", &[("p1", WEB)], best_effort("同名B"));
    let a = dispatch_as(&env, &twin_a, "r-a", "execute", "需求一");
    let b = dispatch_as(&env, &twin_b, "r-b", "execute", "需求二");
    let (ra, rb) = (a.requirement_id.unwrap(), b.requirement_id.unwrap());
    assert_eq!(model::load_requirement(&env.conn, &ra).unwrap().owner_agent_id.as_deref(), Some(twin_a.as_str()));
    assert_eq!(model::load_requirement(&env.conn, &rb).unwrap().owner_agent_id.as_deref(), Some(twin_b.as_str()));
    let before_b = model::load_requirement(&env.conn, &rb).unwrap();
    let cont = requirements::dispatch_to_agent(
        &env.conn,
        &DispatchIntentInput { request_id: "r-a-2".into(), agent_id: twin_a.clone(), mode: "execute".into(), requirement_id: Some(ra.clone()), body: "补充：加排序".into(), ..Default::default() },
        &env.repos,
        &env.matrix,
    )
    .unwrap();
    assert_eq!(cont.requirement_id.as_deref(), Some(ra.as_str()), "continuing appends to the chosen requirement");
    assert_eq!(model::load_requirement(&env.conn, &ra).unwrap().requirement_revision, 2);
    assert_eq!(model::load_requirement(&env.conn, &rb).unwrap().revision, before_b.revision, "the other requirement is untouched");
    let n: i64 = env.conn.query_row("SELECT COUNT(*) FROM collab_requirements", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2);

    for r in [&ra, &rb] {
        ctl(&env, r, "cancel", &format!("x-{r}")).unwrap();
    }
    while let Some(c) = try_claim(&env) {
        finish(&env, &c, "stopped");
    }
    let p = dispatch(&env, "r-plan", "plan", "先出方案");
    let rid = p.requirement_id.unwrap();
    let planner = claim(&env);
    assert_eq!(planner.requirement_id, rid);
    assert!(planner.spawn.read_only, "plan-first never edits business files");
    let out = run(&env, &planner, "plan", json!({ "requestId": "r-plan-1", "tasks": [{ "key": "FE-1", "title": "改页面", "repositoryId": WEB, "kind": "implement" }] }));
    assert_eq!(out["state"], "proposed", "waits for the user to start execution");
    succeed(&env, &planner);
    assert!(try_claim(&env).is_none(), "nothing executes before approval");
}

// AC-21 / AC-22 / AC-26：同引擎同仓库的两个智能体配置互不串用；多仓库绑定分仓库应用规则并保留仓库 AGENTS.md。
#[test]
fn agent_configs_are_isolated_and_repository_scoped() {
    let env = setup();
    let skill = |id: &str, repos: Vec<i64>| agents::SkillBinding { id: id.into(), label: id.into(), repository_ids: repos, ..Default::default() };
    let mut cx = best_effort("甲");
    cx.soul_md = "甲的人格".into();
    cx.skill_bindings = vec![skill("x-skill", vec![])];
    let mut cy = best_effort("乙");
    cy.soul_md = "乙的人格".into();
    cy.skill_bindings = vec![skill("y-skill", vec![])];
    let x = enabled_agent_with(&env.conn, "甲", &[("p1", WEB)], cx);
    let y = enabled_agent_with(&env.conn, "乙", &[("p1", WEB)], cy);
    let (mx, my) = (resolve_for(&env, &x, None, WEB), resolve_for(&env, &y, None, WEB));
    assert_eq!(mx.engine_id, my.engine_id);
    assert_ne!(mx.soul_hash, my.soul_hash);
    assert!(mx.skills.iter().any(|s| s.id == "x-skill") && !mx.skills.iter().any(|s| s.id == "y-skill"));
    assert!(my.skills.iter().any(|s| s.id == "y-skill") && !my.skills.iter().any(|s| s.id == "x-skill"));
    super::memory::add_memory(&env.conn, super::memory::AddMemoryInput { agent_id: x.clone(), scope: "agent".into(), content: "甲的私有经验".into(), trust: Some("user".into()), ..Default::default() }).unwrap();
    let ys = super::memory::retrieve_for_task(&env.conn, &super::memory::MemoryScope { agent_id: &y, ..Default::default() }, "经验", 10, true).unwrap();
    assert!(ys.is_empty(), "memories never cross agents");
    let hash_y = my.config_hash.clone();
    republish(&env, &x, |c| c.agents_md = "甲的新规则".into());
    assert_eq!(resolve_for(&env, &y, None, WEB).config_hash, hash_y, "editing one agent never changes the other");

    // One identity bound to two repositories with different rules.
    std::fs::write(std::path::Path::new(&env.repos.get(&WEB).unwrap().path).join("AGENTS.md"), "# web 仓库自带规则").unwrap();
    let mut cz = best_effort("全栈");
    cz.skill_bindings = vec![skill("lint", vec![]), skill("api-only", vec![API])];
    let z = enabled_agent_with(&env.conn, "全栈", &[("p1", WEB), ("p1", API)], cz);
    let web_binding = agents::list_bindings(&env.conn, &z, false).unwrap().into_iter().find(|b| b.repository_id == WEB).unwrap();
    env.conn
        .execute(
            "UPDATE repository_agent_bindings SET override_json = ?2 WHERE id = ?1",
            params![web_binding.id, json!({ "agentsMd": "web 专用：使用 pnpm", "skillsDisable": ["lint"] }).to_string()],
        )
        .unwrap();
    assert_eq!(agents::get_agent(&env.conn, &z).unwrap().bindings.len(), 2, "stable identity with two bindings");
    let (on_web, on_api) = (resolve_for(&env, &z, None, WEB), resolve_for(&env, &z, None, API));
    assert!(on_web.repository_override_applied && !on_api.repository_override_applied);
    let status = |m: &runtime::EffectiveConfigManifest, id: &str| m.skills.iter().find(|s| s.id == id).map(|s| (s.status.clone(), s.source.clone()));
    assert_eq!(status(&on_web, "lint"), Some(("disabled".into(), "repository".into())));
    assert_eq!(status(&on_api, "lint").map(|s| s.1), Some("base".into()));
    assert!(status(&on_web, "api-only").is_none() && status(&on_api, "api-only").is_some());
    assert!(on_web.repo_rules.iter().any(|r| r.path.ends_with("AGENTS.md")), "repository's own AGENTS.md is kept and shown as a source");
    assert!(on_api.repo_rules.is_empty());
}

// AC-33 / AC-27：草稿不影响运行；发布显式生效；回退保留历史；必需能力失效阻塞，可选能力降级；权限撤销即时生效。
#[test]
fn agent_lifecycle_drafts_rollback_and_required_capabilities() {
    let env = setup();
    let d = dispatch(&env, "lc-1", "execute", "需求");
    let rid = d.requirement_id.unwrap();
    let p = agents::get_agent(&env.conn, &env.owner).unwrap();
    let mut draft = p.draft.clone();
    draft.agents_md = "草稿规则".into();
    agents::update_agent(&env.conn, agents::UpdateAgentInput { agent_id: env.owner.clone(), expected_row_version: p.row_version, draft: Some(draft), ..Default::default() }).unwrap();
    let planner = claim(&env);
    assert!(planner.spawn.append_system_prompt.contains("商城主责 的工作规则") && !planner.spawn.append_system_prompt.contains("草稿规则"), "drafts never affect runs");
    finish(&env, &planner, "stopped");
    let p = agents::get_agent(&env.conn, &env.owner).unwrap();
    let r2 = agents::publish_agent(&env.conn, &env.owner, p.row_version, "v2").unwrap();
    assert_eq!(r2.revision, 2);
    let again = claim(&env);
    assert_eq!(again.requirement_id, rid);
    assert!(again.spawn.append_system_prompt.contains("商城主责 的工作规则"), "an in-flight requirement keeps its locked revision");
    finish(&env, &again, "stopped");
    let new_req = dispatch(&env, "lc-2", "execute", "新需求");
    assert_eq!(model::load_requirement(&env.conn, new_req.requirement_id.as_deref().unwrap()).unwrap().profile_revision, Some(2), "new work uses the published revision");
    let p = agents::get_agent(&env.conn, &env.owner).unwrap();
    let r3 = agents::rollback_agent(&env.conn, &env.owner, 1, p.row_version).unwrap();
    assert_eq!((r3.revision, r3.rollback_of), (3, Some(1)));
    assert_eq!(agents::get_agent(&env.conn, &env.owner).unwrap().revisions.len(), 3, "history is never rewritten");

    let missing = std::env::temp_dir().join("wise-collab-missing-skill").join("SKILL.md").to_string_lossy().into_owned();
    let optional = republish(&env, &env.owner, |c| {
        c.skill_bindings = vec![agents::SkillBinding { id: "opt".into(), label: "可选技能".into(), source_path: Some(missing.clone()), required: false, ..Default::default() }];
    });
    let m = resolve_for(&env, &env.owner, Some(optional.revision), WEB);
    assert!(!m.blocked && m.degradations.iter().any(|d| d.contains("可选技能")), "optional capability degrades explicitly");
    let required = republish(&env, &env.owner, |c| {
        c.skill_bindings = vec![agents::SkillBinding { id: "req".into(), label: "必需技能".into(), source_path: Some(missing.clone()), required: true, ..Default::default() }];
    });
    let m = resolve_for(&env, &env.owner, Some(required.revision), WEB);
    assert!(m.blocked && m.block_reasons.iter().any(|r| r.contains("必需技能")), "required capability blocks");

    let with_mcp = republish(&env, &env.owner, |c| {
        c.skill_bindings.clear();
        c.mcp_bindings = vec![agents::McpBinding { server_id: "db".into(), label: "数据库".into(), ..Default::default() }];
    });
    republish(&env, &env.owner, |c| c.mcp_bindings.clear());
    let locked = resolve_for(&env, &env.owner, Some(with_mcp.revision), WEB);
    assert_eq!(locked.mcps.iter().find(|m| m.server_id == "db").map(|m| m.status.as_str()), Some("revoked"), "revocation beats the locked snapshot");
}

// AC-27 / AC-30：独立记忆可检索且版本可追溯；删除后检索排除，历史快照可查询。
#[test]
fn memory_revisions_and_deletion() {
    let env = setup();
    use super::memory::{self, AddMemoryInput, MemoryScope, UpdateMemoryInput};
    let m = memory::add_memory(&env.conn, AddMemoryInput { agent_id: env.owner.clone(), scope: "repository".into(), project_id: Some("p1".into()), repository_id: Some(WEB), content: "web 仓库用 bun test".into(), trust: Some("user".into()), ..Default::default() }).unwrap();
    let m = memory::update_memory(&env.conn, UpdateMemoryInput { memory_id: m.id.clone(), expected_revision: m.revision, content: Some("web 仓库用 bun test --bail".into()), ..Default::default() }).unwrap();
    assert_eq!(m.revision, 2);
    let scope = MemoryScope { agent_id: &env.owner, project_id: Some("p1"), repository_id: Some(WEB), requirement_id: None };
    assert_eq!(memory::retrieve_for_task(&env.conn, &scope, "bun test", 10, false).unwrap().len(), 1);
    let other_repo = MemoryScope { repository_id: Some(API), ..scope.clone() };
    assert!(memory::retrieve_for_task(&env.conn, &other_repo, "bun test", 10, false).unwrap().is_empty(), "repository scope");

    dispatch(&env, "mem-1", "execute", "跑测试");
    let planner = claim(&env);
    let used = planner.context["inputManifest"]["memories"].as_array().unwrap().clone();
    assert!(used.iter().any(|u| u["id"] == m.id.as_str() && u["revision"] == 2), "context snapshot pins memory revision");

    let deleted = memory::delete_memory(&env.conn, &m.id).unwrap();
    assert!(deleted.deleted_at.is_some());
    assert!(memory::retrieve_for_task(&env.conn, &scope, "bun test", 10, true).unwrap().is_empty(), "deleted memories are excluded");
    let history = memory::memory_revisions(&env.conn, &m.id).unwrap();
    assert_eq!(history.iter().map(|h| h["changeKind"].as_str().unwrap()).collect::<Vec<_>>(), vec!["delete", "update", "create"]);
    assert_eq!(memory::list_memories(&env.conn, &env.owner, true).unwrap().len(), 1, "history remains queryable");
    memory::add_memory(&env.conn, AddMemoryInput { agent_id: env.owner.clone(), scope: "agent".into(), content: "另一条".into(), ..Default::default() }).unwrap();
    assert_eq!(memory::clear_memories(&env.conn, &env.owner).unwrap(), 1);
    assert!(memory::list_memories(&env.conn, &env.owner, false).unwrap().is_empty());
}

// AC-39：多个需求共享环境时，释放一个需求不停止其他需求仍在使用的服务。
#[test]
fn shared_runtime_resource_survives_one_requirement_release() {
    let env = setup();
    let a = dispatch(&env, "rt-a", "execute", "需求 A").requirement_id.unwrap();
    let b = dispatch(&env, "rt-b", "execute", "需求 B").requirement_id.unwrap();
    let ca = claim(&env);
    let cb = claim(&env);
    let (ca, cb) = if ca.requirement_id == a { (ca, cb) } else { (cb, ca) };
    assert_eq!(cb.requirement_id, b);
    let r = run(&env, &ca, "runtime-resource", json!({ "kind": "service", "name": "mock-api", "stopMethod": "kill", "port": 18080, "pid": 4242 }));
    let rid = r["id"].as_str().unwrap().to_string();
    run(&env, &cb, "runtime-use", json!({ "resourceId": rid }));
    ctl(&env, &a, "cancel", "rt-cancel-a").unwrap();
    finish(&env, &ca, "stopped");
    assert_eq!(model::load_requirement(&env.conn, &a).unwrap().control_status, "cancelled");
    let res = super::runtime_resources::load(&env.conn, &rid).unwrap();
    assert!(!super::runtime_resources::pending_stops(&env.conn).unwrap().iter().any(|p| p.id == rid), "B still uses it: {res:?}");
    run(&env, &cb, "runtime-release", json!({ "resourceId": rid }));
    assert!(super::runtime_resources::pending_stops(&env.conn).unwrap().iter().any(|p| p.id == rid), "last consumer released ⇒ stop requested");
}

// AC-14：暂停期间修正结果抵达 → 记录交付与消息，暂停时不派发，继续后恢复复验。
#[test]
fn repair_result_during_pause_is_recorded_and_waits() {
    let env = setup();
    let (rid, v1, fe1, _fe2) = delivered_two_consumers(&env);
    let a = claim_task(&env, &fe1);
    let c = run(&env, &a, "change", missing_field_change("pz-1", v1.version, "statusText"));
    let change_id = c["change"]["id"].as_str().unwrap().to_string();
    finish(&env, &a, "stopped");
    let cr = model::load_change(&env.conn, &change_id).unwrap();
    let repair = claim_task(&env, cr.current_repair_task_id.as_deref().unwrap());
    assert_eq!(ctl(&env, &rid, "pause", "pz-pause").unwrap().control_status, "pausing");
    let v2 = publish_api(&env, &repair, "def0401", json!({ "status": "string", "statusText": "string" }));
    succeed(&env, &repair);
    assert_eq!(model::load_requirement(&env.conn, &rid).unwrap().control_status, "paused");
    assert_eq!(v2.validation_state, "valid", "the delivery is recorded");
    assert_eq!(model::load_change(&env.conn, &change_id).unwrap().state, "ready_for_retest");
    assert!(super::events::task_inbox(&env.conn, &fe1).unwrap().iter().any(|m| m.kind == "change.ready_for_retest"), "the message is recorded");
    assert!(try_claim(&env).is_none(), "paused ⇒ nothing is dispatched");
    ctl(&env, &rid, "resume", "pz-resume").unwrap();
    let b = claim_task(&env, &fe1);
    assert_eq!((b.task.id.as_str(), b.task.next_action.as_str()), (fe1.as_str(), "retest_then_continue"));
}
