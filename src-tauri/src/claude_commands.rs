use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

pub(crate) mod attachments;
pub(crate) mod disk_sessions;
pub(crate) mod hooks_discovery;
pub(crate) mod mcp;
pub(crate) mod plugin_market;
pub(crate) mod prd_split;
pub(crate) mod prd_split_pipeline;
pub(crate) mod project_skills;
pub(crate) mod shared;
pub(crate) mod subagents;
pub(crate) mod terminal;
use self::hooks_discovery::{
    build_hook_scope_data_from_path, enrich_project_hooks_from_claude_hooks_dir,
};
use self::shared::{canonicalize_existing_project_dir, read_json_file, resolve_omc_plugin_root};
pub(crate) use project_skills::validate_claude_skill_name;
pub(crate) use terminal::TerminalManager;

// ── Claude Code Process ──

/// 每次 spawn 唯一 id，用于并发多进程时 `pending_stdin` 不与其它 stdout reader 抢同一槽位。
static CLAUDE_SPAWN_SERIAL: AtomicU64 = AtomicU64::new(1);

use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex as TokioMutex;
use self::disk_sessions::claude_session_jsonl_exists;

// ── Claude Code Process Management ──

/// Global state to track current Claude process (single slot)
pub(crate) struct ClaudeProcessState {
    current_process: Arc<TokioMutex<Option<Child>>>,
    /// `stream-json` 控制协议：按 `session_id` 保存 stdin，实现会话级定向回包。
    claude_stdin_by_session: Arc<TokioMutex<HashMap<String, tokio::process::ChildStdin>>>,
    /// 在拿到 `system.init.session_id` 之前，按 spawn 序号挂 stdin（支持多进程并发首包 initialize）。
    pending_stdin_by_spawn_id: Arc<TokioMutex<HashMap<u64, tokio::process::ChildStdin>>>,
    /// 当前可写 stdin 所属的 Claude session_id（用于前端定向回包校验）。
    current_session_id: Arc<TokioMutex<Option<String>>>,
    /// Oneshot 等「非 current_process 托管」子进程：按 Claude session_id 保存 wait 句柄，供 cancel / 同会话再次 resume 时 kill。
    pub(crate) active_child_by_claude_session:
        Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
    /// Oneshot invocation 早于 `system.init.session_id` 可见；按 invocation_key 保存 wait 句柄，支持精准取消。
    pub(crate) active_child_by_invocation_key:
        Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
    /// invocation_key → Wise tab session id（Cursor/Codex oneshot 取消时补发 complete）。
    pub(crate) invocation_tab_session_by_key: Arc<TokioMutex<HashMap<String, String>>>,
    /// 与前端「项目+仓库并发」一致：按 `projectId:repositoryId` 计数当前已占用的 Claude spawn 槽位。
    spawn_slots_by_scope: Arc<TokioMutex<HashMap<String, u32>>>,
}

impl Default for ClaudeProcessState {
    fn default() -> Self {
        Self {
            current_process: Arc::new(TokioMutex::new(None)),
            claude_stdin_by_session: Arc::new(TokioMutex::new(HashMap::new())),
            pending_stdin_by_spawn_id: Arc::new(TokioMutex::new(HashMap::new())),
            current_session_id: Arc::new(TokioMutex::new(None)),
            active_child_by_claude_session: Arc::new(TokioMutex::new(HashMap::new())),
            active_child_by_invocation_key: Arc::new(TokioMutex::new(HashMap::new())),
            invocation_tab_session_by_key: Arc::new(TokioMutex::new(HashMap::new())),
            spawn_slots_by_scope: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }
}

fn normalize_claude_spawn_limit(raw: Option<u32>) -> u32 {
    let v = raw.unwrap_or(16);
    v.clamp(1, 32)
}

/// 与前端 `claudeConcurrencyScopeKey` + `getConcurrencyLimitForScope` 对齐的后台槽位：防止绕过 UI 无限起子进程。
async fn try_acquire_claude_spawn_slot(
    slots_mtx: &Arc<TokioMutex<HashMap<String, u32>>>,
    scope_key: Option<String>,
    limit: Option<u32>,
) -> Result<Option<String>, String> {
    let Some(sk_raw) = scope_key else {
        return Ok(None);
    };
    let sk = sk_raw.trim().to_string();
    if sk.is_empty() {
        return Ok(None);
    }
    let lim = normalize_claude_spawn_limit(limit);
    let mut m = slots_mtx.lock().await;
    let c = *m.get(&sk).unwrap_or(&0);
    if c >= lim {
        return Err(format!(
            "该仓库 Claude Code 并发已达上限（{}），请等待其他任务结束或在侧栏调大并发上限。",
            lim
        ));
    }
    m.insert(sk.clone(), c + 1);
    Ok(Some(sk))
}

async fn release_claude_spawn_slot(
    slots_mtx: &Arc<TokioMutex<HashMap<String, u32>>>,
    scope_key: Option<String>,
) {
    let Some(sk) = scope_key else {
        return;
    };
    let mut m = slots_mtx.lock().await;
    if let Some(c) = m.get_mut(&sk) {
        if *c <= 1 {
            m.remove(&sk);
        } else {
            *c -= 1;
        }
    }
}

/// 可选 Claude CLI 旗标（主会话 streaming / 交互式 oneshot 共用）。
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeSpawnCliExtras {
    /// 追加 `--add-dir`（除 `current_dir` 外的可读目录）。
    #[serde(default)]
    pub add_dirs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disallowed_tools: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub append_system_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_config_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict_mcp_config: Option<bool>,
    /// 例如 `user,project` 或 `none`（透传 `--setting-sources`）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setting_sources: Option<String>,
}

fn apply_claude_spawn_cli_extras(cmd: &mut tokio::process::Command, extras: &ClaudeSpawnCliExtras) {
    for dir in &extras.add_dirs {
        let t = dir.trim();
        if !t.is_empty() {
            cmd.arg("--add-dir").arg(t);
        }
    }
    if let Some(v) = extras
        .allowed_tools
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        cmd.arg("--allowed-tools").arg(v);
    }
    if let Some(v) = extras
        .disallowed_tools
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        cmd.arg("--disallowed-tools").arg(v);
    }
    if let Some(v) = extras
        .append_system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        cmd.arg("--append-system-prompt").arg(v);
    }
    if let Some(v) = extras
        .mcp_config_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        cmd.arg("--mcp-config").arg(v);
    }
    if extras.strict_mcp_config == Some(true) {
        cmd.arg("--strict-mcp-config");
    }
    if let Some(v) = extras
        .setting_sources
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        cmd.arg("--setting-sources").arg(v);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudeConnectionMode {
    Persistent,
    Oneshot,
    /// `--input-format stream-json` 长驻子进程；用户消息经 stdin JSON 写入，与 CLI 会话能力对齐。
    Streaming,
}

impl ClaudeConnectionMode {
    fn from_option_str(value: Option<&str>) -> Self {
        match value.map(str::trim).map(|v| v.to_ascii_lowercase()) {
            Some(v) if v == "oneshot" || v == "one-shot" || v == "one_shot" => Self::Oneshot,
            Some(v) if v == "streaming" || v == "stream" => Self::Streaming,
            _ => Self::Persistent,
        }
    }
}

/// 进程结束事件：前端据此定位标签页（不依赖「当前选中会话」ref），后台会话也能正确入库通知。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCompletePayload {
    session_id: String,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    structured_verdict: Option<serde_json::Value>,
}

fn normalize_verdict_value(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "approve" | "approved" | "pass" | "accept" | "yes" | "ok" => Some("approve"),
        "reject" | "rejected" | "fail" | "deny" | "no" => Some("reject"),
        _ => {
            let zh = raw.trim();
            if zh == "通过" {
                Some("approve")
            } else if zh == "驳回" {
                Some("reject")
            } else {
                None
            }
        }
    }
}

fn canonicalize_structured_verdict_object(
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Option<serde_json::Value> {
    let verdict_raw = obj
        .get("workflowAcceptanceVerdict")
        .or_else(|| obj.get("verdict"))
        .or_else(|| obj.get("decision"))
        .and_then(|v| v.as_str())
        .or_else(|| obj.get("验收结论").and_then(|v| v.as_str()));
    let Some(raw) = verdict_raw else {
        return None;
    };
    let Some(canonical) = normalize_verdict_value(raw) else {
        return None;
    };

    let mut out = serde_json::Map::new();
    out.insert(
        "workflowAcceptanceVerdict".to_string(),
        serde_json::Value::String(canonical.to_string()),
    );
    if let Some(v) = obj.get("schemaVersion").and_then(|v| v.as_i64()) {
        if v >= 1 {
            out.insert(
                "schemaVersion".to_string(),
                serde_json::Value::Number(v.into()),
            );
        }
    }
    if let Some(v) = obj.get("taskId").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            out.insert(
                "taskId".to_string(),
                serde_json::Value::String(v.trim().to_string()),
            );
        }
    }
    if let Some(v) = obj
        .get("nodeId")
        .or_else(|| obj.get("graphNodeId"))
        .and_then(|v| v.as_str())
    {
        if !v.trim().is_empty() {
            out.insert(
                "nodeId".to_string(),
                serde_json::Value::String(v.trim().to_string()),
            );
        }
    }
    if let Some(v) = obj.get("rationale").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            out.insert(
                "rationale".to_string(),
                serde_json::Value::String(v.trim().to_string()),
            );
        }
    }

    Some(serde_json::Value::Object(out))
}

