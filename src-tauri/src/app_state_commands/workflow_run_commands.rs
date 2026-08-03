use crate::wise_db;

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub(crate) fn get_workflow_run(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_run_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let raw = db.get_workflow_run_payload(&workflow_run_id)?;
    if let Some(value) = raw {
        let parsed: serde_json::Value =
            serde_json::from_str(&value).map_err(|e| format!("解析 workflow run 失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub(crate) fn set_workflow_run(
    db: tauri::State<'_, wise_db::WiseDb>,
    run: serde_json::Value,
) -> Result<(), String> {
    if !run.is_object() {
        return Err("workflow run 格式无效".to_string());
    }
    let workflow_run_id = run
        .get("workflowRunId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "workflowRunId 缺失".to_string())?;
    let session_id = run
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "sessionId 缺失".to_string())?;
    let repository_path = run
        .get("repositoryPath")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "repositoryPath 缺失".to_string())?;
    let updated_at = run
        .get("updatedAt")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(unix_now_ms);
    let raw =
        serde_json::to_string(&run).map_err(|e| format!("序列化 workflow run 失败: {}", e))?;
    db.set_workflow_run_payload(
        workflow_run_id,
        session_id,
        repository_path,
        &raw,
        updated_at,
    )
}

#[tauri::command]
pub(crate) fn list_workflow_runs(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_path: Option<String>,
    limit: Option<i64>,
    status: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    // 列表只需绑定会话/展示阶段：DB 侧元数据投影 + json_extract，不载入巨大 tasks payload，
    // repository_path/limit/status 由前端下推（status 过滤在 LIMIT 之前），避免每次返回最多 500 条无关 run。
    let summaries = db
        .list_workflow_run_summaries(limit.unwrap_or(500), repository_path.as_deref(), status.as_deref())?;
    let out = summaries
        .into_iter()
        .map(|(workflow_run_id, session_id, repository_path, updated_at, current_stage, status)| {
            serde_json::json!({
                "workflowRunId": workflow_run_id,
                "sessionId": session_id,
                "repositoryPath": repository_path,
                // 老数据可能缺 stage/status 字段，回退到与 createRun 一致的默认值，避免前端列表空值。
                "currentStage": current_stage.unwrap_or_else(|| "split".to_string()),
                "status": status.unwrap_or_else(|| "running".to_string()),
                "updatedAt": updated_at,
            })
        })
        .collect();
    Ok(out)
}

#[tauri::command]
pub(crate) fn append_workflow_event(
    db: tauri::State<'_, wise_db::WiseDb>,
    event: serde_json::Value,
) -> Result<(), String> {
    if !event.is_object() {
        return Err("workflow event 格式无效".to_string());
    }
    let event_id = event
        .get("eventId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "eventId 缺失".to_string())?;
    let workflow_run_id = event
        .get("workflowRunId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "workflowRunId 缺失".to_string())?;
    let timestamp = event
        .get("timestamp")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(unix_now_ms);
    let raw =
        serde_json::to_string(&event).map_err(|e| format!("序列化 workflow event 失败: {}", e))?;
    db.append_workflow_event_payload(event_id, workflow_run_id, timestamp, &raw)
}

#[tauri::command]
pub(crate) fn migrate_workflow_session_tab_references(
    db: tauri::State<'_, wise_db::WiseDb>,
    from_tab_id: String,
    to_session_id: String,
) -> Result<(), String> {
    db.migrate_claude_tab_session_references(&from_tab_id, &to_session_id)
}

#[tauri::command]
pub(crate) fn list_workflow_events(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_run_id: String,
    from: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let raws = db.list_workflow_event_payloads(&workflow_run_id, from, until)?;
    let mut out = Vec::new();
    for raw in raws {
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("解析 workflow event 失败: {}", e))?;
        out.push(parsed);
    }
    Ok(out)
}
