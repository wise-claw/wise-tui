use crate::wise_db;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Command;
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(30);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

type ProbeFuture<'a> = Pin<Box<dyn Future<Output = ProbeResult> + Send + 'a>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntheticAgent {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub backend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    pub detected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub backend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    pub detected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DetectedAgent {
    Claude(SyntheticAgent),
    Codex(SyntheticAgent),
    Gemini(SyntheticAgent),
    Custom(CustomAgent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
}

pub trait Probe: Send + Sync {
    fn probe<'a>(&'a self, command: &'a str, env: &'a HashMap<String, String>) -> ProbeFuture<'a>;
}

#[derive(Debug, Default)]
pub struct OsProbe;

#[derive(Debug, Clone)]
pub(crate) struct CustomAgentRecord {
    id: String,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct RegistryState {
    agents: Vec<DetectedAgent>,
    last_probed_at: Option<Instant>,
}

pub struct AgentRegistry {
    state: RwLock<RegistryState>,
}

impl AgentRegistry {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(RegistryState {
                agents: Vec::new(),
                last_probed_at: None,
            }),
        }
    }

    pub fn snapshot(&self) -> Result<Vec<DetectedAgent>, String> {
        let guard = self
            .state
            .read()
            .map_err(|_| "agent registry lock poisoned".to_string())?;
        Ok(guard.agents.clone())
    }

    pub fn get(&self, id: &str) -> Result<Option<DetectedAgent>, String> {
        Ok(self
            .snapshot()?
            .into_iter()
            .find(|agent| agent.id() == id))
    }

    pub async fn refresh_all(
        &self,
        force: bool,
        db: &Mutex<Connection>,
        probe: &dyn Probe,
    ) -> Result<Vec<DetectedAgent>, String> {
        if let Some(cached) = self.cached_snapshot(force)? {
            return Ok(cached);
        }

        let custom_records = load_custom_agents(db)?;
        let mut agents = detect_builtin_agents(probe).await;
        agents.extend(detect_custom_agents(custom_records, probe).await);
        let agents = deduplicate_agents(agents);
        self.replace_agents(agents)
    }

    #[allow(dead_code)]
    pub async fn refresh_builtin(
        &self,
        force: bool,
        probe: &dyn Probe,
    ) -> Result<Vec<DetectedAgent>, String> {
        if let Some(cached) = self.cached_snapshot(force)? {
            return Ok(cached);
        }

        let mut agents = detect_builtin_agents(probe).await;
        agents.extend(
            self.snapshot()?
                .into_iter()
                .filter(|agent| matches!(agent, DetectedAgent::Custom(_))),
        );
        let agents = deduplicate_agents(agents);
        self.replace_agents(agents)
    }

    pub async fn refresh_custom(
        &self,
        force: bool,
        db: &Mutex<Connection>,
        probe: &dyn Probe,
    ) -> Result<Vec<DetectedAgent>, String> {
        if let Some(cached) = self.cached_snapshot(force)? {
            return Ok(cached);
        }

        let custom_records = load_custom_agents(db)?;
        let mut agents: Vec<DetectedAgent> = self
            .snapshot()?
            .into_iter()
            .filter(|agent| !matches!(agent, DetectedAgent::Custom(_)))
            .collect();
        if agents.is_empty() {
            agents = detect_builtin_agents(probe).await;
        }
        agents.extend(detect_custom_agents(custom_records, probe).await);
        let agents = deduplicate_agents(agents);
        self.replace_agents(agents)
    }

    fn cached_snapshot(&self, force: bool) -> Result<Option<Vec<DetectedAgent>>, String> {
        if force {
            return Ok(None);
        }
        let guard = self
            .state
            .read()
            .map_err(|_| "agent registry lock poisoned".to_string())?;
        let fresh = guard
            .last_probed_at
            .map(|last| last.elapsed() < CACHE_TTL)
            .unwrap_or(false);
        if fresh && !guard.agents.is_empty() {
            return Ok(Some(guard.agents.clone()));
        }
        Ok(None)
    }

    fn replace_agents(&self, agents: Vec<DetectedAgent>) -> Result<Vec<DetectedAgent>, String> {
        let mut guard = self
            .state
            .write()
            .map_err(|_| "agent registry lock poisoned".to_string())?;
        guard.agents = agents;
        guard.last_probed_at = Some(Instant::now());
        Ok(guard.agents.clone())
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Probe for OsProbe {
    fn probe<'a>(&'a self, command: &'a str, env: &'a HashMap<String, String>) -> ProbeFuture<'a> {
        // Probes run in the Rust process via tokio::process, so renderer plugin-shell capabilities do not gate them.
        Box::pin(async move { resolve_command(command, env).await })
    }
}

