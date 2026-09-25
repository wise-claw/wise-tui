//! Agent 工具通道：本机 127.0.0.1 HTTP 桥 + `~/.wise/collab/bin/wise-collab` CLI。
//!
//! Agent 在会话里执行 `wise-collab --attempt <id> <命令> '<JSON>'`，CLI 读取
//! `~/.wise/collab/bridge.json`（端口）与 `attempts/<id>.json`（尝试密钥，0600），
//! 以 `X-Wise-Attempt` / `X-Wise-Secret` 调用桥；桥按尝试身份 + fencing 写入协作状态。

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, Path as AxumPath, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rusqlite::Connection;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::error::{codes, CResult, CollabError};
use super::model::{self, AttemptRow};
use super::runtime::EffectiveConfigManifest;
use super::verification::{self, PreparedRun};
use super::RepoDirectory;

pub const CHANGED_EVENT: &str = "wise-collab-changed";
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

static PORT: Mutex<Option<u16>> = Mutex::new(None);

pub fn collab_dir() -> Option<PathBuf> {
    crate::wise_dir().ok().map(|d| d.join("collab"))
}

pub fn cli_path() -> Option<PathBuf> {
    collab_dir().map(|d| d.join("bin").join("wise-collab"))
}

fn attempt_file(attempt_id: &str) -> Option<PathBuf> {
    let safe: String = attempt_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    if safe.is_empty() {
        return None;
    }
    collab_dir().map(|d| d.join("attempts").join(format!("{safe}.json")))
}

#[cfg(unix)]
fn restrict(path: &std::path::Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn restrict(_path: &std::path::Path, _mode: u32) {}

pub fn write_attempt_credentials(attempt_id: &str, secret: &str, fencing_token: i64) -> Result<(), String> {
    let path = attempt_file(attempt_id).ok_or("无法定位协作目录")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        restrict(dir, 0o700);
    }
    let body = json!({ "attemptId": attempt_id, "secret": secret, "fencingToken": fencing_token }).to_string();
    crate::wise_paths::write_file_atomic(&path, &body)?;
    restrict(&path, 0o600);
    Ok(())
}

pub fn remove_attempt_credentials(attempt_id: &str) {
    if let Some(p) = attempt_file(attempt_id) {
        let _ = std::fs::remove_file(p);
    }
}

fn cli_script(dir: &std::path::Path) -> String {
    let dir = dir.to_string_lossy().replace('\'', "'\\''");
    format!(
        r#"#!/bin/sh
# wise-collab：Wise 多仓库协作工具通道（由 Wise 自动生成，请勿手改）
# 用法：wise-collab --attempt <尝试ID> <命令> '<JSON>'   （JSON 为 - 时从标准输入读取）
DIR='{dir}'
ATTEMPT="${{WISE_COLLAB_ATTEMPT:-}}"
if [ "$1" = "--attempt" ]; then ATTEMPT="$2"; shift 2; fi
CMD="$1"
[ $# -gt 0 ] && shift
BODY="${{1:-{{}}}}"
if [ "$BODY" = "-" ]; then BODY="$(cat)"; fi
if [ -z "$CMD" ] || [ -z "$ATTEMPT" ]; then
  echo '{{"ok":false,"error":{{"code":"INVALID_PAYLOAD","message":"用法：wise-collab --attempt <尝试ID> <命令> <JSON>"}}}}'
  exit 2
fi
PORT=$(sed -n 's/.*"port":[ ]*\([0-9]*\).*/\1/p' "$DIR/bridge.json" 2>/dev/null)
SECRET=$(sed -n 's/.*"secret":[ ]*"\([^"]*\)".*/\1/p' "$DIR/attempts/$ATTEMPT.json" 2>/dev/null)
if [ -z "$PORT" ] || [ -z "$SECRET" ]; then
  echo '{{"ok":false,"error":{{"code":"STALE_ATTEMPT","message":"协作服务未运行或本尝试已结束"}}}}'
  exit 3
fi
curl -sS -X POST "http://127.0.0.1:$PORT/v1/collab/$CMD" \
  -H "Content-Type: application/json" \
  -H "X-Wise-Attempt: $ATTEMPT" \
  -H "X-Wise-Secret: $SECRET" \
  --data-binary "$BODY"
echo
"#
    )
}

pub fn install_cli() -> Result<PathBuf, String> {
    let dir = collab_dir().ok_or("无法定位协作目录")?;
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
    let path = bin.join("wise-collab");
    crate::wise_paths::write_file_atomic(&path, &cli_script(&dir))?;
    restrict(&path, 0o755);
    Ok(path)
}

pub fn port() -> Option<u16> {
    PORT.lock().ok().and_then(|g| *g)
}

// ── Agent command dispatch (sync part, shared with tests) ──

pub enum Step {
    Done(Value),
    Verify(PreparedRun),
    Validate { version_id: String, health_url: Option<String>, requirement_id: String },
}

fn parse<T: serde::de::DeserializeOwned>(body: &Value) -> CResult<T> {
    serde_json::from_value(body.clone()).map_err(|e| CollabError::new(codes::INVALID_PAYLOAD, format!("参数无效：{e}")))
}

fn str_arg<'a>(body: &'a Value, key: &str) -> Option<&'a str> {
    body.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

