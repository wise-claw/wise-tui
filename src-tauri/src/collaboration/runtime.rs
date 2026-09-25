//! 仓库智能体运行态解析：锁定配置 + 仓库覆盖 + 撤销优先 → 生效清单（manifest）。
//!
//! 引擎能力矩阵记录每项隔离能力是否经过实测（W0）；未验证的能力在 strict
//! 隔离策略下阻塞执行，不以提示词“请不要使用”冒充隔离。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::agents::{self, AgentConfig, KnowledgeRef, McpBinding, SkillBinding};
use super::error::CResult;
use super::util::{now_ms, sha256_hex};

pub const CAPABILITY_MATRIX_KEY: &str = "wise.collaboration.capabilityMatrix.v1";

pub const VERIFIED: &str = "verified";
pub const UNVERIFIED: &str = "unverified";
pub const UNSUPPORTED: &str = "unsupported";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineCapability {
    pub engine_id: String,
    pub independent_instructions: String,
    pub native_repo_rules: String,
    pub skill_mount: String,
    pub mcp_restriction: String,
    pub memory_isolation: String,
    pub tool_allowlist: String,
    pub resume: String,
    pub query_by_dispatch_key: String,
    pub cancel: String,
    pub evidence: Vec<String>,
    pub probed_at: Option<i64>,
}

impl Default for EngineCapability {
    fn default() -> Self {
        Self {
            engine_id: String::new(),
            independent_instructions: UNVERIFIED.into(),
            native_repo_rules: UNVERIFIED.into(),
            skill_mount: UNVERIFIED.into(),
            mcp_restriction: UNVERIFIED.into(),
            memory_isolation: UNVERIFIED.into(),
            tool_allowlist: UNVERIFIED.into(),
            resume: UNVERIFIED.into(),
            // Wise records attempt ↔ session itself, independent of engine.
            query_by_dispatch_key: VERIFIED.into(),
            cancel: VERIFIED.into(),
            evidence: Vec::new(),
            probed_at: None,
        }
    }
}

pub type CapabilityMatrix = BTreeMap<String, EngineCapability>;

/// Baseline before probing: nothing about isolation is claimed.
pub fn default_matrix() -> CapabilityMatrix {
    let mut m = CapabilityMatrix::new();
    for engine in ["claude", "codex", "codex-rpc", "cursor", "opencode", "qoder", "deepseek", "gemini"] {
        let mut cap = EngineCapability {
            engine_id: engine.into(),
            ..Default::default()
        };
        if engine != "claude" {
            cap.memory_isolation = UNSUPPORTED.into();
            cap.mcp_restriction = UNSUPPORTED.into();
            cap.skill_mount = UNSUPPORTED.into();
            cap.evidence.push("该引擎适配器未提供独立指令/MCP/记忆隔离通道，首期标记为不支持".into());
        }
        m.insert(engine.into(), cap);
    }
    m
}

pub fn load_matrix(conn: &Connection) -> CResult<CapabilityMatrix> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![CAPABILITY_MATRIX_KEY],
            |r| r.get(0),
        )
        .optional()?;
    let mut base = default_matrix();
    if let Some(raw) = raw {
        if let Ok(stored) = serde_json::from_str::<CapabilityMatrix>(&raw) {
            for (k, v) in stored {
                base.insert(k, v);
            }
        }
    }
    Ok(base)
}

pub fn save_matrix(conn: &Connection, matrix: &CapabilityMatrix) -> CResult<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![CAPABILITY_MATRIX_KEY, serde_json::to_string(matrix)?],
    )?;
    Ok(())
}