impl DetectedAgent {
    fn id(&self) -> &str {
        match self {
            DetectedAgent::Claude(agent)
            | DetectedAgent::Codex(agent)
            | DetectedAgent::Gemini(agent) => &agent.id,
            DetectedAgent::Custom(agent) => &agent.id,
        }
    }

    fn name(&self) -> &str {
        match self {
            DetectedAgent::Claude(agent)
            | DetectedAgent::Codex(agent)
            | DetectedAgent::Gemini(agent) => &agent.name,
            DetectedAgent::Custom(agent) => &agent.name,
        }
    }

    fn is_available(&self) -> bool {
        match self {
            DetectedAgent::Claude(agent)
            | DetectedAgent::Codex(agent)
            | DetectedAgent::Gemini(agent) => agent.available,
            DetectedAgent::Custom(agent) => agent.available,
        }
    }

    fn backend(&self) -> &str {
        match self {
            DetectedAgent::Claude(agent)
            | DetectedAgent::Codex(agent)
            | DetectedAgent::Gemini(agent) => &agent.backend,
            DetectedAgent::Custom(agent) => &agent.backend,
        }
    }

    fn dedupe_key(&self) -> String {
        match self {
            DetectedAgent::Custom(_) => self.id().to_string(),
            _ => self.backend().to_string(),
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn deduplicate_agents(agents: Vec<DetectedAgent>) -> Vec<DetectedAgent> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for agent in agents {
        if seen.insert(agent.dedupe_key()) {
            out.push(agent);
        }
    }
    out
}

async fn detect_builtin_agents(probe: &dyn Probe) -> Vec<DetectedAgent> {
    let specs = [
        ("claude", "Claude Code", "claude"),
        ("codex", "Codex CLI", "codex"),
        ("gemini", "Gemini CLI", "gemini"),
    ];
    let empty_env = HashMap::new();
    let mut out = Vec::with_capacity(specs.len());
    for (kind, name, command) in specs {
        let result = probe_builtin(command, probe, &empty_env).await;
        let agent = synthetic_agent(kind, name, command, result);
        out.push(match kind {
            "claude" => DetectedAgent::Claude(agent),
            "codex" => DetectedAgent::Codex(agent),
            "gemini" => DetectedAgent::Gemini(agent),
            _ => unreachable!("builtin agent kind is fixed"),
        });
    }
    out
}

async fn detect_custom_agents(
    records: Vec<CustomAgentRecord>,
    probe: &dyn Probe,
) -> Vec<DetectedAgent> {
    let mut out = Vec::with_capacity(records.len());
    for record in records {
        let result = probe.probe(&record.command, &record.env).await;
        out.push(DetectedAgent::Custom(custom_agent(record, result)));
    }
    out
}

async fn probe_builtin(
    command: &str,
    probe: &dyn Probe,
    env: &HashMap<String, String>,
) -> ProbeResult {
    let first = probe.probe(command, env).await;
    if first.ok || command != "claude" {
        return first;
    }

    let fallback = dirs::home_dir().map(|home| home.join(".claude/local/claude"));
    match fallback {
        Some(path) if path.is_file() => {
            let fallback_command = path.to_string_lossy().to_string();
            let fallback_result = probe.probe(&fallback_command, env).await;
            if fallback_result.ok {
                fallback_result
            } else {
                ProbeResult {
                    ok: false,
                    error: Some(format!(
                        "{}; fallback {} failed",
                        first
                            .error
                            .unwrap_or_else(|| "binary not found on PATH".to_string()),
                        fallback_command
                    )),
                    resolved_path: None,
                }
            }
        }
        _ => ProbeResult {
            ok: false,
            error: Some(format!(
                "{}; fallback ~/.claude/local/claude not found",
                first
                    .error
                    .unwrap_or_else(|| "binary not found on PATH".to_string())
            )),
            resolved_path: None,
        },
    }
}

fn synthetic_agent(kind: &str, name: &str, command: &str, result: ProbeResult) -> SyntheticAgent {
    SyntheticAgent {
        id: kind.to_string(),
        name: name.to_string(),
        available: result.ok,
        backend: kind.to_string(),
        binary_path: result.resolved_path,
        detected_at: now_iso(),
        failure_reason: if result.ok {
            None
        } else {
            Some(
                result
                    .error
                    .unwrap_or_else(|| "binary not found on PATH".to_string()),
            )
        },
        command: command.to_string(),
    }
}

fn custom_agent(record: CustomAgentRecord, result: ProbeResult) -> CustomAgent {
    CustomAgent {
        id: format!("custom:{}", record.id),
        name: record.name,
        available: result.ok,
        backend: "custom".to_string(),
        binary_path: result.resolved_path,
        detected_at: now_iso(),
        failure_reason: if result.ok {
            None
        } else {
            Some(
                result
                    .error
                    .unwrap_or_else(|| "binary not found on PATH".to_string()),
            )
        },
        command: record.command,
        args: record.args,
        env: record.env,
    }
}

async fn resolve_command(command: &str, env: &HashMap<String, String>) -> ProbeResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return ProbeResult {
            ok: false,
            error: Some("command is required".to_string()),
            resolved_path: None,
        };
    }