pub fn agent_command(
    conn: &Connection,
    repos: &RepoDirectory,
    att: &AttemptRow,
    cmd: &str,
    body: &Value,
) -> CResult<Step> {
    let fencing = att.fencing_token;
    let v = |x: CResult<Value>| x.map(Step::Done);
    match cmd {
        "context" => {
            let live = super::scheduler::live_attempt(conn, &att.id, fencing, true)?;
            let task = model::load_task(conn, &live.task_id)?;
            let req = model::load_requirement(conn, &task.requirement_id)?;
            let manifest: EffectiveConfigManifest = serde_json::from_value(live.effective_config_manifest.clone()).unwrap_or_default();
            let repo = task.repository_id.and_then(|id| repos.get(&id)).cloned().unwrap_or_default();
            let pkg = super::context::build_package(conn, &req, &task, &live.id, &manifest, &repo, repos)?;
            v(Ok(json!({ "prompt": super::context::build_prompt(&pkg), "package": pkg })))
        }
        "messages" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, true)?;
            v(Ok(json!(super::events::task_inbox(conn, &att.task_id)?)))
        }
        "plan" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, false)?;
            let input: super::plans::PlanInput = parse(body)?;
            let source = super::plans::PlanSource { attempt_id: Some(att.id.clone()), task_id: Some(att.task_id.clone()), by_user: false };
            let out = super::plans::publish_plan(conn, &att.requirement_id, &input, &source, repos)?;
            v(Ok(serde_json::to_value(out)?))
        }
        "checkpoint" => {
            let input: super::scheduler::CheckpointInput = parse(body)?;
            let id = super::scheduler::save_checkpoint(conn, &att.id, fencing, &input)?;
            v(Ok(json!({ "checkpointId": id })))
        }
        "verify" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, false)?;
            let run = verification::prepare_run(conn, &att.task_id, Some(&att.id), str_arg(body, "command"), repos, false)?;
            Ok(Step::Verify(run))
        }
        "artifact" => {
            let input: super::artifacts::PublishArtifactInput = parse(body)?;
            let version = super::artifacts::publish_candidate(conn, &att.id, fencing, &input)?;
            if version.is_draft {
                return v(Ok(serde_json::to_value(version)?));
            }
            Ok(Step::Validate { version_id: version.id.clone(), health_url: version.health_url.clone(), requirement_id: version.requirement_id })
        }
        "change" => {
            let payload: super::changes::ChangePayload = parse(body)?;
            v(Ok(serde_json::to_value(super::changes::submit_change(conn, &att.id, fencing, &payload)?)?))
        }
        "retest" => {
            let ack: super::changes::RetestAck = parse(body)?;
            v(Ok(serde_json::to_value(super::changes::acknowledge_retest(conn, &att.id, fencing, &ack)?)?))
        }
        "change-rejection" => {
            let input: super::changes::RejectionProposal = parse(body)?;
            v(Ok(serde_json::to_value(super::changes::propose_rejection(conn, &att.id, fencing, &input)?)?))
        }
        "result" => v(Ok(serde_json::to_value(super::scheduler::record_result(conn, &att.id, fencing, body)?)?)),
        "memory" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, true)?;
            let task = model::load_task(conn, &att.task_id)?;
            let agent = task.executor_agent_id.clone().ok_or_else(|| CollabError::state("该任务没有执行智能体，无法记录记忆"))?;
            let scope = str_arg(body, "scope").unwrap_or("repository").to_string();
            let item = super::memory::add_memory(
                conn,
                super::memory::AddMemoryInput {
                    agent_id: agent,
                    scope: scope.clone(),
                    project_id: task.project_id.clone(),
                    repository_id: task.repository_id,
                    requirement_id: if scope == "requirement" { Some(task.requirement_id.clone()) } else { None },
                    content: str_arg(body, "content").unwrap_or("").to_string(),
                    trust: Some("candidate".into()),
                    source_attempt_id: Some(att.id.clone()),
                    evidence: body.get("evidence").cloned(),
                    expires_at: None,
                },
            )?;
            v(Ok(serde_json::to_value(item)?))
        }
        "resources" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, true)?;
            let who = super::resources::principal_for_attempt(conn, &att.task_id)?;
            let limit = body.get("limit").and_then(Value::as_u64).unwrap_or(10).clamp(1, 30) as usize;
            let hits = super::resources::search(conn, &who, str_arg(body, "query").unwrap_or(""), limit)?;
            v(Ok(serde_json::to_value(hits)?))
        }
        "resource" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, true)?;
            let who = super::resources::principal_for_attempt(conn, &att.task_id)?;
            let id = str_arg(body, "id").ok_or_else(|| CollabError::invalid("缺少资源 id"))?;
            // A running attempt keeps reading the version pinned in its input manifest.
            let pinned = att.input_manifest["resources"]
                .as_array()
                .and_then(|refs| refs.iter().find(|r| r["id"] == id))
                .and_then(|r| r["version"].as_i64());
            let (res, ver) = super::resources::read(conn, &who, id, body.get("version").and_then(Value::as_i64).or(pinned))?;
            v(Ok(json!({ "resource": res, "version": ver })))
        }
        "runtime-resource" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, false)?;
            let input: super::runtime_resources::RegisterRuntimeInput = parse(body)?;
            let r = super::runtime_resources::register(conn, &att.requirement_id, &att.task_id, &att.id, &input)?;
            v(Ok(serde_json::to_value(r)?))
        }
        "runtime-use" | "runtime-release" => {
            super::scheduler::live_attempt(conn, &att.id, fencing, true)?;
            let id = str_arg(body, "resourceId").ok_or_else(|| CollabError::invalid("缺少 resourceId"))?;
            if cmd == "runtime-use" {
                super::runtime_resources::add_consumer(conn, id, &att.requirement_id, &att.task_id)?;
            } else {
                super::runtime_resources::release_consumer(conn, id, &att.requirement_id, &att.task_id)?;
            }
            v(Ok(serde_json::to_value(super::runtime_resources::load(conn, id)?)?))
        }
        other => Err(CollabError::invalid(format!("未知协作命令：{other}"))),
    }
}

