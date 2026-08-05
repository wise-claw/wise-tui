//! Tauri commands for Cursor ACP integration (persistent per-tab sessions).

use std::collections::HashMap;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::claude_commands::{ClaudeProcessState, ClaudeSessionRegistry};
use crate::cursor_acp_session::CursorAcpSession;
use crate::cursor_acp_stream_adapter::{
    adapt_acp_notification_to_stream_lines, ask_question_event_payload, create_plan_event_payload,
    cursor_acp_init_line, cursor_agent_bind_line, emit_acp_complete, emit_acp_output_line,
    permission_event_payload,
};
use crate::cursor_acp_types::{
    permission_cancelled_result, permission_selected_result, AcpServerRequest, JsonRpcId,
    JsonRpcMessage,
};
use crate::cursor_agent::load_cursor_api_key;
use crate::cursor_binary::find_cursor_agent_binary;
use crate::cursor_disk::{append_cursor_session_line, build_cursor_user_turn_line};
use crate::wise_db::WiseDb;

/// Active ACP sessions keyed by Wise tab session id.
#[derive(Default, Clone)]
pub(crate) struct CursorAcpSessionStore {
    pub(crate) sessions: Arc<TokioMutex<HashMap<String, Arc<TokioMutex<CursorAcpSession>>>>>,
    /// Tabs currently running a prompt turn (prevents overlapping prompts).
    pub(crate) busy: Arc<TokioMutex<HashMap<String, bool>>>,
    /// Monotonic turn epoch per tab. Interrupt / newer execute bumps this so a
    /// superseded prompt loop must not clear `busy` or emit complete for the new turn.
    pub(crate) turn_epoch: Arc<TokioMutex<HashMap<String, u64>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteCursorAcpParams {
    prompt: String,
    #[serde(default)]
    project_path: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    invocation_key: Option<String>,
    #[serde(default)]
    tab_session_id: Option<String>,
    /// Previously bound ACP/CLI session id for session/load.
    #[serde(default)]
    cursor_agent_id: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    /// When true (default), auto-allow tool permissions like former `--force`.
    #[serde(default = "default_true")]
    auto_approve_permissions: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InterruptCursorAcpParams {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShutdownCursorAcpParams {
    session_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCursorAcpPermissionParams {
    pub session_id: String,
    pub request_id: String,
    /// allow-once | allow-always | reject-once | cancelled
    pub decision: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCursorAcpQuestionParams {
    pub session_id: String,
    pub request_id: String,
    pub outcome: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RespondCursorAcpPlanParams {
    pub session_id: String,
    pub request_id: String,
    pub outcome: Value,
}

fn persist_line(project_path: &str, tab_session_id: &str, line: &str) {
    if let Err(e) = append_cursor_session_line(project_path, tab_session_id, line) {
        eprintln!("[cursor_acp] transcript append failed (tab={tab_session_id}): {e}");
    }
}

fn emit_and_persist(
    app: &AppHandle,
    project_path: &str,
    session_id: &str,
    line: &str,
    invocation_key: Option<&str>,
) {
    persist_line(project_path, session_id, line);
    emit_acp_output_line(app, session_id, line, invocation_key);
}

fn parse_request_id(raw: &str) -> JsonRpcId {
    let trimmed = raw.trim();
    if let Ok(n) = trimmed.parse::<u64>() {
        JsonRpcId::Number(n)
    } else {
        JsonRpcId::String(trimmed.to_string())
    }
}

fn request_id_key(id: &JsonRpcId) -> String {
    match id {
        JsonRpcId::Number(n) => n.to_string(),
        JsonRpcId::String(s) => s.clone(),
    }
}

async fn get_or_create_session(
    app: &AppHandle,
    store: &CursorAcpSessionStore,
    tab_session_id: &str,
    project_path: &str,
    resume_id: Option<&str>,
) -> Result<Arc<TokioMutex<CursorAcpSession>>, String> {
    // Reuse healthy session.
    {
        let sessions = store.sessions.lock().await;
        if let Some(existing) = sessions.get(tab_session_id) {
            let mut guard = existing.lock().await;
            if !guard.is_dead() && guard.acp_session_id.is_some() {
                drop(guard);
                return Ok(existing.clone());
            }
        }
    }

    let agent = find_cursor_agent_binary()?;
    let db = app.state::<WiseDb>();
    let api_key = load_cursor_api_key(&db.0);

    let mut session = CursorAcpSession::bootstrap(&agent, api_key.as_deref(), project_path)
        .await
        .map_err(|e| format!("Cursor ACP 启动失败: {e}"))?;

    let acp_sid = if let Some(resume) = resume_id.map(str::trim).filter(|s| !s.is_empty()) {
        match session.session_load(resume).await {
            Ok(sid) => sid,
            Err(e) => {
                eprintln!("[cursor_acp] session/load failed ({e}); falling back to session/new");
                session
                    .session_new()
                    .await
                    .map_err(|e2| format!("Cursor ACP session/new 失败: {e2}"))?
            }
        }
    } else {
        session
            .session_new()
            .await
            .map_err(|e| format!("Cursor ACP session/new 失败: {e}"))?
    };

    let _ = acp_sid;
    let arc = Arc::new(TokioMutex::new(session));
    {
        let mut sessions = store.sessions.lock().await;
        sessions.insert(tab_session_id.to_string(), arc.clone());
    }
    Ok(arc)
}

/// Main execute entry: persistent ACP session + one prompt turn.
#[tauri::command]
pub(crate) async fn execute_cursor_acp(
    app: AppHandle,
    db: tauri::State<'_, WiseDb>,
    store: tauri::State<'_, CursorAcpSessionStore>,
    params: ExecuteCursorAcpParams,
) -> Result<(), String> {
    let _ = &db;
    let trimmed_prompt = params.prompt.trim();
    if trimmed_prompt.is_empty() {
        return Err("Cursor ACP 执行需要非空提示词".to_string());
    }
    if params.project_path.trim().is_empty() {
        return Err("Cursor ACP 执行需要 projectPath".to_string());
    }

    let session_id = params
        .tab_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("cursor-{}", Uuid::new_v4().simple()));

    {
        let mut busy = store.busy.lock().await;
        if busy.get(&session_id).copied().unwrap_or(false) {
            return Err("该会话已有进行中的 Cursor ACP 回合".to_string());
        }
        busy.insert(session_id.clone(), true);
    }

    let turn_epoch = {
        let mut epochs = store.turn_epoch.lock().await;
        let entry = epochs.entry(session_id.clone()).or_insert(0);
        *entry = entry.saturating_add(1);
        *entry
    };

    let invocation_key = params
        .invocation_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);

    {
        let registry = app.state::<ClaudeSessionRegistry>();
        let model_label = params.model.as_deref().unwrap_or("cursor-acp").to_string();
        registry.register(session_id.clone(), params.project_path.clone(), model_label);
    }

    if let Some(inv) = invocation_key.as_deref() {
        let process_state = app.state::<ClaudeProcessState>();
        process_state
            .invocation_tab_session_by_key
            .lock()
            .await
            .insert(inv.to_string(), session_id.clone());
    }

    let resume = params.cursor_agent_id.as_deref();
    let session_arc = match get_or_create_session(
        &app,
        &store,
        &session_id,
        &params.project_path,
        resume,
    )
    .await
    {
        Ok(s) => s,
        Err(e) => {
            store.busy.lock().await.remove(&session_id);
            emit_and_persist(
                &app,
                &params.project_path,
                &session_id,
                &json!({
                    "type": "assistant",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": &e }] }
                })
                .to_string(),
                invocation_key.as_deref(),
            );
            let registry = app.state::<ClaudeSessionRegistry>();
            registry.mark_completed(&session_id, false);
            emit_acp_complete(&app, invocation_key.as_deref(), &session_id, false, None);
            return Err(e);
        }
    };

    // Configure model/mode + emit bind/init + persist user turn.
    let acp_session_id = {
        let mut guard = session_arc.lock().await;
        if let Some(mode) = params.mode.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let _ = guard.set_config_option("mode", mode).await;
        }
        if let Err(e) = guard.set_model_if_needed(params.model.as_deref()).await {
            eprintln!("[cursor_acp] set model failed (non-fatal): {e}");
        }
        guard
            .acp_session_id
            .clone()
            .unwrap_or_else(|| session_id.clone())
    };

    emit_and_persist(
        &app,
        &params.project_path,
        &session_id,
        &cursor_acp_init_line(&session_id),
        invocation_key.as_deref(),
    );
    emit_and_persist(
        &app,
        &params.project_path,
        &session_id,
        &cursor_agent_bind_line(&acp_session_id),
        invocation_key.as_deref(),
    );

    let user_line = build_cursor_user_turn_line(trimmed_prompt, None);
    persist_line(&params.project_path, &session_id, &user_line);

    let prompt_rx = {
        let mut guard = session_arc.lock().await;
        match guard.begin_prompt(trimmed_prompt).await {
            Ok((_id, rx)) => rx,
            Err(e) => {
                store.busy.lock().await.remove(&session_id);
                let msg = format!("Cursor ACP prompt 失败: {e}");
                emit_and_persist(
                    &app,
                    &params.project_path,
                    &session_id,
                    &json!({
                        "type": "assistant",
                        "message": { "role": "assistant", "content": [{ "type": "text", "text": &msg }] }
                    })
                    .to_string(),
                    invocation_key.as_deref(),
                );
                let registry = app.state::<ClaudeSessionRegistry>();
                registry.mark_completed(&session_id, false);
                emit_acp_complete(
                    &app,
                    invocation_key.as_deref(),
                    &session_id,
                    false,
                    Some(&acp_session_id),
                );
                return Err(msg);
            }
        }
    };

    let app_loop = app.clone();
    let session_id_loop = session_id.clone();
    let project_path_loop = params.project_path.clone();
    let invocation_key_loop = invocation_key.clone();
    let acp_sid_loop = acp_session_id.clone();
    let auto_approve = params.auto_approve_permissions;
    let store_loop = store.inner().clone();
    let session_arc_loop = session_arc.clone();

    tokio::spawn(async move {
        let mut success = true;
        let mut prompt_rx = prompt_rx;

        loop {
            // Check prompt completion without holding the session lock.
            match prompt_rx.try_recv() {
                Ok(msg) => {
                    match msg {
                        JsonRpcMessage::Response { error: Some(err), .. } => {
                            success = false;
                            let text = format!("Cursor ACP 错误: {}", err.message);
                            emit_and_persist(
                                &app_loop,
                                &project_path_loop,
                                &session_id_loop,
                                &json!({
                                    "type": "assistant",
                                    "message": { "role": "assistant", "content": [{ "type": "text", "text": text }] }
                                })
                                .to_string(),
                                invocation_key_loop.as_deref(),
                            );
                        }
                        JsonRpcMessage::Response { result, .. } => {
                            let stop = result
                                .as_ref()
                                .and_then(|v| v.get("stopReason"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("end_turn");
                            if stop == "cancelled" || stop == "refusal" {
                                success = false;
                            }
                        }
                        _ => {
                            success = false;
                        }
                    }
                    break;
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
                Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    success = false;
                    break;
                }
            }

            enum Poll {
                Notif(String, Option<Value>),
                Req(AcpServerRequest),
                Idle,
            }

            let poll = {
                let mut guard = session_arc_loop.lock().await;
                if let Some((method, params)) = guard.poll_notification() {
                    Poll::Notif(method, params)
                } else if let Some(req) = guard.poll_server_request() {
                    Poll::Req(req)
                } else {
                    Poll::Idle
                }
            };

            match poll {
                Poll::Idle => {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
                Poll::Notif(method, params) => {
                    let lines = adapt_acp_notification_to_stream_lines(
                        &method,
                        params.as_ref(),
                        &session_id_loop,
                    );
                    for line in &lines {
                        emit_and_persist(
                            &app_loop,
                            &project_path_loop,
                            &session_id_loop,
                            line,
                            invocation_key_loop.as_deref(),
                        );
                    }
                    // Best-effort todos from cursor/update_todos arrive as notifications
                    // with method name; also handle sessionUpdate variants already covered.
                    if method == "cursor/update_todos" {
                        if let Some(p) = params {
                            let line = json!({
                                "type": "system",
                                "subtype": "todo_list",
                                "todos": p.get("todos").cloned().unwrap_or(Value::Array(vec![])),
                            })
                            .to_string();
                            emit_and_persist(
                                &app_loop,
                                &project_path_loop,
                                &session_id_loop,
                                &line,
                                invocation_key_loop.as_deref(),
                            );
                        }
                    }
                    // cursor/task is also handled inside adapt_acp_notification_to_stream_lines;
                    // lines above already include the mapped Task tool_use when method matches.
                }
                Poll::Req(req) => {
                    handle_server_request(
                        &app_loop,
                        &session_arc_loop,
                        &session_id_loop,
                        req,
                        auto_approve,
                    )
                    .await;
                }
            }
        }

        {
            let still_current = {
                let epochs = store_loop.turn_epoch.lock().await;
                epochs.get(&session_id_loop).copied().unwrap_or(0) == turn_epoch
            };
            if !still_current {
                // Interrupt or a newer execute owns this tab; do not touch busy /
                // prompt_in_flight / completion events belonging to the new turn.
                return;
            }
            let mut guard = session_arc_loop.lock().await;
            guard.mark_prompt_done();
        }
        store_loop.busy.lock().await.remove(&session_id_loop);

        let registry = app_loop.state::<ClaudeSessionRegistry>();
        registry.mark_completed(&session_id_loop, success);
        emit_acp_complete(
            &app_loop,
            invocation_key_loop.as_deref(),
            &session_id_loop,
            success,
            Some(&acp_sid_loop),
        );
    });

    Ok(())
}

async fn handle_server_request(
    app: &AppHandle,
    session_arc: &Arc<TokioMutex<CursorAcpSession>>,
    wise_session_id: &str,
    req: AcpServerRequest,
    auto_approve: bool,
) {
    match req {
        AcpServerRequest::RequestPermission { request_id, params } => {
            let key = request_id_key(&request_id);
            if auto_approve {
                // Prefer allow-always if offered, else allow-once.
                let option_id = params
                    .get("options")
                    .and_then(|o| o.as_array())
                    .and_then(|arr| {
                        arr.iter()
                            .find_map(|opt| {
                                let id = opt.get("optionId").and_then(|v| v.as_str())?;
                                if id == "allow-always" || id == "allow_always" {
                                    Some(id)
                                } else {
                                    None
                                }
                            })
                            .or_else(|| {
                                arr.iter().find_map(|opt| {
                                    opt.get("optionId").and_then(|v| v.as_str())
                                })
                            })
                    })
                    .unwrap_or("allow-once");
                let mut guard = session_arc.lock().await;
                let _ = guard
                    .respond(request_id, permission_selected_result(option_id))
                    .await;
                return;
            }
            let payload = permission_event_payload(wise_session_id, &key, &params);
            let _ = app.emit("cursor-acp:permission-request", payload);
        }
        AcpServerRequest::AskQuestion { request_id, params } => {
            let key = request_id_key(&request_id);
            let payload = ask_question_event_payload(wise_session_id, &key, &params);
            let _ = app.emit("cursor-acp:ask-question", payload);
        }
        AcpServerRequest::CreatePlan { request_id, params } => {
            let key = request_id_key(&request_id);
            let payload = create_plan_event_payload(wise_session_id, &key, &params);
            let _ = app.emit("cursor-acp:create-plan", payload);
        }
        AcpServerRequest::Unknown {
            request_id,
            method,
            params,
        } => {
            eprintln!("[cursor_acp] unknown server request: {method} params={params:?}");
            // Unblock the agent with a cancelled/empty result when possible.
            let mut guard = session_arc.lock().await;
            let _ = guard
                .respond(request_id, permission_cancelled_result())
                .await;
        }
    }
}

#[tauri::command]
pub(crate) async fn interrupt_cursor_acp(
    app: AppHandle,
    store: tauri::State<'_, CursorAcpSessionStore>,
    params: InterruptCursorAcpParams,
) -> Result<(), String> {
    // Invalidate the in-flight prompt loop's finalize before unblocking waiters /
    // clearing busy, so a quick re-send cannot have its busy flag stolen.
    {
        let mut epochs = store.turn_epoch.lock().await;
        let entry = epochs.entry(params.session_id.clone()).or_insert(0);
        *entry = entry.saturating_add(1);
    }
    store.busy.lock().await.remove(&params.session_id);

    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions.get(&params.session_id).cloned()
    };
    if let Some(session_arc) = session_arc {
        let mut guard = session_arc.lock().await;
        guard
            .cancel_prompt()
            .await
            .map_err(|e| format!("session/cancel failed: {e}"))?;
    }

    let registry = app.state::<ClaudeSessionRegistry>();
    registry.mark_completed(&params.session_id, false);

    let _ = app.emit(
        "cursor-acp:interrupted",
        json!({ "sessionId": params.session_id }),
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn shutdown_cursor_acp(
    store: tauri::State<'_, CursorAcpSessionStore>,
    params: ShutdownCursorAcpParams,
) -> Result<(), String> {
    let session_arc = {
        let mut sessions = store.sessions.lock().await;
        sessions.remove(&params.session_id)
    };
    store.turn_epoch.lock().await.remove(&params.session_id);
    store.busy.lock().await.remove(&params.session_id);
    if let Some(arc) = session_arc {
        let mut guard = arc.lock().await;
        let _ = guard.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn respond_cursor_acp_permission(
    app: AppHandle,
    store: tauri::State<'_, CursorAcpSessionStore>,
    params: RespondCursorAcpPermissionParams,
) -> Result<(), String> {
    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions
            .get(&params.session_id)
            .cloned()
            .ok_or_else(|| format!("No active Cursor ACP session: {}", params.session_id))?
    };
    let decision = params.decision.trim();
    let result = match decision {
        "allow-once" | "allow_once" | "allow" | "accept" => {
            permission_selected_result("allow-once")
        }
        "allow-always" | "allow_always" | "allowAlways" => {
            permission_selected_result("allow-always")
        }
        "reject-once" | "reject_once" | "reject" | "deny" => {
            permission_selected_result("reject-once")
        }
        "cancelled" | "cancel" => permission_cancelled_result(),
        other => permission_selected_result(other),
    };
    let id = parse_request_id(&params.request_id);
    {
        let mut guard = session_arc.lock().await;
        guard
            .respond(id, result)
            .await
            .map_err(|e| format!("respond permission failed: {e}"))?;
    }
    let _ = app.emit(
        "cursor-acp:permission-resolved",
        json!({
            "sessionId": params.session_id,
            "requestId": params.request_id,
            "decision": params.decision,
        }),
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn respond_cursor_acp_question(
    app: AppHandle,
    store: tauri::State<'_, CursorAcpSessionStore>,
    params: RespondCursorAcpQuestionParams,
) -> Result<(), String> {
    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions
            .get(&params.session_id)
            .cloned()
            .ok_or_else(|| format!("No active Cursor ACP session: {}", params.session_id))?
    };
    let id = parse_request_id(&params.request_id);
    {
        let mut guard = session_arc.lock().await;
        guard
            .respond(id, params.outcome.clone())
            .await
            .map_err(|e| format!("respond question failed: {e}"))?;
    }
    let _ = app.emit(
        "cursor-acp:ask-question-resolved",
        json!({
            "sessionId": params.session_id,
            "requestId": params.request_id,
        }),
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn respond_cursor_acp_plan(
    app: AppHandle,
    store: tauri::State<'_, CursorAcpSessionStore>,
    params: RespondCursorAcpPlanParams,
) -> Result<(), String> {
    let session_arc = {
        let sessions = store.sessions.lock().await;
        sessions
            .get(&params.session_id)
            .cloned()
            .ok_or_else(|| format!("No active Cursor ACP session: {}", params.session_id))?
    };
    let id = parse_request_id(&params.request_id);
    {
        let mut guard = session_arc.lock().await;
        guard
            .respond(id, params.outcome.clone())
            .await
            .map_err(|e| format!("respond plan failed: {e}"))?;
    }
    let _ = app.emit(
        "cursor-acp:create-plan-resolved",
        json!({
            "sessionId": params.session_id,
            "requestId": params.request_id,
        }),
    );
    Ok(())
}