fn extract_structured_verdict_candidate(v: &serde_json::Value) -> Option<serde_json::Value> {
    match v {
        serde_json::Value::Object(obj) => {
            if let Some(found) = canonicalize_structured_verdict_object(obj) {
                return Some(found);
            }
            for value in obj.values() {
                if let Some(found) = extract_structured_verdict_candidate(value) {
                    return Some(found);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                if let Some(found) = extract_structured_verdict_candidate(item) {
                    return Some(found);
                }
            }
            None
        }
        _ => None,
    }
}

/// Claude session info returned to frontend
#[derive(Serialize, Clone)]
pub(crate) struct ClaudeSessionInfo {
    session_id: String,
    project_path: String,
    model: String,
    status: String,
    started_at: String,
}

/// Session registry for tracking running Claude sessions
#[derive(Clone)]
pub(crate) struct ClaudeSessionRegistry {
    sessions: Arc<Mutex<HashMap<String, ClaudeSessionInfo>>>,
}

impl ClaudeSessionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn register(&self, session_id: String, project_path: String, model: String) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.insert(
            session_id.clone(),
            ClaudeSessionInfo {
                session_id,
                project_path,
                model,
                status: "running".to_string(),
                started_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis().to_string())
                    .unwrap_or_default(),
            },
        );
    }

    pub(crate) fn mark_completed(&self, session_id: &str, success: bool) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(info) = sessions.get_mut(session_id) {
            info.status = if success {
                "completed".to_string()
            } else {
                "cancelled".to_string()
            };
        }
    }

    /// 长驻 streaming 新一轮用户消息写入 stdin 时，注册表恢复为 running（进程未退出）。
    fn mark_running(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(info) = sessions.get_mut(session_id) {
            info.status = "running".to_string();
        }
    }

    fn remove(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.remove(session_id);
    }

    fn list(&self) -> Vec<ClaudeSessionInfo> {
        let sessions = self.sessions.lock().unwrap();
        sessions.values().cloned().collect()
    }
}

/// Extra PATH segments so `which` / subprocesses find `claude` when the GUI app inherits a minimal PATH (e.g. Tauri `.app`).
pub(crate) fn claude_path_search_prefixes() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    #[cfg(not(windows))]
    {
        v.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]);
    }
    #[cfg(windows)]
    {
        if let Some(home) = dirs::home_dir() {
            v.push(home.join("AppData/Roaming/npm"));
            v.push(home.join("AppData/Local/npm"));
        }
        v.push(PathBuf::from(r"C:\Program Files\nodejs"));
        v.push(PathBuf::from(r"C:\Program Files (x86)\nodejs"));
    }
    if let Some(home) = dirs::home_dir() {
        v.push(home.join("bin"));
        v.push(home.join(".local/bin"));
        v.push(home.join(".volta/bin"));
        v.push(home.join(".bun/bin"));
        v.push(home.join(".npm-global/bin"));
        // nvm default install
        if let Ok(entries) = fs::read_dir(home.join(".nvm/versions/node")) {
            let mut nodes: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            nodes.sort_by(|a, b| b.cmp(a));
            for node_dir in nodes {
                v.push(node_dir.join("bin"));
            }
        }
        // NVM_DIR may differ from ~/.nvm
        if let Ok(nvm_dir) = std::env::var("NVM_DIR") {
            let versions_dir = PathBuf::from(nvm_dir.trim()).join("versions/node");
            if let Ok(entries) = fs::read_dir(&versions_dir) {
                let mut nodes: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect();
                nodes.sort_by(|a, b| b.cmp(a));
                for node_dir in nodes {
                    v.push(node_dir.join("bin"));
                }
            }
        }
        // fnm
        for base in [
            home.join(".local/share/fnm/node-versions"),
            home.join(".fnm/node-versions"),
        ] {
            if let Ok(entries) = fs::read_dir(&base) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    v.push(p.join("installation/bin"));
                    v.push(p.join("bin"));
                }
            }
        }
    }
    v
}

pub(crate) fn merge_path_env(prefix_dirs: &[PathBuf]) -> String {
    let mut seen = HashSet::<String>::new();
    let mut parts: Vec<String> = Vec::new();
    for d in prefix_dirs {
        let s = d.to_string_lossy().to_string();
        if s.is_empty() || !seen.insert(s.clone()) {
            continue;
        }
        if Path::new(&s).is_dir() {
            parts.push(s);
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        let path_sep = if cfg!(windows) { ';' } else { ':' };
        for piece in existing.split(path_sep) {
            let t = piece.trim();
            if t.is_empty() || !seen.insert(t.to_string()) {
                continue;
            }
            parts.push(t.to_string());
        }
    }
    parts.join(if cfg!(windows) { ";" } else { ":" })
}

/// Enumerate likely `claude` paths (GUI apps often lack NVM_HOME on PATH).
fn claude_binary_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in claude_path_search_prefixes() {
        out.push(d.join("claude"));
    }
    #[cfg(windows)]
    {
        if let Some(h) = dirs::home_dir() {
            out.push(h.join("AppData/Roaming/npm/claude.cmd"));
            out.push(h.join("AppData/Roaming/npm/claude.exe"));
        }
        out.push(PathBuf::from(r"C:\Program Files\nodejs\claude.cmd"));
        out.push(PathBuf::from(r"C:\Program Files\nodejs\claude.exe"));
    }
    out
}

#[cfg(unix)]
fn try_claude_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v claude"]),
        ("/bin/bash", vec!["-lc", "command -v claude"]),
    ] {
        let output = Command::new(shell)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if p.is_empty() {
            continue;
        }
        if Path::new(&p).is_file() {
            return Some(p);
        }
    }
    None
}

