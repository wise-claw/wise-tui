//! 智能体私有记忆：按智能体与作用域隔离、CAS 修订、来源去重、删除即排除。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::{CResult, CollabError};
use super::util::{keyword_tokens, new_id, now_ms, parse_value, sha256_hex, tx};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub id: String,
    pub agent_id: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub repository_id: Option<i64>,
    pub requirement_id: Option<String>,
    pub content: String,
    pub source_attempt_id: Option<String>,
    pub evidence: Value,
    pub trust: String,
    pub revision: i64,
    pub expires_at: Option<i64>,
    pub deleted_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AddMemoryInput {
    pub agent_id: String,
    pub scope: String,
    pub project_id: Option<String>,
    pub repository_id: Option<i64>,
    pub requirement_id: Option<String>,
    pub content: String,
    pub trust: Option<String>,
    pub source_attempt_id: Option<String>,
    pub evidence: Option<Value>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateMemoryInput {
    pub memory_id: String,
    pub expected_revision: i64,
    pub content: Option<String>,
    pub trust: Option<String>,
    pub expires_at: Option<i64>,
}

/// Who is asking: memories never widen beyond the agent and its task scope.
#[derive(Debug, Clone, Default)]
pub struct MemoryScope<'a> {
    pub agent_id: &'a str,
    pub project_id: Option<&'a str>,
    pub repository_id: Option<i64>,
    pub requirement_id: Option<&'a str>,
}

const COLS: &str = "id, agent_id, scope, project_id, repository_id, requirement_id, content, source_attempt_id, evidence_json, trust, revision, expires_at, deleted_at, created_at, updated_at";

