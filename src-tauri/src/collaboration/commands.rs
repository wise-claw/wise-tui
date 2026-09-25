//! Tauri 命令：协作层对前端的全部入口。命令均为 async + spawn_blocking，
//! 仓库列表在拿 DB 锁之前读取；写操作后广播 `wise-collab-changed`。

use std::time::Duration;

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::bridge::{self, notify};
use super::error::{codes, CResult, CollabError};
use super::{agents, memory, model, runtime, scheduler, verification};
use super::{repo_directory, RepoDirectory, RepoInfo};

pub(crate) fn repos_of(app: &AppHandle) -> RepoDirectory {
    repo_directory(crate::app_state_commands::load_repositories(app).into_iter().map(|r| RepoInfo {
        id: r.id,
        name: r.name.clone(),
        path: r.path().to_string(),
        role_tags: r.effective_role_tags(),
    }))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CResult<T> + Send + 'static) -> CResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| CollabError::new(codes::STORAGE_ERROR, format!("协作任务异常：{e}")))?
}

async fn db<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&Connection) -> CResult<T> + Send + 'static) -> CResult<T> {
    let app = app.clone();
    blocking(move || {
        let state = app.state::<crate::wise_db::WiseDb>();
        let conn = state.conn();
        f(&conn)
    })
    .await
}

async fn db_repos<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&Connection, &RepoDirectory) -> CResult<T> + Send + 'static,
) -> CResult<T> {
    let app = app.clone();
    blocking(move || {
        let repos = repos_of(&app);
        let state = app.state::<crate::wise_db::WiseDb>();
        let conn = state.conn();
        f(&conn, &repos)
    })
    .await
}

async fn mutate<T: Send + 'static>(
    app: &AppHandle,
    requirement_id: Option<String>,
    f: impl FnOnce(&Connection, &RepoDirectory) -> CResult<T> + Send + 'static,
) -> CResult<T> {
    let out = db_repos(app, f).await?;
    notify(app, requirement_id.as_deref());
    Ok(out)
}

// ── 仓库智能体 ──