/// Finds the claude binary in common locations (works when packaged app has a narrow PATH).
pub(crate) fn find_claude_binary() -> Result<String, String> {
    for c in claude_binary_candidates() {
        if c.is_file() {
            return Ok(c.to_string_lossy().to_string());
        }
    }

    #[cfg(windows)]
    {
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        if let Ok(output) = Command::new("where")
            .arg("claude")
            .env("PATH", &path_merged)
            .output()
        {
            if output.status.success() {
                let line = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !line.is_empty() && Path::new(&line).exists() {
                    return Ok(line);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        if let Ok(output) = Command::new("which")
            .arg("claude")
            .env("PATH", &path_merged)
            .output()
        {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() && Path::new(&p).is_file() {
                    return Ok(p);
                }
            }
        }
        if let Some(p) = try_claude_from_login_shell() {
            return Ok(p);
        }
    }

    Err(
        "未找到 claude 可执行文件。请安装: npm install -g @anthropic-ai/claude-code；\
若已安装，请确认位于 PATH，或装在 /opt/homebrew/bin、/usr/local/bin、\
以及 nvm/fnm 的 node 版本 bin 目录下（从 .app 启动时不会继承终端 PATH，已自动尝试上述路径与登录 shell 解析）。"
            .to_string(),
    )
}

/// Default model from one `settings.json`: `env.ANTHROPIC_MODEL` when set, else top-level `model`.
fn read_claude_effective_model_from_value(v: &serde_json::Value) -> Option<String> {
    if let Some(env) = v.get("env") {
        if let Some(s) = env.get("ANTHROPIC_MODEL").and_then(|x| x.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    v.get("model")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn read_claude_available_models_from_value(v: &serde_json::Value) -> Vec<String> {
    let Some(arr) = v.get("availableModels").and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for item in arr {
        let s = item
            .as_str()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let Some(s) = s else { continue };
        let key = s.to_lowercase();
        if !out.iter().any(|x| x.to_lowercase() == key) {
            out.push(s);
        }
    }
    out
}

/// Merges `availableModels` arrays (project then user), deduplicated case-insensitively.
fn merge_claude_available_model_lists(project: &[String], user: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push_list = |list: &[String]| {
        for s in list {
            let key = s.to_lowercase();
            if !out.iter().any(|x| x.to_lowercase() == key) {
                out.push(s.clone());
            }
        }
    };
    push_list(project);
    push_list(user);
    out
}

/// Reads the effective default model from a Claude Code `settings.json` path, if present.
fn read_claude_settings_model(path: &Path) -> Option<String> {
    let v = read_json_file(path)?;
    read_claude_effective_model_from_value(&v)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeModelPickerOptions {
    default_model: Option<String>,
    available_models: Vec<String>,
}

fn collect_claude_model_picker_options(
    project_path: Option<String>,
) -> Result<ClaudeModelPickerOptions, String> {
    let user_settings = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let user_val = read_json_file(&user_settings);
    let user_models = user_val
        .as_ref()
        .map(read_claude_available_models_from_value)
        .unwrap_or_default();

    let (project_val, project_models) = project_path
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|p| {
            let path = PathBuf::from(p).join(".claude").join("settings.json");
            let val = read_json_file(&path);
            let models = val
                .as_ref()
                .map(read_claude_available_models_from_value)
                .unwrap_or_default();
            (val, models)
        })
        .unwrap_or((None, Vec::new()));

    let available_models = merge_claude_available_model_lists(&project_models, &user_models);

    let user_effective = user_val
        .as_ref()
        .and_then(read_claude_effective_model_from_value);
    let project_effective = project_val
        .as_ref()
        .and_then(read_claude_effective_model_from_value);
    let default_model = project_effective.or(user_effective);

    Ok(ClaudeModelPickerOptions {
        default_model,
        available_models,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeHookHandler {
    id: String,
    r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#if: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    shell: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#async: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    async_rewake: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_env_vars: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeHookMatcherGroup {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    matcher: Option<String>,
    hooks: Vec<ClaudeHookHandler>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeHookScopeData {
    source_path: String,
    disable_all_hooks: bool,
    hooks: HashMap<String, Vec<ClaudeHookMatcherGroup>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeHooksStatusResponse {
    user: ClaudeHookScopeData,
    project: ClaudeHookScopeData,
    local: ClaudeHookScopeData,
    omc: ClaudeHookScopeData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeHookHandlerInput {
    r#type: String,
    r#if: Option<String>,
    timeout: Option<i64>,
    status_message: Option<String>,
    shell: Option<String>,
    r#async: Option<bool>,
    async_rewake: Option<bool>,
    command: Option<String>,
    url: Option<String>,
    headers: Option<HashMap<String, String>>,
    allowed_env_vars: Option<Vec<String>>,
    prompt: Option<String>,
    model: Option<String>,
}

fn ensure_json_object(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        return Ok(serde_json::json!({}));
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !v.is_object() {
        return Err("settings.json 顶层必须是对象".to_string());
    }
    Ok(v)
}

fn write_json_pretty(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())
}

fn build_hook_scope_data(path: &Path) -> ClaudeHookScopeData {
    build_hook_scope_data_from_path(path, "")
}

fn hooks_settings_path_for_scope(
    scope: &str,
    project_path: Option<&str>,
    _home: &Path,
) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(crate::claude_config_dir::user_claude_dir().join("settings.json")),
        "project" => {
            let pp = project_path
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "project scope 需要有效 projectPath".to_string())?;
            Ok(PathBuf::from(pp).join(".claude").join("settings.json"))
        }
        "local" => {
            let pp = project_path
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "local scope 需要有效 projectPath".to_string())?;
            Ok(PathBuf::from(pp)
                .join(".claude")
                .join("settings.local.json"))
        }
        _ => Err(format!("未知 hooks scope: {}", scope)),
    }
}

fn normalize_hook_handler_input(
    handler: ClaudeHookHandlerInput,
) -> Result<serde_json::Value, String> {
    let ty = handler.r#type.trim().to_lowercase();
    if !matches!(ty.as_str(), "command" | "http" | "prompt" | "agent") {
        return Err("hook type 仅支持 command/http/prompt/agent".to_string());
    }
    if let Some(timeout) = handler.timeout {
        if timeout <= 0 {
            return Err("timeout 必须是正整数".to_string());
        }
    }
    let mut obj = serde_json::Map::new();
    obj.insert("type".into(), serde_json::Value::String(ty.clone()));
    if let Some(v) = handler
        .r#if
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        obj.insert("if".into(), serde_json::Value::String(v));
    }
    if let Some(v) = handler.timeout {
        obj.insert("timeout".into(), serde_json::Value::Number(v.into()));
    }
    if let Some(v) = handler
        .status_message
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        obj.insert("statusMessage".into(), serde_json::Value::String(v));
    }
    if let Some(v) = handler
        .shell
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        obj.insert("shell".into(), serde_json::Value::String(v));
    }
    if let Some(v) = handler.r#async {
        obj.insert("async".into(), serde_json::Value::Bool(v));
    }
    if let Some(v) = handler.async_rewake {
        obj.insert("asyncRewake".into(), serde_json::Value::Bool(v));
    }

    match ty.as_str() {
        "command" => {
            let cmd = handler
                .command
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "command hook 必须填写 command".to_string())?;
            obj.insert("command".into(), serde_json::Value::String(cmd));
        }
        "http" => {
            let url = handler
                .url
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "http hook 必须填写 url".to_string())?;
            obj.insert("url".into(), serde_json::Value::String(url));
            if let Some(headers) = handler.headers {
                let mut hm = serde_json::Map::new();
                for (k, v) in headers {
                    let key = k.trim();
                    let val = v.trim();
                    if !key.is_empty() && !val.is_empty() {
                        hm.insert(key.to_string(), serde_json::Value::String(val.to_string()));
                    }
                }
                if !hm.is_empty() {
                    obj.insert("headers".into(), serde_json::Value::Object(hm));
                }
            }
            if let Some(vars) = handler.allowed_env_vars {
                let arr: Vec<serde_json::Value> = vars
                    .iter()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .map(|s| serde_json::Value::String(s.to_string()))
                    .collect();
                if !arr.is_empty() {
                    obj.insert("allowedEnvVars".into(), serde_json::Value::Array(arr));
                }
            }
        }
        "prompt" | "agent" => {
            let prompt = handler
                .prompt
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "prompt/agent hook 必须填写 prompt".to_string())?;
            obj.insert("prompt".into(), serde_json::Value::String(prompt));
            if let Some(model) = handler
                .model
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            {
                obj.insert("model".into(), serde_json::Value::String(model));
            }
        }
        _ => {}
    }
    Ok(serde_json::Value::Object(obj))
}

#[tauri::command]
pub(crate) fn get_claude_hooks_status(
    project_path: Option<String>,
) -> Result<ClaudeHooksStatusResponse, String> {
    let user_path = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let project_path_file = project_root
        .as_ref()
        .map(|p| p.join(".claude").join("settings.json"));
    let local_path_file = project_root
        .as_ref()
        .map(|p| p.join(".claude").join("settings.local.json"));
    let omc_hooks_file =
        resolve_omc_plugin_root().map(|root| root.join("hooks").join("hooks.json"));

    let project = project_root.as_ref().map(|root| {
        let settings = root.join(".claude").join("settings.json");
        let base = build_hook_scope_data(&settings);
        enrich_project_hooks_from_claude_hooks_dir(base, root)
    });

    Ok(ClaudeHooksStatusResponse {
        user: build_hook_scope_data(&user_path),
        project: project.unwrap_or_else(|| {
            build_hook_scope_data(
                &project_path_file
                    .unwrap_or_else(|| PathBuf::from("<请选择项目后可查看 project hooks>")),
            )
        }),
        local: build_hook_scope_data(
            &local_path_file.unwrap_or_else(|| PathBuf::from("<请选择项目后可查看 local hooks>")),
        ),
        omc: build_hook_scope_data(
            &omc_hooks_file.unwrap_or_else(|| PathBuf::from("<未发现 OMC 插件 hooks.json>")),
        ),
    })
}

/// Whether oh-my-claudecode (OMC) is installed under `~/.claude/plugins/cache/omc/`.
#[tauri::command]
pub(crate) fn is_omc_plugin_installed() -> bool {
    resolve_omc_plugin_root().is_some()
}

#[tauri::command]
pub(crate) fn upsert_claude_hook(
    scope: String,
    project_path: Option<String>,
    event_name: String,
    matcher: Option<String>,
    handler: ClaudeHookHandlerInput,
    target_group_id: Option<String>,
    target_handler_id: Option<String>,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim().to_string();
    let event_name = event_name.trim().to_string();
    if event_name.is_empty() {
        return Err("eventName 不能为空".to_string());
    }
    let path = hooks_settings_path_for_scope(&scope, project_path.as_deref(), &home)?;
    let mut root = ensure_json_object(&path)?;
    if root.get("hooks").and_then(|v| v.as_object()).is_none() {
        root["hooks"] = serde_json::json!({});
    }
    let normalized_handler = normalize_hook_handler_input(handler)?;
    let matcher = matcher
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let hooks_obj = root
        .get_mut("hooks")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "hooks 字段必须是对象".to_string())?;
    let groups = hooks_obj
        .entry(event_name.clone())
        .or_insert_with(|| serde_json::Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "event hooks 必须是数组".to_string())?;

    if let (Some(group_id), Some(handler_id)) =
        (target_group_id.as_ref(), target_handler_id.as_ref())
    {
        let parts: Vec<&str> = group_id.split(':').collect();
        if parts.len() < 2 {
            return Err("targetGroupId 无效".to_string());
        }
        let g_idx: usize = parts[parts.len() - 1]
            .parse()
            .map_err(|_| "targetGroupId 无效".to_string())?;
        let h_parts: Vec<&str> = handler_id.split(':').collect();
        if h_parts.len() < 3 {
            return Err("targetHandlerId 无效".to_string());
        }
        let h_idx: usize = h_parts[h_parts.len() - 1]
            .parse()
            .map_err(|_| "targetHandlerId 无效".to_string())?;
        let group = groups
            .get_mut(g_idx)
            .and_then(|v| v.as_object_mut())
            .ok_or_else(|| "未找到目标 matcher group".to_string())?;
        if let Some(m) = matcher {
            group.insert("matcher".into(), serde_json::Value::String(m));
        } else {
            group.remove("matcher");
        }
        let hooks = group
            .get_mut("hooks")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| "目标 matcher group 中 hooks 无效".to_string())?;
        if h_idx >= hooks.len() {
            return Err("未找到目标 hook".to_string());
        }
        hooks[h_idx] = normalized_handler;
    } else if let Some(group_id) = target_group_id.as_ref() {
        let parts: Vec<&str> = group_id.split(':').collect();
        if parts.len() < 2 {
            return Err("targetGroupId 无效".to_string());
        }
        let g_idx: usize = parts[parts.len() - 1]
            .parse()
            .map_err(|_| "targetGroupId 无效".to_string())?;
        let group = groups
            .get_mut(g_idx)
            .and_then(|v| v.as_object_mut())
            .ok_or_else(|| "未找到目标 matcher group".to_string())?;
        if let Some(m) = matcher {
            group.insert("matcher".into(), serde_json::Value::String(m));
        } else {
            group.remove("matcher");
        }
        let hooks = group
            .get_mut("hooks")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| "目标 matcher group 中 hooks 无效".to_string())?;
        hooks.push(normalized_handler);
    } else {
        groups.push(serde_json::json!({
            "matcher": matcher,
            "hooks": [normalized_handler]
        }));
    }

    write_json_pretty(&path, &root)
}

