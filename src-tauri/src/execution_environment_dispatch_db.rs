//! 执行环境派发任务 SQLite 持久化。

use crate::wise_db::WiseDb;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEnvironmentDispatchItemDto {
    pub key: String,
    pub batch_id: String,
    pub anchor_session_id: String,
    pub worker_session_id: String,
    pub label: String,
    pub preview_text: String,
    pub batch_index: i32,
    pub session_count: i32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEnvironmentDispatchRecordDto {
    pub batch_id: String,
    pub anchor_session_id: String,
    pub repository_path: String,
    pub execution_engine: String,
    pub created_at: i64,
    pub preview_text: String,
    pub session_count: i32,
    pub items: Vec<ExecutionEnvironmentDispatchItemDto>,
}

#[derive(Debug, Clone)]
pub struct UpsertExecutionEnvironmentBatchInput {
    pub batch_id: String,
    pub anchor_session_id: String,
    pub repository_path: String,
    pub execution_engine: String,
    pub session_count: i32,
    pub preview_text: String,
    pub batch_hint: Option<String>,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct UpsertExecutionEnvironmentItemInput {
    pub item_key: String,
    pub batch_id: String,
    pub anchor_session_id: String,
    pub worker_session_id: String,
    pub label: String,
    pub preview_text: String,
    pub batch_index: i32,
    pub session_count: i32,
    pub updated_at_ms: i64,
}

impl WiseDb {
    pub fn upsert_execution_environment_dispatch_batch(
        &self,
        input: UpsertExecutionEnvironmentBatchInput,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        upsert_batch(&g, &input)
    }

    pub fn upsert_execution_environment_dispatch_item(
        &self,
        input: UpsertExecutionEnvironmentItemInput,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        upsert_item(&g, &input)
    }

    pub fn list_execution_environment_dispatches_for_anchor(
        &self,
        anchor_session_id: &str,
        since_ms: i64,
    ) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_for_anchor(&g, anchor_session_id, since_ms)
    }

    pub fn list_execution_environment_dispatches_for_repository(
        &self,
        repository_path: &str,
        since_ms: i64,
    ) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_for_repository(&g, repository_path, since_ms)
    }
}

fn upsert_batch(conn: &Connection, input: &UpsertExecutionEnvironmentBatchInput) -> Result<(), String> {
    let anchor = input.anchor_session_id.trim();
    let batch_id = input.batch_id.trim();
    if anchor.is_empty() || batch_id.is_empty() {
        return Err("batchId 与 anchorSessionId 不能为空".to_string());
    }
    let now = input.created_at_ms.max(0);
    conn.execute(
        "INSERT INTO execution_environment_dispatch_batch (
            batch_id, anchor_session_id, repository_path, execution_engine,
            session_count, preview_text, batch_hint, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(batch_id) DO UPDATE SET
            anchor_session_id = excluded.anchor_session_id,
            repository_path = excluded.repository_path,
            execution_engine = excluded.execution_engine,
            session_count = excluded.session_count,
            preview_text = excluded.preview_text,
            batch_hint = excluded.batch_hint,
            updated_at_ms = excluded.updated_at_ms",
        params![
            batch_id,
            anchor,
            input.repository_path.trim(),
            input.execution_engine.trim(),
            input.session_count.max(1),
            input.preview_text.trim(),
            input.batch_hint.as_deref(),
            now,
            now,
        ],
    )
    .map_err(|e| format!("upsert execution_environment_dispatch_batch: {e}"))?;
    Ok(())
}

fn upsert_item(conn: &Connection, input: &UpsertExecutionEnvironmentItemInput) -> Result<(), String> {
    let anchor = input.anchor_session_id.trim();
    let batch_id = input.batch_id.trim();
    let item_key = input.item_key.trim();
    if anchor.is_empty() || batch_id.is_empty() || item_key.is_empty() {
        return Err("itemKey、batchId 与 anchorSessionId 不能为空".to_string());
    }
    let updated = input.updated_at_ms.max(0);
    conn.execute(
        "INSERT INTO execution_environment_dispatch_item (
            item_key, batch_id, anchor_session_id, worker_session_id,
            label, preview_text, batch_index, session_count, created_at_ms, updated_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(item_key) DO UPDATE SET
            batch_id = excluded.batch_id,
            anchor_session_id = excluded.anchor_session_id,
            worker_session_id = excluded.worker_session_id,
            label = excluded.label,
            preview_text = excluded.preview_text,
            batch_index = excluded.batch_index,
            session_count = excluded.session_count,
            updated_at_ms = excluded.updated_at_ms",
        params![
            item_key,
            batch_id,
            anchor,
            input.worker_session_id.trim(),
            input.label.trim(),
            input.preview_text.trim(),
            input.batch_index.max(1),
            input.session_count.max(1),
            updated,
            updated,
        ],
    )
    .map_err(|e| format!("upsert execution_environment_dispatch_item: {e}"))?;
    Ok(())
}

