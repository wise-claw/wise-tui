//! 共享资源：来源 / 版本 / 可见范围 / 授权。发布生成不可变版本；检索与读取都按调用方身份过滤；
//! 撤销授权立即使后续读取失效，并通知正在使用该资源的运行任务在检查点停止。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{codes, CResult, CollabError};
use super::events::append_event;
use super::util::{keyword_tokens, new_id, now_ms, parse_value, sha256_hex, truncate_chars, tx};

pub const GLOBAL_STREAM: &str = "_resources";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub owner_project_id: Option<String>,
    pub owner_agent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub maintainer: String,
    pub visibility: String,
    pub space_id: Option<String>,
    pub repository_id: Option<i64>,
    pub location: String,
    pub status: String,
    pub auth_version: i64,
    pub latest_version: i64,
    pub grants: Vec<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceVersion {
    pub id: String,
    pub resource_id: String,
    pub version: i64,
    pub content: String,
    pub content_hash: String,
    pub source_ref: Value,
    pub publisher: String,
    pub note: String,
    pub published_at: i64,
}

/// Caller identity used for every search / read.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Principal {
    pub project_ids: Vec<String>,
    pub agent_id: Option<String>,
    pub task_id: Option<String>,
    /// UI/user reads see everything they own or that is visible to their projects.
    pub is_user: bool,
}

const RES_COLS: &str = "id, owner_project_id, owner_agent_id, kind, title, maintainer, visibility, space_id, repository_id,
    location, status, auth_version, latest_version, created_at, updated_at";

