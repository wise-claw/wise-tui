//! 领域事件、协作消息、分接收方投递状态与 outbox。
//!
//! 事件、消息、outbox 与业务状态在同一事务写入；投递至少一次，接收方以
//! `(messageId, targetKind, targetId)` 去重。投递状态只会单调前进。

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};

use super::error::CResult;
use super::util::{new_id, now_ms, parse_value};

/// Messages that should surface as user-facing notifications (UI toast / external channel).
const NOTIFY_TYPES: &[&str] = &[
    "decision.required",
    "requirement.verifying",
    "requirement.done",
    "task.failed",
    "change.requested",
    "change.verified",
    "requirement.stop_pending",
];

#[derive(Debug, Clone, Default)]
pub struct NewMessage {
    pub id: Option<String>,
    pub kind: String,
    pub source_task_id: Option<String>,
    pub target_task_id: Option<String>,
    pub correlation_id: Option<String>,
    pub causation_id: Option<String>,
    pub plan_revision: Option<i64>,
    pub change_revision: Option<i64>,
    pub round: Option<i64>,
    pub artifact_refs: Value,
    pub checkpoint_id: Option<String>,
    pub action: Option<String>,
    pub body: Value,
}

impl NewMessage {
    pub fn new(kind: &str, body: Value) -> Self {
        Self {
            kind: kind.to_string(),
            body,
            artifact_refs: json!([]),
            ..Default::default()
        }
    }

    pub fn to_task(mut self, task_id: &str) -> Self {
        self.target_task_id = Some(task_id.to_string());
        self
    }

    pub fn from_task(mut self, task_id: Option<&str>) -> Self {
        self.source_task_id = task_id.map(str::to_string);
        self
    }

    pub fn correlation(mut self, id: &str) -> Self {
        self.correlation_id = Some(id.to_string());
        self
    }

    pub fn with_id(mut self, id: String) -> Self {
        self.id = Some(id);
        self
    }
}

pub fn append_event(
    conn: &Connection,
    requirement_id: &str,
    kind: &str,
    payload: Value,
    correlation_id: Option<&str>,
    causation_id: Option<&str>,
) -> CResult<(String, i64)> {
    let seq: i64 = conn.query_row(
        "SELECT COALESCE(MAX(aggregate_seq), 0) + 1 FROM collab_events WHERE requirement_id = ?1",
        params![requirement_id],
        |r| r.get(0),
    )?;
    let id = new_id("evt");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_events (id, requirement_id, aggregate_seq, type, payload_json, correlation_id, causation_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, requirement_id, seq, kind, payload.to_string(), correlation_id, causation_id, now],
    )?;
    conn.execute(
        "INSERT INTO collab_outbox (requirement_id, event_id, channel, created_at) VALUES (?1, ?2, 'ui', ?3)",
        params![requirement_id, id, now],
    )?;
    Ok((id, seq))
}

