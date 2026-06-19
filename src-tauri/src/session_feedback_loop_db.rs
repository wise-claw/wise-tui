//! 反馈神经网 SQLite 持久化（闭环历史 + 配置补丁效果）。

use crate::wise_db::WiseDb;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackLoopHistoryRecordDto {
    pub id: String,
    pub session_id: String,
    pub repository_path: String,
    pub repository_name: Option<String>,
    pub claude_session_id: Option<String>,
    pub completed_at: i64,
    pub completion_reason: Option<String>,
    pub cycle_count: i32,
    pub max_cycles: i32,
    pub final_overall_score: Option<f64>,
    pub improved_cycles: i32,
    pub final_summary: String,
    pub habits: Vec<String>,
    pub trend: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchEffectivenessRecordDto {
    pub id: String,
    pub repository_path: String,
    pub kind: String,
    pub action: String,
    pub path: String,
    pub source: String,
    pub applied_at: i64,
    pub overhead_delta: Option<serde_json::Value>,
    pub session_final_score: Option<f64>,
}

fn normalize_path(path: &str) -> String {
    path.trim().replace('\\', "/").trim_end_matches('/').to_string()
}

impl WiseDb {
    pub fn upsert_session_feedback_loop_history(
        &self,
        record: FeedbackLoopHistoryRecordDto,
    ) -> Result<(), String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        upsert_history(&g, &record)
    }

    pub fn list_session_feedback_loop_history(
        &self,
        repository_path: Option<&str>,
        limit: i32,
    ) -> Result<Vec<FeedbackLoopHistoryRecordDto>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_history(&g, repository_path, limit)
    }

    pub fn insert_session_feedback_patch_effectiveness_batch(
        &self,
        records: &[PatchEffectivenessRecordDto],
    ) -> Result<u32, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        insert_patch_batch(&g, records)
    }

    pub fn list_session_feedback_patch_effectiveness(
        &self,
        repository_path: Option<&str>,
        limit: i32,
    ) -> Result<Vec<PatchEffectivenessRecordDto>, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_patch_records(&g, repository_path, limit)
    }

    pub fn attach_session_feedback_patch_scores(
        &self,
        repository_path: &str,
        session_final_score: f64,
        within_ms: i64,
    ) -> Result<u32, String> {
        let g = self.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        attach_patch_scores(&g, repository_path, session_final_score, within_ms)
    }
}

fn upsert_history(conn: &Connection, record: &FeedbackLoopHistoryRecordDto) -> Result<(), String> {
    let id = record.id.trim();
    if id.is_empty() {
        return Err("history id 不能为空".to_string());
    }
    let habits_json = serde_json::to_string(&record.habits).map_err(|e| e.to_string())?;
    let trend_json = serde_json::to_string(&record.trend).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO session_feedback_loop_history (
            id, session_id, repository_path, repository_name, claude_session_id,
            completed_at_ms, completion_reason, cycle_count, max_cycles,
            final_overall_score, improved_cycles, final_summary, habits_json, trend_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            session_id = excluded.session_id,
            repository_path = excluded.repository_path,
            repository_name = excluded.repository_name,
            claude_session_id = excluded.claude_session_id,
            completed_at_ms = excluded.completed_at_ms,
            completion_reason = excluded.completion_reason,
            cycle_count = excluded.cycle_count,
            max_cycles = excluded.max_cycles,
            final_overall_score = excluded.final_overall_score,
            improved_cycles = excluded.improved_cycles,
            final_summary = excluded.final_summary,
            habits_json = excluded.habits_json,
            trend_json = excluded.trend_json",
        params![
            id,
            record.session_id.trim(),
            normalize_path(&record.repository_path),
            record.repository_name.as_deref(),
            record.claude_session_id.as_deref(),
            record.completed_at.max(0),
            record.completion_reason.as_deref(),
            record.cycle_count.max(0),
            record.max_cycles.max(1),
            record.final_overall_score,
            record.improved_cycles.max(0),
            record.final_summary,
            habits_json,
            trend_json,
        ],
    )
    .map_err(|e| format!("upsert session_feedback_loop_history: {e}"))?;
    Ok(())
}