// ── HTTP server ──

#[derive(Clone)]
struct Inner {
    app: AppHandle,
}

fn reply(result: CResult<Value>) -> Response {
    match result {
        Ok(data) => (StatusCode::OK, Json(json!({ "ok": true, "data": data }))).into_response(),
        Err(e) => {
            let status = match e.code.as_str() {
                codes::FORBIDDEN => StatusCode::FORBIDDEN,
                codes::NOT_FOUND => StatusCode::NOT_FOUND,
                codes::STALE_ATTEMPT | codes::STALE_ROUND | codes::REVISION_CONFLICT => StatusCode::CONFLICT,
                codes::STORAGE_ERROR | codes::IO_ERROR => StatusCode::INTERNAL_SERVER_ERROR,
                _ => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({ "ok": false, "error": e }))).into_response()
        }
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CResult<T> + Send + 'static) -> CResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| CollabError::new(codes::STORAGE_ERROR, format!("协作任务异常：{e}")))?
}

pub(crate) fn notify(app: &AppHandle, requirement_id: Option<&str>) {
    let _ = app.emit(CHANGED_EVENT, json!({ "requirementId": requirement_id }));
}

async fn run_agent_command(app: AppHandle, attempt_id: String, secret: String, cmd: String, body: Value) -> CResult<Value> {
    let a = app.clone();
    let (step, requirement_id) = blocking(move || {
        let repos = super::commands::repos_of(&a);
        let db = a.state::<crate::wise_db::WiseDb>();
        let conn = db.conn();
        let att = super::scheduler::authenticate(&conn, &attempt_id, &secret)?;
        let rid = att.requirement_id.clone();
        agent_command(&conn, &repos, &att, &cmd, &body).map(|s| (s, rid))
    })
    .await?;
    let out = match step {
        Step::Done(v) => v,
        Step::Verify(run) => {
            let r = run.clone();
            let outcome = blocking(move || verification::execute_blocking(&r).map_err(|e| CollabError::new(codes::IO_ERROR, e))).await?;
            let a = app.clone();
            let recorded = blocking(move || {
                let db = a.state::<crate::wise_db::WiseDb>();
                let conn = db.conn();
                verification::record_run(&conn, &run, &outcome)
            })
            .await?;
            serde_json::to_value(recorded)?
        }
        Step::Validate { version_id, health_url, requirement_id } => {
            let health = match health_url.as_deref().filter(|u| verification::is_http_url(u)) {
                Some(u) => Some(verification::http_health(u, Duration::from_secs(10)).await),
                None => None,
            };
            let a = app.clone();
            let version = blocking(move || {
                let db = a.state::<crate::wise_db::WiseDb>();
                let conn = db.conn();
                let producer = model::load_artifact_version(&conn, &version_id)?.producer_task_id;
                if let Some(h) = health.as_ref() {
                    verification::record_health(&conn, &requirement_id, &producer, h)?;
                }
                super::artifacts::apply_validation(&conn, &version_id, health.as_ref())
            })
            .await?;
            let checks = serde_json::to_value(&version)?;
            json!({ "version": checks })
        }
    };
    notify(&app, Some(&requirement_id));
    Ok(out)
}