/// Inserts a message once (idempotent on explicit id) plus its per-recipient deliveries.
pub fn send_message(conn: &Connection, requirement_id: &str, msg: NewMessage) -> CResult<String> {
    let id = msg.id.clone().unwrap_or_else(|| new_id("msg"));
    let now = now_ms();
    let seq: Option<i64> = conn
        .query_row(
            "SELECT MAX(aggregate_seq) FROM collab_events WHERE requirement_id = ?1",
            params![requirement_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();
    let inserted = conn.execute(
        "INSERT OR IGNORE INTO collab_messages (
            id, requirement_id, type, source_task_id, target_task_id, correlation_id, causation_id,
            aggregate_seq, plan_revision, change_revision, round, artifact_refs_json, checkpoint_id,
            action, body_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            id,
            requirement_id,
            msg.kind,
            msg.source_task_id,
            msg.target_task_id,
            msg.correlation_id,
            msg.causation_id,
            seq,
            msg.plan_revision,
            msg.change_revision,
            msg.round,
            msg.artifact_refs.to_string(),
            msg.checkpoint_id,
            msg.action,
            msg.body.to_string(),
            now
        ],
    )?;
    if inserted == 0 {
        return Ok(id);
    }
    if let Some(task_id) = msg.target_task_id.as_deref() {
        insert_delivery(conn, &id, "task", task_id, now)?;
        conn.execute(
            "INSERT INTO collab_outbox (requirement_id, message_id, channel, created_at) VALUES (?1, ?2, 'scheduler', ?3)",
            params![requirement_id, id, now],
        )?;
    }
    insert_delivery(conn, &id, "ui", "main", now)?;
    if NOTIFY_TYPES.contains(&msg.kind.as_str()) {
        insert_delivery(conn, &id, "channel", "default", now)?;
        conn.execute(
            "INSERT INTO collab_outbox (requirement_id, message_id, channel, created_at) VALUES (?1, ?2, 'channel', ?3)",
            params![requirement_id, id, now],
        )?;
    }
    Ok(id)
}

fn insert_delivery(conn: &Connection, message_id: &str, kind: &str, target: &str, now: i64) -> CResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO collab_deliveries (message_id, target_kind, target_id, state, updated_at)
         VALUES (?1, ?2, ?3, 'queued', ?4)",
        params![message_id, kind, target, now],
    )?;
    Ok(())
}

fn delivery_rank(state: &str) -> i32 {
    match state {
        "queued" => 0,
        "failed" => 1,
        "delivered" => 2,
        "received" => 3,
        "processed" => 4,
        "dropped" => 5,
        _ => -1,
    }
}