#[tauri::command]
pub(crate) fn remove_claude_hook(
    scope: String,
    event_name: String,
    group_id: String,
    handler_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let path = hooks_settings_path_for_scope(scope.trim(), project_path.as_deref(), &home)?;
    let mut root = ensure_json_object(&path)?;
    let hooks_obj = root
        .get_mut("hooks")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "未找到 hooks 配置".to_string())?;
    let groups = hooks_obj
        .get_mut(event_name.trim())
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "未找到目标事件".to_string())?;
    let g_idx: usize = group_id
        .split(':')
        .last()
        .ok_or_else(|| "groupId 无效".to_string())?
        .parse()
        .map_err(|_| "groupId 无效".to_string())?;
    let h_idx: usize = handler_id
        .split(':')
        .last()
        .ok_or_else(|| "handlerId 无效".to_string())?
        .parse()
        .map_err(|_| "handlerId 无效".to_string())?;
    let group = groups
        .get_mut(g_idx)
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "未找到 matcher group".to_string())?;
    let handlers = group
        .get_mut("hooks")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| "matcher group hooks 无效".to_string())?;
    if h_idx >= handlers.len() {
        return Err("未找到目标 hook".to_string());
    }
    handlers.remove(h_idx);
    if handlers.is_empty() && g_idx < groups.len() {
        groups.remove(g_idx);
    }
    if groups.is_empty() {
        hooks_obj.remove(event_name.trim());
    }
    write_json_pretty(&path, &root)
}

#[tauri::command]
pub(crate) fn set_claude_disable_all_hooks(
    scope: String,
    disable_all_hooks: bool,
    project_path: Option<String>,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let path = hooks_settings_path_for_scope(scope.trim(), project_path.as_deref(), &home)?;
    let mut root = ensure_json_object(&path)?;
    root["disableAllHooks"] = serde_json::Value::Bool(disable_all_hooks);
    write_json_pretty(&path, &root)
}

/// User `~/.claude/settings.json`（或自定义目录下的 settings.json）, optionally overridden by `{project}/.claude/settings.json`.
#[tauri::command]
pub(crate) fn get_claude_config_model(
    project_path: Option<String>,
) -> Result<Option<String>, String> {
    let user_settings = crate::claude_config_dir::user_claude_dir().join("settings.json");
    let user_model = read_claude_settings_model(&user_settings);

    let project_model = project_path
        .as_ref()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|p| PathBuf::from(p).join(".claude").join("settings.json"))
        .and_then(|p| read_claude_settings_model(&p));

    Ok(project_model.or(user_model))
}

/// User + project `settings.json`: merged `availableModels` and effective default (`env.ANTHROPIC_MODEL` or `model`).
#[tauri::command]
pub(crate) fn get_claude_model_picker_options(
    project_path: Option<String>,
) -> Result<ClaudeModelPickerOptions, String> {
    collect_claude_model_picker_options(project_path)
}

fn trim_model_cli_arg(model: &str) -> Option<&str> {
    let m = model.trim();
    if m.is_empty() {
        None
    } else {
        Some(m)
    }
}

/// 凡由 Wise 拉起的 `claude` 子进程（GUI、`--bare` 编排、PRD split 等）统一使用官方 `bypassPermissions`，
/// 跳过权限层、不在 CLI 侧等待逐项工具批准。
/// 非 `--bare` 时仍保留 `--permission-prompt-tool stdio` + 管道 stdin，用于 `initialize` 应答与 AskUserQuestion 等控制流；
/// `--bare` 时 stdin 为 `/dev/null`，减少编排子进程对 hooks/控制流的粘连。
/// 参考：<https://docs.anthropic.com/en/docs/claude-code/permission-modes>
///
/// Build a tokio Command for running claude
fn create_claude_command(
    project_path: &str,
    prompt: &str,
    model: Option<&str>,
    extra_args: &[&str],
    bare: bool,
    trellis_context_id: Option<&str>,
    cli_extras: &ClaudeSpawnCliExtras,
) -> Result<tokio::process::Command, String> {
    let claude_path = find_claude_binary()?;

    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(project_path);
    if bare {
        cmd.arg("--bare");
    }
    cmd.arg("-p").arg(prompt);
    cmd.arg("--output-format").arg("stream-json");
    // 非 `--bare` 时见下方 piped stdin：`initialize` / AskUserQuestion 等控制行经 stdio 写回。
    cmd.arg("--verbose");
    cmd.arg("--permission-mode").arg("bypassPermissions");

    if let Some(m) = model.and_then(trim_model_cli_arg) {
        cmd.arg("--model").arg(m);
    }

    for arg in extra_args {
        cmd.arg(arg);
    }

    apply_claude_spawn_cli_extras(&mut cmd, cli_extras);

    // Inherit environment
    cmd.env(
        "HOME",
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );

    // Subprocess PATH：与查找逻辑一致，避免 GUI 下子进程找不到 node / 其它 CLI
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));

    // 与 Wise 前端发送前 `/compact` 策略对齐：未显式配置时让 Claude Code 在约 88% 窗口时自动压缩。
    if std::env::var("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE").is_err() {
        cmd.env("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "88");
    }

    if let Some(context_id) = trellis_context_id.map(str::trim).filter(|v| !v.is_empty()) {
        cmd.env("TRELLIS_CONTEXT_ID", context_id);
    }

    if bare {
        // `--bare`：自动化/拆分等场景保持无 stdin，避免子进程等待控制流。
        cmd.stdin(std::process::Stdio::null());
    } else {
        // GUI 会话：管道 stdin + stdio 控制通道（initialize / AskUserQuestion 等），由前端写回 `control_response`。
        cmd.arg("--permission-prompt-tool").arg("stdio");
        cmd.stdin(std::process::Stdio::piped());
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    Ok(cmd)
}

/// Streaming 会话模式：`--input-format stream-json` 长驻进程。
/// 不使用 `-p`，提示通过 stdin 发送。
fn create_streaming_claude_command(
    project_path: &str,
    model: Option<&str>,
    session_id_to_resume: Option<&str>,
    trellis_context_id: Option<&str>,
    cli_extras: &ClaudeSpawnCliExtras,
) -> Result<tokio::process::Command, String> {
    let claude_path = find_claude_binary()?;

    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(project_path);
    cmd.arg("--input-format").arg("stream-json");
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--permission-mode").arg("bypassPermissions");
    cmd.arg("--permission-prompt-tool").arg("stdio");

    if let Some(m) = model.and_then(trim_model_cli_arg) {
        cmd.arg("--model").arg(m);
    }

    if let Some(sid) = session_id_to_resume.map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("--resume").arg(sid);
    }

    apply_claude_spawn_cli_extras(&mut cmd, cli_extras);

    // Inherit environment
    cmd.env(
        "HOME",
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));

    if std::env::var("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE").is_err() {
        cmd.env("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE", "88");
    }

    if let Some(context_id) = trellis_context_id.map(str::trim).filter(|v| !v.is_empty()) {
        cmd.env("TRELLIS_CONTEXT_ID", context_id);
    }

    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    Ok(cmd)
}

/// Claude `-p` 与管道 stdin 并存时，CLI 可能在 stderr 打出「数秒内无 stdin」提示后自行继续；
/// 该行不应经 `claude-error*` 事件进入前端系统消息。
fn claude_stderr_line_suppressed_for_ui_events(line: &str) -> bool {
    line.to_lowercase().contains("no stdin data received in 3s")
}

/// `stream-json` 单轮结束包络（`type: result`）；长驻子进程不会因此退出。
fn streaming_turn_success_from_result(json: &serde_json::Value) -> Option<bool> {
    if json.get("type").and_then(|v| v.as_str()) != Some("result") {
        return None;
    }
    let is_error = json.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
    Some(!is_error)
}

