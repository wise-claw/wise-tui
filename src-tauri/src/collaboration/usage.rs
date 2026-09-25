//! 需求预算账本：按用量事件 ID 幂等记账；无精确计量时标为估算。

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::error::CResult;
use super::util::now_ms;

#[allow(clippy::too_many_arguments)]
pub fn record(
    conn: &Connection,
    event_id: &str,
    requirement_id: &str,
    attempt_id: Option<&str>,
    kind: &str,
    duration_ms: i64,
    tokens: Option<i64>,
    source: &str,
    confidence: &str,
) -> CResult<bool> {
    let confidence = match confidence {
        "exact" | "estimated" | "unavailable" => confidence,
        _ => "estimated",
    };
    let n = conn.execute(
        "INSERT OR IGNORE INTO collab_usage_ledger (event_id, requirement_id, attempt_id, kind, duration_ms, tokens, source, confidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![event_id, requirement_id, attempt_id, kind, duration_ms.max(0), tokens, source, confidence, now_ms()],
    )?;
    Ok(n > 0)
}

pub fn requirement_total_ms(conn: &Connection, requirement_id: &str) -> CResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(duration_ms), 0) FROM collab_usage_ledger WHERE requirement_id = ?1",
        params![requirement_id],
        |r| r.get(0),
    )?)
}

pub fn summary(conn: &Connection, requirement_id: &str) -> CResult<Value> {
    let (total_ms, tokens, events, exact): (i64, Option<i64>, i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(duration_ms), 0), SUM(tokens), COUNT(*),
                COALESCE(SUM(CASE WHEN confidence = 'exact' THEN 1 ELSE 0 END), 0)
         FROM collab_usage_ledger WHERE requirement_id = ?1",
        params![requirement_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let budget: Option<i64> = conn.query_row(
        "SELECT budget_ms FROM collab_requirements WHERE id = ?1",
        params![requirement_id],
        |r| r.get(0),
    )?;
    Ok(json!({
        "totalMs": total_ms,
        "tokens": tokens,
        "events": events,
        "confidence": if events == 0 { "unavailable" } else if exact == events { "exact" } else { "estimated" },
        "budgetMs": budget,
        "remainingMs": budget.map(|b| (b - total_ms).max(0)),
        "note": "时长按执行桥记录；多数引擎仅在结束后提供用量，无法承诺精确硬上限",
    }))
}