/// Advances a delivery state; never moves backwards (duplicate/late acks are ignored).
pub fn advance_delivery(
    conn: &Connection,
    message_id: &str,
    target_kind: &str,
    target_id: &str,
    next: &str,
    error: Option<&str>,
) -> CResult<bool> {
    let current: Option<(String, i64)> = conn
        .query_row(
            "SELECT state, attempts FROM collab_deliveries WHERE message_id = ?1 AND target_kind = ?2 AND target_id = ?3",
            params![message_id, target_kind, target_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((state, attempts)) = current else {
        return Ok(false);
    };
    let now = now_ms();
    if next == "failed" {
        if delivery_rank(&state) >= delivery_rank("delivered") {
            return Ok(false);
        }
        let attempts = attempts + 1;
        let backoff = (1_000_i64 << attempts.min(10)).min(10 * 60 * 1000);
        conn.execute(
            "UPDATE collab_deliveries SET state = 'failed', attempts = ?4, next_retry_at = ?5, last_error = ?6, updated_at = ?7
             WHERE message_id = ?1 AND target_kind = ?2 AND target_id = ?3",
            params![message_id, target_kind, target_id, attempts, now + backoff, error, now],
        )?;
        return Ok(true);
    }
    if delivery_rank(next) <= delivery_rank(&state) {
        return Ok(false);
    }
    conn.execute(
        "UPDATE collab_deliveries SET state = ?4, updated_at = ?5, last_error = NULL
         WHERE message_id = ?1 AND target_kind = ?2 AND target_id = ?3",
        params![message_id, target_kind, target_id, next, now],
    )?;
    Ok(true)
}

/// Pending task-inbox messages (persist until the target task's next attempt picks them up).
pub fn task_inbox(conn: &Connection, task_id: &str) -> CResult<Vec<MessageRow>> {
    let mut stmt = conn.prepare(
        "SELECT m.id FROM collab_messages m
         JOIN collab_deliveries d ON d.message_id = m.id AND d.target_kind = 'task' AND d.target_id = ?1
         WHERE d.state IN ('queued', 'failed', 'delivered', 'received')
         ORDER BY m.created_at ASC",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![task_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    ids.iter().map(|id| load_message(conn, id)).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryRow {
    pub target_kind: String,
    pub target_id: String,
    pub state: String,
    pub attempts: i64,
    pub next_retry_at: i64,
    pub last_error: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRow {
    pub id: String,
    pub requirement_id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub source_task_id: Option<String>,
    pub target_task_id: Option<String>,
    pub correlation_id: Option<String>,
    pub causation_id: Option<String>,
    pub aggregate_sequence: Option<i64>,
    pub plan_revision: Option<i64>,
    pub change_revision: Option<i64>,
    pub round: Option<i64>,
    pub artifact_refs: Value,
    pub checkpoint_id: Option<String>,
    pub action: Option<String>,
    pub body: Value,
    pub created_at: i64,
    pub deliveries: Vec<DeliveryRow>,
}

pub fn load_message(conn: &Connection, id: &str) -> CResult<MessageRow> {
    let mut row = conn.query_row(
        "SELECT id, requirement_id, type, source_task_id, target_task_id, correlation_id, causation_id,
                aggregate_seq, plan_revision, change_revision, round, artifact_refs_json, checkpoint_id,
                action, body_json, created_at
         FROM collab_messages WHERE id = ?1",
        params![id],
        |r| {
            Ok(MessageRow {
                id: r.get(0)?,
                requirement_id: r.get(1)?,
                kind: r.get(2)?,
                source_task_id: r.get(3)?,
                target_task_id: r.get(4)?,
                correlation_id: r.get(5)?,
                causation_id: r.get(6)?,
                aggregate_sequence: r.get(7)?,
                plan_revision: r.get(8)?,
                change_revision: r.get(9)?,
                round: r.get(10)?,
                artifact_refs: parse_value(&r.get::<_, String>(11)?),
                checkpoint_id: r.get(12)?,
                action: r.get(13)?,
                body: parse_value(&r.get::<_, String>(14)?),
                created_at: r.get(15)?,
                deliveries: Vec::new(),
            })
        },
    )?;
    let mut stmt = conn.prepare(
        "SELECT target_kind, target_id, state, attempts, next_retry_at, last_error, updated_at
         FROM collab_deliveries WHERE message_id = ?1 ORDER BY target_kind",
    )?;
    row.deliveries = stmt
        .query_map(params![id], |r| {
            Ok(DeliveryRow {
                target_kind: r.get(0)?,
                target_id: r.get(1)?,
                state: r.get(2)?,
                attempts: r.get(3)?,
                next_retry_at: r.get(4)?,
                last_error: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(row)
}

pub fn list_messages(
    conn: &Connection,
    requirement_id: &str,
    task_id: Option<&str>,
    before: Option<i64>,
    limit: i64,
) -> CResult<Vec<MessageRow>> {
    let limit = limit.clamp(1, 500);
    let before = before.unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "SELECT id FROM collab_messages
         WHERE requirement_id = ?1 AND created_at < ?2
           AND (?3 IS NULL OR target_task_id = ?3 OR source_task_id = ?3)
         ORDER BY created_at DESC, rowid DESC LIMIT ?4",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![requirement_id, before, task_id, limit], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    ids.iter().map(|id| load_message(conn, id)).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItem {
    pub id: i64,
    pub requirement_id: String,
    pub requirement_title: String,
    pub channel: String,
    pub event_id: Option<String>,
    pub message: Option<MessageRow>,
    pub event: Option<Value>,
    pub attempts: i64,
}

/// Due outbox items for a channel (`ui` / `channel`); `scheduler` items are consumed in-process.
pub fn due_outbox(conn: &Connection, channel: &str, limit: i64) -> CResult<Vec<OutboxItem>> {
    let now = now_ms();
    let mut stmt = conn.prepare(
        "SELECT o.id, o.requirement_id, o.channel, o.event_id, o.message_id, o.attempts, COALESCE(r.title, '')
         FROM collab_outbox o LEFT JOIN collab_requirements r ON r.id = o.requirement_id
         WHERE o.channel = ?1 AND o.state = 'pending' AND o.next_retry_at <= ?2
         ORDER BY o.id ASC LIMIT ?3",
    )?;
    let rows: Vec<(i64, String, String, Option<String>, Option<String>, i64, String)> = stmt
        .query_map(params![channel, now, limit.clamp(1, 200)], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?
        .collect::<Result<_, _>>()?;
    let mut out = Vec::new();
    for (id, requirement_id, channel, event_id, message_id, attempts, requirement_title) in rows {
        let message = match message_id.as_deref() {
            Some(mid) => Some(load_message(conn, mid)?),
            None => None,
        };
        let event = match event_id.as_deref() {
            Some(eid) => conn
                .query_row(
                    "SELECT type, payload_json, aggregate_seq, created_at FROM collab_events WHERE id = ?1",
                    params![eid],
                    |r| {
                        Ok(json!({
                            "type": r.get::<_, String>(0)?,
                            "payload": parse_value(&r.get::<_, String>(1)?),
                            "aggregateSequence": r.get::<_, i64>(2)?,
                            "createdAt": r.get::<_, i64>(3)?,
                        }))
                    },
                )
                .optional()?,
            None => None,
        };
        out.push(OutboxItem {
            id,
            requirement_id,
            requirement_title,
            channel,
            event_id,
            message,
            event,
            attempts,
        });
    }
    Ok(out)
}

pub fn ack_outbox(conn: &Connection, id: i64, ok: bool, error: Option<&str>) -> CResult<()> {
    let now = now_ms();
    if ok {
        conn.execute("UPDATE collab_outbox SET state = 'done' WHERE id = ?1", params![id])?;
        let message: Option<(Option<String>, String)> = conn
            .query_row(
                "SELECT message_id, channel FROM collab_outbox WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((Some(mid), channel)) = message {
            if channel == "channel" {
                advance_delivery(conn, &mid, "channel", "default", "delivered", None)?;
            }
        }
        return Ok(());
    }
    let attempts: i64 = conn
        .query_row("SELECT attempts FROM collab_outbox WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .unwrap_or(0)
        + 1;
    let state = if attempts >= 8 { "dead" } else { "pending" };
    let backoff = (2_000_i64 << attempts.min(10)).min(30 * 60 * 1000);
    conn.execute(
        "UPDATE collab_outbox SET attempts = ?2, state = ?3, next_retry_at = ?4, last_error = ?5 WHERE id = ?1",
        params![id, attempts, state, now + backoff, error],
    )?;
    let mid: Option<String> = conn
        .query_row("SELECT message_id FROM collab_outbox WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .flatten();
    if let Some(mid) = mid {
        advance_delivery(conn, &mid, "channel", "default", "failed", error)?;
    }
    Ok(())
}

/// Manual re-delivery of a failed/dead channel message.
pub fn requeue_message(conn: &Connection, message_id: &str) -> CResult<()> {
    let now = now_ms();
    conn.execute(
        "UPDATE collab_outbox SET state = 'pending', next_retry_at = ?2 WHERE message_id = ?1 AND state <> 'done'",
        params![message_id, now],
    )?;
    conn.execute(
        "UPDATE collab_deliveries SET next_retry_at = ?2 WHERE message_id = ?1 AND state IN ('queued', 'failed')",
        params![message_id, now],
    )?;
    Ok(())
}

pub fn events_since(conn: &Connection, requirement_id: &str, after_seq: i64) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, aggregate_seq, type, payload_json, correlation_id, causation_id, created_at
         FROM collab_events WHERE requirement_id = ?1 AND aggregate_seq > ?2 ORDER BY aggregate_seq ASC LIMIT 500",
    )?;
    let rows = stmt
        .query_map(params![requirement_id, after_seq], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "aggregateSequence": r.get::<_, i64>(1)?,
                "type": r.get::<_, String>(2)?,
                "payload": parse_value(&r.get::<_, String>(3)?),
                "correlationId": r.get::<_, Option<String>>(4)?,
                "causationId": r.get::<_, Option<String>>(5)?,
                "createdAt": r.get::<_, i64>(6)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

const UI_OUTBOX_TTL_MS: i64 = 10 * 60 * 1000;
const SCHEDULER_OUTBOX_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const DONE_OUTBOX_RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// `ui` 行由实时变更事件覆盖、`scheduler` 行由任务投递状态覆盖，超期即视为已消费；
/// 已完成行保留一周后清理。`channel` 行只由渠道泵 ack，不在此处结束。
pub fn compact_outbox(conn: &Connection) -> CResult<usize> {
    let now = now_ms();
    let mut n = conn.execute(
        "UPDATE collab_outbox SET state = 'done'
         WHERE state = 'pending' AND ((channel = 'ui' AND created_at < ?1) OR (channel = 'scheduler' AND created_at < ?2))",
        params![now - UI_OUTBOX_TTL_MS, now - SCHEDULER_OUTBOX_TTL_MS],
    )?;
    n += conn.execute(
        "DELETE FROM collab_outbox WHERE state = 'done' AND created_at < ?1",
        params![now - DONE_OUTBOX_RETENTION_MS],
    )?;
    Ok(n)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxEntry {
    pub requirement_id: String,
    pub requirement_title: String,
    pub message: MessageRow,
    pub read: bool,
    pub outbox_state: Option<String>,
    pub outbox_attempts: i64,
    pub outbox_error: Option<String>,
}

/// 协作收件箱：所有需要通知用户的消息（带渠道投递与已读状态），按时间倒序。
pub fn channel_inbox(conn: &Connection, before: Option<i64>, limit: i64, unread_only: bool) -> CResult<Vec<InboxEntry>> {
    let limit = limit.clamp(1, 200);
    let before = before.unwrap_or(i64::MAX);
    let mut stmt = conn.prepare(
        "SELECT m.id, m.requirement_id, COALESCE(r.title, ''),
                COALESCE((SELECT state FROM collab_deliveries u WHERE u.message_id = m.id AND u.target_kind = 'ui' AND u.target_id = 'main'), 'queued'),
                o.state, COALESCE(o.attempts, 0), o.last_error
         FROM collab_messages m
         JOIN collab_deliveries d ON d.message_id = m.id AND d.target_kind = 'channel'
         LEFT JOIN collab_requirements r ON r.id = m.requirement_id
         LEFT JOIN collab_outbox o ON o.message_id = m.id AND o.channel = 'channel'
         WHERE m.created_at < ?1
         ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?2",
    )?;
    let rows: Vec<(String, String, String, String, Option<String>, i64, Option<String>)> = stmt
        .query_map(params![before, limit * if unread_only { 4 } else { 1 }], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
        })?
        .collect::<Result<_, _>>()?;
    let mut out = Vec::new();
    for (mid, requirement_id, title, ui_state, outbox_state, attempts, outbox_error) in rows {
        let read = delivery_rank(&ui_state) >= delivery_rank("processed");
        if unread_only && read {
            continue;
        }
        out.push(InboxEntry {
            requirement_id,
            requirement_title: title,
            message: load_message(conn, &mid)?,
            read,
            outbox_state,
            outbox_attempts: attempts,
            outbox_error,
        });
        if out.len() as i64 >= limit {
            break;
        }
    }
    Ok(out)
}

/// 用户在收件箱中处理（已读）消息：UI 投递前进到 processed。
pub fn mark_inbox_read(conn: &Connection, message_ids: &[String]) -> CResult<usize> {
    let mut n = 0;
    for mid in message_ids {
        advance_delivery(conn, mid, "ui", "main", "delivered", None)?;
        if advance_delivery(conn, mid, "ui", "main", "processed", None)? {
            n += 1;
        }
    }
    Ok(n)
}
