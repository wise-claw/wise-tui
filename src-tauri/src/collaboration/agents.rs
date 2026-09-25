//! 仓库智能体：独立 profile、不可变配置版本、仓库绑定与生命周期。
//!
//! assistant/template 只是创建时的基线来源；profile 是独立实例，
//! 配置与记忆互不共享。发布、回退都生成新的递增版本。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::error::{codes, CResult, CollabError};
use super::util::{hash_json, new_id, now_ms, parse_json_or, parse_value, to_json, tx};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct KnowledgeRef {
    pub resource_id: String,
    pub pinned_version: Option<i64>,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MemoryPolicy {
    pub enabled: bool,
    pub auto_save_verified: bool,
    pub max_items: i64,
}

impl Default for MemoryPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            auto_save_verified: true,
            max_items: 20,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SkillBinding {
    pub id: String,
    pub label: String,
    pub source_path: Option<String>,
    pub version: Option<String>,
    pub required: bool,
    /// Empty = applies to every bound repository.
    pub repository_ids: Vec<i64>,
    pub params: Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct McpBinding {
    pub server_id: String,
    pub label: String,
    /// Empty = every tool the server exposes.
    pub tools: Vec<String>,
    pub credential_ref: Option<String>,
    pub required: bool,
    pub source_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DelegationPolicy {
    pub allowed_executor_agent_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RunPolicy {
    pub default_mode: String,
    pub max_concurrent_attempts: i64,
    pub repair_round_budget: i64,
    pub execution_attempt_budget: i64,
    pub budget_ms: Option<i64>,
    /// `strict`: unverifiable isolation blocks execution; `best_effort`: degrade with warning.
    pub isolation: String,
    pub acceptance_policy: String,
}

impl Default for RunPolicy {
    fn default() -> Self {
        Self {
            default_mode: "execute".into(),
            max_concurrent_attempts: 2,
            repair_round_budget: 3,
            execution_attempt_budget: 3,
            budget_ms: None,
            isolation: "strict".into(),
            acceptance_policy: "manual".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentConfig {
    pub soul_md: String,
    pub agents_md: String,
    pub knowledge_refs: Vec<KnowledgeRef>,
    pub memory_policy: MemoryPolicy,
    pub skill_bindings: Vec<SkillBinding>,
    pub mcp_bindings: Vec<McpBinding>,
    pub engine_id: String,
    pub model: Option<String>,
    pub delegation_policy: DelegationPolicy,
    pub run_policy: RunPolicy,
    pub template_id: Option<String>,
    pub template_hash: Option<String>,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            soul_md: String::new(),
            agents_md: String::new(),
            knowledge_refs: Vec::new(),
            memory_policy: MemoryPolicy::default(),
            skill_bindings: Vec::new(),
            mcp_bindings: Vec::new(),
            engine_id: "claude".into(),
            model: None,
            delegation_policy: DelegationPolicy::default(),
            run_policy: RunPolicy::default(),
            template_id: None,
            template_hash: None,
        }
    }
}

impl AgentConfig {
    pub fn normalized(mut self) -> Self {
        self.engine_id = self.engine_id.trim().to_string();
        if self.engine_id.is_empty() {
            self.engine_id = "claude".into();
        }
        self.skill_bindings.retain(|s| !s.id.trim().is_empty());
        self.mcp_bindings.retain(|m| !m.server_id.trim().is_empty());
        self.knowledge_refs.retain(|k| !k.resource_id.trim().is_empty());
        let rp = &mut self.run_policy;
        rp.max_concurrent_attempts = rp.max_concurrent_attempts.clamp(1, 8);
        rp.repair_round_budget = rp.repair_round_budget.clamp(1, 20);
        rp.execution_attempt_budget = rp.execution_attempt_budget.clamp(1, 20);
        if !matches!(rp.default_mode.as_str(), "discuss" | "plan" | "execute") {
            rp.default_mode = "execute".into();
        }
        if !matches!(rp.isolation.as_str(), "strict" | "best_effort") {
            rp.isolation = "strict".into();
        }
        if !matches!(rp.acceptance_policy.as_str(), "manual" | "machine") {
            rp.acceptance_policy = "manual".into();
        }
        self
    }

    /// Copy suitable for a duplicated profile: never carries credential references.
    pub fn without_credentials(mut self) -> Self {
        for m in &mut self.mcp_bindings {
            m.credential_ref = None;
        }
        self
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BindingOverride {
    pub agents_md: Option<String>,
    pub knowledge_refs: Vec<KnowledgeRef>,
    pub skills_enable: Vec<SkillBinding>,
    pub skills_disable: Vec<String>,
    pub mcps_enable: Vec<McpBinding>,
    pub mcps_disable: Vec<String>,
}

impl BindingOverride {
    pub fn is_empty(&self) -> bool {
        self.agents_md.as_deref().map_or(true, |s| s.trim().is_empty())
            && self.knowledge_refs.is_empty()
            && self.skills_enable.is_empty()
            && self.skills_disable.is_empty()
            && self.mcps_enable.is_empty()
            && self.mcps_disable.is_empty()
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentBinding {
    pub id: String,
    pub agent_id: String,
    pub project_id: String,
    pub repository_id: i64,
    pub responsibility: String,
    pub role_tags: Vec<String>,
    pub access_scope: String,
    #[serde(rename = "override")]
    pub override_cfg: BindingOverride,
    pub is_default: bool,
    pub status: String,
    pub auth_version: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentRevision {
    pub agent_id: String,
    pub revision: i64,
    pub config: AgentConfig,
    pub config_hash: String,
    pub source: String,
    pub rollback_of: Option<i64>,
    pub note: String,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentRevisionSummary {
    pub revision: i64,
    pub config_hash: String,
    pub source: String,
    pub rollback_of: Option<i64>,
    pub note: String,
    pub created_at: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub assistant_id: Option<String>,
    pub name: String,
    pub description: String,
    pub avatar_color: Option<String>,
    pub default_owner_project_id: Option<String>,
    pub status: String,
    pub active_revision: i64,
    pub draft: AgentConfig,
    pub draft_hash: String,
    pub active_config_hash: Option<String>,
    pub has_unpublished_changes: bool,
    pub draft_updated_at: i64,
    pub row_version: i64,
    pub last_check: Option<Value>,
    pub auth_version: i64,
    pub bindings: Vec<AgentBinding>,
    pub revisions: Vec<AgentRevisionSummary>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CreateAgentInput {
    pub name: String,
    pub description: String,
    pub avatar_color: Option<String>,
    pub assistant_id: Option<String>,
    pub default_owner_project_id: Option<String>,
    pub config: Option<AgentConfig>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateAgentInput {
    pub agent_id: String,
    pub expected_row_version: i64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar_color: Option<String>,
    pub default_owner_project_id: Option<String>,
    pub draft: Option<AgentConfig>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BindAgentInput {
    pub agent_id: String,
    pub project_id: String,
    pub repository_id: i64,
    pub responsibility: String,
    pub role_tags: Vec<String>,
    pub access_scope: Option<String>,
    #[serde(rename = "override")]
    pub override_cfg: Option<BindingOverride>,
    pub is_default: bool,
}

fn map_binding(r: &rusqlite::Row<'_>) -> rusqlite::Result<AgentBinding> {
    Ok(AgentBinding {
        id: r.get(0)?,
        agent_id: r.get(1)?,
        project_id: r.get(2)?,
        repository_id: r.get(3)?,
        responsibility: r.get(4)?,
        role_tags: parse_json_or(&r.get::<_, String>(5)?, Vec::new()),
        access_scope: r.get(6)?,
        override_cfg: parse_json_or(&r.get::<_, String>(7)?, BindingOverride::default()),
        is_default: r.get::<_, i64>(8)? != 0,
        status: r.get(9)?,
        auth_version: r.get(10)?,
        created_at: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

const BINDING_COLS: &str = "id, agent_id, project_id, repository_id, responsibility, role_tags_json, access_scope, override_json, is_default, status, auth_version, created_at, updated_at";

pub fn list_bindings(conn: &Connection, agent_id: &str, include_unbound: bool) -> CResult<Vec<AgentBinding>> {
    let sql = format!(
        "SELECT {BINDING_COLS} FROM repository_agent_bindings WHERE agent_id = ?1 {} ORDER BY created_at ASC",
        if include_unbound { "" } else { "AND status = 'active'" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![agent_id], map_binding)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn list_bindings_for_repository(conn: &Connection, repository_id: i64) -> CResult<Vec<AgentBinding>> {
    let sql = format!(
        "SELECT {BINDING_COLS} FROM repository_agent_bindings WHERE repository_id = ?1 AND status = 'active' ORDER BY is_default DESC, created_at ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![repository_id], map_binding)?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn get_binding(conn: &Connection, binding_id: &str) -> CResult<AgentBinding> {
    let sql = format!("SELECT {BINDING_COLS} FROM repository_agent_bindings WHERE id = ?1");
    conn.query_row(&sql, params![binding_id], map_binding)
        .optional()?
        .ok_or_else(|| CollabError::not_found("绑定", binding_id))
}

pub fn find_binding(
    conn: &Connection,
    agent_id: &str,
    project_id: Option<&str>,
    repository_id: i64,
) -> CResult<Option<AgentBinding>> {
    let sql = format!(
        "SELECT {BINDING_COLS} FROM repository_agent_bindings
         WHERE agent_id = ?1 AND repository_id = ?2 AND status = 'active' AND (?3 IS NULL OR project_id = ?3)
         ORDER BY is_default DESC, created_at ASC LIMIT 1"
    );
    Ok(conn
        .query_row(&sql, params![agent_id, repository_id, project_id], map_binding)
        .optional()?)
}

pub fn default_agent_for(conn: &Connection, project_id: &str, repository_id: i64) -> CResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT b.agent_id FROM repository_agent_bindings b
             JOIN repository_agent_profiles p ON p.id = b.agent_id
             WHERE b.project_id = ?1 AND b.repository_id = ?2 AND b.is_default = 1 AND b.status = 'active'
               AND p.status <> 'archived'",
            params![project_id, repository_id],
            |r| r.get(0),
        )
        .optional()?)
}

fn revision_summaries(conn: &Connection, agent_id: &str) -> CResult<Vec<AgentRevisionSummary>> {
    let mut stmt = conn.prepare(
        "SELECT revision, config_hash, source, rollback_of, note, created_at
         FROM repository_agent_revisions WHERE agent_id = ?1 ORDER BY revision DESC",
    )?;
    let rows = stmt
        .query_map(params![agent_id], |r| {
            Ok(AgentRevisionSummary {
                revision: r.get(0)?,
                config_hash: r.get(1)?,
                source: r.get(2)?,
                rollback_of: r.get(3)?,
                note: r.get(4)?,
                created_at: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn get_agent(conn: &Connection, agent_id: &str) -> CResult<AgentProfile> {
    let row = conn
        .query_row(
            "SELECT id, assistant_id, name, description, avatar_color, default_owner_project_id, status,
                    active_revision, draft_json, draft_updated_at, row_version, last_check_json, auth_version,
                    created_at, updated_at
             FROM repository_agent_profiles WHERE id = ?1",
            params![agent_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, i64>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, Option<String>>(11)?,
                    r.get::<_, i64>(12)?,
                    r.get::<_, i64>(13)?,
                    r.get::<_, i64>(14)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| CollabError::not_found("仓库智能体", agent_id))?;
    let draft: AgentConfig = parse_json_or(&row.8, AgentConfig::default());
    let draft_hash = hash_json(&serde_json::to_value(&draft)?);
    let active_config_hash: Option<String> = conn
        .query_row(
            "SELECT config_hash FROM repository_agent_revisions WHERE agent_id = ?1 AND revision = ?2",
            params![row.0, row.7],
            |r| r.get(0),
        )
        .optional()?;
    Ok(AgentProfile {
        bindings: list_bindings(conn, &row.0, true)?,
        revisions: revision_summaries(conn, &row.0)?,
        has_unpublished_changes: active_config_hash.as_deref() != Some(draft_hash.as_str()),
        id: row.0,
        assistant_id: row.1,
        name: row.2,
        description: row.3,
        avatar_color: row.4,
        default_owner_project_id: row.5,
        status: row.6,
        active_revision: row.7,
        draft,
        draft_hash,
        active_config_hash,
        draft_updated_at: row.9,
        row_version: row.10,
        last_check: row.11.as_deref().map(parse_value),
        auth_version: row.12,
        created_at: row.13,
        updated_at: row.14,
    })
}

pub fn list_agents(conn: &Connection, include_archived: bool) -> CResult<Vec<AgentProfile>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM repository_agent_profiles WHERE (?1 = 1 OR status <> 'archived') ORDER BY created_at ASC",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![include_archived as i64], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    ids.iter().map(|id| get_agent(conn, id)).collect()
}

pub fn get_revision(conn: &Connection, agent_id: &str, revision: i64) -> CResult<AgentRevision> {
    conn.query_row(
        "SELECT agent_id, revision, config_json, config_hash, source, rollback_of, note, created_at
         FROM repository_agent_revisions WHERE agent_id = ?1 AND revision = ?2",
        params![agent_id, revision],
        |r| {
            Ok(AgentRevision {
                agent_id: r.get(0)?,
                revision: r.get(1)?,
                config: parse_json_or(&r.get::<_, String>(2)?, AgentConfig::default()),
                config_hash: r.get(3)?,
                source: r.get(4)?,
                rollback_of: r.get(5)?,
                note: r.get(6)?,
                created_at: r.get(7)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| CollabError::not_found("智能体配置版本", &format!("{agent_id}@{revision}")))
}

fn check_row_version(conn: &Connection, agent_id: &str, expected: i64) -> CResult<()> {
    let current: i64 = conn
        .query_row(
            "SELECT row_version FROM repository_agent_profiles WHERE id = ?1",
            params![agent_id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| CollabError::not_found("仓库智能体", agent_id))?;
    if expected > 0 && current != expected {
        return Err(CollabError::revision_conflict(current));
    }
    Ok(())
}

fn bump(conn: &Connection, agent_id: &str) -> CResult<()> {
    conn.execute(
        "UPDATE repository_agent_profiles SET row_version = row_version + 1, updated_at = ?2 WHERE id = ?1",
        params![agent_id, now_ms()],
    )?;
    Ok(())
}

pub fn create_agent(conn: &Connection, input: CreateAgentInput) -> CResult<AgentProfile> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(CollabError::invalid("智能体名称不能为空"));
    }
    let id = new_id("agent");
    let now = now_ms();
    let config = input.config.unwrap_or_default().normalized();
    conn.execute(
        "INSERT INTO repository_agent_profiles (
            id, assistant_id, name, description, avatar_color, default_owner_project_id, status,
            active_revision, draft_json, draft_updated_at, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'draft', 0, ?7, ?8, ?8, ?8)",
        params![
            id,
            input.assistant_id.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            name,
            input.description.trim(),
            input.avatar_color,
            input.default_owner_project_id.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            to_json(&config),
            now
        ],
    )?;
    get_agent(conn, &id)
}

pub fn update_agent(conn: &Connection, input: UpdateAgentInput) -> CResult<AgentProfile> {
    tx(conn, |conn| {
        check_row_version(conn, &input.agent_id, input.expected_row_version)?;
        let now = now_ms();
        if let Some(name) = input.name.as_deref() {
            let name = name.trim();
            if name.is_empty() {
                return Err(CollabError::invalid("智能体名称不能为空"));
            }
            conn.execute(
                "UPDATE repository_agent_profiles SET name = ?2 WHERE id = ?1",
                params![input.agent_id, name],
            )?;
        }
        if let Some(desc) = input.description.as_deref() {
            conn.execute(
                "UPDATE repository_agent_profiles SET description = ?2 WHERE id = ?1",
                params![input.agent_id, desc.trim()],
            )?;
        }
        if let Some(color) = input.avatar_color.as_deref() {
            conn.execute(
                "UPDATE repository_agent_profiles SET avatar_color = ?2 WHERE id = ?1",
                params![input.agent_id, Some(color.trim()).filter(|s| !s.is_empty())],
            )?;
        }
        if let Some(project) = input.default_owner_project_id.as_deref() {
            conn.execute(
                "UPDATE repository_agent_profiles SET default_owner_project_id = ?2 WHERE id = ?1",
                params![input.agent_id, Some(project.trim()).filter(|s| !s.is_empty())],
            )?;
        }
        if let Some(draft) = input.draft.clone() {
            conn.execute(
                "UPDATE repository_agent_profiles SET draft_json = ?2, draft_updated_at = ?3 WHERE id = ?1",
                params![input.agent_id, to_json(&draft.normalized()), now],
            )?;
        }
        bump(conn, &input.agent_id)?;
        get_agent(conn, &input.agent_id)
    })
}

fn revoked_capabilities(prev: &AgentConfig, next: &AgentConfig) -> bool {
    let next_skills: Vec<&str> = next.skill_bindings.iter().map(|s| s.id.as_str()).collect();
    let skill_removed = prev.skill_bindings.iter().any(|s| !next_skills.contains(&s.id.as_str()));
    let mcp_removed = prev.mcp_bindings.iter().any(|m| {
        match next.mcp_bindings.iter().find(|n| n.server_id == m.server_id) {
            None => true,
            Some(n) => {
                // Narrowing the tool list (or moving from "all" to a subset) is a revocation.
                (!n.tools.is_empty() && m.tools.is_empty())
                    || m.tools.iter().any(|t| !n.tools.is_empty() && !n.tools.contains(t))
            }
        }
    });
    skill_removed || mcp_removed
}

fn insert_revision(
    conn: &Connection,
    agent_id: &str,
    config: &AgentConfig,
    source: &str,
    rollback_of: Option<i64>,
    note: &str,
) -> CResult<AgentRevision> {
    let revision: i64 = conn.query_row(
        "SELECT COALESCE(MAX(revision), 0) + 1 FROM repository_agent_revisions WHERE agent_id = ?1",
        params![agent_id],
        |r| r.get(0),
    )?;
    let value = serde_json::to_value(config)?;
    let hash = hash_json(&value);
    let now = now_ms();
    let previous_active: i64 = conn.query_row(
        "SELECT active_revision FROM repository_agent_profiles WHERE id = ?1",
        params![agent_id],
        |r| r.get(0),
    )?;
    if previous_active > 0 {
        let prev = get_revision(conn, agent_id, previous_active)?;
        if revoked_capabilities(&prev.config, config) {
            conn.execute(
                "UPDATE repository_agent_profiles SET auth_version = auth_version + 1 WHERE id = ?1",
                params![agent_id],
            )?;
        }
    }
    conn.execute(
        "INSERT INTO repository_agent_revisions (agent_id, revision, config_json, config_hash, source, rollback_of, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![agent_id, revision, value.to_string(), hash, source, rollback_of, note.trim(), now],
    )?;
    conn.execute(
        "UPDATE repository_agent_profiles SET active_revision = ?2 WHERE id = ?1",
        params![agent_id, revision],
    )?;
    bump(conn, agent_id)?;
    get_revision(conn, agent_id, revision)
}

/// Publishes the current draft as a new immutable revision (affects only new requirements).
pub fn publish_agent(conn: &Connection, agent_id: &str, expected_row_version: i64, note: &str) -> CResult<AgentRevision> {
    tx(conn, |conn| {
        check_row_version(conn, agent_id, expected_row_version)?;
        let profile = get_agent(conn, agent_id)?;
        if profile.status == "archived" {
            return Err(CollabError::state("已归档的智能体不能发布新版本"));
        }
        insert_revision(conn, agent_id, &profile.draft, "publish", None, note)
    })
}

/// Rollback publishes a new revision that copies an older one; history is never rewritten.
pub fn rollback_agent(conn: &Connection, agent_id: &str, to_revision: i64, expected_row_version: i64) -> CResult<AgentRevision> {
    tx(conn, |conn| {
        check_row_version(conn, agent_id, expected_row_version)?;
        let target = get_revision(conn, agent_id, to_revision)?;
        conn.execute(
            "UPDATE repository_agent_profiles SET draft_json = ?2, draft_updated_at = ?3 WHERE id = ?1",
            params![agent_id, to_json(&target.config), now_ms()],
        )?;
        insert_revision(
            conn,
            agent_id,
            &target.config,
            "rollback",
            Some(to_revision),
            &format!("回退到版本 {to_revision}"),
        )
    })
}

pub fn record_check(conn: &Connection, agent_id: &str, report: &Value, passed: bool) -> CResult<AgentProfile> {
    let profile = get_agent(conn, agent_id)?;
    let next_status = match (profile.status.as_str(), passed) {
        ("draft", true) | ("disabled", true) => "checked",
        ("checked", false) => "draft",
        (s, _) => s,
    };
    conn.execute(
        "UPDATE repository_agent_profiles SET last_check_json = ?2, status = ?3, row_version = row_version + 1, updated_at = ?4 WHERE id = ?1",
        params![agent_id, report.to_string(), next_status, now_ms()],
    )?;
    get_agent(conn, agent_id)
}

/// `enable` requires a passing check against the active revision; `disable` stops new work.
pub fn set_agent_status(conn: &Connection, agent_id: &str, action: &str, expected_row_version: i64) -> CResult<AgentProfile> {
    tx(conn, |conn| {
        check_row_version(conn, agent_id, expected_row_version)?;
        let profile = get_agent(conn, agent_id)?;
        let next = match action {
            "enable" => {
                if profile.active_revision == 0 {
                    return Err(CollabError::state("请先发布一个配置版本再启用"));
                }
                let check_ok = profile
                    .last_check
                    .as_ref()
                    .map(|c| {
                        c.get("passed").and_then(Value::as_bool) == Some(true)
                            && c.get("revision").and_then(Value::as_i64) == Some(profile.active_revision)
                    })
                    .unwrap_or(false);
                if !check_ok {
                    return Err(CollabError::new(
                        codes::REQUIRED_CAPABILITY_MISSING,
                        "当前生效版本尚未通过「检查配置」，请先检查后再启用",
                    )
                    .suggest("check_agent"));
                }
                "enabled"
            }
            "disable" => {
                if profile.status == "archived" {
                    return Err(CollabError::state("已归档的智能体不能停用"));
                }
                "disabled"
            }
            "archive" => {
                if !matches!(profile.status.as_str(), "draft" | "disabled" | "checked") {
                    return Err(CollabError::state("仅草稿或已停用的智能体可以归档"));
                }
                let running: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM collab_attempts a JOIN collab_tasks t ON t.id = a.task_id
                     WHERE a.state <> 'finished' AND t.executor_agent_id = ?1",
                    params![agent_id],
                    |r| r.get(0),
                )?;
                if running > 0 {
                    return Err(CollabError::state("仍有执行中的尝试，不能归档"));
                }
                "archived"
            }
            other => return Err(CollabError::invalid(format!("未知操作 {other}"))),
        };
        conn.execute(
            "UPDATE repository_agent_profiles SET status = ?2 WHERE id = ?1",
            params![agent_id, next],
        )?;
        bump(conn, agent_id)?;
        if next == "disabled" {
            super::scheduler::request_stop_for_agent(conn, agent_id, "agent_disabled")?;
        }
        get_agent(conn, agent_id)
    })
}

/// Duplicates config (never memories or credentials) into an independent draft profile.
pub fn duplicate_agent(conn: &Connection, agent_id: &str, name: &str) -> CResult<AgentProfile> {
    let source = get_agent(conn, agent_id)?;
    let name = if name.trim().is_empty() {
        format!("{} 副本", source.name)
    } else {
        name.trim().to_string()
    };
    create_agent(
        conn,
        CreateAgentInput {
            name,
            description: source.description.clone(),
            avatar_color: source.avatar_color.clone(),
            assistant_id: source.assistant_id.clone(),
            default_owner_project_id: source.default_owner_project_id.clone(),
            config: Some(source.draft.clone().without_credentials()),
        },
    )
}

pub fn repository_in_project(conn: &Connection, project_id: &str, repository_id: i64) -> CResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM project_repositories WHERE project_id = ?1 AND repository_id = ?2",
        params![project_id, repository_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub fn bind_agent(conn: &Connection, input: BindAgentInput) -> CResult<AgentBinding> {
    tx(conn, |conn| {
        let profile = get_agent(conn, &input.agent_id)?;
        if profile.status == "archived" {
            return Err(CollabError::state("已归档的智能体不能绑定仓库"));
        }
        let project_id = input.project_id.trim();
        if project_id.is_empty() {
            return Err(CollabError::invalid("绑定必须指定责任项目"));
        }
        if !repository_in_project(conn, project_id, input.repository_id)? {
            return Err(CollabError::new(
                codes::SCOPE_NOT_AUTHORIZED,
                "该仓库不属于所选项目，请先在项目中关联仓库",
            ));
        }
        let access = match input.access_scope.as_deref() {
            Some("read") => "read",
            _ => "read_write",
        };
        let now = now_ms();
        let override_json = to_json(&input.override_cfg.clone().unwrap_or_default());
        if input.is_default {
            conn.execute(
                "UPDATE repository_agent_bindings SET is_default = 0, updated_at = ?3
                 WHERE project_id = ?1 AND repository_id = ?2 AND is_default = 1",
                params![project_id, input.repository_id, now],
            )?;
        }
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM repository_agent_bindings WHERE agent_id = ?1 AND project_id = ?2 AND repository_id = ?3",
                params![input.agent_id, project_id, input.repository_id],
                |r| r.get(0),
            )
            .optional()?;
        let id = match existing {
            Some(id) => {
                conn.execute(
                    "UPDATE repository_agent_bindings SET responsibility = ?2, role_tags_json = ?3, access_scope = ?4,
                        override_json = ?5, is_default = ?6, status = 'active', auth_version = auth_version + 1, updated_at = ?7
                     WHERE id = ?1",
                    params![
                        id,
                        input.responsibility.trim(),
                        to_json(&input.role_tags),
                        access,
                        override_json,
                        input.is_default as i64,
                        now
                    ],
                )?;
                id
            }
            None => {
                let id = new_id("bind");
                conn.execute(
                    "INSERT INTO repository_agent_bindings (
                        id, agent_id, project_id, repository_id, responsibility, role_tags_json, access_scope,
                        override_json, is_default, status, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?10)",
                    params![
                        id,
                        input.agent_id,
                        project_id,
                        input.repository_id,
                        input.responsibility.trim(),
                        to_json(&input.role_tags),
                        access,
                        override_json,
                        input.is_default as i64,
                        now
                    ],
                )?;
                id
            }
        };
        bump(conn, &input.agent_id)?;
        get_binding(conn, &id)
    })
}

/// Unbinding blocks new reads/executions and notifies affected tasks; history stays linked.
pub fn unbind_agent(conn: &Connection, binding_id: &str) -> CResult<AgentBinding> {
    tx(conn, |conn| {
        let binding = get_binding(conn, binding_id)?;
        let now = now_ms();
        conn.execute(
            "UPDATE repository_agent_bindings SET status = 'unbound', is_default = 0, auth_version = auth_version + 1, updated_at = ?2 WHERE id = ?1",
            params![binding_id, now],
        )?;
        bump(conn, &binding.agent_id)?;
        super::scheduler::handle_binding_revoked(conn, &binding)?;
        get_binding(conn, binding_id)
    })
}

pub fn agent_summary_json(profile: &AgentProfile) -> Value {
    json!({
        "id": profile.id,
        "name": profile.name,
        "status": profile.status,
        "activeRevision": profile.active_revision,
        "description": profile.description,
        "avatarColor": profile.avatar_color,
        "assistantId": profile.assistant_id,
        "defaultOwnerProjectId": profile.default_owner_project_id,
        "hasUnpublishedChanges": profile.has_unpublished_changes,
        "engineId": profile.draft.engine_id,
        "defaultMode": profile.draft.run_policy.default_mode,
        "updatedAt": profile.updated_at,
    })
}