fn session_channel_sid_valid(sid: &str) -> bool {
    !sid.is_empty() && sid != "unknown"
}

/// 长驻 streaming 后续轮按 `session_id` 订阅；带 invocation 时仍须发 session 通道（仅抑制全局通道）。
fn emit_claude_stdout_line(
    app: &tauri::AppHandle,
    sid: &str,
    line: &str,
    connection_mode: ClaudeConnectionMode,
    invocation_key: Option<&str>,
    suppress_shared_stdout: bool,
) {
    if connection_mode == ClaudeConnectionMode::Streaming && session_channel_sid_valid(sid) {
        let _ = app.emit(&format!("claude-output:{}", sid), line);
    } else if !suppress_shared_stdout && session_channel_sid_valid(sid) {
        let _ = app.emit(&format!("claude-output:{}", sid), line);
    }
    if !suppress_shared_stdout {
        let _ = app.emit("claude-output", line);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-output:invocation:{}", inv), line);
    }
}

fn emit_claude_complete_payload(
    app: &tauri::AppHandle,
    sid: &str,
    payload: &ClaudeCompletePayload,
    connection_mode: ClaudeConnectionMode,
    invocation_key: Option<&str>,
    suppress_shared_stdout: bool,
) {
    if connection_mode == ClaudeConnectionMode::Streaming && session_channel_sid_valid(sid) {
        let _ = app.emit(&format!("claude-complete:{}", sid), payload);
    } else if !suppress_shared_stdout && session_channel_sid_valid(sid) {
        let _ = app.emit(&format!("claude-complete:{}", sid), payload);
    }
    if !suppress_shared_stdout {
        let _ = app.emit("claude-complete", payload);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&format!("claude-complete:invocation:{}", inv), payload);
    }
}

fn emit_streaming_turn_complete_events(
    app: &tauri::AppHandle,
    registry: &ClaudeSessionRegistry,
    sid: &str,
    success: bool,
    structured_verdict: Option<serde_json::Value>,
    invocation_key: Option<&str>,
    suppress_shared_stdout: bool,
) -> bool {
    let sid = sid.trim();
    if sid.is_empty() || sid == "unknown" {
        return false;
    }
    registry.mark_completed(sid, success);
    let payload = ClaudeCompletePayload {
        session_id: sid.to_string(),
        success,
        structured_verdict,
    };
    emit_claude_complete_payload(
        app,
        sid,
        &payload,
        ClaudeConnectionMode::Streaming,
        invocation_key,
        suppress_shared_stdout,
    );
    true
}

fn extract_claude_session_id_from_stream_json(json: &serde_json::Value) -> Option<String> {
    json.get("session_id")
        .or_else(|| json.get("sessionId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 绑定 spawn 期 stdin 到 Claude `session_id`，并在 streaming 模式下写入首条用户消息。
/// Trellis `SessionStart` 场景下 CLI 可能先有 hook 行、迟迟不发 `system.init`；若只等 init 再写 stdin 会死锁。
/// 在拿到 Claude `session_id` 之前，向 spawn 期 `pending_stdin` 写入首条用户消息。
/// Trellis `SessionStart` 无 stdin 时 CLI 可能长时间只跑 Hook、不发 `system.init`。
async fn try_write_initial_streaming_prompt_pending(
    spawn_id: u64,
    initial_prompt: &str,
    initial_sent: &mut bool,
    pending_stdin_by_spawn: &Arc<TokioMutex<HashMap<u64, tokio::process::ChildStdin>>>,
) {
    if *initial_sent {
        return;
    }
    let prompt = initial_prompt.trim();
    if prompt.is_empty() {
        return;
    }
    let mut g = pending_stdin_by_spawn.lock().await;
    let Some(sin) = g.get_mut(&spawn_id) else {
        return;
    };
    if write_streaming_user_message_to_stdin(sin, prompt).await.is_ok() {
        *initial_sent = true;
    }
}

async fn bootstrap_streaming_session_stdin(
    sid: &str,
    spawn_id: u64,
    connection_mode: ClaudeConnectionMode,
    initial_prompt: Option<&str>,
    initial_sent: &mut bool,
    real_session_id: &mut Option<String>,
    pending_stdin_by_spawn: &Arc<TokioMutex<HashMap<u64, tokio::process::ChildStdin>>>,
    stdin_map_mtx: &Arc<TokioMutex<HashMap<String, tokio::process::ChildStdin>>>,
    active_child_by_session: &Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
    wait_child_mutex: &Arc<TokioMutex<Option<Child>>>,
    registry: &ClaudeSessionRegistry,
    project_path: &str,
    model: &str,
    current_session_id_mtx: &Arc<TokioMutex<Option<String>>>,
) {
    let sid = sid.trim();
    if sid.is_empty() {
        return;
    }

    if real_session_id.is_none() {
        *real_session_id = Some(sid.to_string());
        if let Some(stdin) = pending_stdin_by_spawn.lock().await.remove(&spawn_id) {
            stdin_map_mtx
                .lock()
                .await
                .insert(sid.to_string(), stdin);
        }
        if connection_mode == ClaudeConnectionMode::Persistent {
            *current_session_id_mtx.lock().await = Some(sid.to_string());
        }
        if connection_mode == ClaudeConnectionMode::Oneshot
            || connection_mode == ClaudeConnectionMode::Streaming
        {
            active_child_by_session
                .lock()
                .await
                .insert(sid.to_string(), wait_child_mutex.clone());
        }
        registry.register(sid.to_string(), project_path.to_string(), model.to_string());
    }

    if *initial_sent || connection_mode != ClaudeConnectionMode::Streaming {
        return;
    }
    let Some(initial) = initial_prompt.map(str::trim).filter(|p| !p.is_empty()) else {
        return;
    };
    if let Some(sin) = stdin_map_mtx.lock().await.get_mut(sid) {
        if write_streaming_user_message_to_stdin(sin, initial).await.is_ok() {
            *initial_sent = true;
        }
    }
}

/// 自动应答 CLI 的 `initialize` control，避免仅开 stdin 时首包卡死。
async fn maybe_ack_control_initialize(
    line: &str,
    pending_stdin_by_spawn: &Arc<TokioMutex<HashMap<u64, tokio::process::ChildStdin>>>,
    spawn_id: u64,
) {
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    let req = match v.get("type").and_then(|t| t.as_str()) {
        Some("sdk_control_request") | Some("control_request") => v.get("request"),
        _ => return,
    };
    let Some(req) = req else {
        return;
    };
    if req.get("subtype").and_then(|s| s.as_str()) != Some("initialize") {
        return;
    }
    let rid = v.get("request_id")
        .and_then(|s| s.as_str())
        .or_else(|| req.get("request_id").and_then(|s| s.as_str()));
    let Some(rid) = rid else {
        return;
    };
    let body = serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": rid,
        }
    });
    let mut g = pending_stdin_by_spawn.lock().await;
    let Some(sin) = g.get_mut(&spawn_id) else {
        return;
    };
    use tokio::io::AsyncWriteExt;
    let payload = format!("{}\n", body);
    if sin.write_all(payload.as_bytes()).await.is_err() {
        return;
    }
    let _ = sin.flush().await;
}

/// 同 Claude session 再次 resume 或用户取消前，结束仍占位的 oneshot 子进程并清理 stdin 映射。
async fn kill_active_claude_run_for_session(
    process_state: &ClaudeProcessState,
    claude_session_id: &str,
) {
    let sid = claude_session_id.trim();
    if sid.is_empty() {
        return;
    }
    let arc_opt = {
        let mut m = process_state.active_child_by_claude_session.lock().await;
        m.remove(sid)
    };
    if let Some(arc) = arc_opt {
        let mut slot = arc.lock().await;
        if let Some(ref mut c) = *slot {
            let _ = c.kill().await;
        }
        *slot = None;
    }
    process_state
        .claude_stdin_by_session
        .lock()
        .await
        .remove(sid);
}