    if looks_like_path(trimmed) {
        let path = Path::new(trimmed);
        if path.is_file() {
            return ProbeResult {
                ok: true,
                error: None,
                resolved_path: Some(path.to_string_lossy().to_string()),
            };
        }
        return ProbeResult {
            ok: false,
            error: Some("binary path does not exist".to_string()),
            resolved_path: None,
        };
    }

    let resolver = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = tokio::process::Command::new(resolver);
    cmd.kill_on_drop(true);
    cmd.arg(trimmed);
    cmd.env("PATH", merge_path_env(env));
    for (key, value) in env {
        cmd.env(key, value);
    }

    match tokio::time::timeout(PROBE_TIMEOUT, cmd.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string);
            match path {
                Some(path) => {
                    if is_runnable_binary(Path::new(&path)) {
                        ProbeResult {
                            ok: true,
                            error: None,
                            resolved_path: Some(path),
                        }
                    } else if Path::new(&path).is_symlink() {
                        ProbeResult {
                            ok: false,
                            error: Some(format!(
                                "binary symlink is broken: {path}（请删除后重新安装）"
                            )),
                            resolved_path: Some(path),
                        }
                    } else {
                        ProbeResult {
                            ok: false,
                            error: Some(format!("binary not executable or missing: {path}")),
                            resolved_path: Some(path),
                        }
                    }
                }
                None => ProbeResult {
                    ok: false,
                    error: Some("resolver returned no path".to_string()),
                    resolved_path: None,
                },
            }
        }
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            ProbeResult {
                ok: false,
                error: Some(if stderr.is_empty() {
                    "binary not found on PATH".to_string()
                } else {
                    stderr
                }),
                resolved_path: None,
            }
        }
        Ok(Err(error)) => ProbeResult {
            ok: false,
            error: Some(error.to_string()),
            resolved_path: None,
        },
        Err(_) => ProbeResult {
            ok: false,
            error: Some("probe timed out after 2s".to_string()),
            resolved_path: None,
        },
    }
}

fn looks_like_path(command: &str) -> bool {
    let path = Path::new(command);
    path.is_absolute() || command.contains('/') || command.contains('\\')
}

fn is_runnable_binary(path: &Path) -> bool {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                meta.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                true
            }
        }
        _ => false,
    }
}

fn builtin_command_name(kind: &str) -> Option<&'static str> {
    match kind.trim().to_lowercase().as_str() {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        _ => None,
    }
}