fn map(r: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryItem> {
    Ok(MemoryItem {
        id: r.get(0)?,
        agent_id: r.get(1)?,
        scope: r.get(2)?,
        project_id: r.get(3)?,
        repository_id: r.get(4)?,
        requirement_id: r.get(5)?,
        content: r.get(6)?,
        source_attempt_id: r.get(7)?,
        evidence: parse_value(&r.get::<_, String>(8)?),
        trust: r.get(9)?,
        revision: r.get(10)?,
        expires_at: r.get(11)?,
        deleted_at: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

fn normalize_trust(raw: Option<&str>) -> &'static str {
    match raw {
        Some("verified") => "verified",
        Some("user") => "user",
        _ => "candidate",
    }
}

fn dedupe_key(scope: &str, project: Option<&str>, repo: Option<i64>, requirement: Option<&str>, content: &str) -> String {
    let normalized: String = content.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    sha256_hex(&format!(
        "{scope}|{}|{}|{}|{normalized}",
        project.unwrap_or(""),
        repo.map(|r| r.to_string()).unwrap_or_default(),
        requirement.unwrap_or("")
    ))
}

pub fn get_memory(conn: &Connection, memory_id: &str) -> CResult<MemoryItem> {
    conn.query_row(
        &format!("SELECT {COLS} FROM repository_agent_memories WHERE id = ?1"),
        params![memory_id],
        map,
    )
    .optional()?
    .ok_or_else(|| CollabError::not_found("记忆", memory_id))
}

pub fn add_memory(conn: &Connection, input: AddMemoryInput) -> CResult<MemoryItem> {
    let content = input.content.trim();
    if content.is_empty() {
        return Err(CollabError::invalid("记忆内容不能为空"));
    }
    if content.chars().count() > 4000 {
        return Err(CollabError::invalid("单条记忆不超过 4000 字"));
    }
    let scope = match input.scope.as_str() {
        "repository" => "repository",
        "requirement" => "requirement",
        _ => "agent",
    };
    if scope == "repository" && input.repository_id.is_none() {
        return Err(CollabError::invalid("仓库范围记忆必须指定仓库"));
    }
    if scope == "requirement" && input.requirement_id.as_deref().map_or(true, str::is_empty) {
        return Err(CollabError::invalid("需求范围记忆必须指定需求"));
    }
    tx(conn, |conn| {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM repository_agent_profiles WHERE id = ?1",
            params![input.agent_id],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(CollabError::not_found("仓库智能体", &input.agent_id));
        }
        let key = dedupe_key(
            scope,
            input.project_id.as_deref(),
            input.repository_id,
            input.requirement_id.as_deref(),
            content,
        );
        if let Some(existing) = conn
            .query_row(
                "SELECT id FROM repository_agent_memories WHERE agent_id = ?1 AND dedupe_key = ?2 AND deleted_at IS NULL",
                params![input.agent_id, key],
                |r| r.get::<_, String>(0),
            )
            .optional()?
        {
            let item = get_memory(conn, &existing)?;
            // A verified re-observation promotes a candidate; the reverse never demotes.
            if item.trust == "candidate" && normalize_trust(input.trust.as_deref()) != "candidate" {
                return update_memory(
                    conn,
                    UpdateMemoryInput {
                        memory_id: existing,
                        expected_revision: item.revision,
                        trust: input.trust.clone(),
                        ..Default::default()
                    },
                );
            }
            return Ok(item);
        }
        let id = new_id("mem");
        let now = now_ms();
        let trust = normalize_trust(input.trust.as_deref());
        conn.execute(
            "INSERT INTO repository_agent_memories (
                id, agent_id, scope, project_id, repository_id, requirement_id, content, source_attempt_id,
                evidence_json, trust, revision, dedupe_key, expires_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12, ?13, ?13)",
            params![
                id,
                input.agent_id,
                scope,
                input.project_id,
                input.repository_id,
                input.requirement_id,
                content,
                input.source_attempt_id,
                input.evidence.clone().unwrap_or(Value::Array(vec![])).to_string(),
                trust,
                key,
                input.expires_at,
                now
            ],
        )?;
        conn.execute(
            "INSERT INTO repository_agent_memory_revisions (memory_id, revision, content, trust, change_kind, created_at)
             VALUES (?1, 1, ?2, ?3, 'create', ?4)",
            params![id, content, trust, now],
        )?;
        get_memory(conn, &id)
    })
}

pub fn update_memory(conn: &Connection, input: UpdateMemoryInput) -> CResult<MemoryItem> {
    tx(conn, |conn| {
        let item = get_memory(conn, &input.memory_id)?;
        if item.deleted_at.is_some() {
            return Err(CollabError::state("记忆已删除"));
        }
        if input.expected_revision > 0 && input.expected_revision != item.revision {
            return Err(CollabError::revision_conflict(item.revision));
        }
        let content = input.content.as_deref().map(str::trim).unwrap_or(&item.content).to_string();
        if content.is_empty() {
            return Err(CollabError::invalid("记忆内容不能为空"));
        }
        let trust = input
            .trust
            .as_deref()
            .map(|t| normalize_trust(Some(t)).to_string())
            .unwrap_or_else(|| item.trust.clone());
        let next = item.revision + 1;
        let now = now_ms();
        let key = dedupe_key(
            &item.scope,
            item.project_id.as_deref(),
            item.repository_id,
            item.requirement_id.as_deref(),
            &content,
        );
        conn.execute(
            "UPDATE repository_agent_memories SET content = ?2, trust = ?3, revision = ?4, dedupe_key = ?5,
                expires_at = COALESCE(?6, expires_at), updated_at = ?7
             WHERE id = ?1 AND revision = ?8",
            params![item.id, content, trust, next, key, input.expires_at, now, item.revision],
        )?;
        conn.execute(
            "INSERT INTO repository_agent_memory_revisions (memory_id, revision, content, trust, change_kind, created_at)
             VALUES (?1, ?2, ?3, ?4, 'update', ?5)",
            params![item.id, next, content, trust, now],
        )?;
        get_memory(conn, &item.id)
    })
}

/// Deletion is recorded as a revision so earlier context snapshots that used the memory stay explainable.
fn record_deletions(conn: &Connection, where_sql: &str, key: &str, now: i64) -> CResult<()> {
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO repository_agent_memory_revisions (memory_id, revision, content, trust, change_kind, created_at)
             SELECT id, revision + 1, content, trust, 'delete', ?2 FROM repository_agent_memories
             WHERE {where_sql} AND deleted_at IS NULL"
        ),
        params![key, now],
    )?;
    conn.execute(
        &format!(
            "UPDATE repository_agent_memories SET deleted_at = ?2, revision = revision + 1, updated_at = ?2
             WHERE {where_sql} AND deleted_at IS NULL"
        ),
        params![key, now],
    )?;
    Ok(())
}

pub fn delete_memory(conn: &Connection, memory_id: &str) -> CResult<MemoryItem> {
    tx(conn, |conn| {
        record_deletions(conn, "id = ?1", memory_id, now_ms())?;
        get_memory(conn, memory_id)
    })
}