/// Spawn a Claude process and stream output to the frontend
async fn spawn_claude_process(
    cmd: tokio::process::Command,
    app: tauri::AppHandle,
    registry: &ClaudeSessionRegistry,
    project_path: String,
    model: String,
    invocation_key: Option<String>,
    connection_mode: ClaudeConnectionMode,
    concurrency_scope_key: Option<String>,
    concurrency_limit: Option<u32>,
    initial_streaming_prompt: Option<String>,
) -> Result<(), String> {
    let process_state = app.state::<ClaudeProcessState>();
    let child_mutex = process_state.current_process.clone();
    let stdin_map_mtx = process_state.claude_stdin_by_session.clone();
    let pending_stdin_by_spawn_mtx = process_state.pending_stdin_by_spawn_id.clone();
    let active_child_by_session_mtx = process_state.active_child_by_claude_session.clone();
    let active_child_by_invocation_mtx = process_state.active_child_by_invocation_key.clone();
    let current_session_id_mtx = process_state.current_session_id.clone();
    let spawn_id = CLAUDE_SPAWN_SERIAL.fetch_add(1, Ordering::Relaxed);
    let slots_mtx = process_state.spawn_slots_by_scope.clone();
    let acquired_scope =
        try_acquire_claude_spawn_slot(&slots_mtx, concurrency_scope_key, concurrency_limit).await?;

    if connection_mode == ClaudeConnectionMode::Persistent {
        // 常驻连接：接管全局槽位，关闭旧 stdin 并终止旧子进程。
        {
            stdin_map_mtx.lock().await.clear();
            pending_stdin_by_spawn_mtx.lock().await.clear();
            active_child_by_session_mtx.lock().await.clear();
            *current_session_id_mtx.lock().await = None;
            let mut child = child_mutex.lock().await;
            if let Some(ref mut existing) = *child {
                let _ = existing.kill().await;
            }
            *child = None;
        }
    }

    let mut cmd = cmd;
    let base_url_override = crate::claude_llm_proxy::claude_spawn_anthropic_base_url_override();
    crate::claude_config_dir::configure_claude_child_process(
        &mut cmd,
        &project_path,
        base_url_override.as_deref(),
    );
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            release_claude_spawn_slot(&slots_mtx, acquired_scope.clone()).await;
            return Err(format!("Failed to start claude: {}", e));
        }
    };

    let spawned_pid = match child.id() {
        Some(pid) => pid,
        None => {
            let _ = child.kill().await;
            release_claude_spawn_slot(&slots_mtx, acquired_scope.clone()).await;
            return Err("Failed to get process ID".to_string());
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill().await;
            release_claude_spawn_slot(&slots_mtx, acquired_scope.clone()).await;
            return Err("Failed to get stdout handle".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => {
            let _ = child.kill().await;
            release_claude_spawn_slot(&slots_mtx, acquired_scope.clone()).await;
            return Err("Failed to get stderr handle".to_string());
        }
    };
    let stdin = child.stdin.take();
    let wait_child_mutex: Arc<TokioMutex<Option<Child>>>;

    let mut initial_streaming_prompt_sent_at_spawn = false;
    if let Some(sin) = stdin {
        pending_stdin_by_spawn_mtx
            .lock()
            .await
            .insert(spawn_id, sin);
        // 写入 stream-json 用户行（非占位 `\n`）：避免 Trellis Hook 阶段无 stdin 死锁。
        if connection_mode == ClaudeConnectionMode::Streaming {
            if let Some(ref ip) = initial_streaming_prompt {
                try_write_initial_streaming_prompt_pending(
                    spawn_id,
                    ip.as_str(),
                    &mut initial_streaming_prompt_sent_at_spawn,
                    &pending_stdin_by_spawn_mtx,
                )
                .await;
            }
        }
    }

    if connection_mode == ClaudeConnectionMode::Persistent {
        let mut child_guard = child_mutex.lock().await;
        *child_guard = Some(child);
        wait_child_mutex = child_mutex.clone();
    } else {
        wait_child_mutex = Arc::new(TokioMutex::new(Some(child)));
        if let Some(inv) = invocation_key.as_deref() {
            active_child_by_invocation_mtx
                .lock()
                .await
                .insert(inv.to_string(), wait_child_mutex.clone());
        }
    }

    let app_clone = app.clone();
    let registry_clone = registry.clone();
    let wait_child_mutex_clone = wait_child_mutex.clone();
    let stdin_map_mtx_clone = stdin_map_mtx.clone();
    let pending_stdin_by_spawn_clone = pending_stdin_by_spawn_mtx.clone();
    let active_child_by_session_clone = active_child_by_session_mtx.clone();
    let active_child_by_invocation_clone = active_child_by_invocation_mtx.clone();
    let current_session_id_mtx_clone = current_session_id_mtx.clone();
    let project_path_clone = project_path.clone();
    let model_clone = model.clone();
    let invocation_key_clone = invocation_key.clone();
    let connection_mode_stdout = connection_mode;
    let spawned_pid_stdout = spawned_pid;
    let slots_mtx_clone = slots_mtx.clone();
    let acquired_scope_clone = acquired_scope.clone();
    let initial_streaming_prompt_stdout = initial_streaming_prompt;
    let initial_streaming_prompt_sent_at_spawn_stdout = initial_streaming_prompt_sent_at_spawn;

    // Spawn async task for stdout processing
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut real_session_id: Option<String> = None;
        let mut structured_verdict: Option<serde_json::Value> = None;
        let mut initial_streaming_prompt_sent = initial_streaming_prompt_sent_at_spawn_stdout;
        let mut streaming_turn_complete_sent = false;
        // 带 `invocation_key` 的 oneshot/streaming 运行：只走 invocation 通道，避免全局 `claude-output` 把主会话 UI 每条流式行都打爆。
        let suppress_shared_stdout = invocation_key_clone.is_some()
            && (connection_mode_stdout == ClaudeConnectionMode::Oneshot
                || connection_mode_stdout == ClaudeConnectionMode::Streaming);
        let mut active_invocation_key = invocation_key_clone.clone();
        let mut active_suppress_shared = suppress_shared_stdout;

        while let Ok(Some(line)) = lines.next_line().await {
            maybe_ack_control_initialize(&line, &pending_stdin_by_spawn_clone, spawn_id).await;
            // Try to parse as JSON to extract session_id
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let line_sid = extract_claude_session_id_from_stream_json(&json);
                let line_type = json.get("type").and_then(|v| v.as_str());
                let line_subtype = json.get("subtype").and_then(|v| v.as_str());

                if line_type == Some("system") && line_subtype == Some("init") {
                    if let Some(sid) = line_sid.as_deref() {
                        bootstrap_streaming_session_stdin(
                            sid,
                            spawn_id,
                            connection_mode_stdout,
                            initial_streaming_prompt_stdout.as_deref(),
                            &mut initial_streaming_prompt_sent,
                            &mut real_session_id,
                            &pending_stdin_by_spawn_clone,
                            &stdin_map_mtx_clone,
                            &active_child_by_session_clone,
                            &wait_child_mutex_clone,
                            &registry_clone,
                            &project_path_clone,
                            &model_clone,
                            &current_session_id_mtx_clone,
                        )
                        .await;
                    }
                }

                // Trellis SessionStart 完成后绑定 stdin；若 spawn 时未写入则再试 pending。
                if line_type == Some("system") && line_subtype == Some("hook_response") {
                    let outcome = json.get("outcome").and_then(|v| v.as_str()).unwrap_or("");
                    if outcome == "success" {
                        if let Some(ip) = initial_streaming_prompt_stdout.as_deref() {
                            try_write_initial_streaming_prompt_pending(
                                spawn_id,
                                ip,
                                &mut initial_streaming_prompt_sent,
                                &pending_stdin_by_spawn_clone,
                            )
                            .await;
                        }
                        if let Some(sid) = line_sid.as_deref() {
                            bootstrap_streaming_session_stdin(
                                sid,
                                spawn_id,
                                connection_mode_stdout,
                                initial_streaming_prompt_stdout.as_deref(),
                                &mut initial_streaming_prompt_sent,
                                &mut real_session_id,
                                &pending_stdin_by_spawn_clone,
                                &stdin_map_mtx_clone,
                                &active_child_by_session_clone,
                                &wait_child_mutex_clone,
                                &registry_clone,
                                &project_path_clone,
                                &model_clone,
                                &current_session_id_mtx_clone,
                            )
                            .await;
                        }
                    }
                }

                if let Some(candidate) = extract_structured_verdict_candidate(&json) {
                    structured_verdict = Some(candidate);
                }

                if connection_mode_stdout == ClaudeConnectionMode::Streaming {
                    if let Some(turn_ok) = streaming_turn_success_from_result(&json) {
                        let sid_for_turn = real_session_id
                            .as_deref()
                            .or(line_sid.as_deref())
                            .unwrap_or("unknown");
                        let turn_verdict = extract_structured_verdict_candidate(&json);
                        if emit_streaming_turn_complete_events(
                            &app_clone,
                            &registry_clone,
                            sid_for_turn,
                            turn_ok,
                            turn_verdict,
                            active_invocation_key.as_deref(),
                            active_suppress_shared,
                        ) {
                            streaming_turn_complete_sent = true;
                            active_suppress_shared = false;
                        }
                    }
                }
            }

            let sid = real_session_id.as_deref().unwrap_or("unknown");

            emit_claude_stdout_line(
                &app_clone,
                sid,
                &line,
                connection_mode_stdout,
                active_invocation_key.as_deref(),
                active_suppress_shared,
            );
        }

        let child_still_running_after_stdout = {
            let mut slot = wait_child_mutex_clone.lock().await;
            match slot.as_mut() {
                Some(c) if c.id() == Some(spawned_pid_stdout) => c
                    .try_wait()
                    .ok()
                    .flatten()
                    .is_none(),
                _ => false,
            }
        };

        // 长驻 streaming：单轮 result 后 stdout 可能暂时无新行（AskUserQuestion 等 stdin 续答前），继续读直到子进程退出。
        if connection_mode_stdout == ClaudeConnectionMode::Streaming
            && streaming_turn_complete_sent
            && child_still_running_after_stdout
        {
            pending_stdin_by_spawn_clone.lock().await.remove(&spawn_id);
            release_claude_spawn_slot(&slots_mtx_clone, acquired_scope_clone.clone()).await;
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        maybe_ack_control_initialize(
                            &line,
                            &pending_stdin_by_spawn_clone,
                            spawn_id,
                        )
                        .await;
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                            if let Some(turn_ok) = streaming_turn_success_from_result(&json) {
                                let sid_for_turn = real_session_id.as_deref().unwrap_or("unknown");
                                let turn_verdict = extract_structured_verdict_candidate(&json);
                                let _ = emit_streaming_turn_complete_events(
                                    &app_clone,
                                    &registry_clone,
                                    sid_for_turn,
                                    turn_ok,
                                    turn_verdict,
                                    None,
                                    false,
                                );
                            }
                        }
                        let sid = real_session_id.as_deref().unwrap_or("unknown");
                        emit_claude_stdout_line(
                            &app_clone,
                            sid,
                            &line,
                            connection_mode_stdout,
                            active_invocation_key.as_deref(),
                            false,
                        );
                    }
                    Ok(None) => {
                        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        let still = {
                            let mut slot = wait_child_mutex_clone.lock().await;
                            match slot.as_mut() {
                                Some(c) if c.id() == Some(spawned_pid_stdout) => c
                                    .try_wait()
                                    .ok()
                                    .flatten()
                                    .is_none(),
                                _ => false,
                            }
                        };
                        if !still {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }

        // Process finished — 只 wait 本 stdout 对应的子进程。Persistent 下新 spawn 会替换全局槽位并 kill 旧进程，
        // 若旧 reader 对「当前 mutex 里的新 Child」wait，会把别的会话的退出码绑到本会话，前端表现为误报「执行失败」。
        let (exit_status, skip_completion_for_superseded_reader) = {
            let mut slot = wait_child_mutex_clone.lock().await;
            match slot.as_mut() {
                Some(c) if c.id() == Some(spawned_pid_stdout) => (c.wait().await.ok(), false),
                // 槽位已是别的子进程或已清空：本 reader 属于被顶替的旧 spawn，不得发 complete（否则同一 Claude session_id
                // 会立刻收到失败完成事件，前端表现为「第二次刷的一下就结束了」），也不得 remove stdin 误伤新进程。
                _ => (
                    None,
                    connection_mode_stdout == ClaudeConnectionMode::Persistent,
                ),
            }
        };
        if skip_completion_for_superseded_reader {
            pending_stdin_by_spawn_clone.lock().await.remove(&spawn_id);
            release_claude_spawn_slot(&slots_mtx_clone, acquired_scope_clone.clone()).await;
            return;
        }

        let child_still_running = {
            let mut slot = wait_child_mutex_clone.lock().await;
            match slot.as_mut() {
                Some(c) if c.id() == Some(spawned_pid_stdout) => c
                    .try_wait()
                    .ok()
                    .flatten()
                    .is_none(),
                _ => false,
            }
        };

        let sid = real_session_id.as_deref().unwrap_or("unknown");

        // 长驻 streaming：单轮 result 已发过 turn complete；子进程已退出则清理 stdin / registry。
        if connection_mode_stdout == ClaudeConnectionMode::Streaming && streaming_turn_complete_sent {
            if real_session_id.is_some() {
                registry_clone.remove(sid);
            }
            stdin_map_mtx_clone.lock().await.remove(sid);
            if !sid.is_empty() && sid != "unknown" {
                let mut m = active_child_by_session_clone.lock().await;
                if let Some(existing) = m.get(sid) {
                    if Arc::ptr_eq(existing, &wait_child_mutex_clone) {
                        m.remove(sid);
                    }
                }
            }
            if let Some(inv) = invocation_key_clone.as_deref() {
                let mut m = active_child_by_invocation_clone.lock().await;
                if let Some(existing) = m.get(inv) {
                    if Arc::ptr_eq(existing, &wait_child_mutex_clone) {
                        m.remove(inv);
                    }
                }
            }
            pending_stdin_by_spawn_clone.lock().await.remove(&spawn_id);
            release_claude_spawn_slot(&slots_mtx_clone, acquired_scope_clone.clone()).await;
            return;
        }

        let success = exit_status.map(|s| s.success()).unwrap_or(false);
        let complete_payload = ClaudeCompletePayload {
            session_id: sid.to_string(),
            success,
            structured_verdict,
        };

        // Mark session as completed
        registry_clone.mark_completed(sid, success);

        emit_claude_complete_payload(
            &app_clone,
            sid,
            &complete_payload,
            connection_mode_stdout,
            invocation_key_clone.as_deref(),
            suppress_shared_stdout,
        );

        // Clean up registry
        if real_session_id.is_some() {
            registry_clone.remove(sid);
        }
        stdin_map_mtx_clone.lock().await.remove(sid);
        if connection_mode_stdout == ClaudeConnectionMode::Persistent {
            let mut g = current_session_id_mtx_clone.lock().await;
            if g.as_deref() == Some(sid) {
                *g = None;
            }
        }
        if (connection_mode_stdout == ClaudeConnectionMode::Oneshot
            || connection_mode_stdout == ClaudeConnectionMode::Streaming)
            && !sid.is_empty()
            && sid != "unknown"
        {
            let mut m = active_child_by_session_clone.lock().await;
            if let Some(existing) = m.get(sid) {
                if Arc::ptr_eq(existing, &wait_child_mutex_clone) {
                    m.remove(sid);
                }
            }
        }
        if let Some(inv) = invocation_key_clone.as_deref() {
            let mut m = active_child_by_invocation_clone.lock().await;
            if let Some(existing) = m.get(inv) {
                if Arc::ptr_eq(existing, &wait_child_mutex_clone) {
                    m.remove(inv);
                }
            }
        }
        pending_stdin_by_spawn_clone.lock().await.remove(&spawn_id);
        release_claude_spawn_slot(&slots_mtx_clone, acquired_scope_clone.clone()).await;
    });

    // Spawn stderr processing
    let app_stderr = app.clone();
    let invocation_key_stderr = invocation_key.clone();
    let connection_mode_stderr = connection_mode;
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let suppress_shared_stderr = invocation_key_stderr.is_some()
            && (connection_mode_stderr == ClaudeConnectionMode::Oneshot
                || connection_mode_stderr == ClaudeConnectionMode::Streaming);

        while let Ok(Some(line)) = lines.next_line().await {
            if claude_stderr_line_suppressed_for_ui_events(&line) {
                continue;
            }
            let sid = "unknown";
            if !suppress_shared_stderr {
                let _ = app_stderr.emit(&format!("claude-error:{}", sid), &line);
                let _ = app_stderr.emit("claude-error", &line);
            }
            if let Some(inv) = invocation_key_stderr.as_deref() {
                let _ = app_stderr.emit(&format!("claude-error:invocation:{}", inv), &line);
            }
        }
    });

    Ok(())
}