fn map_batch_rows(
    conn: &Connection,
    batch_rows: impl Iterator<Item = Result<(String, String, String, String, i64, String, i64), rusqlite::Error>>,
) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
    let mut out: Vec<ExecutionEnvironmentDispatchRecordDto> = Vec::new();
    for row in batch_rows {
        let (
            batch_id,
            anchor_session_id,
            repository_path,
            execution_engine,
            session_count,
            preview_text,
            created_at_ms,
        ) = row.map_err(|e| format!("list execution_environment_dispatch_batch row: {e}"))?;
        let items = load_items_for_batch(conn, &batch_id)?;
        out.push(ExecutionEnvironmentDispatchRecordDto {
            batch_id,
            anchor_session_id,
            repository_path,
            execution_engine,
            created_at: created_at_ms,
            preview_text,
            session_count: session_count.max(1) as i32,
            items,
        });
    }
    Ok(out)
}

fn list_for_anchor(
    conn: &Connection,
    anchor_session_id: &str,
    since_ms: i64,
) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
    let anchor = anchor_session_id.trim();
    if anchor.is_empty() {
        return Ok(Vec::new());
    }
    let since = since_ms.max(0);
    let mut stmt = conn
        .prepare(
            "SELECT batch_id, anchor_session_id, repository_path, execution_engine,
                    session_count, preview_text, created_at_ms
             FROM execution_environment_dispatch_batch
             WHERE anchor_session_id = ?1 AND created_at_ms >= ?2
             ORDER BY created_at_ms DESC",
        )
        .map_err(|e| format!("list execution_environment_dispatch_batch prepare: {e}"))?;

    let batch_rows = stmt
        .query_map(params![anchor, since], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| format!("list execution_environment_dispatch_batch query: {e}"))?;

    map_batch_rows(conn, batch_rows)
}

fn normalize_repository_path_key(path: &str) -> String {
    path.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

fn list_for_repository(
    conn: &Connection,
    repository_path: &str,
    since_ms: i64,
) -> Result<Vec<ExecutionEnvironmentDispatchRecordDto>, String> {
    let repo = normalize_repository_path_key(repository_path);
    if repo.is_empty() {
        return Ok(Vec::new());
    }
    let since = since_ms.max(0);
    let mut stmt = conn
        .prepare(
            "SELECT batch_id, anchor_session_id, repository_path, execution_engine,
                    session_count, preview_text, created_at_ms
             FROM execution_environment_dispatch_batch
             WHERE trim(replace(repository_path, '\\', '/')) = ?1 AND created_at_ms >= ?2
             ORDER BY created_at_ms DESC",
        )
        .map_err(|e| format!("list execution_environment_dispatch_batch by repo prepare: {e}"))?;

    let batch_rows = stmt
        .query_map(params![repo, since], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| format!("list execution_environment_dispatch_batch by repo query: {e}"))?;

    map_batch_rows(conn, batch_rows)
}

fn load_items_for_batch(
    conn: &Connection,
    batch_id: &str,
) -> Result<Vec<ExecutionEnvironmentDispatchItemDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT item_key, batch_id, anchor_session_id, worker_session_id,
                    label, preview_text, batch_index, session_count, updated_at_ms
             FROM execution_environment_dispatch_item
             WHERE batch_id = ?1
             ORDER BY batch_index ASC, updated_at_ms ASC",
        )
        .map_err(|e| format!("list execution_environment_dispatch_item prepare: {e}"))?;

    let rows = stmt
        .query_map(params![batch_id], |row| {
            Ok(ExecutionEnvironmentDispatchItemDto {
                key: row.get(0)?,
                batch_id: row.get(1)?,
                anchor_session_id: row.get(2)?,
                worker_session_id: row.get(3)?,
                label: row.get(4)?,
                preview_text: row.get(5)?,
                batch_index: row.get(6)?,
                session_count: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("list execution_environment_dispatch_item query: {e}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list execution_environment_dispatch_item row: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn roundtrip_execution_environment_dispatch_rows() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(include_str!("../migrations/034_execution_environment_dispatch.sql"))
            .expect("schema");

        let batch = UpsertExecutionEnvironmentBatchInput {
            batch_id: "batch-1".to_string(),
            anchor_session_id: "anchor-1".to_string(),
            repository_path: "/repo".to_string(),
            execution_engine: "claude".to_string(),
            session_count: 1,
            preview_text: "你好".to_string(),
            batch_hint: None,
            created_at_ms: 1_700_000_000_000,
        };
        upsert_batch(&conn, &batch).expect("batch");
        upsert_item(
            &conn,
            &UpsertExecutionEnvironmentItemInput {
                item_key: "exec-env:batch-1:worker-1".to_string(),
                batch_id: "batch-1".to_string(),
                anchor_session_id: "anchor-1".to_string(),
                worker_session_id: "worker-1".to_string(),
                label: "任务".to_string(),
                preview_text: "你好".to_string(),
                batch_index: 1,
                session_count: 1,
                updated_at_ms: 1_700_000_000_100,
            },
        )
        .expect("item");

        let listed = list_for_anchor(&conn, "anchor-1", 0).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].items.len(), 1);
        assert_eq!(listed[0].items[0].preview_text, "你好");
    }
}