/// Clears memories only; SOUL/AGENTS.md, knowledge and execution history are untouched.
pub fn clear_memories(conn: &Connection, agent_id: &str) -> CResult<i64> {
    tx(conn, |conn| {
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM repository_agent_memories WHERE agent_id = ?1 AND deleted_at IS NULL",
            params![agent_id],
            |r| r.get(0),
        )?;
        record_deletions(conn, "agent_id = ?1", agent_id, now_ms())?;
        Ok(n)
    })
}

pub fn list_memories(conn: &Connection, agent_id: &str, include_deleted: bool) -> CResult<Vec<MemoryItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM repository_agent_memories WHERE agent_id = ?1 AND (?2 = 1 OR deleted_at IS NULL)
         ORDER BY updated_at DESC"
    ))?;
    let rows = stmt
        .query_map(params![agent_id, include_deleted as i64], map)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn memory_revisions(conn: &Connection, memory_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT revision, content, trust, change_kind, created_at FROM repository_agent_memory_revisions
         WHERE memory_id = ?1 ORDER BY revision DESC",
    )?;
    let rows = stmt
        .query_map(params![memory_id], |r| {
            Ok(serde_json::json!({
                "revision": r.get::<_, i64>(0)?,
                "content": r.get::<_, String>(1)?,
                "trust": r.get::<_, String>(2)?,
                "changeKind": r.get::<_, String>(3)?,
                "createdAt": r.get::<_, i64>(4)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn visible(item: &MemoryItem, scope: &MemoryScope<'_>, now: i64) -> bool {
    if item.agent_id != scope.agent_id || item.deleted_at.is_some() {
        return false;
    }
    if item.expires_at.is_some_and(|e| e <= now) {
        return false;
    }
    match item.scope.as_str() {
        "agent" => true,
        "repository" => {
            item.repository_id.is_some()
                && item.repository_id == scope.repository_id
                && (item.project_id.is_none() || item.project_id.as_deref() == scope.project_id)
        }
        "requirement" => item.requirement_id.is_some() && item.requirement_id.as_deref() == scope.requirement_id,
        _ => false,
    }
}

/// Memories injectable into a task context. Candidates are never presented as facts.
pub fn retrieve_for_task(
    conn: &Connection,
    scope: &MemoryScope<'_>,
    query: &str,
    limit: usize,
    include_candidates: bool,
) -> CResult<Vec<MemoryItem>> {
    let now = now_ms();
    let tokens = keyword_tokens(query);
    let mut items: Vec<(i64, MemoryItem)> = list_memories(conn, scope.agent_id, false)?
        .into_iter()
        .filter(|m| visible(m, scope, now))
        .filter(|m| include_candidates || m.trust != "candidate")
        .map(|m| {
            let lower = m.content.to_lowercase();
            let hits = tokens.iter().filter(|t| lower.contains(t.as_str())).count() as i64;
            let scope_bonus = match m.scope.as_str() {
                "requirement" => 3,
                "repository" => 2,
                _ => 0,
            };
            (hits * 10 + scope_bonus, m)
        })
        .collect();
    items.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.updated_at.cmp(&a.1.updated_at)));
    Ok(items.into_iter().take(limit).map(|(_, m)| m).collect())
}

/// On acceptance, candidates tied to a requirement and carrying evidence become verified.
pub fn promote_verified_candidates(conn: &Connection, agent_id: &str, requirement_id: &str) -> CResult<i64> {
    let now = now_ms();
    let ids: Vec<(String, i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, revision, content FROM repository_agent_memories
             WHERE agent_id = ?1 AND trust = 'candidate' AND deleted_at IS NULL
               AND (requirement_id = ?2 OR source_attempt_id IN (SELECT id FROM collab_attempts WHERE requirement_id = ?2))
               AND evidence_json <> '[]'",
        )?;
        let rows = stmt
            .query_map(params![agent_id, requirement_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        rows
    };
    for (id, revision, content) in &ids {
        conn.execute(
            "UPDATE repository_agent_memories SET trust = 'verified', revision = revision + 1, updated_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        conn.execute(
            "INSERT INTO repository_agent_memory_revisions (memory_id, revision, content, trust, change_kind, created_at)
             VALUES (?1, ?2, ?3, 'verified', 'verify', ?4)",
            params![id, revision + 1, content, now],
        )?;
    }
    Ok(ids.len() as i64)
}