// ── Screenshot capture (macOS) ──

// ── Claude Commands ──

#[tauri::command]
pub(crate) async fn execute_claude_code(
    app: tauri::AppHandle,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    connection_mode: Option<String>,
    concurrency_scope_key: Option<String>,
    concurrency_limit: Option<u32>,
    bare: Option<bool>,
    trellis_context_id: Option<String>,
    cli_extras: Option<ClaudeSpawnCliExtras>,
) -> Result<(), String> {
    let registry = app.state::<ClaudeSessionRegistry>();
    let app_clone = app.clone();
    let model_for_cmd = model.as_deref().and_then(trim_model_cli_arg);
    let extras = cli_extras.unwrap_or_default();
    let cmd = create_claude_command(
        &project_path,
        &prompt,
        model_for_cmd,
        &[],
        bare.unwrap_or(false),
        trellis_context_id.as_deref(),
        &extras,
    )?;
    let model_label = model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "(from Claude config)")
        .to_string();

    let mode = ClaudeConnectionMode::from_option_str(connection_mode.as_deref());
    spawn_claude_process(
        cmd,
        app_clone,
        &registry,
        project_path,
        model_label,
        invocation_key,
        mode,
        concurrency_scope_key,
        concurrency_limit,
        None,
    )
    .await
}

#[tauri::command]
pub(crate) async fn resume_claude_code(
    app: tauri::AppHandle,
    project_path: String,
    session_id: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    connection_mode: Option<String>,
    concurrency_scope_key: Option<String>,
    concurrency_limit: Option<u32>,
    trellis_context_id: Option<String>,
    cli_extras: Option<ClaudeSpawnCliExtras>,
) -> Result<(), String> {
    let process_state = app.state::<ClaudeProcessState>();
    kill_active_claude_run_for_session(&process_state, &session_id).await;
    let resume_sid = session_id.trim().to_string();
    if resume_sid.is_empty() {
        return Err("session_id 不能为空".to_string());
    }

    let registry = app.state::<ClaudeSessionRegistry>();
    let app_clone = app.clone();
    let model_for_cmd = model.as_deref().and_then(trim_model_cli_arg);
    let extras = cli_extras.unwrap_or_default();
    let can_resume = claude_session_jsonl_exists(&project_path, &resume_sid);
    let cmd = if can_resume {
        create_claude_command(
            &project_path,
            &prompt,
            model_for_cmd,
            &["-r", &resume_sid],
            false,
            trellis_context_id.as_deref(),
            &extras,
        )?
    } else {
        create_claude_command(
            &project_path,
            &prompt,
            model_for_cmd,
            &[],
            false,
            trellis_context_id.as_deref(),
            &extras,
        )?
    };
    let model_label = model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| "(from Claude config)")
        .to_string();

    let mode = ClaudeConnectionMode::from_option_str(connection_mode.as_deref());
    spawn_claude_process(
        cmd,
        app_clone,
        &registry,
        project_path,
        model_label,
        invocation_key,
        mode,
        concurrency_scope_key,
        concurrency_limit,
        None,
    )
    .await
}