/// Remove broken symlinks on PATH that block `npm install -g` from linking the CLI bin.
fn clear_blocking_broken_bins(command: &str, path_env: &str) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    let separator = path_env_separator();
    for dir in path_env.split(separator) {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(trimmed).join(command);
        if !candidate.is_symlink() {
            continue;
        }
        if std::fs::symlink_metadata(&candidate).is_ok() && std::fs::metadata(&candidate).is_err() {
            std::fs::remove_file(&candidate).map_err(|e| {
                format!(
                    "无法移除损坏的符号链接 {}: {e}",
                    candidate.to_string_lossy()
                )
            })?;
            removed.push(candidate.to_string_lossy().to_string());
        }
    }
    Ok(removed)
}

fn path_search_prefixes() -> Vec<PathBuf> {
    let mut prefixes = Vec::new();
    #[cfg(not(windows))]
    {
        prefixes.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]);
    }
    #[cfg(windows)]
    {
        if let Some(home) = dirs::home_dir() {
            prefixes.push(home.join("AppData/Roaming/npm"));
            prefixes.push(home.join("AppData/Local/npm"));
        }
        prefixes.push(PathBuf::from(r"C:\Program Files\nodejs"));
        prefixes.push(PathBuf::from(r"C:\Program Files (x86)\nodejs"));
    }
    if let Some(home) = dirs::home_dir() {
        prefixes.push(home.join("bin"));
        prefixes.push(home.join(".local/bin"));
        prefixes.push(home.join(".volta/bin"));
        prefixes.push(home.join(".bun/bin"));
        prefixes.push(home.join(".npm-global/bin"));
        collect_node_version_bins(home.join(".nvm/versions/node"), &mut prefixes);
        if let Ok(nvm_dir) = std::env::var("NVM_DIR") {
            collect_node_version_bins(PathBuf::from(nvm_dir).join("versions/node"), &mut prefixes);
        }
        for base in [
            home.join(".local/share/fnm/node-versions"),
            home.join(".fnm/node-versions"),
        ] {
            if let Ok(entries) = std::fs::read_dir(base) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    prefixes.push(path.join("installation/bin"));
                    prefixes.push(path.join("bin"));
                }
            }
        }
    }
    prefixes
}

fn collect_node_version_bins(base: PathBuf, prefixes: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(base) {
        let mut nodes: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        nodes.sort_by(|a, b| b.cmp(a));
        for node_dir in nodes {
            prefixes.push(node_dir.join("bin"));
        }
    }
}

fn merge_path_env(extra_env: &HashMap<String, String>) -> String {
    let mut seen = HashSet::new();
    let mut parts = Vec::new();
    let separator = if cfg!(windows) { ';' } else { ':' };

    for path in path_search_prefixes() {
        let value = path.to_string_lossy().to_string();
        if path.is_dir() && seen.insert(value.clone()) {
            parts.push(value);
        }
    }

    if let Some(path_value) = extra_env.get("PATH") {
        push_path_parts(path_value, separator, &mut seen, &mut parts);
    }
    if let Ok(path_value) = std::env::var("PATH") {
        push_path_parts(&path_value, separator, &mut seen, &mut parts);
    }

    parts.join(if cfg!(windows) { ";" } else { ":" })
}

fn push_path_parts(
    path_value: &str,
    separator: char,
    seen: &mut HashSet<String>,
    parts: &mut Vec<String>,
) {
    for part in path_value.split(separator) {
        let trimmed = part.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            parts.push(trimmed.to_string());
        }
    }
}

fn normalize_custom_input(input: CustomAgentInput) -> Result<CustomAgentRecord, String> {
    let id = input
        .id
        .as_deref()
        .map(strip_custom_prefix)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("agent name is required".to_string());
    }
    let command = input.command.trim().to_string();
    if command.is_empty() {
        return Err("command is required".to_string());
    }
    let args = input
        .args
        .into_iter()
        .map(|arg| arg.trim().to_string())
        .filter(|arg| !arg.is_empty())
        .collect();
    let env = input
        .env
        .into_iter()
        .filter_map(|(key, value)| {
            let key = key.trim().to_string();
            if key.is_empty() {
                None
            } else {
                Some((key, value))
            }
        })
        .collect();

    Ok(CustomAgentRecord {
        id,
        name,
        command,
        args,
        env,
    })
}

fn strip_custom_prefix(id: &str) -> &str {
    id.strip_prefix("custom:").unwrap_or(id)
}

