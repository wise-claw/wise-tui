use crate::execution_environment_dispatch_db::{
    ExecutionEnvironmentDispatchRecordDto, UpsertExecutionEnvironmentBatchInput,
    UpsertExecutionEnvironmentItemInput,
};
use crate::wise_db::WiseDb;

#[tauri::command]
pub(crate) fn upsert_execution_environment_dispatch_batch(
    db: tauri::State<'_, WiseDb>,
    batch_id: String,
    anchor_session_id: String,
    repository_path: String,
    execution_engine: String,
    session_count: i32,
    preview_text: String,
    batch_hint: Option<String>,
    created_at_ms: i64,
) -> Result<(), String> {
    db.upsert_execution_environment_dispatch_batch(UpsertExecutionEnvironmentBatchInput {
        batch_id,
        anchor_session_id,
        repository_path,
        execution_engine,
        session_count,
        preview_text,
        batch_hint,
        created_at_ms,
    })
}

#[tauri::command]
pub(crate) fn upsert_execution_environment_dispatch_item(
    db: tauri::State<'_, WiseDb>,
    item_key: String,
    batch_id: String,
    anchor_session_id: String,
    worker_session_id: String,
    label: String,
    preview_text: String,
    batch_index: i32,
    session_count: i32,
    updated_at_ms: i64,
) -> Result<(), String> {
    db.upsert_execution_environment_dispatch_item(UpsertExecutionEnvironmentItemInput {
        item_key,
        batch_id,
        anchor_session_id,
        worker_session_id,
        label,
        preview_text,
        batch_index,
        session_count,
        updated_at_ms,
    })
}

#[tauri::command]
pub(crate) fn list_execution_environment_dispatches_for_anchor(
    db: tauri::State<'_, WiseDb>,
    anchor_session_id: String,
    since_ms: i64,
) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
    db.list_execution_environment_dispatches_for_anchor(&anchor_session_id, since_ms)
}

#[tauri::command]
pub(crate) fn list_execution_environment_dispatches_for_repository(
    db: tauri::State<'_, WiseDb>,
    repository_path: String,
    since_ms: i64,
) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
    db.list_execution_environment_dispatches_for_repository(&repository_path, since_ms)
}