#[tauri::command]
pub(crate) async fn cancel_claude_execution(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let registry = app.state::<ClaudeSessionRegistry>();
    let process_state = app.state::<ClaudeProcessState>();

    // Mark as cancelled
    registry.mark_completed(&session_id, false);

    let sid = session_id.trim();
    let killed_oneshot = {
        let mut m = process_state.active_child_by_claude_session.lock().await;
        m.remove(sid)
    };
    if let Some(arc) = killed_oneshot {
        let mut slot = arc.lock().await;
        if let Some(ref mut proc) = *slot {
            let _ = proc.kill().await;
        }
        *slot = None;
        process_state
            .claude_stdin_by_session
            .lock()
            .await
            .remove(sid);
    } else {
        let mut global_child = process_state.current_process.lock().await;
        if global_child.is_some() {
            process_state.claude_stdin_by_session.lock().await.clear();
            process_state.pending_stdin_by_spawn_id.lock().await.clear();
            *process_state.current_session_id.lock().await = None;
            if let Some(ref mut proc) = *global_child {
                let _ = proc.kill().await;
            }
            *global_child = None;
        } else {
            process_state
                .claude_stdin_by_session
                .lock()
                .await
                .remove(sid);
        }
    }

    // Emit completion
    let complete_payload = ClaudeCompletePayload {
        session_id: session_id.clone(),
        success: false,
        structured_verdict: None,
    };
    let _ = app.emit(
        &format!("claude-complete:{}", session_id),
        &complete_payload,
    );
    let _ = app.emit("claude-complete", &complete_payload);

    // Clean up registry
    registry.remove(&session_id);

    Ok(())
}

#[tauri::command]
pub(crate) async fn cancel_claude_invocation(
    app: tauri::AppHandle,
    invocation_key: String,
) -> Result<bool, String> {
    let process_state = app.state::<ClaudeProcessState>();
    let inv = invocation_key.trim();
    if inv.is_empty() {
        return Err("invocation_key 不能为空".to_string());
    }
    let tab_session_id = {
        let mut m = process_state.invocation_tab_session_by_key.lock().await;
        m.remove(inv)
    };
    let killed = {
        let mut m = process_state.active_child_by_invocation_key.lock().await;
        m.remove(inv)
    };
    if let Some(arc) = killed {
        let mut slot = arc.lock().await;
        if let Some(ref mut proc) = *slot {
            let _ = proc.kill().await;
        }
        *slot = None;
        let complete_payload = ClaudeCompletePayload {
            session_id: tab_session_id
                .clone()
                .unwrap_or_else(|| inv.to_string()),
            success: false,
            structured_verdict: None,
        };
        let _ = app.emit(
            &format!("claude-complete:invocation:{}", inv),
            &complete_payload,
        );
        if let Some(sid) = tab_session_id {
            let _ = app.emit(&format!("claude-complete:{}", sid), &complete_payload);
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 读取指定 `projectId:repositoryId` 下当前占用的 Claude spawn 槽位数（含批量 OMC 等无 UI 会话的 oneshot）。
#[tauri::command]
pub(crate) async fn get_claude_spawn_slot_count(
    process_state: tauri::State<'_, ClaudeProcessState>,
    scope_key: String,
) -> Result<u32, String> {
    let sk = scope_key.trim();
    if sk.is_empty() {
        return Err("scope_key 不能为空".to_string());
    }
    let m = process_state.spawn_slots_by_scope.lock().await;
    Ok(*m.get(sk).unwrap_or(&0))
}

#[tauri::command]
pub(crate) async fn claude_submit_stdin_line(
    app: tauri::AppHandle,
    process_state: tauri::State<'_, ClaudeProcessState>,
    line: String,
    session_id: Option<String>,
) -> Result<(), String> {
    let target_sid = session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let resolved_sid = if let Some(sid) = target_sid {
        sid.to_string()
    } else if let Some(active) = process_state.current_session_id.lock().await.clone() {
        active
    } else {
        return Err("未指定目标会话，且当前没有可响应会话".to_string());
    };

    let mut stdin_map = process_state.claude_stdin_by_session.lock().await;
    let Some(sin) = stdin_map.get_mut(&resolved_sid) else {
        return Err(format!(
            "会话 {} 没有可写 stdin（可能已结束）",
            resolved_sid
        ));
    };
    use tokio::io::AsyncWriteExt;
    sin.write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    sin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    sin.flush().await.map_err(|e| e.to_string())?;
    drop(stdin_map);
    let registry = app.state::<ClaudeSessionRegistry>();
    registry.mark_running(&resolved_sid);
    Ok(())
}

#[tauri::command]
pub(crate) fn list_running_claude_sessions(app: tauri::AppHandle) -> Vec<ClaudeSessionInfo> {
    let registry = app.state::<ClaudeSessionRegistry>();
    registry.list()
}

// ── Streaming Session Commands (主会话长驻进程模式) ──

/// Streaming 会话用户消息（`--input-format stream-json` stdin 行）。
fn build_streaming_user_message(prompt: &str) -> String {
    serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{ "type": "text", "text": prompt }]
        }
    })
    .to_string()
}

async fn write_streaming_user_message_to_stdin(
    sin: &mut tokio::process::ChildStdin,
    prompt: &str,
) -> Result<(), String> {
    let payload = build_streaming_user_message(prompt);
    use tokio::io::AsyncWriteExt;
    sin.write_all(payload.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    sin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    sin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// 启动 streaming 会话的长驻子进程；首条用户消息在 spawn 后立即写入 pending stdin（并可在 hook/init 后补绑 session）。
/// 前端监听 `claude-output:invocation:{invocation_key}`（与 oneshot 一致）。
#[tauri::command]
pub(crate) async fn spawn_streaming_session(
    app: tauri::AppHandle,
    project_path: String,
    initial_prompt: String,
    model: Option<String>,
    session_id_to_resume: Option<String>,
    invocation_key: Option<String>,
    concurrency_scope_key: Option<String>,
    concurrency_limit: Option<u32>,
    trellis_context_id: Option<String>,
    cli_extras: Option<ClaudeSpawnCliExtras>,
) -> Result<(), String> {
    if initial_prompt.trim().is_empty() {
        return Err("initial_prompt 不能为空".to_string());
    }

    let model_for_cmd = model.as_deref().and_then(trim_model_cli_arg);
    let resume_sid = session_id_to_resume
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let extras = cli_extras.unwrap_or_default();
    let cmd = create_streaming_claude_command(
        &project_path,
        model_for_cmd,
        resume_sid,
        trellis_context_id.as_deref(),
        &extras,
    )?;
    let model_label = model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or("(from Claude config)")
        .to_string();

    let registry = app.state::<ClaudeSessionRegistry>();
    let app_clone = app.clone();

    spawn_claude_process(
        cmd,
        app_clone,
        &registry,
        project_path,
        model_label,
        invocation_key,
        ClaudeConnectionMode::Streaming,
        concurrency_scope_key,
        concurrency_limit,
        Some(initial_prompt),
    )
    .await
}

/// 向已连接的 streaming 会话（按 Claude `session_id`）发送一条用户消息。
#[tauri::command]
pub(crate) async fn send_user_message_to_session(
    app: tauri::AppHandle,
    process_state: tauri::State<'_, ClaudeProcessState>,
    session_id: String,
    prompt: String,
) -> Result<(), String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Err("session_id 不能为空".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("prompt 不能为空".to_string());
    }
    let registry = app.state::<ClaudeSessionRegistry>();
    registry.mark_running(&sid);

    let mut stdin_map = process_state.claude_stdin_by_session.lock().await;
    let Some(sin) = stdin_map.get_mut(&sid) else {
        return Err(format!(
            "Streaming 会话 {} 没有可写 stdin，可能子进程已结束。请重新发送以重启进程。",
            sid
        ));
    };
    write_streaming_user_message_to_stdin(sin, &prompt).await
}

/// 关闭 streaming 会话：终止子进程并释放 stdin 映射。
#[tauri::command]
pub(crate) async fn close_streaming_session(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let sid = session_id.trim().to_string();
    if sid.is_empty() {
        return Ok(());
    }
    let process_state = app.state::<ClaudeProcessState>();
    process_state
        .claude_stdin_by_session
        .lock()
        .await
        .remove(&sid);
    let killed = {
        let mut m = process_state.active_child_by_claude_session.lock().await;
        m.remove(&sid)
    };
    if let Some(arc) = killed {
        let mut slot = arc.lock().await;
        if let Some(ref mut proc) = *slot {
            let _ = proc.kill().await;
        }
        *slot = None;
    }
    Ok(())
}