fn list_history(
    conn: &Connection,
    repository_path: Option<&str>,
    limit: i32,
) -> Result<Vec<FeedbackLoopHistoryRecordDto>, String> {
    let cap = limit.clamp(1, 200) as i64;
    let mut out = Vec::new();
    if let Some(path) = repository_path.filter(|p| !p.trim().is_empty()) {
        let norm = normalize_path(path);
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, repository_path, repository_name, claude_session_id,
                        completed_at_ms, completion_reason, cycle_count, max_cycles,
                        final_overall_score, improved_cycles, final_summary, habits_json, trend_json
                 FROM session_feedback_loop_history
                 WHERE repository_path = ?1
                 ORDER BY completed_at_ms DESC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![norm, cap], map_history_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, repository_path, repository_name, claude_session_id,
                        completed_at_ms, completion_reason, cycle_count, max_cycles,
                        final_overall_score, improved_cycles, final_summary, habits_json, trend_json
                 FROM session_feedback_loop_history
                 ORDER BY completed_at_ms DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cap], map_history_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

fn map_history_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FeedbackLoopHistoryRecordDto> {
    let habits_json: String = row.get(12)?;
    let trend_json: String = row.get(13)?;
    let habits: Vec<String> = serde_json::from_str(&habits_json).unwrap_or_default();
    let trend: serde_json::Value = serde_json::from_str(&trend_json).unwrap_or(serde_json::json!([]));
    Ok(FeedbackLoopHistoryRecordDto {
        id: row.get(0)?,
        session_id: row.get(1)?,
        repository_path: row.get(2)?,
        repository_name: row.get(3)?,
        claude_session_id: row.get(4)?,
        completed_at: row.get(5)?,
        completion_reason: row.get(6)?,
        final_overall_score: row.get(9)?,
        cycle_count: row.get(7)?,
        max_cycles: row.get(8)?,
        improved_cycles: row.get(10)?,
        final_summary: row.get(11)?,
        habits,
        trend,
    })
}

fn insert_patch_batch(conn: &Connection, records: &[PatchEffectivenessRecordDto]) -> Result<u32, String> {
    let mut count = 0u32;
    for record in records {
        let id = record.id.trim();
        if id.is_empty() {
            continue;
        }
        let overhead_json = record
            .overhead_delta
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO session_feedback_patch_effectiveness (
                id, repository_path, kind, action, path, source, applied_at_ms,
                overhead_delta_json, session_final_score
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                repository_path = excluded.repository_path,
                kind = excluded.kind,
                action = excluded.action,
                path = excluded.path,
                source = excluded.source,
                applied_at_ms = excluded.applied_at_ms,
                overhead_delta_json = excluded.overhead_delta_json,
                session_final_score = excluded.session_final_score",
            params![
                id,
                normalize_path(&record.repository_path),
                record.kind.trim(),
                record.action.trim(),
                record.path.trim(),
                record.source.trim(),
                record.applied_at.max(0),
                overhead_json,
                record.session_final_score,
            ],
        )
        .map_err(|e| format!("insert session_feedback_patch_effectiveness: {e}"))?;
        count += 1;
    }
    Ok(count)
}

fn list_patch_records(
    conn: &Connection,
    repository_path: Option<&str>,
    limit: i32,
) -> Result<Vec<PatchEffectivenessRecordDto>, String> {
    let cap = limit.clamp(1, 500) as i64;
    let mut out = Vec::new();
    if let Some(path) = repository_path.filter(|p| !p.trim().is_empty()) {
        let norm = normalize_path(path);
        let mut stmt = conn
            .prepare(
                "SELECT id, repository_path, kind, action, path, source, applied_at_ms,
                        overhead_delta_json, session_final_score
                 FROM session_feedback_patch_effectiveness
                 WHERE repository_path = ?1
                 ORDER BY applied_at_ms DESC
                 LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![norm, cap], map_patch_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, repository_path, kind, action, path, source, applied_at_ms,
                        overhead_delta_json, session_final_score
                 FROM session_feedback_patch_effectiveness
                 ORDER BY applied_at_ms DESC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cap], map_patch_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

fn map_patch_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PatchEffectivenessRecordDto> {
    let overhead_raw: Option<String> = row.get(7)?;
    let overhead_delta = overhead_raw
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(|s| serde_json::from_str(s).ok());
    Ok(PatchEffectivenessRecordDto {
        id: row.get(0)?,
        repository_path: row.get(1)?,
        kind: row.get(2)?,
        action: row.get(3)?,
        path: row.get(4)?,
        source: row.get(5)?,
        applied_at: row.get(6)?,
        overhead_delta,
        session_final_score: row.get(8)?,
    })
}

fn attach_patch_scores(
    conn: &Connection,
    repository_path: &str,
    session_final_score: f64,
    within_ms: i64,
) -> Result<u32, String> {
    let repo = normalize_path(repository_path);
    if repo.is_empty() {
        return Ok(0);
    }
    let cutoff = crate::wise_db::unix_now_ms().saturating_sub(within_ms.max(0));
    let updated = conn
        .execute(
            "UPDATE session_feedback_patch_effectiveness
             SET session_final_score = ?1
             WHERE repository_path = ?2
               AND applied_at_ms >= ?3
               AND session_final_score IS NULL",
            params![session_final_score, repo, cutoff],
        )
        .map_err(|e| format!("attach session_feedback_patch_scores: {e}"))?;
    Ok(updated as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn upsert_and_list_history_roundtrip() {
        let conn = Connection::open_in_memory().expect("open");
        conn.execute_batch(include_str!("../migrations/044_session_feedback_loop.sql"))
            .expect("migrate");
        let record = FeedbackLoopHistoryRecordDto {
            id: "fb-1".into(),
            session_id: "sess-1".into(),
            repository_path: "/tmp/wise".into(),
            repository_name: Some("wise".into()),
            claude_session_id: None,
            completed_at: 1_700_000_000_000,
            completion_reason: Some("converged".into()),
            cycle_count: 2,
            max_cycles: 3,
            final_overall_score: Some(4.5),
            improved_cycles: 1,
            final_summary: "速度↑".into(),
            habits: vec!["合并探索".into()],
            trend: serde_json::json!([{ "cycleIndex": 1, "overallScore": 4.5 }]),
        };
        upsert_history(&conn, &record).expect("upsert");
        let rows = list_history(&conn, Some("/tmp/wise"), 10).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].habits.len(), 1);
    }
}
