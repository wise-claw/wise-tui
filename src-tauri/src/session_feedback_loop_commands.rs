use crate::session_feedback_loop_db::{
    FeedbackLoopHistoryRecordDto, PatchEffectivenessRecordDto,
};
use crate::wise_db::WiseDb;
use tauri::State;

#[tauri::command]
pub(crate) fn upsert_session_feedback_loop_history(
    db: State<'_, WiseDb>,
    record: FeedbackLoopHistoryRecordDto,
) -> Result<(), String> {
    db.upsert_session_feedback_loop_history(record)
}

#[tauri::command]
pub(crate) fn list_session_feedback_loop_history(
    db: State<'_, WiseDb>,
    repository_path: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<FeedbackLoopHistoryRecordDto>, String> {
    db.list_session_feedback_loop_history(
        repository_path.as_deref(),
        limit.unwrap_or(40),
    )
}

#[tauri::command]
pub(crate) fn insert_session_feedback_patch_effectiveness_batch(
    db: State<'_, WiseDb>,
    records: Vec<PatchEffectivenessRecordDto>,
) -> Result<u32, String> {
    db.insert_session_feedback_patch_effectiveness_batch(&records)
}

#[tauri::command]
pub(crate) fn list_session_feedback_patch_effectiveness(
    db: State<'_, WiseDb>,
    repository_path: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<PatchEffectivenessRecordDto>, String> {
    db.list_session_feedback_patch_effectiveness(
        repository_path.as_deref(),
        limit.unwrap_or(200),
    )
}

#[tauri::command]
pub(crate) fn attach_session_feedback_patch_scores(
    db: State<'_, WiseDb>,
    repository_path: String,
    session_final_score: f64,
    within_ms: Option<i64>,
) -> Result<u32, String> {
    db.attach_session_feedback_patch_scores(
        &repository_path,
        session_final_score,
        within_ms.unwrap_or(30 * 60_000),
    )
}
