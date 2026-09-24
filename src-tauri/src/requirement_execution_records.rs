//! 需求逐轮执行与人工验收日志；与需求正文分开存储，避免编辑覆盖历史。
use crate::wise_db::WiseDb;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequirementExecutionRecord {
    id: String,
    requirement_id: String,
    session_id: String,
    kind: String,
    outcome: String,
    started_at: Option<i64>,
    finished_at: i64,
    engine: String,
    summary: String,
    files: Vec<String>,
}

fn key(requirement_id: &str) -> String {
    format!("wise.requirementExecutionRecords.v1:{}", requirement_id)
}

fn list(
    conn: &Connection,
    requirement_id: &str,
) -> Result<Vec<RequirementExecutionRecord>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key(requirement_id)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match raw {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|error| format!("需求执行记录无法读取：{error}"))
        }
        None => Ok(Vec::new()),
    }
}

fn append(conn: &mut Connection, record: RequirementExecutionRecord) -> Result<(), String> {
    let valid_outcome = match record.kind.as_str() {
        "execution" => matches!(
            record.outcome.as_str(),
            "processed" | "incomplete" | "failed" | "cancelled"
        ),
        "review" => matches!(
            record.outcome.as_str(),
            "accepted" | "rejected" | "reopened"
        ),
        _ => false,
    };
    if record.id.trim().is_empty()
        || record.requirement_id.trim().is_empty()
        || !valid_outcome
        || record.finished_at <= 0
        || record
            .started_at
            .is_some_and(|at| at <= 0 || at > record.finished_at)
        || record.summary.len() > 32_000
        || record.files.len() > 100
    {
        return Err("需求执行记录格式无效".into());
    }
    // 数据库事务覆盖读改写；多个窗口/连接并发收尾不会丢记录。
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let mut records = list(&tx, &record.requirement_id)?;
    if records.iter().any(|row| row.id == record.id) {
        return Ok(());
    }
    let setting_key = key(&record.requirement_id);
    records.push(record);
    records.sort_by_key(|row| row.finished_at);
    let value = serde_json::to_string(&records).map_err(|error| error.to_string())?;
    tx.execute("INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![setting_key, value])
        .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn append_requirement_execution_record(
    db: tauri::State<'_, WiseDb>,
    app: tauri::AppHandle,
    record: RequirementExecutionRecord,
) -> Result<(), String> {
    let mut conn = db.conn();
    let requirement_id = record.requirement_id.clone();
    append(&mut conn, record)?;
    drop(conn);
    let _ = app.emit("wise-requirement-execution-records-changed", requirement_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn list_requirement_execution_records(
    db: tauri::State<'_, WiseDb>,
    requirement_id: String,
) -> Result<Vec<RequirementExecutionRecord>, String> {
    let conn = db.conn();
    list(&conn, &requirement_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_turns_deduplicates_and_keeps_requirements_separate() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
        let record = RequirementExecutionRecord {
            id: "turn-1".into(),
            requirement_id: "req".into(),
            session_id: "session".into(),
            kind: "execution".into(),
            outcome: "processed".into(),
            started_at: Some(1),
            finished_at: 2,
            engine: "claude".into(),
            summary: "完成".into(),
            files: vec![],
        };
        append(&mut conn, record.clone()).unwrap();
        append(&mut conn, record.clone()).unwrap();
        append(
            &mut conn,
            RequirementExecutionRecord {
                id: "turn-2".into(),
                finished_at: 3,
                ..record
            },
        )
        .unwrap();
        assert_eq!(list(&conn, "req").unwrap().len(), 2);
        assert!(list(&conn, "other").unwrap().is_empty());
    }

    #[test]
    fn refuses_to_overwrite_corrupt_history() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES (?1, 'broken')",
            [key("req")],
        )
        .unwrap();
        assert!(list(&conn, "req").is_err());
    }
}