async fn handle(AxumState(inner): AxumState<Inner>, AxumPath(cmd): AxumPath<String>, headers: HeaderMap, body: Option<Json<Value>>) -> Response {
    let header = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).unwrap_or("").trim().to_string();
    let attempt = header("x-wise-attempt");
    let secret = header("x-wise-secret");
    if attempt.is_empty() || secret.is_empty() {
        return reply(Err(CollabError::new(codes::FORBIDDEN, "缺少尝试身份")));
    }
    let body = body.map(|Json(v)| v).unwrap_or(Value::Null);
    reply(run_agent_command(inner.app, attempt, secret, cmd, body).await)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "wise-collab" }))
}

pub async fn ensure_started(app: AppHandle) -> Result<u16, String> {
    if let Some(p) = port() {
        return Ok(p);
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|e| format!("协作桥监听失败：{e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let router = Router::new()
        .route("/health", get(health))
        .route("/v1/collab/{cmd}", post(handle))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(Inner { app: app.clone() });
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("[collab_bridge] server error: {e}");
        }
        if let Ok(mut g) = PORT.lock() {
            *g = None;
        }
    });
    if let Ok(mut g) = PORT.lock() {
        *g = Some(port);
    }
    let dir = collab_dir().ok_or("无法定位协作目录")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(
        &dir.join("bridge.json"),
        &json!({ "port": port, "pid": std::process::id(), "startedAt": super::util::now_ms() }).to_string(),
    )?;
    install_cli()?;
    Ok(port)
}

/// Background maintenance: lease expiry, health TTL rechecks, requirement evaluation.
pub fn spawn_maintenance(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = ensure_started(app.clone()).await {
            eprintln!("[collab_bridge] {e}");
        }
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            if let Err(e) = super::commands::maintenance_tick(app.clone()).await {
                eprintln!("[collab_maintenance] {e}");
            }
        }
    });
}
