//! Wise 登记的运行环境资源（本地服务、端口、夹具）：按消费者引用计数，最后一个消费者释放后才请求停止。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::error::{CResult, CollabError};
use super::events::append_event;
use super::util::{new_id, now_ms};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeResource {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub owner_requirement_id: String,
    pub owner_task_id: Option<String>,
    pub start_attempt_id: Option<String>,
    pub stop_method: String,
    pub endpoint: Option<String>,
    pub port: Option<i64>,
    pub pid: Option<i64>,
    pub state: String,
    pub active_consumers: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RegisterRuntimeInput {
    pub kind: String,
    pub name: String,
    pub stop_method: String,
    pub endpoint: Option<String>,
    pub port: Option<i64>,
    pub pid: Option<i64>,
}

fn active_consumers(conn: &Connection, resource_id: &str) -> CResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT requirement_id || ':' || task_id FROM collab_runtime_consumers WHERE resource_id = ?1 AND released_at IS NULL",
    )?;
    let rows = stmt.query_map(params![resource_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn load(conn: &Connection, id: &str) -> CResult<RuntimeResource> {
    let mut row = conn
        .query_row(
            "SELECT id, kind, name, owner_requirement_id, owner_task_id, start_attempt_id, stop_method, endpoint, port, pid,
                    state, created_at, updated_at FROM collab_runtime_resources WHERE id = ?1",
            params![id],
            |r| {
                Ok(RuntimeResource {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    owner_requirement_id: r.get(3)?,
                    owner_task_id: r.get(4)?,
                    start_attempt_id: r.get(5)?,
                    stop_method: r.get(6)?,
                    endpoint: r.get(7)?,
                    port: r.get(8)?,
                    pid: r.get(9)?,
                    state: r.get(10)?,
                    active_consumers: Vec::new(),
                    created_at: r.get(11)?,
                    updated_at: r.get(12)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| CollabError::not_found("运行环境资源", id))?;
    row.active_consumers = active_consumers(conn, id)?;
    Ok(row)
}

pub fn list_for_requirement(conn: &Connection, requirement_id: &str) -> CResult<Vec<RuntimeResource>> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT r.id FROM collab_runtime_resources r
             LEFT JOIN collab_runtime_consumers c ON c.resource_id = r.id
             WHERE r.owner_requirement_id = ?1 OR c.requirement_id = ?1 ORDER BY r.created_at ASC",
        )?;
        let rows = stmt.query_map(params![requirement_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    ids.iter().map(|id| load(conn, id)).collect()
}

/// Registered by the attempt that started the service; the starter is its first consumer.
pub fn register(
    conn: &Connection,
    requirement_id: &str,
    task_id: &str,
    attempt_id: &str,
    input: &RegisterRuntimeInput,
) -> CResult<RuntimeResource> {
    if input.name.trim().is_empty() || input.stop_method.trim().is_empty() {
        return Err(CollabError::invalid("运行资源需要 name 与 stopMethod（Wise 只控制已登记的服务）"));
    }
    let id = new_id("rt");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_runtime_resources (id, kind, name, owner_requirement_id, owner_task_id, start_attempt_id,
            stop_method, endpoint, port, pid, state, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'running', ?11, ?11)",
        params![
            id,
            if input.kind.trim().is_empty() { "service" } else { input.kind.trim() },
            input.name.trim(),
            requirement_id,
            task_id,
            attempt_id,
            input.stop_method.trim(),
            input.endpoint,
            input.port,
            input.pid,
            now
        ],
    )?;
    add_consumer(conn, &id, requirement_id, task_id)?;
    append_event(conn, requirement_id, "runtime.registered", json!({ "resourceId": id, "name": input.name }), Some(task_id), None)?;
    load(conn, &id)
}

pub fn add_consumer(conn: &Connection, resource_id: &str, requirement_id: &str, task_id: &str) -> CResult<()> {
    let state: String = conn
        .query_row("SELECT state FROM collab_runtime_resources WHERE id = ?1", params![resource_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| CollabError::not_found("运行环境资源", resource_id))?;
    if state != "running" {
        return Err(CollabError::state("运行资源已停止或正在停止，不能再被引用"));
    }
    conn.execute(
        "INSERT INTO collab_runtime_consumers (resource_id, requirement_id, task_id, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(resource_id, requirement_id, task_id) DO UPDATE SET released_at = NULL",
        params![resource_id, requirement_id, task_id, now_ms()],
    )?;
    Ok(())
}

fn maybe_request_stop(conn: &Connection, resource_id: &str) -> CResult<bool> {
    if !active_consumers(conn, resource_id)?.is_empty() {
        return Ok(false);
    }
    let n = conn.execute(
        "UPDATE collab_runtime_resources SET state = 'stop_requested', updated_at = ?2 WHERE id = ?1 AND state = 'running'",
        params![resource_id, now_ms()],
    )?;
    Ok(n > 0)
}

pub fn release_consumer(conn: &Connection, resource_id: &str, requirement_id: &str, task_id: &str) -> CResult<bool> {
    conn.execute(
        "UPDATE collab_runtime_consumers SET released_at = ?4
         WHERE resource_id = ?1 AND requirement_id = ?2 AND task_id = ?3 AND released_at IS NULL",
        params![resource_id, requirement_id, task_id, now_ms()],
    )?;
    maybe_request_stop(conn, resource_id)
}

/// Cancel/accept: drop this requirement's references; shared services keep running for other consumers.
pub fn release_for_requirement(conn: &Connection, requirement_id: &str) -> CResult<Vec<String>> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT resource_id FROM collab_runtime_consumers WHERE requirement_id = ?1 AND released_at IS NULL",
        )?;
        let rows = stmt.query_map(params![requirement_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    conn.execute(
        "UPDATE collab_runtime_consumers SET released_at = ?2 WHERE requirement_id = ?1 AND released_at IS NULL",
        params![requirement_id, now_ms()],
    )?;
    let mut stopping = Vec::new();
    for id in ids {
        if maybe_request_stop(conn, &id)? {
            stopping.push(id);
        }
    }
    Ok(stopping)
}

/// Confirmed by whoever ran the registered stop method (service exited).
pub fn mark_stopped(conn: &Connection, resource_id: &str) -> CResult<RuntimeResource> {
    let res = load(conn, resource_id)?;
    if !res.active_consumers.is_empty() {
        return Err(CollabError::state("仍有有效消费者，不能停止共享运行资源"));
    }
    conn.execute(
        "UPDATE collab_runtime_resources SET state = 'stopped', updated_at = ?2 WHERE id = ?1",
        params![resource_id, now_ms()],
    )?;
    load(conn, resource_id)
}

pub fn pending_stops(conn: &Connection) -> CResult<Vec<RuntimeResource>> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM collab_runtime_resources WHERE state = 'stop_requested'")?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    ids.iter().map(|id| load(conn, id)).collect()
}