/// W0 probe for Claude Code: derives capabilities from the flags the installed CLI actually accepts.
pub fn claude_capability_from_help(help: &str, version: &str) -> EngineCapability {
    let has = |flag: &str| help.contains(flag);
    let mut cap = EngineCapability {
        engine_id: "claude".into(),
        probed_at: Some(now_ms()),
        ..Default::default()
    };
    let mut ev = vec![format!("claude --version: {}", version.trim())];
    let mark = |ok: bool| if ok { VERIFIED.to_string() } else { UNSUPPORTED.to_string() };
    cap.independent_instructions = mark(has("--append-system-prompt"));
    ev.push(format!("--append-system-prompt: {}", has("--append-system-prompt")));
    cap.mcp_restriction = mark(has("--strict-mcp-config") && has("--mcp-config"));
    ev.push(format!(
        "--mcp-config + --strict-mcp-config: {}",
        has("--strict-mcp-config") && has("--mcp-config")
    ));
    // Excluding the `user` setting source drops user-level settings, CLAUDE.md memory and skills.
    cap.memory_isolation = mark(has("--setting-sources"));
    ev.push(format!("--setting-sources: {}", has("--setting-sources")));
    cap.skill_mount = mark(has("--setting-sources") && has("--add-dir"));
    ev.push(format!("--add-dir: {}", has("--add-dir")));
    cap.tool_allowlist = if has("--disallowedTools") || has("--disallowed-tools") {
        VERIFIED.into()
    } else {
        UNSUPPORTED.into()
    };
    cap.native_repo_rules = VERIFIED.into();
    ev.push("仓库 CLAUDE.md 属于 project 设置源，隔离模式下仍加载".into());
    cap.resume = mark(has("--resume"));
    cap.evidence = ev;
    cap
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RuleFileRef {
    pub path: String,
    pub hash: String,
    pub bytes: u64,
    pub scope: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestSkill {
    pub id: String,
    pub label: String,
    pub version: Option<String>,
    pub source_path: Option<String>,
    pub required: bool,
    pub source: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestMcp {
    pub server_id: String,
    pub label: String,
    pub tools: Vec<String>,
    pub credential_ref: Option<String>,
    pub source_path: Option<String>,
    pub required: bool,
    pub source: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ManifestKnowledge {
    pub resource_id: String,
    pub pinned_version: Option<i64>,
    pub label: String,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EffectiveConfigManifest {
    pub agent_id: String,
    pub agent_name: String,
    pub agent_status: String,
    pub profile_revision: i64,
    pub active_revision: i64,
    pub config_hash: String,
    pub auth_version: i64,
    pub engine_id: String,
    pub model: Option<String>,
    pub isolation: String,
    pub project_id: Option<String>,
    pub repository_id: Option<i64>,
    pub binding_id: Option<String>,
    pub access_scope: Option<String>,
    pub responsibility: Option<String>,
    pub soul_hash: String,
    pub soul_path: Option<String>,
    pub agents_md_hash: String,
    pub agents_md_path: Option<String>,
    pub repository_override_applied: bool,
    pub repository_agents_md_hash: Option<String>,
    pub repo_rules: Vec<RuleFileRef>,
    pub knowledge: Vec<ManifestKnowledge>,
    pub memory_policy: Value,
    pub memory_refs: Vec<Value>,
    pub skills: Vec<ManifestSkill>,
    pub mcps: Vec<ManifestMcp>,
    pub capabilities: EngineCapability,
    pub blocked: bool,
    pub block_reasons: Vec<String>,
    pub degradations: Vec<String>,
    pub resolved_at: i64,
}

#[derive(Debug, Clone, Default)]
pub struct ResolveInput<'a> {
    pub agent_id: &'a str,
    pub revision: Option<i64>,
    pub project_id: Option<&'a str>,
    pub repository_id: Option<i64>,
    pub repository_path: Option<&'a str>,
    pub known_mcp_server_ids: Option<&'a [String]>,
    /// For viewing effective config; execution paths also require an enabled agent.
    pub require_enabled: bool,
}

pub fn agent_config_root() -> Option<PathBuf> {
    crate::wise_dir().ok().map(|d| d.join("repository-agents"))
}

pub fn revision_dir(agent_id: &str, revision: i64) -> Option<PathBuf> {
    agent_config_root().map(|root| root.join(agent_id).join(format!("r{revision}")))
}

/// Writes SOUL.md / AGENTS.md for a revision into the Wise-managed directory (never into repos).
pub fn materialize_revision_files(agent_id: &str, revision: i64, config: &AgentConfig) -> Result<(PathBuf, PathBuf), String> {
    let dir = revision_dir(agent_id, revision).ok_or("无法解析 ~/.wise 目录")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let soul = dir.join("SOUL.md");
    let agents = dir.join("AGENTS.md");
    crate::wise_paths::write_file_atomic(&soul, &config.soul_md)?;
    crate::wise_paths::write_file_atomic(&agents, &config.agents_md)?;
    Ok((soul, agents))
}

fn scan_repo_rules(repo_path: &str) -> Vec<RuleFileRef> {
    let mut out = Vec::new();
    for rel in ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md"] {
        let p = Path::new(repo_path).join(rel);
        if let Ok(content) = std::fs::read_to_string(&p) {
            out.push(RuleFileRef {
                path: p.to_string_lossy().into_owned(),
                hash: sha256_hex(&content),
                bytes: content.len() as u64,
                scope: "repository".into(),
            });
        }
    }
    out
}

fn skill_to_manifest(s: &SkillBinding, source: &str) -> ManifestSkill {
    ManifestSkill {
        id: s.id.trim().to_string(),
        label: if s.label.trim().is_empty() { s.id.clone() } else { s.label.clone() },
        version: s.version.clone(),
        source_path: s.source_path.clone().filter(|p| !p.trim().is_empty()),
        required: s.required,
        source: source.into(),
        status: "active".into(),
        reason: None,
    }
}

fn mcp_to_manifest(m: &McpBinding, source: &str) -> ManifestMcp {
    ManifestMcp {
        server_id: m.server_id.trim().to_string(),
        label: if m.label.trim().is_empty() { m.server_id.clone() } else { m.label.clone() },
        tools: m.tools.clone(),
        credential_ref: m.credential_ref.clone(),
        source_path: m.source_path.clone().filter(|p| !p.trim().is_empty()),
        required: m.required,
        source: source.into(),
        status: "active".into(),
        reason: None,
    }
}

fn apply_requirement(
    required: bool,
    reason: String,
    status_on_block: &str,
    item_status: &mut String,
    item_reason: &mut Option<String>,
    blocked: &mut Vec<String>,
    degraded: &mut Vec<String>,
) {
    *item_reason = Some(reason.clone());
    if required {
        *item_status = status_on_block.into();
        blocked.push(reason);
    } else {
        *item_status = "degraded".into();
        degraded.push(reason);
    }
}

pub fn resolve(conn: &Connection, input: &ResolveInput<'_>, matrix: &CapabilityMatrix) -> CResult<EffectiveConfigManifest> {
    let profile = agents::get_agent(conn, input.agent_id)?;
    let mut blocked: Vec<String> = Vec::new();
    let mut degraded: Vec<String> = Vec::new();
    if input.require_enabled && profile.status != "enabled" {
        blocked.push(format!("智能体「{}」当前状态为 {}，不接受新执行", profile.name, profile.status));
    }
    let revision = input.revision.unwrap_or(profile.active_revision);
    if revision <= 0 {
        blocked.push("智能体尚未发布配置版本".into());
        return Ok(EffectiveConfigManifest {
            agent_id: profile.id.clone(),
            agent_name: profile.name.clone(),
            agent_status: profile.status.clone(),
            blocked: true,
            block_reasons: blocked,
            resolved_at: now_ms(),
            ..Default::default()
        });
    }
    let locked = agents::get_revision(conn, input.agent_id, revision)?;
    let active_config = if profile.active_revision > 0 && profile.active_revision != revision {
        Some(agents::get_revision(conn, input.agent_id, profile.active_revision)?.config)
    } else {
        None
    };
    let config = &locked.config;

    let binding = match input.repository_id {
        Some(repo) => {
            let b = agents::find_binding(conn, input.agent_id, input.project_id, repo)?;
            if b.is_none() {
                blocked.push(format!("仓库 #{repo} 未绑定到该智能体或已解绑"));
            }
            b
        }
        None => None,
    };
    let ov = binding.as_ref().map(|b| b.override_cfg.clone()).unwrap_or_default();

    // Knowledge: base refs + repository-specific refs (repository pin wins).
    let mut knowledge: Vec<ManifestKnowledge> = Vec::new();
    let mut push_k = |k: &KnowledgeRef, source: &str| {
        if let Some(existing) = knowledge.iter_mut().find(|e| e.resource_id == k.resource_id) {
            existing.pinned_version = k.pinned_version.or(existing.pinned_version);
            existing.source = source.into();
        } else {
            knowledge.push(ManifestKnowledge {
                resource_id: k.resource_id.clone(),
                pinned_version: k.pinned_version,
                label: k.label.clone(),
                source: source.into(),
            });
        }
    };
    for k in &config.knowledge_refs {
        push_k(k, "base");
    }
    for k in &ov.knowledge_refs {
        push_k(k, "repository");
    }

    // Skills: base (filtered by applicable repositories) + repository enable − disable (disable wins).
    let mut skills: Vec<ManifestSkill> = Vec::new();
    for s in &config.skill_bindings {
        let applies = s.repository_ids.is_empty()
            || input.repository_id.map_or(true, |r| s.repository_ids.contains(&r));
        if applies {
            skills.push(skill_to_manifest(s, "base"));
        }
    }
    for s in &ov.skills_enable {
        if let Some(existing) = skills.iter_mut().find(|e| e.id == s.id.trim()) {
            *existing = skill_to_manifest(s, "repository");
        } else {
            skills.push(skill_to_manifest(s, "repository"));
        }
    }
    for s in skills.iter_mut() {
        if ov.skills_disable.iter().any(|d| d.trim() == s.id) {
            s.status = "disabled".into();
            s.source = "repository".into();
            s.reason = Some("仓库专用配置已禁用".into());
        }
    }

    let mut mcps: Vec<ManifestMcp> = Vec::new();
    for m in &config.mcp_bindings {
        mcps.push(mcp_to_manifest(m, "base"));
    }
    for m in &ov.mcps_enable {
        if let Some(existing) = mcps.iter_mut().find(|e| e.server_id == m.server_id.trim()) {
            *existing = mcp_to_manifest(m, "repository");
        } else {
            mcps.push(mcp_to_manifest(m, "repository"));
        }
    }
    for m in mcps.iter_mut() {
        if ov.mcps_disable.iter().any(|d| d.trim() == m.server_id) {
            m.status = "disabled".into();
            m.source = "repository".into();
            m.reason = Some("仓库专用配置已禁用".into());
        }
    }

    // Revocation beats the locked snapshot: anything removed from the current revision is gone now.
    if let Some(active) = active_config.as_ref() {
        for s in skills.iter_mut().filter(|s| s.status == "active") {
            if !active.skill_bindings.iter().any(|a| a.id.trim() == s.id) {
                s.status = "revoked".into();
                s.reason = Some("当前配置已移除该技能，撤销即时生效".into());
            }
        }
        for m in mcps.iter_mut().filter(|m| m.status == "active") {
            match active.mcp_bindings.iter().find(|a| a.server_id.trim() == m.server_id) {
                None => {
                    m.status = "revoked".into();
                    m.reason = Some("当前配置已移除该 MCP，撤销即时生效".into());
                }
                Some(a) if !a.tools.is_empty() => {
                    let narrowed: Vec<String> = if m.tools.is_empty() {
                        a.tools.clone()
                    } else {
                        m.tools.iter().filter(|t| a.tools.contains(t)).cloned().collect()
                    };
                    if narrowed != m.tools {
                        m.tools = narrowed;
                        m.reason = Some("工具授权已按当前配置收窄".into());
                    }
                }
                _ => {}
            }
        }
    }

    let cap = matrix
        .get(&config.engine_id)
        .cloned()
        .unwrap_or_else(|| EngineCapability {
            engine_id: config.engine_id.clone(),
            independent_instructions: UNSUPPORTED.into(),
            memory_isolation: UNSUPPORTED.into(),
            mcp_restriction: UNSUPPORTED.into(),
            skill_mount: UNSUPPORTED.into(),
            evidence: vec!["未知执行引擎".into()],
            ..Default::default()
        });
    let strict = config.run_policy.isolation != "best_effort";

    for s in skills.iter_mut().filter(|s| s.status == "active") {
        if let Some(p) = s.source_path.as_deref() {
            if !Path::new(p).exists() {
                let reason = format!("技能「{}」的来源文件不存在：{p}", s.label);
                let (mut st, mut rs) = (s.status.clone(), s.reason.clone());
                apply_requirement(s.required, reason, "blocked", &mut st, &mut rs, &mut blocked, &mut degraded);
                s.status = st;
                s.reason = rs;
                continue;
            }
        }
        if cap.skill_mount != VERIFIED {
            let reason = format!("引擎 {} 无法独立挂载技能「{}」（{}）", cap.engine_id, s.label, cap.skill_mount);
            let (mut st, mut rs) = (s.status.clone(), s.reason.clone());
            apply_requirement(s.required || strict, reason, "blocked", &mut st, &mut rs, &mut blocked, &mut degraded);
            s.status = st;
            s.reason = rs;
        }
    }
    for m in mcps.iter_mut().filter(|m| m.status == "active") {
        if let Some(known) = input.known_mcp_server_ids {
            if m.source_path.is_none() && !known.iter().any(|k| k == &m.server_id) {
                let reason = format!("MCP「{}」在 MCP Hub 中不存在或未连接", m.label);
                let (mut st, mut rs) = (m.status.clone(), m.reason.clone());
                apply_requirement(m.required, reason, "blocked", &mut st, &mut rs, &mut blocked, &mut degraded);
                m.status = st;
                m.reason = rs;
                continue;
            }
        }
        if !m.tools.is_empty() && cap.tool_allowlist != VERIFIED {
            degraded.push(format!("MCP「{}」的工具白名单仅作权限层记录（引擎未验证工具级隔离）", m.label));
        }
    }

    if cap.independent_instructions != VERIFIED {
        let reason = format!(
            "引擎 {} 无法通过独立指令通道挂载 SOUL/AGENTS.md（{}）",
            cap.engine_id, cap.independent_instructions
        );
        if strict { blocked.push(reason) } else { degraded.push(reason) }
    }
    if cap.memory_isolation != VERIFIED {
        let reason = format!(
            "引擎 {} 会隐式读取用户级记忆/规则，无法落实记忆隔离（{}）",
            cap.engine_id, cap.memory_isolation
        );
        if strict { blocked.push(reason) } else { degraded.push(reason) }
    }
    if cap.mcp_restriction != VERIFIED {
        let reason = format!(
            "引擎 {} 无法关闭隐式 MCP 继承（{}）",
            cap.engine_id, cap.mcp_restriction
        );
        let any_mcp = mcps.iter().any(|m| m.status == "active");
        if strict || (any_mcp && mcps.iter().any(|m| m.required)) {
            blocked.push(reason)
        } else {
            degraded.push(reason)
        }
    }

    let repo_rules = input.repository_path.map(scan_repo_rules).unwrap_or_default();
    let dir = revision_dir(&profile.id, revision);
    let repo_agents_md = ov.agents_md.as_deref().map(str::trim).filter(|s| !s.is_empty());

    Ok(EffectiveConfigManifest {
        agent_id: profile.id.clone(),
        agent_name: profile.name.clone(),
        agent_status: profile.status.clone(),
        profile_revision: revision,
        active_revision: profile.active_revision,
        config_hash: locked.config_hash.clone(),
        auth_version: profile.auth_version,
        engine_id: config.engine_id.clone(),
        model: config.model.clone(),
        isolation: config.run_policy.isolation.clone(),
        project_id: binding.as_ref().map(|b| b.project_id.clone()).or(input.project_id.map(str::to_string)),
        repository_id: input.repository_id,
        binding_id: binding.as_ref().map(|b| b.id.clone()),
        access_scope: binding.as_ref().map(|b| b.access_scope.clone()),
        responsibility: binding.as_ref().map(|b| b.responsibility.clone()),
        soul_hash: sha256_hex(&config.soul_md),
        soul_path: dir.as_ref().map(|d| d.join("SOUL.md").to_string_lossy().into_owned()),
        agents_md_hash: sha256_hex(&config.agents_md),
        agents_md_path: dir.as_ref().map(|d| d.join("AGENTS.md").to_string_lossy().into_owned()),
        repository_override_applied: !ov.is_empty(),
        repository_agents_md_hash: repo_agents_md.map(sha256_hex),
        repo_rules,
        knowledge,
        memory_policy: serde_json::to_value(&config.memory_policy)?,
        memory_refs: Vec::new(),
        skills,
        mcps,
        capabilities: cap,
        blocked: !blocked.is_empty(),
        block_reasons: blocked,
        degradations: degraded,
        resolved_at: now_ms(),
    })
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SpawnConfig {
    pub engine_id: String,
    pub model: Option<String>,
    pub append_system_prompt: String,
    pub mcp_server_keys: Vec<String>,
    pub mcp_extra_config_paths: Vec<String>,
    pub strict_mcp_config: bool,
    pub setting_sources: Option<String>,
    pub allowed_tools: Option<String>,
    pub disallowed_tools: Option<String>,
    pub add_dirs: Vec<String>,
    pub read_only: bool,
}

pub const READ_ONLY_DISALLOWED_TOOLS: &str = "Edit,Write,MultiEdit,NotebookEdit";

/// Builds the engine launch config; the system prompt carries SOUL/AGENTS.md, never the repo files.
pub fn spawn_config(conn: &Connection, manifest: &EffectiveConfigManifest, read_only: bool, add_dirs: Vec<String>) -> CResult<SpawnConfig> {
    let config = if manifest.profile_revision > 0 {
        agents::get_revision(conn, &manifest.agent_id, manifest.profile_revision)?.config
    } else {
        AgentConfig::default()
    };
    let override_md = match manifest.binding_id.as_deref() {
        Some(b) => agents::get_binding(conn, b)?.override_cfg.agents_md.unwrap_or_default(),
        None => String::new(),
    };
    let mut prompt = String::new();
    prompt.push_str(&format!("# 智能体身份：{}\n\n", manifest.agent_name));
    if !config.soul_md.trim().is_empty() {
        prompt.push_str("## 灵魂设定（SOUL.md）\n\n");
        prompt.push_str(config.soul_md.trim());
        prompt.push_str("\n\n");
    }
    if !config.agents_md.trim().is_empty() {
        prompt.push_str("## 智能体工作规则（AGENTS.md）\n\n以下规则补充目标仓库原生规则；与仓库强制工程约束冲突时以仓库规则为准，并提交决策。\n\n");
        prompt.push_str(config.agents_md.trim());
        prompt.push_str("\n\n");
    }
    if !override_md.trim().is_empty() {
        prompt.push_str("## 本仓库专用规则\n\n");
        prompt.push_str(override_md.trim());
        prompt.push_str("\n\n");
    }
    let active_skills: Vec<&ManifestSkill> = manifest
        .skills
        .iter()
        .filter(|s| s.status == "active")
        .collect();
    let mut dirs = add_dirs;
    if !active_skills.is_empty() {
        prompt.push_str("## 已启用技能\n\n需要时先阅读对应 SKILL.md 再执行：\n\n");
        for s in &active_skills {
            match s.source_path.as_deref() {
                Some(p) => {
                    prompt.push_str(&format!("- {}（{}）：{}\n", s.label, s.id, p));
                    if let Some(parent) = Path::new(p).parent() {
                        let parent = parent.to_string_lossy().into_owned();
                        if !dirs.contains(&parent) {
                            dirs.push(parent);
                        }
                    }
                }
                None => prompt.push_str(&format!("- {}（{}）\n", s.label, s.id)),
            }
        }
        prompt.push('\n');
    }
    let active_mcps: Vec<&ManifestMcp> = manifest.mcps.iter().filter(|m| m.status == "active").collect();
    let allowed_tools: Vec<String> = active_mcps
        .iter()
        .flat_map(|m| m.tools.iter().map(move |t| format!("mcp__{}__{}", m.server_id, t)))
        .collect();
    let caps = &manifest.capabilities;
    Ok(SpawnConfig {
        engine_id: manifest.engine_id.clone(),
        model: manifest.model.clone(),
        append_system_prompt: prompt.trim().to_string(),
        mcp_server_keys: active_mcps.iter().filter(|m| m.source_path.is_none()).map(|m| m.server_id.clone()).collect(),
        mcp_extra_config_paths: active_mcps.iter().filter_map(|m| m.source_path.clone()).collect(),
        strict_mcp_config: caps.mcp_restriction == VERIFIED,
        setting_sources: if caps.memory_isolation == VERIFIED {
            Some("project,local".into())
        } else {
            None
        },
        allowed_tools: if allowed_tools.is_empty() { None } else { Some(allowed_tools.join(",")) },
        disallowed_tools: if read_only { Some(READ_ONLY_DISALLOWED_TOOLS.into()) } else { None },
        add_dirs: dirs,
        read_only,
    })
}

/// "检查配置": readable/writable bindings, rules, capability isolation. Never touches business files.
pub fn check_agent(
    conn: &Connection,
    agent_id: &str,
    repos: &super::RepoDirectory,
    known_mcp_server_ids: Option<&[String]>,
    matrix: &CapabilityMatrix,
) -> CResult<(Value, bool)> {
    let profile = agents::get_agent(conn, agent_id)?;
    let mut items: Vec<Value> = Vec::new();
    let mut blocking = 0;
    let mut add = |level: &str, label: String, detail: String| {
        items.push(json!({ "level": level, "label": label, "detail": detail }));
    };
    if profile.active_revision == 0 {
        add("blocking", "配置版本".into(), "尚未发布配置版本，请先发布".into());
        blocking += 1;
    } else if profile.has_unpublished_changes {
        add("warning", "配置版本".into(), "存在未发布的草稿修改；检查针对当前生效版本".into());
    }
    let bindings = agents::list_bindings(conn, agent_id, false)?;
    if bindings.is_empty() {
        add("blocking", "绑定仓库".into(), "至少绑定一个仓库".into());
        blocking += 1;
    }
    for b in &bindings {
        let Some(repo) = repos.get(&b.repository_id) else {
            add("blocking", format!("仓库 #{}", b.repository_id), "仓库已不在 Wise 仓库列表中".into());
            blocking += 1;
            continue;
        };
        let path = Path::new(&repo.path);
        let meta = std::fs::metadata(path);
        match meta {
            Err(_) => {
                add("blocking", repo.name.clone(), format!("目录不可访问：{}", repo.path));
                blocking += 1;
                continue;
            }
            Ok(m) => {
                if b.access_scope == "read_write" && m.permissions().readonly() {
                    add("blocking", repo.name.clone(), "目录只读，但绑定要求读写".into());
                    blocking += 1;
                } else {
                    add("ok", repo.name.clone(), format!("可访问（{}）", if b.access_scope == "read" { "只读" } else { "读写" }));
                }
            }
        }
        if !agents::repository_in_project(conn, &b.project_id, b.repository_id)? {
            add("blocking", repo.name.clone(), "仓库已不属于绑定的责任项目".into());
            blocking += 1;
        }
        if profile.active_revision > 0 {
            let manifest = resolve(
                conn,
                &ResolveInput {
                    agent_id,
                    revision: None,
                    project_id: Some(&b.project_id),
                    repository_id: Some(b.repository_id),
                    repository_path: Some(&repo.path),
                    known_mcp_server_ids,
                    require_enabled: false,
                },
                matrix,
            )?;
            let rules: Vec<String> = manifest.repo_rules.iter().map(|r| r.path.clone()).collect();
            add(
                "ok",
                format!("{} 适用规则", repo.name),
                if rules.is_empty() { "未发现仓库原生规则文件".into() } else { rules.join("、") },
            );
            for reason in &manifest.block_reasons {
                add("blocking", format!("{} 能力", repo.name), reason.clone());
                blocking += 1;
            }
            for reason in &manifest.degradations {
                add("warning", format!("{} 降级", repo.name), reason.clone());
            }
        }
    }
    let passed = blocking == 0;
    let report = json!({
        "passed": passed,
        "revision": profile.active_revision,
        "checkedAt": now_ms(),
        "items": items,
    });
    Ok((report, passed))
}