pub(crate) fn load_custom_agents(db: &Mutex<Connection>) -> Result<Vec<CustomAgentRecord>, String> {
    let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, command, args_json, env_json
             FROM agent_custom
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let args_json: String = row.get(3)?;
            let env_json: String = row.get(4)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                args_json,
                env_json,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (id, name, command, args_json, env_json) = row.map_err(|e| e.to_string())?;
        let args: Vec<String> = serde_json::from_str(&args_json)
            .map_err(|e| format!("invalid custom agent args JSON for {id}: {e}"))?;
        let env: HashMap<String, String> = serde_json::from_str(&env_json)
            .map_err(|e| format!("invalid custom agent env JSON for {id}: {e}"))?;
        out.push(CustomAgentRecord {
            id,
            name,
            command,
            args,
            env,
        });
    }
    Ok(out)
}

pub(crate) fn insert_custom_agent(
    db: &Mutex<Connection>,
    input: CustomAgentInput,
) -> Result<CustomAgentRecord, String> {
    let record = normalize_custom_input(input)?;
    let args_json = serde_json::to_string(&record.args).map_err(|e| e.to_string())?;
    let env_json = serde_json::to_string(&record.env).map_err(|e| e.to_string())?;
    let now = now_iso();
    let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute(
        "INSERT INTO agent_custom (id, name, command, args_json, env_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id)
         DO UPDATE SET
           name = excluded.name,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           updated_at = excluded.updated_at",
        params![
            record.id,
            record.name,
            record.command,
            args_json,
            env_json,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(record)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct BuiltinInstallSpec {
    npm_package: &'static str,
}

fn parse_builtin_install_kind(kind: &str) -> Result<BuiltinInstallSpec, String> {
    match kind.trim().to_lowercase().as_str() {
        "claude" => Ok(BuiltinInstallSpec {
            npm_package: "@anthropic-ai/claude-code",
        }),
        "codex" => Ok(BuiltinInstallSpec {
            npm_package: "@openai/codex",
        }),
        "gemini" => Ok(BuiltinInstallSpec {
            npm_package: "@google/gemini-cli",
        }),
        "" => Err("kind is required".to_string()),
        other => Err(format!("不支持一键安装的运行入口：{other}")),
    }
}

fn path_env_separator() -> char {
    if cfg!(windows) {
        ';'
    } else {
        ':'
    }
}

fn resolve_npm_binary(path_env: &str) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for dir in path_env.split(path_env_separator()) {
        let trimmed = dir.trim();
        if trimmed.is_empty() {
            continue;
        }
        candidates.push(PathBuf::from(trimmed).join(if cfg!(windows) {
            "npm.cmd"
        } else {
            "npm"
        }));
    }
    candidates.push(PathBuf::from(if cfg!(windows) { "npm.cmd" } else { "npm" }));

    for candidate in candidates {
        if candidate == PathBuf::from("npm") || candidate == PathBuf::from("npm.cmd") {
            if Command::new(&candidate)
                .arg("--version")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
            {
                return Ok(candidate);
            }
            continue;
        }
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(
        "未找到 npm。请先安装 Node.js（https://nodejs.org），并确保 npm 在 PATH 中。"
            .to_string(),
    )
}

fn run_npm_global_install(
    npm_bin: &Path,
    home: &str,
    path_env: &str,
    package: &str,
) -> Result<std::process::Output, String> {
    Command::new(npm_bin)
        .args(["install", "-g", package])
        .env("HOME", home)
        .env("PATH", path_env)
        .output()
        .map_err(|e| format!("执行 npm install -g {package} 失败: {e}"))
}

pub(crate) fn delete_custom_agent(db: &Mutex<Connection>, id: &str) -> Result<(), String> {
    let row_id = strip_custom_prefix(id.trim()).trim();
    if row_id.is_empty() {
        return Err("custom agent id is required".to_string());
    }
    let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
    conn.execute("DELETE FROM agent_custom WHERE id = ?1", params![row_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn agent_registry_install_builtin(
    kind: String,
    registry: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<DetectedAgent>, String> {
    let normalized_kind = kind.trim().to_lowercase();
    let spec = parse_builtin_install_kind(&normalized_kind)?;

    let snapshot = registry.snapshot()?;
    if let Some(agent) = snapshot.iter().find(|agent| agent.id() == normalized_kind) {
        if agent.is_available() {
            return Err(format!("{} 已就绪，无需重复安装", agent.name()));
        }
    }

    let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
    let home_s = home.to_string_lossy().to_string();
    let path_env =
        crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
    let package = spec.npm_package.to_string();
    let command_name = builtin_command_name(&normalized_kind)
        .ok_or_else(|| format!("无法解析 {} 对应的 CLI 命令名", normalized_kind))?;

    let install_output = tokio::task::spawn_blocking(move || {
        let npm = resolve_npm_binary(&path_env)?;
        let removed = clear_blocking_broken_bins(command_name, &path_env)?;
        let output = run_npm_global_install(&npm, &home_s, &path_env, &package)?;
        Ok::<_, String>((output, removed))
    })
    .await
    .map_err(|e| format!("安装任务被中断: {e}"))??;

    let (install_output, removed_bins) = install_output;
    let stdout = String::from_utf8_lossy(&install_output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&install_output.stderr).to_string();
    if !install_output.status.success() {
        let removed_hint = if removed_bins.is_empty() {
            String::new()
        } else {
            format!(
                "\n已自动移除损坏的符号链接：{}",
                removed_bins.join("、")
            )
        };
        let eexist_hint = if stderr.contains("EEXIST") {
            format!(
                "\n提示：PATH 上已有同名文件占用安装位置（常见于 Homebrew Cask 残留）。\
                 可手动执行 `rm <路径>` 删除旧链接后重试，或使用 `npm install -g {} --force`。{removed_hint}",
                spec.npm_package
            )
        } else {
            removed_hint
        };
        return Err(format!(
            "安装 {} 失败（退出码 {:?}）\n{stdout}\n{stderr}{eexist_hint}",
            spec.npm_package,
            install_output.status.code()
        ));
    }

    let probe = OsProbe;
    registry.refresh_all(true, &db.0, &probe).await
}

#[tauri::command]
pub async fn agent_registry_list(
    registry: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<DetectedAgent>, String> {
    let snapshot = registry.snapshot()?;
    if snapshot.is_empty() {
        let probe = OsProbe;
        return registry.refresh_all(false, &db.0, &probe).await;
    }
    Ok(snapshot)
}

#[tauri::command]
pub async fn agent_registry_refresh(
    force: bool,
    registry: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<DetectedAgent>, String> {
    let probe = OsProbe;
    registry.refresh_all(force, &db.0, &probe).await
}

#[tauri::command]
pub async fn agent_registry_get(
    id: String,
    registry: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<DetectedAgent>, String> {
    let probe = OsProbe;
    if registry.snapshot()?.is_empty() {
        registry.refresh_all(false, &db.0, &probe).await?;
    }
    registry.get(&id)
}

#[tauri::command]
pub async fn agent_registry_test_custom(
    id: Option<String>,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<ProbeResult, String> {
    let input = CustomAgentInput {
        id,
        name,
        command,
        args,
        env,
    };
    let record = normalize_custom_input(input)?;
    let probe = OsProbe;
    Ok(probe.probe(&record.command, &record.env).await)
}

#[tauri::command]
pub async fn agent_registry_save_custom(
    id: Option<String>,
    name: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    registry: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<DetectedAgent, String> {
    let input = CustomAgentInput {
        id,
        name,
        command,
        args,
        env,
    };
    let record = insert_custom_agent(&db.0, input)?;
    let id = format!("custom:{}", record.id);
    let probe = OsProbe;
    let agents = registry.refresh_all(true, &db.0, &probe).await?;
    agents
        .into_iter()
        .find(|agent| agent.id() == id)
        .ok_or_else(|| "saved custom agent was not found after refresh".to_string())
}

#[tauri::command]
pub async fn agent_registry_delete_custom(
    id: String,
    registry: tauri::State<'_, AgentRegistry>,
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<(), String> {
    delete_custom_agent(&db.0, &id)?;
    let probe = OsProbe;
    registry.refresh_custom(true, &db.0, &probe).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[derive(Clone)]
    struct MockProbe {
        calls: Arc<AtomicUsize>,
        default_ok: bool,
        failures: Arc<Mutex<HashSet<String>>>,
    }

    impl MockProbe {
        fn ok() -> Self {
            Self {
                calls: Arc::new(AtomicUsize::new(0)),
                default_ok: true,
                failures: Arc::new(Mutex::new(HashSet::new())),
            }
        }

        fn fail() -> Self {
            Self {
                calls: Arc::new(AtomicUsize::new(0)),
                default_ok: false,
                failures: Arc::new(Mutex::new(HashSet::new())),
            }
        }

        fn fail_command(&self, command: &str) {
            self.failures
                .lock()
                .expect("mock failures lock")
                .insert(command.to_string());
        }

        fn call_count(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl Probe for MockProbe {
        fn probe<'a>(
            &'a self,
            command: &'a str,
            _env: &'a HashMap<String, String>,
        ) -> ProbeFuture<'a> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                let forced_failure = self
                    .failures
                    .lock()
                    .expect("mock failures lock")
                    .contains(command);
                let ok = self.default_ok && !forced_failure;
                if ok {
                    ProbeResult {
                        ok: true,
                        error: None,
                        resolved_path: Some(format!("/mock/{command}")),
                    }
                } else {
                    ProbeResult {
                        ok: false,
                        error: Some(format!("{command} unavailable")),
                        resolved_path: None,
                    }
                }
            })
        }
    }

    fn test_db() -> Mutex<Connection> {
        let conn = Connection::open_in_memory().expect("in-memory sqlite opens");
        conn.execute_batch(include_str!("../migrations/023_agent_custom.sql"))
            .expect("agent custom table is created");
        Mutex::new(conn)
    }

    fn sample_synthetic(id: &str, backend: &str, command: &str) -> SyntheticAgent {
        SyntheticAgent {
            id: id.to_string(),
            name: id.to_string(),
            available: true,
            backend: backend.to_string(),
            binary_path: Some(format!("/mock/{command}")),
            detected_at: "2026-05-17T00:00:00.000Z".to_string(),
            failure_reason: None,
            command: command.to_string(),
        }
    }

    fn sample_custom(id: &str) -> CustomAgent {
        CustomAgent {
            id: id.to_string(),
            name: id.to_string(),
            available: true,
            backend: "custom".to_string(),
            binary_path: Some("/mock/custom".to_string()),
            detected_at: "2026-05-17T00:00:00.000Z".to_string(),
            failure_reason: None,
            command: "custom".to_string(),
            args: Vec::new(),
            env: HashMap::new(),
        }
    }

    #[test]
    fn parse_builtin_install_kind_accepts_builtin_kinds() {
        assert_eq!(
            parse_builtin_install_kind("claude").expect("claude"),
            BuiltinInstallSpec {
                npm_package: "@anthropic-ai/claude-code",
            }
        );
        assert_eq!(
            parse_builtin_install_kind("codex").expect("codex"),
            BuiltinInstallSpec {
                npm_package: "@openai/codex",
            }
        );
        assert_eq!(
            parse_builtin_install_kind("gemini").expect("gemini"),
            BuiltinInstallSpec {
                npm_package: "@google/gemini-cli",
            }
        );
    }

    #[test]
    fn parse_builtin_install_kind_rejects_custom_and_empty() {
        assert!(parse_builtin_install_kind("custom").is_err());
        assert!(parse_builtin_install_kind("").is_err());
    }

    #[test]
    fn clear_blocking_broken_bins_removes_only_broken_symlinks() {
        let temp = tempfile::tempdir().expect("tempdir");
        let bin_dir = temp.path().join("bin");
        std::fs::create_dir_all(&bin_dir).expect("mkdir");
        let broken = bin_dir.join("codex");
        std::os::unix::fs::symlink("/no/such/codex-target", &broken).expect("symlink");
        let regular = bin_dir.join("claude");
        std::fs::write(&regular, b"#!/bin/sh\n").expect("write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&regular).expect("meta").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&regular, perms).expect("chmod");
        }

        let path_env = bin_dir.to_string_lossy().to_string();
        let removed = clear_blocking_broken_bins("codex", &path_env).expect("remove broken");
        assert_eq!(removed, vec![broken.to_string_lossy().to_string()]);
        assert!(!broken.exists());
        assert!(regular.exists());
    }

    #[test]
    fn agent_registry_deduplicates_by_backend_and_custom_id() {
        let agents = deduplicate_agents(vec![
            DetectedAgent::Claude(sample_synthetic("claude", "claude", "claude")),
            DetectedAgent::Codex(sample_synthetic("codex-a", "codex", "codex")),
            DetectedAgent::Codex(sample_synthetic("codex-b", "codex", "codex")),
            DetectedAgent::Custom(sample_custom("custom:one")),
            DetectedAgent::Custom(sample_custom("custom:one")),
            DetectedAgent::Custom(sample_custom("custom:two")),
        ]);

        let ids: Vec<String> = agents.iter().map(|agent| agent.id().to_string()).collect();
        assert_eq!(ids, vec!["claude", "codex-a", "custom:one", "custom:two"]);
    }

    #[tokio::test]
    async fn agent_registry_cache_hit_skips_probe_within_ttl() {
        let db = test_db();
        let registry = AgentRegistry::new();
        let probe = MockProbe::ok();

        registry
            .refresh_all(false, &db, &probe)
            .await
            .expect("first refresh succeeds");
        assert_eq!(probe.call_count(), 3);

        registry
            .refresh_all(false, &db, &probe)
            .await
            .expect("cached refresh succeeds");
        assert_eq!(probe.call_count(), 3);
    }

    #[tokio::test]
    async fn agent_registry_force_refresh_bypasses_cache() {
        let db = test_db();
        let registry = AgentRegistry::new();
        let probe = MockProbe::ok();

        registry
            .refresh_all(false, &db, &probe)
            .await
            .expect("first refresh succeeds");
        registry
            .refresh_all(true, &db, &probe)
            .await
            .expect("forced refresh succeeds");

        assert_eq!(probe.call_count(), 6);
    }

    #[tokio::test]
    async fn agent_registry_probe_failure_marks_agent_unavailable() {
        let db = test_db();
        let registry = AgentRegistry::new();
        let probe = MockProbe::ok();
        probe.fail_command("codex");

        let agents = registry
            .refresh_all(true, &db, &probe)
            .await
            .expect("refresh succeeds");
        let codex = agents
            .into_iter()
            .find(|agent| agent.id() == "codex")
            .expect("codex is synthesized");

        match codex {
            DetectedAgent::Codex(agent) => {
                assert!(!agent.available);
                assert_eq!(agent.failure_reason.as_deref(), Some("codex unavailable"));
            }
            _ => panic!("codex variant expected"),
        }
    }

    #[tokio::test]
    async fn agent_registry_custom_agent_crud_round_trips_sqlite() {
        let db = test_db();
        let registry = AgentRegistry::new();
        let probe = MockProbe::ok();

        let record = insert_custom_agent(
            &db,
            CustomAgentInput {
                id: Some("local".to_string()),
                name: "Local Agent".to_string(),
                command: "local-agent".to_string(),
                args: vec!["--stdio".to_string()],
                env: HashMap::from([("WISE_TEST".to_string(), "1".to_string())]),
            },
        )
        .expect("custom agent inserts");
        assert_eq!(record.id, "local");

        let agents = registry
            .refresh_all(true, &db, &probe)
            .await
            .expect("refresh after insert succeeds");
        assert!(agents.iter().any(|agent| agent.id() == "custom:local"));

        delete_custom_agent(&db, "custom:local").expect("custom agent deletes");
        let agents = registry
            .refresh_all(true, &db, &probe)
            .await
            .expect("refresh after delete succeeds");
        assert!(!agents.iter().any(|agent| agent.id() == "custom:local"));
    }

    #[tokio::test]
    async fn agent_registry_failure_probe_can_synthesize_all_builtin_agents() {
        let db = test_db();
        let registry = AgentRegistry::new();
        let probe = MockProbe::fail();

        let agents = registry
            .refresh_all(true, &db, &probe)
            .await
            .expect("refresh succeeds");

        assert_eq!(agents.len(), 3);
        for agent in agents {
            match agent {
                DetectedAgent::Claude(agent)
                | DetectedAgent::Codex(agent)
                | DetectedAgent::Gemini(agent) => {
                    assert!(!agent.available);
                    assert!(agent.failure_reason.is_some());
                }
                DetectedAgent::Custom(_) => panic!("no custom rows expected"),
            }
        }
    }
}