fn map_res(r: &rusqlite::Row<'_>) -> rusqlite::Result<Resource> {
    Ok(Resource {
        id: r.get(0)?,
        owner_project_id: r.get(1)?,
        owner_agent_id: r.get(2)?,
        kind: r.get(3)?,
        title: r.get(4)?,
        maintainer: r.get(5)?,
        visibility: r.get(6)?,
        space_id: r.get(7)?,
        repository_id: r.get(8)?,
        location: r.get(9)?,
        status: r.get(10)?,
        auth_version: r.get(11)?,
        latest_version: r.get(12)?,
        grants: Vec::new(),
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

fn load_grants(conn: &Connection, resource_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, grantee_kind, grantee_id, auth_version, revoked_at, created_at FROM collab_resource_grants
         WHERE resource_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map(params![resource_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "granteeKind": r.get::<_, String>(1)?,
                "granteeId": r.get::<_, String>(2)?,
                "authVersion": r.get::<_, i64>(3)?,
                "revokedAt": r.get::<_, Option<i64>>(4)?,
                "createdAt": r.get::<_, i64>(5)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn load_resource(conn: &Connection, id: &str) -> CResult<Resource> {
    let mut res = conn
        .query_row(&format!("SELECT {RES_COLS} FROM collab_resources WHERE id = ?1"), params![id], map_res)
        .optional()?
        .ok_or_else(|| CollabError::not_found("共享资源", id))?;
    res.grants = load_grants(conn, id)?;
    Ok(res)
}

pub fn load_version(conn: &Connection, resource_id: &str, version: Option<i64>) -> CResult<ResourceVersion> {
    conn.query_row(
        "SELECT id, resource_id, version, content, content_hash, source_ref_json, publisher, note, published_at
         FROM collab_resource_versions WHERE resource_id = ?1 AND (?2 IS NULL OR version = ?2)
         ORDER BY version DESC LIMIT 1",
        params![resource_id, version],
        |r| {
            Ok(ResourceVersion {
                id: r.get(0)?,
                resource_id: r.get(1)?,
                version: r.get(2)?,
                content: r.get(3)?,
                content_hash: r.get(4)?,
                source_ref: parse_value(&r.get::<_, String>(5)?),
                publisher: r.get(6)?,
                note: r.get(7)?,
                published_at: r.get(8)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CollabError::not_found("资源版本", &format!("{resource_id}@{version:?}")))
}

pub fn list_versions(conn: &Connection, resource_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT version, content_hash, publisher, note, published_at FROM collab_resource_versions WHERE resource_id = ?1 ORDER BY version DESC",
    )?;
    let rows = stmt
        .query_map(params![resource_id], |r| {
            Ok(json!({
                "version": r.get::<_, i64>(0)?,
                "contentHash": r.get::<_, String>(1)?,
                "publisher": r.get::<_, String>(2)?,
                "note": r.get::<_, String>(3)?,
                "publishedAt": r.get::<_, i64>(4)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn spaces_of(conn: &Connection, project_ids: &[String]) -> CResult<Vec<String>> {
    let mut out = Vec::new();
    for p in project_ids {
        let mut stmt = conn.prepare("SELECT space_id FROM collaboration_members WHERE project_id = ?1")?;
        let ids: Vec<String> = stmt.query_map(params![p], |r| r.get(0))?.collect::<Result<_, _>>()?;
        for id in ids {
            if !out.contains(&id) {
                out.push(id);
            }
        }
    }
    Ok(out)
}

/// Authorization gate shared by search and read.
pub fn can_read(conn: &Connection, res: &Resource, who: &Principal) -> CResult<bool> {
    if res.status != "active" {
        return Ok(false);
    }
    let owns_project = res.owner_project_id.as_deref().is_some_and(|p| who.project_ids.iter().any(|x| x == p));
    let owns_agent = res.owner_agent_id.is_some() && res.owner_agent_id == who.agent_id;
    match res.visibility.as_str() {
        "agent_private" => return Ok(owns_agent),
        "source" if owns_project || owns_agent => return Ok(true),
        "space" => {
            if owns_project || owns_agent {
                return Ok(true);
            }
            if let Some(space) = res.space_id.as_deref() {
                if spaces_of(conn, &who.project_ids)?.iter().any(|s| s == space) {
                    return Ok(true);
                }
            }
        }
        _ => {
            if owns_project || owns_agent {
                return Ok(true);
            }
        }
    }
    let spaces = spaces_of(conn, &who.project_ids)?;
    for g in &res.grants {
        if !g["revokedAt"].is_null() {
            continue;
        }
        let id = g["granteeId"].as_str().unwrap_or("");
        let hit = match g["granteeKind"].as_str().unwrap_or("") {
            "project" => who.project_ids.iter().any(|p| p == id),
            "agent" => who.agent_id.as_deref() == Some(id),
            "task" => who.task_id.as_deref() == Some(id),
            "space" => spaces.iter().any(|s| s == id),
            _ => false,
        };
        if hit {
            return Ok(true);
        }
    }
    Ok(false)
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateResourceInput {
    pub owner_project_id: Option<String>,
    pub owner_agent_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub maintainer: String,
    pub visibility: String,
    pub space_id: Option<String>,
    pub repository_id: Option<i64>,
    pub location: String,
    pub content: String,
    pub note: String,
    pub source_ref: Value,
    pub publisher: String,
}

fn normalize_visibility(v: &str) -> &'static str {
    match v.trim() {
        "space" => "space",
        "granted" => "granted",
        "agent_private" => "agent_private",
        _ => "source",
    }
}

/// Resource content never stores resolved credentials; obvious secrets are rejected.
fn reject_secrets(content: &str) -> CResult<()> {
    let lower = content.to_ascii_lowercase();
    for marker in ["-----begin", "aws_secret_access_key", "authorization: bearer ", "api_key=", "password="] {
        if lower.contains(marker) {
            return Err(CollabError::new(
                codes::INVALID_PAYLOAD,
                "共享资源不能包含凭据明文；请改用 credentialRef 引用由运行环境解析",
            ));
        }
    }
    Ok(())
}

pub fn create_resource(conn: &Connection, input: &CreateResourceInput) -> CResult<Resource> {
    tx(conn, |conn| {
        if input.title.trim().is_empty() {
            return Err(CollabError::invalid("资源需要标题"));
        }
        if input.owner_project_id.is_none() && input.owner_agent_id.is_none() {
            return Err(CollabError::invalid("资源需要来源项目或来源智能体"));
        }
        let visibility = normalize_visibility(&input.visibility);
        if visibility == "agent_private" && input.owner_agent_id.is_none() {
            return Err(CollabError::invalid("智能体私有资源需要 ownerAgentId"));
        }
        if visibility == "space" && input.space_id.is_none() {
            return Err(CollabError::invalid("空间可见资源需要 spaceId"));
        }
        reject_secrets(&input.content)?;
        let id = new_id("res");
        let now = now_ms();
        conn.execute(
            "INSERT INTO collab_resources (id, owner_project_id, owner_agent_id, kind, title, maintainer, visibility, space_id,
                repository_id, location, status, auth_version, latest_version, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', 1, 0, ?11, ?11)",
            params![
                id,
                input.owner_project_id,
                input.owner_agent_id,
                if input.kind.trim().is_empty() { "knowledge" } else { input.kind.trim() },
                input.title.trim(),
                input.maintainer.trim(),
                visibility,
                input.space_id,
                input.repository_id,
                input.location.trim(),
                now
            ],
        )?;
        publish_locked(conn, &id, &input.content, &input.note, &input.publisher, &input.source_ref)?;
        load_resource(conn, &id)
    })
}

fn publish_locked(conn: &Connection, resource_id: &str, content: &str, note: &str, publisher: &str, source_ref: &Value) -> CResult<ResourceVersion> {
    let now = now_ms();
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM collab_resource_versions WHERE resource_id = ?1",
        params![resource_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO collab_resource_versions (id, resource_id, version, content, content_hash, source_ref_json, publisher, note, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            new_id("rv"),
            resource_id,
            version,
            content,
            sha256_hex(content),
            if source_ref.is_null() { "{}".to_string() } else { source_ref.to_string() },
            publisher,
            note,
            now
        ],
    )?;
    conn.execute(
        "UPDATE collab_resources SET latest_version = ?2, updated_at = ?3 WHERE id = ?1",
        params![resource_id, version, now],
    )?;
    append_event(
        conn,
        GLOBAL_STREAM,
        "resource.version_published",
        json!({ "resourceId": resource_id, "version": version }),
        Some(resource_id),
        None,
    )?;
    load_version(conn, resource_id, Some(version))
}

pub fn publish_version(conn: &Connection, resource_id: &str, content: &str, note: &str, publisher: &str, source_ref: &Value) -> CResult<ResourceVersion> {
    tx(conn, |conn| {
        let res = load_resource(conn, resource_id)?;
        if res.status != "active" {
            return Err(CollabError::state("资源已停用，不能发布新版本"));
        }
        reject_secrets(content)?;
        let latest = load_version(conn, resource_id, None)?;
        if latest.content_hash == sha256_hex(content) {
            return Ok(latest);
        }
        publish_locked(conn, resource_id, content, note, publisher, source_ref)
    })
}

fn bump_auth(conn: &Connection, resource_id: &str) -> CResult<i64> {
    conn.execute(
        "UPDATE collab_resources SET auth_version = auth_version + 1, updated_at = ?2 WHERE id = ?1",
        params![resource_id, now_ms()],
    )?;
    Ok(conn.query_row("SELECT auth_version FROM collab_resources WHERE id = ?1", params![resource_id], |r| r.get(0))?)
}

pub fn grant(conn: &Connection, resource_id: &str, grantee_kind: &str, grantee_id: &str) -> CResult<Resource> {
    tx(conn, |conn| {
        if !matches!(grantee_kind, "project" | "agent" | "task" | "space") || grantee_id.trim().is_empty() {
            return Err(CollabError::invalid("授权对象需要 project / agent / task / space 与 id"));
        }
        load_resource(conn, resource_id)?;
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM collab_resource_grants WHERE resource_id = ?1 AND grantee_kind = ?2 AND grantee_id = ?3 AND revoked_at IS NULL",
            params![resource_id, grantee_kind, grantee_id.trim()],
            |r| r.get(0),
        )?;
        if exists == 0 {
            let auth = bump_auth(conn, resource_id)?;
            conn.execute(
                "INSERT INTO collab_resource_grants (id, resource_id, grantee_kind, grantee_id, auth_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![new_id("grant"), resource_id, grantee_kind, grantee_id.trim(), auth, now_ms()],
            )?;
        }
        load_resource(conn, resource_id)
    })
}

/// Revocation takes effect for the next read; running consumers are told to stop at a checkpoint.
pub fn revoke(conn: &Connection, grant_id: &str) -> CResult<Resource> {
    tx(conn, |conn| {
        let resource_id: String = conn
            .query_row("SELECT resource_id FROM collab_resource_grants WHERE id = ?1", params![grant_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| CollabError::not_found("资源授权", grant_id))?;
        conn.execute(
            "UPDATE collab_resource_grants SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL",
            params![grant_id, now_ms()],
        )?;
        bump_auth(conn, &resource_id)?;
        notify_revoked(conn, &resource_id)?;
        load_resource(conn, &resource_id)
    })
}

pub fn set_visibility(conn: &Connection, resource_id: &str, visibility: &str, space_id: Option<&str>) -> CResult<Resource> {
    tx(conn, |conn| {
        let v = normalize_visibility(visibility);
        conn.execute(
            "UPDATE collab_resources SET visibility = ?2, space_id = ?3, updated_at = ?4 WHERE id = ?1",
            params![resource_id, v, space_id, now_ms()],
        )?;
        bump_auth(conn, resource_id)?;
        notify_revoked(conn, resource_id)?;
        load_resource(conn, resource_id)
    })
}

pub fn archive(conn: &Connection, resource_id: &str) -> CResult<Resource> {
    tx(conn, |conn| {
        conn.execute(
            "UPDATE collab_resources SET status = 'archived', updated_at = ?2 WHERE id = ?1",
            params![resource_id, now_ms()],
        )?;
        bump_auth(conn, resource_id)?;
        notify_revoked(conn, resource_id)?;
        load_resource(conn, resource_id)
    })
}

fn principal_for_task(conn: &Connection, task_id: &str) -> CResult<Principal> {
    let task = super::model::load_task(conn, task_id)?;
    Ok(Principal {
        project_ids: task.project_id.into_iter().collect(),
        agent_id: task.executor_agent_id,
        task_id: Some(task.id),
        is_user: false,
    })
}

fn notify_revoked(conn: &Connection, resource_id: &str) -> CResult<()> {
    let res = load_resource(conn, resource_id)?;
    let pattern = format!("%{resource_id}%");
    let attempts: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, task_id, requirement_id FROM collab_attempts WHERE state IN ('claimed', 'running') AND input_manifest_json LIKE ?1",
        )?;
        let rows = stmt.query_map(params![pattern], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
        rows
    };
    for (attempt_id, task_id, requirement_id) in attempts {
        if can_read(conn, &res, &principal_for_task(conn, &task_id)?)? {
            continue;
        }
        super::events::send_message(
            conn,
            &requirement_id,
            super::events::NewMessage::new(
                "resource.revoked",
                json!({ "resourceId": resource_id, "title": res.title, "authVersion": res.auth_version }),
            )
            .to_task(&task_id)
            .with_id(format!("msg-revoke-{resource_id}-{}-{task_id}", res.auth_version)),
        )?;
        super::scheduler::request_stop(conn, &attempt_id, "resource_revoked")?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub resource_id: String,
    pub title: String,
    pub kind: String,
    pub version: i64,
    pub content_hash: String,
    pub source_project_id: Option<String>,
    pub maintainer: String,
    pub snippet: String,
    pub score: i64,
    pub auth_version: i64,
}

pub fn search(conn: &Connection, who: &Principal, query: &str, limit: usize) -> CResult<Vec<SearchHit>> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM collab_resources WHERE status = 'active' AND latest_version > 0")?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    let tokens = keyword_tokens(query);
    let mut hits = Vec::new();
    for id in ids {
        let res = load_resource(conn, &id)?;
        if !can_read(conn, &res, who)? {
            continue;
        }
        let v = load_version(conn, &id, None)?;
        let hay = format!("{}\n{}", res.title.to_lowercase(), v.content.to_lowercase());
        let score = if tokens.is_empty() {
            1
        } else {
            tokens.iter().filter(|t| hay.contains(t.as_str())).count() as i64 * 10
                + tokens.iter().filter(|t| res.title.to_lowercase().contains(t.as_str())).count() as i64 * 5
        };
        if score == 0 {
            continue;
        }
        let lower = v.content.to_lowercase();
        let snippet = tokens
            .iter()
            .find_map(|t| {
                lower.find(t.as_str()).map(|pos| {
                    let start = lower[..pos].char_indices().rev().nth(40).map(|(i, _)| i).unwrap_or(0);
                    truncate_chars(&lower[start..], 160)
                })
            })
            .unwrap_or_else(|| truncate_chars(&v.content, 160));
        hits.push(SearchHit {
            resource_id: res.id.clone(),
            title: res.title.clone(),
            kind: res.kind.clone(),
            version: v.version,
            content_hash: v.content_hash.clone(),
            source_project_id: res.owner_project_id.clone(),
            maintainer: res.maintainer.clone(),
            snippet,
            score,
            auth_version: res.auth_version,
        });
    }
    hits.sort_by(|a, b| b.score.cmp(&a.score).then(a.title.cmp(&b.title)));
    hits.truncate(limit.clamp(1, 50));
    Ok(hits)
}

pub fn read(conn: &Connection, who: &Principal, resource_id: &str, version: Option<i64>) -> CResult<(Resource, ResourceVersion)> {
    let res = load_resource(conn, resource_id)?;
    if !can_read(conn, &res, who)? {
        return Err(CollabError::new(codes::FORBIDDEN, format!("无权读取资源「{}」或授权已撤销", res.title)));
    }
    let v = load_version(conn, resource_id, version)?;
    Ok((res, v))
}

pub fn principal_for_attempt(conn: &Connection, task_id: &str) -> CResult<Principal> {
    principal_for_task(conn, task_id)
}

pub fn list_resources(conn: &Connection, project_id: Option<&str>) -> CResult<Vec<Resource>> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM collab_resources WHERE status <> 'archived' ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    let who = Principal { project_ids: project_id.map(|p| vec![p.to_string()]).unwrap_or_default(), is_user: true, ..Default::default() };
    let mut out = Vec::new();
    for id in ids {
        let res = load_resource(conn, &id)?;
        let visible = project_id.is_none() || (res.visibility != "agent_private" && can_read(conn, &res, &who)?);
        if visible {
            out.push(res);
        }
    }
    Ok(out)
}

pub fn subscribe(conn: &Connection, resource_id: &str, subscriber_kind: &str, subscriber_id: &str) -> CResult<Value> {
    if !matches!(subscriber_kind, "project" | "agent") {
        return Err(CollabError::invalid("订阅方为 project 或 agent"));
    }
    let res = load_resource(conn, resource_id)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO collab_resource_subscriptions (id, resource_id, subscriber_kind, subscriber_id, tracked_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(resource_id, subscriber_kind, subscriber_id) DO UPDATE SET tracked_version = excluded.tracked_version, updated_at = excluded.updated_at",
        params![new_id("sub"), resource_id, subscriber_kind, subscriber_id, res.latest_version, now],
    )?;
    Ok(json!({ "resourceId": resource_id, "trackedVersion": res.latest_version }))
}

/// Subscriptions with a newer published version than the tracked one.
pub fn subscription_updates(conn: &Connection, subscriber_kind: &str, subscriber_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT s.resource_id, r.title, s.tracked_version, r.latest_version FROM collab_resource_subscriptions s
         JOIN collab_resources r ON r.id = s.resource_id
         WHERE s.subscriber_kind = ?1 AND s.subscriber_id = ?2 ORDER BY r.updated_at DESC",
    )?;
    let rows = stmt
        .query_map(params![subscriber_kind, subscriber_id], |r| {
            let tracked: i64 = r.get(2)?;
            let latest: i64 = r.get(3)?;
            Ok(json!({
                "resourceId": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "trackedVersion": tracked,
                "latestVersion": latest,
                "hasUpdate": latest > tracked,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn suggest(conn: &Connection, resource_id: &str, from_project_id: Option<&str>, from_task_id: Option<&str>, body: &str) -> CResult<Value> {
    if body.trim().is_empty() {
        return Err(CollabError::invalid("建议内容不能为空"));
    }
    load_resource(conn, resource_id)?;
    let id = new_id("sug");
    conn.execute(
        "INSERT INTO collab_resource_suggestions (id, resource_id, from_project_id, from_task_id, body, state, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)",
        params![id, resource_id, from_project_id, from_task_id, body.trim(), now_ms()],
    )?;
    Ok(json!({ "id": id, "resourceId": resource_id, "state": "open" }))
}

pub fn list_suggestions(conn: &Connection, resource_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, from_project_id, from_task_id, body, state, created_at FROM collab_resource_suggestions WHERE resource_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map(params![resource_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "fromProjectId": r.get::<_, Option<String>>(1)?,
                "fromTaskId": r.get::<_, Option<String>>(2)?,
                "body": r.get::<_, String>(3)?,
                "state": r.get::<_, String>(4)?,
                "createdAt": r.get::<_, i64>(5)?,
            }))
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn resolve_suggestion(conn: &Connection, suggestion_id: &str, accept: bool) -> CResult<()> {
    conn.execute(
        "UPDATE collab_resource_suggestions SET state = ?2 WHERE id = ?1 AND state = 'open'",
        params![suggestion_id, if accept { "accepted" } else { "rejected" }],
    )?;
    Ok(())
}

/// Context audit: which resource versions each attempt of the requirement was given.
pub fn resources_for_requirement(conn: &Connection, requirement_id: &str) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, input_manifest_json, created_at FROM collab_attempts WHERE requirement_id = ?1 ORDER BY created_at DESC LIMIT 100",
    )?;
    let rows: Vec<(String, String, String, i64)> = stmt
        .query_map(params![requirement_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(id, task, manifest, at)| {
            let m = parse_value(&manifest);
            json!({
                "attemptId": id,
                "taskId": task,
                "createdAt": at,
                "resources": m.get("resources").cloned().unwrap_or(json!([])),
                "memories": m.get("memories").cloned().unwrap_or(json!([])),
                "artifacts": m.get("artifacts").cloned().unwrap_or(json!([])),
            })
        })
        .collect())
}

pub fn create_space(conn: &Connection, name: &str, description: &str, owner_project_id: &str) -> CResult<Value> {
    if name.trim().is_empty() || owner_project_id.trim().is_empty() {
        return Err(CollabError::invalid("协作空间需要名称与所属项目"));
    }
    let id = new_id("space");
    let now = now_ms();
    conn.execute(
        "INSERT INTO collaboration_spaces (id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name.trim(), description.trim(), now],
    )?;
    conn.execute(
        "INSERT INTO collaboration_members (space_id, project_id, role, joined_at) VALUES (?1, ?2, 'owner', ?3)",
        params![id, owner_project_id.trim(), now],
    )?;
    Ok(json!({ "id": id, "name": name.trim() }))
}

pub fn set_space_member(conn: &Connection, space_id: &str, project_id: &str, member: bool) -> CResult<()> {
    if member {
        conn.execute(
            "INSERT OR IGNORE INTO collaboration_members (space_id, project_id, role, joined_at) VALUES (?1, ?2, 'member', ?3)",
            params![space_id, project_id, now_ms()],
        )?;
    } else {
        conn.execute(
            "DELETE FROM collaboration_members WHERE space_id = ?1 AND project_id = ?2 AND role <> 'owner'",
            params![space_id, project_id],
        )?;
        // Membership loss is an authorization change for every space-visible resource.
        let ids: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM collab_resources WHERE space_id = ?1")?;
            let rows = stmt.query_map(params![space_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
            rows
        };
        for id in ids {
            bump_auth(conn, &id)?;
            notify_revoked(conn, &id)?;
        }
    }
    Ok(())
}

pub fn list_spaces(conn: &Connection) -> CResult<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id, name, description, created_at FROM collaboration_spaces ORDER BY created_at ASC")?;
    let spaces: Vec<(String, String, String, i64)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    let mut out = Vec::new();
    for (id, name, description, created_at) in spaces {
        let mut m = conn.prepare("SELECT project_id, role FROM collaboration_members WHERE space_id = ?1 ORDER BY joined_at")?;
        let members: Vec<Value> = m
            .query_map(params![id], |r| Ok(json!({ "projectId": r.get::<_, String>(0)?, "role": r.get::<_, String>(1)? })))?
            .collect::<Result<_, _>>()?;
        out.push(json!({ "id": id, "name": name, "description": description, "createdAt": created_at, "members": members }));
    }
    Ok(out)
}
