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
) -> Result<Vec<serde_json::Value>, String> {
    // 与前端 listRuns 上限对齐；payload 内 tasks 可极大，列表仅用于绑定会话，剥离后再过 IPC。
    let raws = db.list_workflow_run_payloads(500)?;
    let mut out = Vec::new();
    for raw in raws {
        let mut parsed: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("解析 workflow run 失败: {}", e))?;
        if let Some(obj) = parsed.as_object_mut() {
            obj.insert("tasks".to_string(), serde_json::json!([]));
        }
        out.push(parsed);
    }
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