#[tauri::command]
pub(crate) async fn collab_list_agents(app: AppHandle, include_archived: Option<bool>) -> CResult<Vec<Value>> {
    db(&app, move |c| {
        let agents = agents::list_agents(c, include_archived.unwrap_or(false))?;
        agents
            .iter()
            .map(|p| {
                let mut v = agents::agent_summary_json(p);
                v["bindings"] = serde_json::to_value(agents::list_bindings(c, &p.id, false)?)?;
                Ok(v)
            })
            .collect()
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_get_agent(app: AppHandle, agent_id: String) -> CResult<Value> {
    db(&app, move |c| {
        let profile = agents::get_agent(c, &agent_id)?;
        let bindings = agents::list_bindings(c, &agent_id, true)?;
        let active = if profile.active_revision > 0 { Some(agents::get_revision(c, &agent_id, profile.active_revision)?) } else { None };
        Ok(json!({ "profile": profile, "bindings": bindings, "activeRevision": active }))
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_get_agent_revision(app: AppHandle, agent_id: String, revision: i64) -> CResult<agents::AgentRevision> {
    db(&app, move |c| agents::get_revision(c, &agent_id, revision)).await
}

#[tauri::command]
pub(crate) async fn collab_create_agent(app: AppHandle, input: agents::CreateAgentInput) -> CResult<agents::AgentProfile> {
    mutate(&app, None, move |c, _| agents::create_agent(c, input)).await
}

#[tauri::command]
pub(crate) async fn collab_update_agent(app: AppHandle, input: agents::UpdateAgentInput) -> CResult<agents::AgentProfile> {
    mutate(&app, None, move |c, _| agents::update_agent(c, input)).await
}

#[tauri::command]
pub(crate) async fn collab_publish_agent(app: AppHandle, agent_id: String, expected_row_version: i64, note: Option<String>) -> CResult<agents::AgentRevision> {
    let rev = mutate(&app, None, move |c, _| agents::publish_agent(c, &agent_id, expected_row_version, note.as_deref().unwrap_or(""))).await?;
    materialize(rev).await
}

/// Writes the immutable revision's SOUL.md / AGENTS.md snapshot under `~/.wise/collab/agents/`.
async fn materialize(rev: agents::AgentRevision) -> CResult<agents::AgentRevision> {
    blocking(move || {
        runtime::materialize_revision_files(&rev.agent_id, rev.revision, &rev.config).map_err(|e| CollabError::new(codes::IO_ERROR, e))?;
        Ok(rev)
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_rollback_agent(app: AppHandle, agent_id: String, to_revision: i64, expected_row_version: i64) -> CResult<agents::AgentRevision> {
    let rev = mutate(&app, None, move |c, _| agents::rollback_agent(c, &agent_id, to_revision, expected_row_version)).await?;
    materialize(rev).await
}

#[tauri::command]
pub(crate) async fn collab_set_agent_status(app: AppHandle, agent_id: String, action: String, expected_row_version: i64) -> CResult<agents::AgentProfile> {
    mutate(&app, None, move |c, _| agents::set_agent_status(c, &agent_id, &action, expected_row_version)).await
}

#[tauri::command]
pub(crate) async fn collab_duplicate_agent(app: AppHandle, agent_id: String, name: String) -> CResult<agents::AgentProfile> {
    mutate(&app, None, move |c, _| agents::duplicate_agent(c, &agent_id, &name)).await
}

#[tauri::command]
pub(crate) async fn collab_check_agent(app: AppHandle, agent_id: String, known_mcp_server_ids: Option<Vec<String>>) -> CResult<Value> {
    mutate(&app, None, move |c, repos| {
        let matrix = runtime::load_matrix(c)?;
        let (report, passed) = runtime::check_agent(c, &agent_id, repos, known_mcp_server_ids.as_deref(), &matrix)?;
        let profile = agents::record_check(c, &agent_id, &report, passed)?;
        Ok(json!({ "report": report, "passed": passed, "profile": profile }))
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_bind_agent(app: AppHandle, input: agents::BindAgentInput) -> CResult<agents::AgentBinding> {
    mutate(&app, None, move |c, _| agents::bind_agent(c, input)).await
}

#[tauri::command]
pub(crate) async fn collab_unbind_agent(app: AppHandle, binding_id: String) -> CResult<agents::AgentBinding> {
    mutate(&app, None, move |c, _| agents::unbind_agent(c, &binding_id)).await
}

#[tauri::command]
pub(crate) async fn collab_list_repository_agents(app: AppHandle, repository_id: i64) -> CResult<Vec<Value>> {
    db(&app, move |c| {
        agents::list_bindings_for_repository(c, repository_id)?
            .into_iter()
            .map(|b| {
                let p = agents::get_agent(c, &b.agent_id)?;
                Ok(json!({ "binding": b, "agent": agents::agent_summary_json(&p) }))
            })
            .collect()
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EffectiveConfigQuery {
    agent_id: String,
    revision: Option<i64>,
    project_id: Option<String>,
    repository_id: Option<i64>,
    known_mcp_server_ids: Option<Vec<String>>,
}

#[tauri::command]
pub(crate) async fn collab_effective_config(app: AppHandle, query: EffectiveConfigQuery) -> CResult<runtime::EffectiveConfigManifest> {
    db_repos(&app, move |c, repos| {
        let matrix = runtime::load_matrix(c)?;
        let path = query.repository_id.and_then(|id| repos.get(&id)).map(|r| r.path.clone());
        runtime::resolve(
            c,
            &runtime::ResolveInput {
                agent_id: &query.agent_id,
                revision: query.revision,
                project_id: query.project_id.as_deref(),
                repository_id: query.repository_id,
                repository_path: path.as_deref(),
                known_mcp_server_ids: query.known_mcp_server_ids.as_deref(),
                require_enabled: false,
            },
            &matrix,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_capability_matrix(app: AppHandle) -> CResult<runtime::CapabilityMatrix> {
    db(&app, runtime::load_matrix).await
}

/// W0 能力探测：读取本机 Claude Code 实际支持的参数，更新引擎能力矩阵。
#[tauri::command]
pub(crate) async fn collab_probe_engine(app: AppHandle) -> CResult<runtime::CapabilityMatrix> {
    let probe = blocking(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let run = |args: &str| {
            std::process::Command::new(&shell)
                .args(["-lc", args])
                .stdin(std::process::Stdio::null())
                .output()
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
                .unwrap_or_default()
        };
        Ok((run("claude --help"), run("claude --version")))
    })
    .await?;
    let out = db(&app, move |c| {
        let mut matrix = runtime::load_matrix(c)?;
        if !probe.0.trim().is_empty() {
            matrix.insert("claude".into(), runtime::claude_capability_from_help(&probe.0, probe.1.trim()));
            runtime::save_matrix(c, &matrix)?;
        }
        Ok(matrix)
    })
    .await?;
    notify(&app, None);
    Ok(out)
}

// ── 记忆 ──

#[tauri::command]
pub(crate) async fn collab_list_memories(app: AppHandle, agent_id: String, include_deleted: Option<bool>) -> CResult<Vec<memory::MemoryItem>> {
    db(&app, move |c| memory::list_memories(c, &agent_id, include_deleted.unwrap_or(false))).await
}

#[tauri::command]
pub(crate) async fn collab_add_memory(app: AppHandle, input: memory::AddMemoryInput) -> CResult<memory::MemoryItem> {
    mutate(&app, None, move |c, _| memory::add_memory(c, input)).await
}

#[tauri::command]
pub(crate) async fn collab_update_memory(app: AppHandle, input: memory::UpdateMemoryInput) -> CResult<memory::MemoryItem> {
    mutate(&app, None, move |c, _| memory::update_memory(c, input)).await
}

#[tauri::command]
pub(crate) async fn collab_delete_memory(app: AppHandle, memory_id: String) -> CResult<memory::MemoryItem> {
    mutate(&app, None, move |c, _| memory::delete_memory(c, &memory_id)).await
}

#[tauri::command]
pub(crate) async fn collab_clear_memories(app: AppHandle, agent_id: String) -> CResult<i64> {
    mutate(&app, None, move |c, _| memory::clear_memories(c, &agent_id)).await
}

#[tauri::command]
pub(crate) async fn collab_memory_revisions(app: AppHandle, memory_id: String) -> CResult<Vec<Value>> {
    db(&app, move |c| memory::memory_revisions(c, &memory_id)).await
}

// ── 需求 ──

#[tauri::command]
pub(crate) async fn collab_dispatch_intent(app: AppHandle, input: super::requirements::DispatchIntentInput) -> CResult<super::requirements::DispatchResult> {
    let out = db_repos(&app, move |c, repos| {
        let matrix = runtime::load_matrix(c)?;
        super::requirements::dispatch_to_agent(c, &input, repos, &matrix)
    })
    .await?;
    notify(&app, out.requirement_id.as_deref());
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_create_requirement(app: AppHandle, input: super::requirements::CreateRequirementInput) -> CResult<model::RequirementRow> {
    let out = db(&app, move |c| super::requirements::create_requirement(c, &input)).await?;
    notify(&app, Some(&out.id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_list_requirements(app: AppHandle, project_id: Option<String>, include_done: Option<bool>) -> CResult<Vec<Value>> {
    db(&app, move |c| super::requirements::list_summaries(c, project_id.as_deref(), include_done.unwrap_or(true))).await
}

#[tauri::command]
pub(crate) async fn collab_requirement_snapshot(app: AppHandle, requirement_id: String) -> CResult<Value> {
    db(&app, move |c| super::requirements::snapshot(c, &requirement_id)).await
}

#[tauri::command]
pub(crate) async fn collab_requirements_for_session(app: AppHandle, session_id: String) -> CResult<Vec<Value>> {
    db(&app, move |c| super::requirements::requirement_for_session(c, &session_id)).await
}

#[tauri::command]
pub(crate) async fn collab_events_since(app: AppHandle, requirement_id: String, after_seq: Option<i64>) -> CResult<Vec<Value>> {
    db(&app, move |c| super::events::events_since(c, &requirement_id, after_seq.unwrap_or(0))).await
}

#[tauri::command]
pub(crate) async fn collab_list_messages(
    app: AppHandle,
    requirement_id: String,
    task_id: Option<String>,
    before: Option<i64>,
    limit: Option<i64>,
) -> CResult<Vec<super::events::MessageRow>> {
    db(&app, move |c| super::events::list_messages(c, &requirement_id, task_id.as_deref(), before, limit.unwrap_or(100))).await
}

#[tauri::command]
pub(crate) async fn collab_requeue_message(app: AppHandle, message_id: String) -> CResult<()> {
    mutate(&app, None, move |c, _| super::events::requeue_message(c, &message_id)).await
}

#[tauri::command]
pub(crate) async fn collab_revise_requirement(app: AppHandle, input: super::requirements::ReviseInput) -> CResult<model::RequirementRow> {
    let rid = input.requirement_id.clone();
    mutate(&app, Some(rid), move |c, _| super::requirements::revise_requirement(c, &input)).await
}

#[tauri::command]
pub(crate) async fn collab_control_requirement(app: AppHandle, input: super::requirements::ControlInput) -> CResult<model::RequirementRow> {
    let rid = input.requirement_id.clone();
    mutate(&app, Some(rid), move |c, _| super::requirements::control(c, &input)).await
}

#[tauri::command]
pub(crate) async fn collab_transfer_owner(app: AppHandle, input: super::requirements::TransferOwnerInput) -> CResult<model::RequirementRow> {
    let rid = input.requirement_id.clone();
    mutate(&app, Some(rid), move |c, _| super::requirements::transfer_owner(c, &input)).await
}

#[tauri::command]
pub(crate) async fn collab_publish_plan(app: AppHandle, requirement_id: String, input: super::plans::PlanInput) -> CResult<super::plans::PlanPublishResult> {
    let rid = requirement_id.clone();
    mutate(&app, Some(rid), move |c, repos| {
        let source = super::plans::PlanSource { attempt_id: None, task_id: None, by_user: true };
        super::plans::publish_plan(c, &requirement_id, &input, &source, repos)
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_resolve_decision(app: AppHandle, input: super::decisions::ResolveDecisionInput) -> CResult<model::DecisionRow> {
    let out = db_repos(&app, move |c, _| super::decisions::resolve(c, &input)).await?;
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_task_detail(app: AppHandle, task_id: String) -> CResult<Value> {
    db(&app, move |c| {
        let task = model::load_task(c, &task_id)?;
        let checkpoint = match task.checkpoint_id.as_deref() {
            Some(id) => model::load_checkpoint(c, id)?,
            None => None,
        };
        Ok(json!({
            "task": task,
            "attempts": model::list_attempts_for_task(c, &task_id)?,
            "verificationRuns": verification::list_runs_for_task(c, &task_id)?,
            "checkpoint": checkpoint,
            "inbox": super::events::task_inbox(c, &task_id)?,
        }))
    })
    .await
}

/// Artifact 面：跨需求的最近交付物与修正记录，附需求与任务标题。
#[tauri::command]
pub(crate) async fn collab_deliverables(app: AppHandle, repository_id: Option<i64>, limit: Option<i64>) -> CResult<Value> {
    db(&app, move |c| {
        let limit = limit.unwrap_or(100);
        let artifacts = model::list_recent_artifact_versions(c, repository_id, limit)?;
        let changes = model::list_recent_changes(c, repository_id, limit)?;
        let mut requirement_ids: Vec<String> = artifacts.iter().map(|a| a.requirement_id.clone()).collect();
        requirement_ids.extend(changes.iter().map(|ch| ch.requirement_id.clone()));
        requirement_ids.sort();
        requirement_ids.dedup();
        let mut requirements = serde_json::Map::new();
        for rid in &requirement_ids {
            if let Ok(r) = model::load_requirement(c, rid) {
                requirements.insert(
                    rid.clone(),
                    json!({ "title": r.title, "businessStatus": r.business_status, "controlStatus": r.control_status, "stage": r.stage }),
                );
            }
        }
        let mut task_ids: Vec<String> = artifacts.iter().map(|a| a.producer_task_id.clone()).collect();
        for ch in &changes {
            task_ids.push(ch.reporter_task_id.clone());
            if let Some(p) = &ch.producer_task_id {
                task_ids.push(p.clone());
            }
        }
        task_ids.sort();
        task_ids.dedup();
        let mut tasks = serde_json::Map::new();
        for tid in &task_ids {
            if let Ok(t) = model::load_task(c, tid) {
                tasks.insert(tid.clone(), json!({ "title": t.title, "repositoryId": t.repository_id }));
            }
        }
        Ok(json!({ "artifacts": artifacts, "changes": changes, "requirements": requirements, "tasks": tasks }))
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_explain_requirement(app: AppHandle, requirement_id: String) -> CResult<Vec<scheduler::TaskExplanation>> {
    db(&app, move |c| scheduler::explain_requirement(c, &requirement_id)).await
}

#[tauri::command]
pub(crate) async fn collab_refresh_acceptance(app: AppHandle, requirement_id: String) -> CResult<super::acceptance::AcceptanceManifest> {
    let rid = requirement_id.clone();
    mutate(&app, Some(rid), move |c, _| super::acceptance::refresh_manifest(c, &requirement_id)).await
}

#[tauri::command]
pub(crate) async fn collab_accept(app: AppHandle, input: super::acceptance::AcceptInput) -> CResult<super::acceptance::AcceptanceManifest> {
    let rid = input.requirement_id.clone();
    mutate(&app, Some(rid), move |c, _| super::acceptance::accept(c, &input)).await
}

#[tauri::command]
pub(crate) async fn collab_merge_changes(app: AppHandle, duplicate_id: String, primary_id: String) -> CResult<model::ChangeRequestRow> {
    let out = db(&app, move |c| super::changes::merge_changes(c, &duplicate_id, &primary_id)).await?;
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_usage_summary(app: AppHandle, requirement_id: String) -> CResult<Value> {
    db(&app, move |c| super::usage::summary(c, &requirement_id)).await
}

// ── V1 迁移 ──

#[tauri::command]
pub(crate) async fn collab_import_v1(app: AppHandle, input: super::legacy::ImportInput) -> CResult<super::legacy::ImportReport> {
    mutate(&app, None, move |c, repos| super::legacy::import_v1(c, &input, repos)).await
}

#[tauri::command]
pub(crate) async fn collab_legacy_history(app: AppHandle, requirement_id: String) -> CResult<Value> {
    db(&app, move |c| super::legacy::history(c, &requirement_id)).await
}

#[tauri::command]
pub(crate) async fn collab_set_legacy_target(app: AppHandle, requirement_id: String, repository_id: i64) -> CResult<()> {
    let rid = requirement_id.clone();
    mutate(&app, Some(rid), move |c, repos| super::legacy::set_legacy_target(c, &requirement_id, repository_id, repos)).await
}

// ── 执行桥（前端会话生命周期） ──

#[tauri::command]
pub(crate) async fn collab_claim(app: AppHandle, input: scheduler::ClaimInput) -> CResult<scheduler::ClaimOutcome> {
    let _ = bridge::ensure_started(app.clone()).await;
    let mut out = db_repos(&app, move |c, repos| {
        let matrix = runtime::load_matrix(c)?;
        scheduler::claim_next(c, &input, repos, &matrix)
    })
    .await?;
    let cli = bridge::cli_path().map(|p| p.to_string_lossy().into_owned());
    for claimed in out.claimed.iter_mut() {
        bridge::write_attempt_credentials(&claimed.attempt.id, &claimed.attempt_secret, claimed.attempt.fencing_token)
            .map_err(|e| CollabError::new(codes::IO_ERROR, e))?;
        if let Some(cli) = cli.as_deref() {
            let tool = format!("Bash({cli}:*)");
            claimed.spawn.allowed_tools = Some(match claimed.spawn.allowed_tools.take() {
                Some(t) if !t.is_empty() => format!("{t},{tool}"),
                _ => tool,
            });
        }
        claimed.attempt_secret.clear();
    }
    if let Some(claimed) = out.claimed.as_ref() {
        notify(&app, Some(&claimed.requirement_id));
    }
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_confirm_launch(app: AppHandle, attempt_id: String, fencing_token: i64) -> CResult<scheduler::LaunchCheck> {
    let out = db(&app, move |c| scheduler::confirm_launch(c, &attempt_id, fencing_token)).await?;
    if !out.proceed {
        bridge::remove_attempt_credentials(&out.attempt.id);
    }
    notify(&app, Some(&out.attempt.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_bind_session(app: AppHandle, attempt_id: String, fencing_token: i64, session_id: String) -> CResult<model::AttemptRow> {
    let out = db(&app, move |c| scheduler::bind_session(c, &attempt_id, fencing_token, &session_id)).await?;
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_heartbeat(app: AppHandle, attempt_id: String, fencing_token: i64) -> CResult<scheduler::HeartbeatAck> {
    db(&app, move |c| scheduler::heartbeat(c, &attempt_id, fencing_token)).await
}

#[tauri::command]
pub(crate) async fn collab_finish_attempt(app: AppHandle, input: scheduler::FinishInput) -> CResult<model::AttemptRow> {
    let out = db(&app, move |c| scheduler::finish_attempt(c, &input)).await?;
    bridge::remove_attempt_credentials(&out.id);
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_request_stop(app: AppHandle, attempt_id: String, reason: Option<String>) -> CResult<model::AttemptRow> {
    let out = db(&app, move |c| scheduler::request_stop(c, &attempt_id, reason.as_deref().unwrap_or("user"))).await?;
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_mark_stop_pending(app: AppHandle, attempt_id: String) -> CResult<model::AttemptRow> {
    let out = db(&app, move |c| scheduler::mark_stop_pending(c, &attempt_id)).await?;
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_reconcile(app: AppHandle, input: scheduler::ReconcileInput) -> CResult<Option<model::AttemptRow>> {
    let out = db(&app, move |c| scheduler::reconcile(c, &input)).await?;
    if let Some(a) = out.as_ref() {
        if a.state == "finished" {
            bridge::remove_attempt_credentials(&a.id);
        }
        notify(&app, Some(&a.requirement_id));
    }
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_active_attempts(app: AppHandle) -> CResult<Vec<model::AttemptRow>> {
    db(&app, model::active_attempts).await
}

#[tauri::command]
pub(crate) async fn collab_bridge_status(app: AppHandle) -> CResult<Value> {
    let port = bridge::ensure_started(app).await.ok();
    Ok(json!({ "port": port, "cli": bridge::cli_path() }))
}

// ── 受控验证 / 交付校验 ──

#[tauri::command]
pub(crate) async fn collab_run_verification(app: AppHandle, task_id: String, command: Option<String>) -> CResult<verification::VerificationRun> {
    let run = db_repos(&app, move |c, repos| verification::prepare_run(c, &task_id, None, command.as_deref(), repos, true)).await?;
    let r = run.clone();
    let outcome = blocking(move || verification::execute_blocking(&r).map_err(|e| CollabError::new(codes::IO_ERROR, e))).await?;
    let rid = run.requirement_id.clone();
    let out = db(&app, move |c| verification::record_run(c, &run, &outcome)).await?;
    notify(&app, Some(&rid));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_revalidate_artifact(app: AppHandle, version_id: String) -> CResult<model::ArtifactVersionRow> {
    let vid = version_id.clone();
    let version = db(&app, move |c| model::load_artifact_version(c, &vid)).await?;
    let health = match version.health_url.as_deref().filter(|u| verification::is_http_url(u)) {
        Some(u) => Some(verification::http_health(u, Duration::from_secs(10)).await),
        None => None,
    };
    let rid = version.requirement_id.clone();
    let out = db(&app, move |c| {
        if let Some(h) = health.as_ref() {
            verification::record_health(c, &version.requirement_id, &version.producer_task_id, h)?;
        }
        super::artifacts::apply_validation(c, &version_id, health.as_ref())
    })
    .await?;
    notify(&app, Some(&rid));
    Ok(out)
}

#[tauri::command]
pub(crate) async fn collab_invalidate_artifact(app: AppHandle, version_id: String, reason: String) -> CResult<model::ArtifactVersionRow> {
    let out = db(&app, move |c| super::artifacts::invalidate_version(c, &version_id, &reason)).await?;
    notify(&app, Some(&out.requirement_id));
    Ok(out)
}

// ── 运行环境资源 ──

#[tauri::command]
pub(crate) async fn collab_pending_runtime_stops(app: AppHandle) -> CResult<Vec<super::runtime_resources::RuntimeResource>> {
    db(&app, super::runtime_resources::pending_stops).await
}

#[tauri::command]
pub(crate) async fn collab_mark_runtime_stopped(app: AppHandle, resource_id: String) -> CResult<super::runtime_resources::RuntimeResource> {
    let out = db(&app, move |c| super::runtime_resources::mark_stopped(c, &resource_id)).await?;
    notify(&app, Some(&out.owner_requirement_id));
    Ok(out)
}

// ── 共享资源 ──

#[tauri::command]
pub(crate) async fn collab_list_resources(app: AppHandle, project_id: Option<String>) -> CResult<Vec<super::resources::Resource>> {
    db(&app, move |c| super::resources::list_resources(c, project_id.as_deref())).await
}

#[tauri::command]
pub(crate) async fn collab_resource_versions(app: AppHandle, resource_id: String) -> CResult<Vec<Value>> {
    db(&app, move |c| super::resources::list_versions(c, &resource_id)).await
}

#[tauri::command]
pub(crate) async fn collab_create_resource(app: AppHandle, input: super::resources::CreateResourceInput) -> CResult<super::resources::Resource> {
    mutate(&app, None, move |c, _| super::resources::create_resource(c, &input)).await
}

#[tauri::command]
pub(crate) async fn collab_publish_resource_version(
    app: AppHandle,
    resource_id: String,
    content: String,
    note: Option<String>,
    source_ref: Option<Value>,
) -> CResult<super::resources::ResourceVersion> {
    mutate(&app, None, move |c, _| {
        super::resources::publish_version(c, &resource_id, &content, note.as_deref().unwrap_or(""), "user", &source_ref.unwrap_or(Value::Null))
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_grant_resource(app: AppHandle, resource_id: String, grantee_kind: String, grantee_id: String) -> CResult<super::resources::Resource> {
    mutate(&app, None, move |c, _| super::resources::grant(c, &resource_id, &grantee_kind, &grantee_id)).await
}

#[tauri::command]
pub(crate) async fn collab_revoke_resource_grant(app: AppHandle, grant_id: String) -> CResult<super::resources::Resource> {
    mutate(&app, None, move |c, _| super::resources::revoke(c, &grant_id)).await
}

#[tauri::command]
pub(crate) async fn collab_set_resource_visibility(
    app: AppHandle,
    resource_id: String,
    visibility: String,
    space_id: Option<String>,
) -> CResult<super::resources::Resource> {
    mutate(&app, None, move |c, _| super::resources::set_visibility(c, &resource_id, &visibility, space_id.as_deref())).await
}

#[tauri::command]
pub(crate) async fn collab_archive_resource(app: AppHandle, resource_id: String) -> CResult<super::resources::Resource> {
    mutate(&app, None, move |c, _| super::resources::archive(c, &resource_id)).await
}

#[tauri::command]
pub(crate) async fn collab_search_resources(
    app: AppHandle,
    project_id: Option<String>,
    query: String,
    limit: Option<usize>,
) -> CResult<Vec<super::resources::SearchHit>> {
    db(&app, move |c| {
        let who = super::resources::Principal { project_ids: project_id.into_iter().collect(), agent_id: None, task_id: None, is_user: true };
        super::resources::search(c, &who, &query, limit.unwrap_or(20).clamp(1, 100))
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_read_resource(app: AppHandle, resource_id: String, version: Option<i64>) -> CResult<Value> {
    db(&app, move |c| {
        let who = super::resources::Principal { is_user: true, ..Default::default() };
        let (res, ver) = super::resources::read(c, &who, &resource_id, version)?;
        Ok(json!({ "resource": res, "version": ver }))
    })
    .await
}

#[tauri::command]
pub(crate) async fn collab_subscribe_resource(app: AppHandle, resource_id: String, subscriber_kind: String, subscriber_id: String) -> CResult<Value> {
    mutate(&app, None, move |c, _| super::resources::subscribe(c, &resource_id, &subscriber_kind, &subscriber_id)).await
}

#[tauri::command]
pub(crate) async fn collab_resource_updates(app: AppHandle, subscriber_kind: String, subscriber_id: String) -> CResult<Vec<Value>> {
    db(&app, move |c| super::resources::subscription_updates(c, &subscriber_kind, &subscriber_id)).await
}

#[tauri::command]
pub(crate) async fn collab_suggest_resource(app: AppHandle, resource_id: String, from_project_id: Option<String>, body: String) -> CResult<Value> {
    mutate(&app, None, move |c, _| super::resources::suggest(c, &resource_id, from_project_id.as_deref(), None, &body)).await
}

#[tauri::command]
pub(crate) async fn collab_list_resource_suggestions(app: AppHandle, resource_id: String) -> CResult<Vec<Value>> {
    db(&app, move |c| super::resources::list_suggestions(c, &resource_id)).await
}

#[tauri::command]
pub(crate) async fn collab_resolve_resource_suggestion(app: AppHandle, suggestion_id: String, accept: bool) -> CResult<()> {
    mutate(&app, None, move |c, _| super::resources::resolve_suggestion(c, &suggestion_id, accept)).await
}

#[tauri::command]
pub(crate) async fn collab_list_spaces(app: AppHandle) -> CResult<Vec<Value>> {
    db(&app, super::resources::list_spaces).await
}

#[tauri::command]
pub(crate) async fn collab_create_space(app: AppHandle, name: String, description: Option<String>, owner_project_id: String) -> CResult<Value> {
    mutate(&app, None, move |c, _| super::resources::create_space(c, &name, description.as_deref().unwrap_or(""), &owner_project_id)).await
}

#[tauri::command]
pub(crate) async fn collab_set_space_member(app: AppHandle, space_id: String, project_id: String, member: bool) -> CResult<()> {
    mutate(&app, None, move |c, _| super::resources::set_space_member(c, &space_id, &project_id, member)).await
}

// ── Channel outbox ──

#[tauri::command]
pub(crate) async fn collab_due_outbox(app: AppHandle, channel: String, limit: Option<i64>) -> CResult<Vec<super::events::OutboxItem>> {
    db(&app, move |c| super::events::due_outbox(c, &channel, limit.unwrap_or(20))).await
}

#[tauri::command]
pub(crate) async fn collab_ack_outbox(app: AppHandle, id: i64, ok: bool, error: Option<String>) -> CResult<()> {
    db(&app, move |c| super::events::ack_outbox(c, id, ok, error.as_deref())).await
}

#[tauri::command]
pub(crate) async fn collab_channel_inbox(
    app: AppHandle,
    before: Option<i64>,
    limit: Option<i64>,
    unread_only: Option<bool>,
) -> CResult<Vec<super::events::InboxEntry>> {
    db(&app, move |c| super::events::channel_inbox(c, before, limit.unwrap_or(50), unread_only.unwrap_or(false))).await
}

#[tauri::command]
pub(crate) async fn collab_mark_inbox_read(app: AppHandle, message_ids: Vec<String>) -> CResult<usize> {
    mutate(&app, None, move |c, _| super::events::mark_inbox_read(c, &message_ids)).await
}

// ── 后台维护 ──

pub(crate) async fn maintenance_tick(app: AppHandle) -> CResult<()> {
    let (expired, stale) = db(&app, |c| {
        let expired = scheduler::expire_leases(c)?;
        let stale = super::artifacts::stale_health_versions(c, super::artifacts::HEALTH_TTL_MS)?;
        scheduler::evaluate_all(c)?;
        super::events::compact_outbox(c)?;
        Ok((expired, stale))
    })
    .await?;
    let mut touched: Vec<String> = Vec::new();
    for v in stale {
        let Some(url) = v.health_url.clone().filter(|u| verification::is_http_url(u)) else { continue };
        let health = verification::http_health(&url, Duration::from_secs(10)).await;
        let rid = v.requirement_id.clone();
        db(&app, move |c| {
            verification::record_health(c, &v.requirement_id, &v.producer_task_id, &health)?;
            super::artifacts::apply_recheck(c, &v.id, &health)
        })
        .await?;
        touched.push(rid);
    }
    if !expired.is_empty() || !touched.is_empty() {
        notify(&app, None);
    }
    Ok(())
}
