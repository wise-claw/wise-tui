use git2::build::CheckoutBuilder;
use git2::BranchType;
use git2::DiffOptions;
use git2::Repository;
use git2::Status;
use git2::StatusOptions;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use walkdir::WalkDir;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::BufRead;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
mod subagents_parser;
mod prd_materialize;
mod wise_db;
mod wise_mascot;
mod wise_push;
mod dingtalk_enterprise_bot;
mod dingtalk_stream_gateway;
mod claude_code_usage;
mod cua_driver;
mod skills_sh;
use subagents_parser::{parse_subagent_markdown, validate_claude_subagent_name};

// ── Claude Code Process ──

/// 每次 spawn 唯一 id，用于并发多进程时 `pending_stdin` 不与其它 stdout reader 抢同一槽位。
static CLAUDE_SPAWN_SERIAL: AtomicU64 = AtomicU64::new(1);

use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Child;
use tokio::sync::Mutex as TokioMutex;

// ── Terminal / PTY ──

use portable_pty::{
    ChildKiller, CommandBuilder, NativePtySystem, PtySize, PtySystem,
};

struct TerminalSession {
    writer: Box<dyn std::io::Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

struct TerminalManager {
    pty_system: NativePtySystem,
    sessions: HashMap<String, TerminalSession>,
}

impl TerminalManager {
    fn new() -> Self {
        Self {
            pty_system: NativePtySystem::default(),
            sessions: HashMap::new(),
        }
    }

    fn open(
        &mut self,
        workspace_id: String,
        terminal_id: String,
        cols: u16,
        rows: u16,
        cwd: String,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        if self.sessions.contains_key(&key) {
            return Err(format!("Terminal session already exists: {}", key));
        }

        let pair = self
            .pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let shell = if cfg!(windows) { "cmd.exe" } else { "zsh" };
        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);
        // GUI 进程继承的 PATH 通常不含 Homebrew / nvm / bun 等，与 `create_claude_command` 一致为 PTY shell 补全 PATH。
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        cmd.env("PATH", path_merged);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let killer = child.clone_killer();

        let workspace_clone = workspace_id.clone();
        let terminal_clone = terminal_id.clone();
        let app_clone = app.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_clone.emit(
                            "terminal-output",
                            serde_json::json!({
                                "workspaceId": workspace_clone,
                                "terminalId": terminal_clone,
                                "data": text,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
            let _ = app_clone.emit(
                "terminal-exit",
                serde_json::json!({
                    "workspaceId": workspace_clone,
                    "terminalId": terminal_clone,
                    "exitCode": 0,
                }),
            );
        });

        self.sessions.insert(
            key,
            TerminalSession {
                writer,
                killer,
            },
        );

        Ok(())
    }

    fn write(&mut self, workspace_id: &str, terminal_id: &str, data: &str) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        let session = self
            .sessions
            .get_mut(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        session.writer.flush().map_err(|e| e.to_string())
    }

    fn resize(&mut self, _workspace_id: &str, _terminal_id: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        // Portable PTY resize is handled at the OS level.
        // The frontend fit addon handles display sizing.
        Ok(())
    }

    fn close(&mut self, workspace_id: &str, terminal_id: &str) -> Result<(), String> {
        let key = format!("{}:{}", workspace_id, terminal_id);
        let mut session = self
            .sessions
            .remove(&key)
            .ok_or_else(|| format!("Terminal session not found: {}", key))?;
        let _ = session.killer.kill();
        Ok(())
    }
}

// ── Repository (Wise sidebar workspace) Types ──

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredRepository {
    id: i64,
    /// 与 `path` 末段目录名一致（打开的仓库名）。
    name: String,
    path: String,
    #[serde(default = "default_repository_type", alias = "repository_type")]
    repository_type: String,
    /// 侧栏圆形角标背景色（`#rgb` / `#rrggbb`）；为空则按 `repository_type` 使用默认色。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_color: Option<String>,
    /// 角标首字来源；为空则取 `name`（目录名）首字。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_display_name: Option<String>,
    branch: Option<String>,
    #[serde(alias = "created_at")]
    created_at: String,
    #[serde(alias = "updated_at")]
    updated_at: String,
}

fn default_repository_type() -> String {
    "frontend".to_string()
}

fn normalize_hex_icon_color(input: Option<String>) -> Option<String> {
    let raw = input?.trim().to_owned();
    if raw.is_empty() {
        return None;
    }
    let without_hash = raw.strip_prefix('#').unwrap_or(&raw);
    if without_hash.len() != 3 && without_hash.len() != 6 {
        return None;
    }
    if !without_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", without_hash.to_ascii_lowercase()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StoredProject {
    id: String,
    name: String,
    repository_ids: Vec<i64>,
    created_at: i64,
    updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EmployeeItem {
    id: String,
    name: String,
    agent_type: String,
    enabled: bool,
    created_at: i64,
    updated_at: i64,
    display_order: i64,
    repository_ids: Vec<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EmployeeTaskCountItem {
    employee_id: String,
    task_count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowTemplateAssignee {
    id: String,
    employee_id: String,
    required_count: i64,
    is_required: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowTemplateStage {
    id: String,
    name: String,
    stage_order: i64,
    pass_rule: String,
    reject_rule: String,
    assignees: Vec<WorkflowTemplateAssignee>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowTemplateItem {
    id: String,
    name: String,
    is_default: bool,
    created_at: i64,
    updated_at: i64,
    stages: Vec<WorkflowTemplateStage>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowTaskItem {
    id: String,
    title: String,
    content: String,
    creator: String,
    workflow_id: String,
    current_stage_index: i64,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowTaskEventItem {
    id: String,
    task_id: String,
    event_type: String,
    payload_json: String,
    created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AcceptanceVerdictSourceStatsItem {
    verdict_source: String,
    count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TaskPendingEmployeeItem {
    employee_id: String,
    name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowGraphItem {
    workflow_id: String,
    version: i64,
    graph: serde_json::Value,
    status: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowGraphValidationError {
    code: String,
    message: String,
    node_id: Option<String>,
    edge_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkflowGraphValidationResult {
    ok: bool,
    errors: Vec<WorkflowGraphValidationError>,
}

// ── Git Types ──

#[derive(Serialize, Clone)]
struct GitFileStatus {
    path: String,
    status: String,
    additions: usize,
    deletions: usize,
}

#[derive(Serialize, Clone)]
struct GitStatusResponse {
    staged: Vec<GitFileStatus>,
    unstaged: Vec<GitFileStatus>,
    branch: Option<String>,
    additions: usize,
    deletions: usize,
    ahead: usize,
    behind: usize,
    upstream: Option<String>,
}

#[derive(Serialize, Clone)]
struct GitLogEntry {
    sha: String,
    summary: String,
    author: String,
    timestamp: i64,
}

#[derive(Serialize, Clone)]
struct GitLogResponse {
    total: usize,
    entries: Vec<GitLogEntry>,
    ahead: usize,
    behind: usize,
    upstream: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitBranchEntry {
    name: String,
    is_remote: bool,
    is_current: bool,
    last_commit_timestamp: Option<i64>,
    last_commit_summary: Option<String>,
    author: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitWorktreeEntry {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    is_primary: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitWorktreeAddOmcBatchResult {
    repo_root: String,
    worktree_path: String,
    branch_name: String,
}

// ── ~/.wise user data (survives app uninstall) ──

pub(crate) fn wise_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Could not resolve home directory".to_string())
        .map(|h| h.join(".wise"))
}

fn wise_repositories_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("repositories.json"))
}

fn wise_legacy_projects_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("projects.json"))
}

fn wise_tabs_json() -> Result<PathBuf, String> {
    Ok(wise_dir()?.join("tabs.json"))
}

fn legacy_repositories_path(app: &tauri::AppHandle) -> PathBuf {
    app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir")
        .join("projects.json")
}

fn write_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.save_tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Ensures `~/.wise/repositories.json` exists: migrates from `~/.wise/projects.json`, then app-data legacy.
fn migrate_repository_storage(app: &tauri::AppHandle) -> Result<(), String> {
    let dest = wise_repositories_json()?;
    if dest.exists() {
        return Ok(());
    }
    let old_wise = wise_legacy_projects_json()?;
    if old_wise.exists() {
        let contents = fs::read_to_string(&old_wise).map_err(|e| e.to_string())?;
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        write_file_atomic(&dest, &contents)?;
        let _ = fs::remove_file(&old_wise);
        return Ok(());
    }
    let legacy = legacy_repositories_path(app);
    if !legacy.exists() {
        return Ok(());
    }
    let contents = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_file_atomic(&dest, &contents)?;
    let _ = fs::remove_file(&legacy);
    Ok(())
}

// ── Repository Helpers ──

fn repository_folder_label_from_path(folder_path: &str) -> String {
    std::path::Path::new(folder_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "未命名仓库".to_string())
}

/// 将 `name` 规范为路径末段；若旧数据曾把自定义侧栏名写在 `name` 里，则迁入 `icon_display_name`。
fn normalize_stored_repository_row(mut r: StoredRepository) -> (StoredRepository, bool) {
    let folder = repository_folder_label_from_path(&r.path);
    let mut changed = false;
    if let Some(ref s) = r.icon_display_name {
        let t = s.trim().to_string();
        if t.is_empty() {
            r.icon_display_name = None;
            changed = true;
        } else if t != *s {
            r.icon_display_name = Some(t);
            changed = true;
        }
    }
    let old_name_trimmed = r.name.trim().to_string();
    if r.icon_display_name.is_none() && !old_name_trimmed.is_empty() && old_name_trimmed != folder {
        r.icon_display_name = Some(old_name_trimmed.clone());
        changed = true;
    }
    if r.name != folder {
        r.name = folder;
        changed = true;
    }
    (r, changed)
}

fn load_repositories(app: &tauri::AppHandle) -> Vec<StoredRepository> {
    let _ = migrate_repository_storage(app);
    let path = match wise_repositories_json() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    if !path.exists() {
        return Vec::new();
    }
    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let list: Vec<StoredRepository> = serde_json::from_str(&contents).unwrap_or_default();
    let mut any_changed = false;
    let mut next = Vec::with_capacity(list.len());
    for r in list {
        let (r2, ch) = normalize_stored_repository_row(r);
        any_changed |= ch;
        next.push(r2);
    }
    if any_changed {
        let _ = save_repositories(app, &next);
    }
    next
}

fn save_repositories(_app: &tauri::AppHandle, repositories: &[StoredRepository]) -> Result<(), String> {
    let path = wise_repositories_json()?;
    let json = serde_json::to_string_pretty(repositories).map_err(|e| e.to_string())?;
    write_file_atomic(&path, &json)
}

#[tauri::command]
fn load_session_tabs() -> Option<serde_json::Value> {
    let path = wise_tabs_json().ok()?;
    if !path.exists() {
        return None;
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
fn save_session_tabs(state: serde_json::Value) -> Result<(), String> {
    let path = wise_tabs_json()?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    write_file_atomic(&path, &json)
}

// ── Git Helpers ──

fn open_repo(path: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| format!("Failed to open git repo: {}", e))
}

fn run_git_command(path: &str, args: &[&str], action: &str) -> Result<(), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|e| format!("{} failed to start: {}", action, e))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    if detail.is_empty() {
        Err(format!("{} failed with exit code {}", action, output.status))
    } else {
        Err(format!("{} failed: {}", action, detail))
    }
}

fn git_rev_parse_show_toplevel(repo_any_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_any_path)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("git rev-parse --show-toplevel failed to start: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git rev-parse --show-toplevel failed".to_string()
        } else {
            format!("git rev-parse --show-toplevel: {}", stderr)
        });
    }
    let top = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if top.is_empty() {
        return Err("git rev-parse --show-toplevel returned empty".to_string());
    }
    Ok(top)
}

fn fnv1a_hash64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 14695981039346656037;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(1099511628211);
    }
    h
}

/// 由 `task_id` + `attempt` 派生固定 10 位十六进制目录名；须与 `src/utils/omcWorktreeSlug.ts` 的 `omcWorktreeSlugHex` 一致。
fn omc_batch_worktree_slug_hex(task_id: &str, attempt: i64) -> String {
    let mut h = fnv1a_hash64(task_id.as_bytes());
    h ^= fnv1a_hash64(&attempt.to_le_bytes());
    h = h.rotate_left(13).wrapping_mul(1099511628211);
    h ^= h >> 33;
    format!("{:010x}", h & 0xffff_ffffff)
}

fn get_git_branch(path: &str) -> Option<String> {
    match Repository::open(path) {
        Ok(repo) => {
            let head = repo.head().ok()?;
            if head.is_branch() {
                head.shorthand().map(|s| s.to_string())
            } else {
                head.target().map(|oid| format!("({})", &oid.to_string()[..7]))
            }
        }
        Err(_) => None,
    }
}

fn enrich_repositories_with_branch(repositories: Vec<StoredRepository>) -> Vec<StoredRepository> {
    repositories
        .into_iter()
        .map(|mut p| {
            p.branch = get_git_branch(&p.path);
            p
        })
        .collect()
}

fn status_char_to_str(status: Status) -> String {
    if status.is_index_new() {
        "A".into()
    } else if status.is_index_modified() {
        "M".into()
    } else if status.is_index_deleted() {
        "D".into()
    } else if status.is_index_renamed() {
        "R".into()
    } else if status.is_index_typechange() {
        "T".into()
    } else if status.is_wt_new() {
        "A".into()
    } else if status.is_wt_modified() {
        "M".into()
    } else if status.is_wt_deleted() {
        "D".into()
    } else if status.is_wt_renamed() {
        "R".into()
    } else if status.is_wt_typechange() {
        "T".into()
    } else {
        "?".into()
    }
}

fn count_commits_between(repo: &Repository, from: git2::Oid, to: git2::Oid) -> usize {
    let mut count = 0;
    if let Ok(mut revwalk) = repo.revwalk() {
        let _ = revwalk.push(to);
        let _ = revwalk.hide(from);
        count = revwalk.count();
    }
    count
}

fn compute_ahead_behind(repo: &Repository) -> Result<(usize, usize, Option<String>), String> {
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_oid = head.target().ok_or("HEAD has no target")?;

    // libgit2 的 git_branch_upstream_name 要求完整本地 ref（refs/heads/...），
    // 不能传 shorthand（如 "main"），否则会判为非法并失败。
    if !head.is_branch() {
        return Ok((0, 0, None));
    }

    let branch = git2::Branch::wrap(head);
    let upstream = match branch.upstream() {
        Ok(u) => u,
        Err(_) => return Ok((0, 0, None)),
    };

    let upstream_ref = upstream
        .get()
        .name()
        .ok_or_else(|| "upstream branch name is not valid UTF-8".to_string())?;

    let upstream_short = upstream_ref
        .strip_prefix("refs/remotes/")
        .unwrap_or(upstream_ref)
        .to_string();

    let upstream_oid = repo
        .refname_to_id(upstream_ref)
        .map_err(|e| e.to_string())?;

    let ahead = count_commits_between(repo, upstream_oid, head_oid);
    let behind = count_commits_between(repo, head_oid, upstream_oid);

    Ok((ahead, behind, Some(upstream_short)))
}

// ── Repository Commands ──

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchedPrdContent {
    title: Option<String>,
    content: String,
    source_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrdTaskRequirementHistoryItem {
    id: String,
    requirement_display_name: String,
    #[serde(default)]
    is_pinned: bool,
    input_value: String,
    #[serde(default)]
    original_input_value: Option<String>,
    context_mode: String,
    linked_project_id: Option<String>,
    linked_repository_id: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrdTaskDraftPayload {
    input_value: String,
    #[serde(default)]
    original_input_value: Option<String>,
    context_mode: String,
    linked_project_id: Option<String>,
    linked_repository_id: Option<i64>,
    /// 用户首次保存需求时填写；已持久化后后续保存不再弹窗。
    #[serde(default)]
    requirement_display_name: Option<String>,
    #[serde(default)]
    current_requirement_id: Option<String>,
    #[serde(default)]
    requirements: Option<Vec<PrdTaskRequirementHistoryItem>>,
}

fn strip_html_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn remove_tag_blocks_case_insensitive(input: &str, tag: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0usize;

    while let Some(rel_open) = lower[cursor..].find(&open_pat) {
        let open_start = cursor + rel_open;
        output.push_str(&input[cursor..open_start]);

        let after_open = match lower[open_start..].find('>') {
            Some(pos) => open_start + pos + 1,
            None => {
                cursor = input.len();
                break;
            }
        };

        if let Some(rel_close) = lower[after_open..].find(&close_pat) {
            cursor = after_open + rel_close + close_pat.len();
        } else {
            cursor = input.len();
            break;
        }
    }

    if cursor < input.len() {
        output.push_str(&input[cursor..]);
    }
    output
}

fn extract_first_tag_block(input: &str, tag: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    let open_pat = format!("<{}", tag);
    let close_pat = format!("</{}>", tag);
    let open_start = lower.find(&open_pat)?;
    let content_start_rel = lower[open_start..].find('>')?;
    let content_start = open_start + content_start_rel + 1;
    let close_rel = lower[content_start..].find(&close_pat)?;
    let content_end = content_start + close_rel;
    Some(input[content_start..content_end].to_string())
}

fn decode_basic_html_entities(input: &str) -> String {
    input
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn extract_html_title(input: &str) -> Option<String> {
    let lower = input.to_ascii_lowercase();
    let start = lower.find("<title>")?;
    let end = lower.find("</title>")?;
    if end <= start + 7 {
        return None;
    }
    let raw = &input[start + 7..end];
    let title = raw.trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

fn normalize_text_blocks(input: &str) -> String {
    input
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
async fn fetch_prd_from_url(url: String) -> Result<FetchedPrdContent, String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("仅支持 http/https 链接".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("创建请求客户端失败: {}", e))?;

    let response = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("拉取链接失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("链接返回异常状态码: {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("读取页面内容失败: {}", e))?;
    let title = extract_html_title(&body);

    // 尽量先抽正文区域，再回退到 body / 全文，降低导航噪音干扰。
    let mut cleaned = body;
    for noisy_tag in ["script", "style", "noscript", "svg", "header", "footer", "nav"] {
        cleaned = remove_tag_blocks_case_insensitive(&cleaned, noisy_tag);
    }

    let main_like = extract_first_tag_block(&cleaned, "article")
        .or_else(|| extract_first_tag_block(&cleaned, "main"))
        .or_else(|| extract_first_tag_block(&cleaned, "body"))
        .unwrap_or_else(|| cleaned.clone());

    let plain_text = strip_html_tags(&main_like);
    let decoded_text = decode_basic_html_entities(&plain_text);
    let content = normalize_text_blocks(&decoded_text);

    if content.is_empty() {
        return Err("未提取到有效正文，请尝试粘贴 Markdown 原文".to_string());
    }

    Ok(FetchedPrdContent {
        title,
        content,
        source_url: trimmed.to_string(),
    })
}

#[tauri::command]
fn list_repositories(app: tauri::AppHandle) -> Vec<StoredRepository> {
    let repositories = load_repositories(&app);
    enrich_repositories_with_branch(repositories)
}

#[tauri::command]
fn create_repository_from_path(
    app: tauri::AppHandle,
    folder_path: String,
    repository_type: String,
    icon_display_name: Option<String>,
    icon_color: Option<String>,
) -> Result<StoredRepository, String> {
    let folder_label = repository_folder_label_from_path(&folder_path);
    let icon_disp = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let existing = load_repositories(&app);
    if existing.iter().any(|p| p.path == folder_path) {
        return Err("此路径的仓库已存在".into());
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let normalized_repository_type = match repository_type.as_str() {
        "frontend" | "backend" | "document" => repository_type,
        _ => return Err("仓库类型无效，仅支持 frontend/backend/document".into()),
    };

    let repository = StoredRepository {
        id: now,
        name: folder_label,
        path: folder_path.clone(),
        repository_type: normalized_repository_type,
        icon_color: normalize_hex_icon_color(icon_color),
        icon_display_name: icon_disp,
        branch: get_git_branch(&folder_path),
        created_at: now.to_string(),
        updated_at: now.to_string(),
    };

    let mut repositories = load_repositories(&app);
    repositories.push(repository.clone());
    save_repositories(&app, &repositories)?;

    Ok(repository)
}

#[tauri::command]
fn update_repository_icon_display(
    app: tauri::AppHandle,
    id: i64,
    icon_display_name: Option<String>,
) -> Result<StoredRepository, String> {
    let mut repositories = load_repositories(&app);
    let idx = repositories
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "仓库未找到".to_string())?;
    let trimmed = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    repositories[idx].icon_display_name = trimmed;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    repositories[idx].updated_at = now.to_string();
    save_repositories(&app, &repositories)?;
    let mut out = repositories[idx].clone();
    out.branch = get_git_branch(&out.path);
    Ok(out)
}

#[tauri::command]
fn remove_repository(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let mut repositories = load_repositories(&app);
    let len_before = repositories.len();
    repositories.retain(|p| p.id != id);
    if repositories.len() == len_before {
        return Err("仓库未找到".into());
    }
    save_repositories(&app, &repositories)
}

fn map_projects(rows: Vec<wise_db::WiseProjectRow>) -> Vec<StoredProject> {
    rows.into_iter()
        .map(|row| StoredProject {
            id: row.id,
            name: row.name,
            repository_ids: row.repository_ids,
            created_at: row.created_at,
            updated_at: row.updated_at,
            icon_display_name: row.icon_display_name.clone(),
            icon_color: row.icon_color.clone(),
        })
        .collect()
}

#[tauri::command]
fn list_projects(db: tauri::State<'_, wise_db::WiseDb>) -> Result<Vec<StoredProject>, String> {
    let rows = db.list_projects()?;
    Ok(map_projects(rows))
}

#[tauri::command]
fn create_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    name: String,
    icon_display_name: Option<String>,
    icon_color: Option<String>,
) -> Result<StoredProject, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    let id = format!("project_{}", Uuid::new_v4().simple());
    let icon_name_sql = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let icon_color_sql = normalize_hex_icon_color(icon_color);
    db.create_project(
        &id,
        trimmed,
        icon_name_sql,
        icon_color_sql.as_deref(),
        now_ms,
    )?;
    let rows = db.list_projects()?;
    let row = rows
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "项目创建失败".to_string())?;
    Ok(StoredProject {
        id: row.id,
        name: row.name,
        repository_ids: row.repository_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
        icon_display_name: row.icon_display_name.clone(),
        icon_color: row.icon_color.clone(),
    })
}

#[tauri::command]
fn update_project_name(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    name: String,
) -> Result<StoredProject, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.update_project_name(&project_id, trimmed, now_ms)?;
    let rows = db.list_projects()?;
    let row = rows
        .into_iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "项目未找到".to_string())?;
    Ok(StoredProject {
        id: row.id,
        name: row.name,
        repository_ids: row.repository_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
        icon_display_name: row.icon_display_name.clone(),
        icon_color: row.icon_color.clone(),
    })
}

#[tauri::command]
fn update_project_icon_badge(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    icon_display_name: Option<String>,
    icon_color: Option<String>,
) -> Result<StoredProject, String> {
    let icon_name_sql = icon_display_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let icon_color_sql = normalize_hex_icon_color(icon_color);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.update_project_icon_badge(
        &project_id,
        icon_name_sql,
        icon_color_sql.as_deref(),
        now_ms,
    )?;
    let rows = db.list_projects()?;
    let row = rows
        .into_iter()
        .find(|item| item.id == project_id)
        .ok_or_else(|| "项目未找到".to_string())?;
    Ok(StoredProject {
        id: row.id,
        name: row.name,
        repository_ids: row.repository_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
        icon_display_name: row.icon_display_name.clone(),
        icon_color: row.icon_color.clone(),
    })
}

#[tauri::command]
fn delete_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<(), String> {
    db.delete_project(&project_id)?;
    let active = db.get_setting("active_project_id")?;
    if active.as_deref() == Some(project_id.as_str()) {
        db.delete_setting("active_project_id")?;
    }
    Ok(())
}

#[tauri::command]
fn add_repository_to_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    repository_id: i64,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.add_repository_to_project(&project_id, repository_id, now_ms)
}

#[tauri::command]
fn reorder_project_repositories(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    repository_ids: Vec<i64>,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.reorder_project_repositories(&project_id, &repository_ids, now_ms)
}

#[tauri::command]
fn remove_repository_from_project(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    repository_id: i64,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;
    db.remove_repository_from_project(&project_id, repository_id, now_ms)
}

#[tauri::command]
fn remove_repository_global(
    app: tauri::AppHandle,
    db: tauri::State<'_, wise_db::WiseDb>,
    id: i64,
) -> Result<(), String> {
    remove_repository(app, id)?;
    db.remove_repository_from_all_projects(id)?;
    Ok(())
}

#[tauri::command]
fn get_active_project_id(db: tauri::State<'_, wise_db::WiseDb>) -> Result<Option<String>, String> {
    db.get_setting("active_project_id")
}

#[tauri::command]
fn set_active_project_id(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = project_id {
        let trimmed = id.trim();
        if trimmed.is_empty() {
            db.delete_setting("active_project_id")
        } else {
            db.set_setting("active_project_id", trimmed)
        }
    } else {
        db.delete_setting("active_project_id")
    }
}

#[tauri::command]
fn list_employees(db: tauri::State<'_, wise_db::WiseDb>) -> Result<Vec<EmployeeItem>, String> {
    let rows = db.list_employees()?;
    Ok(rows
        .into_iter()
        .map(|row| EmployeeItem {
            id: row.id,
            name: row.name,
            agent_type: row.agent_type,
            enabled: row.enabled,
            created_at: row.created_at,
            updated_at: row.updated_at,
            display_order: row.display_order,
            repository_ids: row.repository_ids,
        })
        .collect())
}

#[tauri::command]
fn create_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    name: String,
    agent_type: String,
    enabled: Option<bool>,
    repository_ids: Option<Vec<i64>>,
) -> Result<EmployeeItem, String> {
    let now_ms = unix_now_ms();
    let normalized_name = name.trim();
    let normalized_agent_type = agent_type.trim();
    if normalized_name.is_empty() {
        return Err("员工名称不能为空".to_string());
    }
    if normalized_agent_type.is_empty() {
        return Err("智能体不能为空".to_string());
    }
    let id = format!("employee_{}", Uuid::new_v4().simple());
    let repository_ids = repository_ids.unwrap_or_default();
    db.create_employee(
        &id,
        normalized_name,
        normalized_agent_type,
        enabled.unwrap_or(true),
        now_ms,
        &repository_ids,
    )?;
    let created = db
        .list_employees()?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "员工创建后读取失败".to_string())?;
    Ok(EmployeeItem {
        id: created.id,
        name: created.name,
        agent_type: created.agent_type,
        enabled: created.enabled,
        created_at: created.created_at,
        updated_at: created.updated_at,
        display_order: created.display_order,
        repository_ids: created.repository_ids,
    })
}

#[tauri::command]
fn update_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    employee_id: String,
    name: String,
    agent_type: String,
    enabled: bool,
    repository_ids: Option<Vec<i64>>,
) -> Result<EmployeeItem, String> {
    let now_ms = unix_now_ms();
    let normalized_name = name.trim();
    let normalized_agent_type = agent_type.trim();
    if normalized_name.is_empty() {
        return Err("员工名称不能为空".to_string());
    }
    if normalized_agent_type.is_empty() {
        return Err("智能体不能为空".to_string());
    }
    let repository_ids = repository_ids.unwrap_or_default();
    db.update_employee(
        &employee_id,
        normalized_name,
        normalized_agent_type,
        enabled,
        now_ms,
        &repository_ids,
    )?;
    let updated = db
        .list_employees()?
        .into_iter()
        .find(|item| item.id == employee_id)
        .ok_or_else(|| "员工更新后读取失败".to_string())?;
    Ok(EmployeeItem {
        id: updated.id,
        name: updated.name,
        agent_type: updated.agent_type,
        enabled: updated.enabled,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
        display_order: updated.display_order,
        repository_ids: updated.repository_ids,
    })
}

#[tauri::command]
fn move_employee_display_order(
    db: tauri::State<'_, wise_db::WiseDb>,
    employee_id: String,
    direction: String,
) -> Result<(), String> {
    db.move_employee_display_order(&employee_id, direction.trim())
}

#[tauri::command]
fn delete_employee(
    db: tauri::State<'_, wise_db::WiseDb>,
    employee_id: String,
) -> Result<(), String> {
    db.delete_employee(&employee_id)
}

#[tauri::command]
fn list_employee_task_counts(db: tauri::State<'_, wise_db::WiseDb>) -> Result<Vec<EmployeeTaskCountItem>, String> {
    let rows = db.list_employee_task_counts()?;
    Ok(rows
        .into_iter()
        .map(|row| EmployeeTaskCountItem {
            employee_id: row.employee_id,
            task_count: row.task_count,
        })
        .collect())
}

#[tauri::command]
fn list_workflow_templates(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<WorkflowTemplateItem>, String> {
    let templates = db.list_workflow_templates()?;
    let mut out = Vec::new();
    for tpl in templates {
        let stages = db.list_workflow_stages(&tpl.id)?;
        let stage_ids: Vec<String> = stages.iter().map(|s| s.id.clone()).collect();
        let assignees = db.list_stage_assignees(&stage_ids)?;
        let stage_items: Vec<WorkflowTemplateStage> = stages
            .into_iter()
            .map(|stage| {
                let stage_assignees = assignees
                    .iter()
                    .filter(|a| a.stage_id == stage.id)
                    .map(|a| WorkflowTemplateAssignee {
                        id: a.id.clone(),
                        employee_id: a.employee_id.clone(),
                        required_count: a.required_count,
                        is_required: a.is_required,
                    })
                    .collect();
                WorkflowTemplateStage {
                    id: stage.id,
                    name: stage.name,
                    stage_order: stage.stage_order,
                    pass_rule: stage.pass_rule,
                    reject_rule: stage.reject_rule,
                    assignees: stage_assignees,
                }
            })
            .collect();
        out.push(WorkflowTemplateItem {
            id: tpl.id,
            name: tpl.name,
            is_default: tpl.is_default,
            created_at: tpl.created_at,
            updated_at: tpl.updated_at,
            stages: stage_items,
        });
    }
    Ok(out)
}

#[tauri::command]
fn save_workflow_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: Option<String>,
    name: String,
    is_default: bool,
    stages: Vec<WorkflowTemplateStage>,
) -> Result<WorkflowTemplateItem, String> {
    let now_ms = unix_now_ms();
    let normalized_name = name.trim();
    if normalized_name.is_empty() {
        return Err("工作流名称不能为空".to_string());
    }
    if stages.is_empty() {
        return Err("至少需要一个阶段".to_string());
    }
    let workflow_id_value = workflow_id
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| format!("workflow_{}", Uuid::new_v4().simple()));
    let mut db_stages = Vec::new();
    let mut db_assignees = Vec::new();
    for (idx, stage) in stages.iter().enumerate() {
        let stage_name = stage.name.trim();
        if stage_name.is_empty() {
            return Err("阶段名称不能为空".to_string());
        }
        let stage_id = if stage.id.trim().is_empty() {
            format!("stage_{}", Uuid::new_v4().simple())
        } else {
            stage.id.trim().to_string()
        };
        db_stages.push(wise_db::WiseWorkflowStageRow {
            id: stage_id.clone(),
            workflow_id: workflow_id_value.clone(),
            name: stage_name.to_string(),
            stage_order: idx as i64,
            pass_rule: stage.pass_rule.trim().to_string(),
            reject_rule: stage.reject_rule.trim().to_string(),
        });
        for assignee in &stage.assignees {
            if assignee.employee_id.trim().is_empty() {
                continue;
            }
            let assignee_id = if assignee.id.trim().is_empty() {
                format!("stage_assignee_{}", Uuid::new_v4().simple())
            } else {
                assignee.id.trim().to_string()
            };
            db_assignees.push(wise_db::WiseStageAssigneeRow {
                id: assignee_id,
                stage_id: stage_id.clone(),
                employee_id: assignee.employee_id.trim().to_string(),
                required_count: assignee.required_count.max(1),
                is_required: assignee.is_required,
            });
        }
    }
    db.upsert_workflow_template(
        &workflow_id_value,
        normalized_name,
        is_default,
        now_ms,
        &db_stages,
        &db_assignees,
    )?;
    let templates = list_workflow_templates(db)?;
    templates
        .into_iter()
        .find(|item| item.id == workflow_id_value)
        .ok_or_else(|| "保存后读取工作流失败".to_string())
}

#[tauri::command]
fn delete_workflow_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
) -> Result<(), String> {
    db.delete_workflow_template(workflow_id.trim())
}

#[tauri::command]
fn create_workflow_task(
    db: tauri::State<'_, wise_db::WiseDb>,
    title: String,
    content: String,
    creator: String,
    workflow_id: Option<String>,
) -> Result<WorkflowTaskItem, String> {
    let now_ms = unix_now_ms();
    let title_value = title.trim();
    let creator_value = creator.trim();
    if title_value.is_empty() {
        return Err("任务标题不能为空".to_string());
    }
    if creator_value.is_empty() {
        return Err("任务创建者不能为空".to_string());
    }
    let workflow_id_value = if let Some(id) = workflow_id.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        id
    } else {
        let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
        let default_id: Option<String> = g
            .query_row(
                "SELECT id FROM workflows WHERE is_default = 1 ORDER BY updated_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .ok();
        drop(g);
        default_id.ok_or_else(|| "未找到默认工作流，请先配置工作流".to_string())?
    };
    let task_id = format!("task_{}", Uuid::new_v4().simple());
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let tx = g.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO tasks (id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 'in_progress', ?6, ?7)",
        params![task_id, title_value, content, creator_value, workflow_id_value, now_ms, now_ms],
    )
    .map_err(|e| e.to_string())?;
    let stage_id: String = tx
        .query_row(
            "SELECT id FROM workflow_stages WHERE workflow_id = ?1 ORDER BY stage_order ASC LIMIT 1",
            params![workflow_id_value],
            |row| row.get(0),
        )
        .map_err(|_| "工作流未配置阶段，无法创建任务".to_string())?;
    {
        let mut stmt = tx
            .prepare("SELECT employee_id, required_count FROM stage_assignees WHERE stage_id = ?1")
            .map_err(|e| e.to_string())?;
        let assignees = stmt
            .query_map(params![stage_id.clone()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for item in assignees {
            let (employee_id, required_count) = item.map_err(|e| e.to_string())?;
            let count = required_count.max(1);
            for _ in 0..count {
                tx.execute(
                    "INSERT INTO task_stage_decisions (id, task_id, stage_id, employee_id, decision)
                     VALUES (?1, ?2, ?3, ?4, 'pending')",
                    params![format!("decision_{}", Uuid::new_v4().simple()), task_id, stage_id, employee_id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    let payload = serde_json::json!({
        "action": "task_created",
        "currentStageIndex": 0,
        "workflowId": workflow_id_value,
    });
    tx.execute(
        "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, 'task_created', ?3, ?4)",
        params![format!("event_{}", Uuid::new_v4().simple()), task_id, payload.to_string(), now_ms],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(WorkflowTaskItem {
        id: task_id,
        title: title_value.to_string(),
        content,
        creator: creator_value.to_string(),
        workflow_id: workflow_id_value,
        current_stage_index: 0,
        status: "in_progress".to_string(),
        created_at: now_ms,
        updated_at: now_ms,
    })
}

#[tauri::command]
fn list_workflow_tasks(
    db: tauri::State<'_, wise_db::WiseDb>,
    creator: Option<String>,
) -> Result<Vec<WorkflowTaskItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut out = Vec::new();
    if let Some(creator_id) = creator.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        let mut stmt = g
            .prepare(
                "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
                 FROM tasks
                 WHERE creator = ?1
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![creator_id], |row| {
                Ok(WorkflowTaskItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    creator: row.get(3)?,
                    workflow_id: row.get(4)?,
                    current_stage_index: row.get(5)?,
                    status: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }
    let mut stmt = g
        .prepare(
            "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
             FROM tasks
             ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WorkflowTaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                creator: row.get(3)?,
                workflow_id: row.get(4)?,
                current_stage_index: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn list_task_events(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
) -> Result<Vec<WorkflowTaskEventItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let mut stmt = g
        .prepare(
            "SELECT id, task_id, event_type, payload_json, created_at
             FROM task_events
             WHERE task_id = ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id.trim()], |row| {
            Ok(WorkflowTaskEventItem {
                id: row.get(0)?,
                task_id: row.get(1)?,
                event_type: row.get(2)?,
                payload_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}


#[tauri::command]
fn get_acceptance_verdict_source_stats(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: Option<String>,
) -> Result<Vec<AcceptanceVerdictSourceStatsItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;

    let sql_with_task =
        "SELECT COALESCE(json_extract(payload_json, '$.verdictSource'), 'unknown') AS verdict_source,
                COUNT(*) AS cnt
         FROM task_events
         WHERE task_id = ?1
           AND event_type IN ('workflow_acceptance_verdict_submitted', 'workflow_acceptance_verdict_unresolved')
         GROUP BY verdict_source
         ORDER BY cnt DESC, verdict_source ASC";
    let sql_all =
        "SELECT COALESCE(json_extract(payload_json, '$.verdictSource'), 'unknown') AS verdict_source,
                COUNT(*) AS cnt
         FROM task_events
         WHERE event_type IN ('workflow_acceptance_verdict_submitted', 'workflow_acceptance_verdict_unresolved')
         GROUP BY verdict_source
         ORDER BY cnt DESC, verdict_source ASC";

    let mut out = Vec::new();
    if let Some(task) = task_id.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        let mut stmt = g.prepare(sql_with_task).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![task], |row| {
                Ok(AcceptanceVerdictSourceStatsItem {
                    verdict_source: row.get(0)?,
                    count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }

    let mut stmt = g.prepare(sql_all).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(AcceptanceVerdictSourceStatsItem {
                verdict_source: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn append_task_event(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
    event_type: String,
    payload_json: String,
) -> Result<WorkflowTaskEventItem, String> {
    let now_ms = unix_now_ms();
    let task_id_value = task_id.trim();
    let event_type_value = event_type.trim();
    let payload_value = payload_json.trim();
    if task_id_value.is_empty() {
        return Err("taskId 不能为空".to_string());
    }
    if event_type_value.is_empty() {
        return Err("eventType 不能为空".to_string());
    }
    if payload_value.is_empty() {
        return Err("payloadJson 不能为空".to_string());
    }
    let event_id = format!("event_{}", Uuid::new_v4().simple());
    let parsed_payload: serde_json::Value =
        serde_json::from_str(payload_value).map_err(|_| "payloadJson 必须是合法 JSON".to_string())?;
    let payload_corr_id = parsed_payload
        .get("correlationId")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let payload_graph_node_id = parsed_payload
        .get("graphNodeId")
        .or_else(|| parsed_payload.get("nodeId"))
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let insert_result = g.execute(
        "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![event_id, task_id_value, event_type_value, payload_value, now_ms],
    );

    match insert_result {
        Ok(_) => Ok(WorkflowTaskEventItem {
            id: event_id,
            task_id: task_id_value.to_string(),
            event_type: event_type_value.to_string(),
            payload_json: payload_value.to_string(),
            created_at: now_ms,
        }),
        Err(rusqlite::Error::SqliteFailure(err, _))
            if err.code == rusqlite::ErrorCode::ConstraintViolation
                && payload_corr_id.is_some()
                && payload_graph_node_id.is_some()
                && (event_type_value == "workflow_acceptance_verdict_submitted"
                    || event_type_value == "workflow_acceptance_verdict_unresolved") =>
        {
            let existing = g
                .query_row(
                    "SELECT id, task_id, event_type, payload_json, created_at
                     FROM task_events
                     WHERE task_id = ?1
                       AND event_type = ?2
                       AND json_extract(payload_json, '$.graphNodeId') = ?3
                       AND json_extract(payload_json, '$.correlationId') = ?4
                     ORDER BY created_at ASC
                     LIMIT 1",
                    params![
                        task_id_value,
                        event_type_value,
                        payload_graph_node_id.unwrap(),
                        payload_corr_id.unwrap()
                    ],
                    |row| {
                        Ok(WorkflowTaskEventItem {
                            id: row.get(0)?,
                            task_id: row.get(1)?,
                            event_type: row.get(2)?,
                            payload_json: row.get(3)?,
                            created_at: row.get(4)?,
                        })
                    },
                )
                .map_err(|e| e.to_string())?;
            Ok(existing)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn list_task_pending_employees(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
) -> Result<Vec<TaskPendingEmployeeItem>, String> {
    let g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let (workflow_id, current_stage_index): (String, i64) = g
        .query_row(
            "SELECT workflow_id, current_stage_index FROM tasks WHERE id = ?1",
            params![task_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "任务不存在".to_string())?;
    let stage_id: String = g
        .query_row(
            "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
            params![workflow_id, current_stage_index],
            |row| row.get(0),
        )
        .map_err(|_| "任务当前阶段不存在".to_string())?;
    let mut stmt = g
        .prepare(
            "SELECT DISTINCT e.id, e.name
             FROM task_stage_decisions d
             JOIN employees e ON e.id = d.employee_id
             WHERE d.task_id = ?1
               AND d.stage_id = ?2
               AND d.decision = 'pending'
             ORDER BY e.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![task_id.trim(), stage_id], |row| {
            Ok(TaskPendingEmployeeItem {
                employee_id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in rows {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
fn decide_workflow_task_stage(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
    employee_id: String,
    decision: String,
    reason: Option<String>,
) -> Result<WorkflowTaskItem, String> {
    let now_ms = unix_now_ms();
    let normalized_decision = decision.trim().to_lowercase();
    if normalized_decision != "approved" && normalized_decision != "rejected" {
        return Err("decision 仅支持 approved/rejected".to_string());
    }
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let tx = g.transaction().map_err(|e| e.to_string())?;
    let (workflow_id, current_stage_index, _status): (String, i64, String) = tx
        .query_row(
            "SELECT workflow_id, current_stage_index, status FROM tasks WHERE id = ?1",
            params![task_id.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "任务不存在".to_string())?;
    let stage_id: String = tx
        .query_row(
            "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
            params![workflow_id, current_stage_index],
            |row| row.get(0),
        )
        .map_err(|_| "当前阶段不存在".to_string())?;
    let rows_updated = tx
        .execute(
            "UPDATE task_stage_decisions
             SET decision = ?1, reason = ?2, decided_at = ?3
             WHERE id = (
               SELECT id FROM task_stage_decisions
               WHERE task_id = ?4 AND stage_id = ?5 AND employee_id = ?6 AND decision = 'pending'
               ORDER BY rowid ASC
               LIMIT 1
             )",
            params![
                normalized_decision,
                reason.clone().unwrap_or_default(),
                now_ms,
                task_id.trim(),
                stage_id,
                employee_id.trim()
            ],
        )
        .map_err(|e| e.to_string())?;
    if rows_updated == 0 {
        return Err(
            "未写入阶段决议：该员工在当前阶段没有待决记录，请检查工作流参与人与节点绑定员工是否一致。"
                .to_string(),
        );
    }
    if normalized_decision == "rejected" {
        let next_stage_index = if current_stage_index > 0 { current_stage_index - 1 } else { 0 };
        // 驳回时执行“回退上一阶段”；若已在首阶段则不再回退，保持首阶段进行中。
        let next_status = "in_progress";
        let rollback_stage_id: String = tx
            .query_row(
                "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
                params![workflow_id, next_stage_index],
                |row| row.get(0),
            )
            .map_err(|_| "回退目标阶段不存在".to_string())?;

        // 回退后重置目标阶段决策为 pending，确保员工可继续执行该阶段。
        tx.execute(
            "DELETE FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2",
            params![task_id.trim(), rollback_stage_id.clone()],
        )
        .map_err(|e| e.to_string())?;
        let mut rollback_stmt = tx
            .prepare("SELECT employee_id, required_count FROM stage_assignees WHERE stage_id = ?1")
            .map_err(|e| e.to_string())?;
        let rollback_assignees = rollback_stmt
            .query_map(params![rollback_stage_id.clone()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for item in rollback_assignees {
            let (rollback_employee_id, required_count) = item.map_err(|e| e.to_string())?;
            let count = required_count.max(1);
            for _ in 0..count {
                tx.execute(
                    "INSERT INTO task_stage_decisions (id, task_id, stage_id, employee_id, decision)
                     VALUES (?1, ?2, ?3, ?4, 'pending')",
                    params![
                        format!("decision_{}", Uuid::new_v4().simple()),
                        task_id.trim(),
                        rollback_stage_id,
                        rollback_employee_id
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        tx.execute(
            "UPDATE tasks SET current_stage_index = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
            params![next_stage_index, next_status, now_ms, task_id.trim()],
        )
        .map_err(|e| e.to_string())?;
        let payload = serde_json::json!({
            "action": "task_rejected",
            "employeeId": employee_id.trim(),
            "reason": reason.unwrap_or_default(),
            "fromStageIndex": current_stage_index,
            "toStageIndex": next_stage_index,
            "rollbackApplied": current_stage_index > 0,
        });
        tx.execute(
            "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
             VALUES (?1, ?2, 'task_rejected', ?3, ?4)",
            params![format!("event_{}", Uuid::new_v4().simple()), task_id.trim(), payload.to_string(), now_ms],
        )
        .map_err(|e| e.to_string())?;
    } else {
        let pass_rule: String = tx
            .query_row(
                "SELECT pass_rule FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
                params![workflow_id, current_stage_index],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let should_advance = if pass_rule == "ANY_APPROVE" {
            let approved_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2 AND decision = 'approved'",
                    params![task_id.trim(), stage_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            approved_count > 0
        } else {
            let total_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2",
                    params![task_id.trim(), stage_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            let approved_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM task_stage_decisions WHERE task_id = ?1 AND stage_id = ?2 AND decision = 'approved'",
                    params![task_id.trim(), stage_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            total_count > 0 && total_count == approved_count
        };
        if should_advance {
            let next_stage_exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM workflow_stages WHERE workflow_id = ?1 AND stage_order = ?2",
                    params![workflow_id, current_stage_index + 1],
                    |row| row.get(0),
                )
                .ok();
            if let Some(next_stage_id) = next_stage_exists {
                tx.execute(
                    "UPDATE tasks SET current_stage_index = ?1, status = 'in_progress', updated_at = ?2 WHERE id = ?3",
                    params![current_stage_index + 1, now_ms, task_id.trim()],
                )
                .map_err(|e| e.to_string())?;
                let mut stmt = tx
                    .prepare("SELECT employee_id, required_count FROM stage_assignees WHERE stage_id = ?1")
                    .map_err(|e| e.to_string())?;
                let next_assignees = stmt
                    .query_map(params![next_stage_id.clone()], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                    })
                    .map_err(|e| e.to_string())?;
                for item in next_assignees {
                    let (next_employee_id, required_count) = item.map_err(|e| e.to_string())?;
                    let count = required_count.max(1);
                    for _ in 0..count {
                        tx.execute(
                            "INSERT INTO task_stage_decisions (id, task_id, stage_id, employee_id, decision)
                             VALUES (?1, ?2, ?3, ?4, 'pending')",
                            params![
                                format!("decision_{}", Uuid::new_v4().simple()),
                                task_id.trim(),
                                next_stage_id,
                                next_employee_id
                            ],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            } else {
                tx.execute(
                    "UPDATE tasks SET status = 'completed', updated_at = ?1 WHERE id = ?2",
                    params![now_ms, task_id.trim()],
                )
                .map_err(|e| e.to_string())?;
            }
            let payload = serde_json::json!({
                "action": "task_approved",
                "employeeId": employee_id.trim(),
                "fromStageIndex": current_stage_index,
                "advanced": true
            });
            tx.execute(
                "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
                 VALUES (?1, ?2, 'task_approved', ?3, ?4)",
                params![format!("event_{}", Uuid::new_v4().simple()), task_id.trim(), payload.to_string(), now_ms],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    g.query_row(
        "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
         FROM tasks WHERE id = ?1",
        params![task_id.trim()],
        |row| {
            Ok(WorkflowTaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                creator: row.get(3)?,
                workflow_id: row.get(4)?,
                current_stage_index: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn end_workflow_task(
    db: tauri::State<'_, wise_db::WiseDb>,
    task_id: String,
    reason: Option<String>,
) -> Result<WorkflowTaskItem, String> {
    let now_ms = unix_now_ms();
    let task_id_value = task_id.trim();
    if task_id_value.is_empty() {
        return Err("taskId 不能为空".to_string());
    }
    let mut g = db.0.lock().map_err(|_| "db lock poisoned".to_string())?;
    let tx = g.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE tasks
         SET status = 'archived', updated_at = ?1
         WHERE id = ?2",
        params![now_ms, task_id_value],
    )
    .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "action": "task_archived",
        "reason": reason.clone().unwrap_or_else(|| "手动结束".to_string()),
        "createdAt": now_ms,
    });
    tx.execute(
        "INSERT INTO task_events (id, task_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, 'task_archived', ?3, ?4)",
        params![
            format!("event_{}", Uuid::new_v4().simple()),
            task_id_value,
            payload.to_string(),
            now_ms
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    g.query_row(
        "SELECT id, title, content, creator, workflow_id, current_stage_index, status, created_at, updated_at
         FROM tasks WHERE id = ?1",
        params![task_id_value],
        |row| {
            Ok(WorkflowTaskItem {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                creator: row.get(3)?,
                workflow_id: row.get(4)?,
                current_stage_index: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_task_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
) -> Result<Option<String>, String> {
    let storage_key = match key.as_str() {
        "repositorySplit" => "task_template_repository_split",
        "projectSplit" => "task_template_project_split",
        _ => return Err("不支持的模板 key".to_string()),
    };
    db.get_setting(storage_key)
}

#[tauri::command]
fn set_task_template(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    let storage_key = match key.as_str() {
        "repositorySplit" => "task_template_repository_split",
        "projectSplit" => "task_template_project_split",
        _ => return Err("不支持的模板 key".to_string()),
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("模板内容不能为空".to_string());
    }
    db.set_setting(storage_key, trimmed)
}

fn repo_task_split_prompt_storage_key(repository_id: i64) -> String {
    format!("repo_task_split_prompt:{repository_id}")
}

#[tauri::command]
fn get_repo_task_split_prompt_section(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<Option<String>, String> {
    db.get_setting(&repo_task_split_prompt_storage_key(repository_id))
}

#[tauri::command]
fn set_repo_task_split_prompt_section(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
    value: String,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("提示词内容不能为空".to_string());
    }
    db.set_setting(&repo_task_split_prompt_storage_key(repository_id), trimmed)
}

#[tauri::command]
fn clear_repo_task_split_prompt_section(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<(), String> {
    db.delete_setting(&repo_task_split_prompt_storage_key(repository_id))
}

fn project_split_prompt_layers_storage_key(project_id: &str) -> String {
    format!("split_prompt_layers:project:{project_id}")
}

fn repository_split_prompt_layers_storage_key(repository_id: i64) -> String {
    format!("split_prompt_layers:repo:{repository_id}")
}

const PLATFORM_SPLIT_PROMPT_LAYERS_KEY: &str = "split_prompt_layers:platform_default";

#[tauri::command]
fn get_platform_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<String>, String> {
    db.get_setting(PLATFORM_SPLIT_PROMPT_LAYERS_KEY)
}

#[tauri::command]
fn get_project_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<Option<String>, String> {
    db.get_setting(&project_split_prompt_layers_storage_key(project_id.trim()))
}

#[tauri::command]
fn set_project_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
    value: String,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("JSON 内容不能为空".to_string());
    }
    serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("JSON 无效: {}", e))?;
    db.set_setting(
        &project_split_prompt_layers_storage_key(project_id.trim()),
        trimmed,
    )
}

#[tauri::command]
fn clear_project_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    project_id: String,
) -> Result<(), String> {
    db.delete_setting(&project_split_prompt_layers_storage_key(project_id.trim()))
}

#[tauri::command]
fn get_repository_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<Option<String>, String> {
    db.get_setting(&repository_split_prompt_layers_storage_key(repository_id))
}

#[tauri::command]
fn set_repository_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
    value: String,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("JSON 内容不能为空".to_string());
    }
    serde_json::from_str::<serde_json::Value>(trimmed)
        .map_err(|e| format!("JSON 无效: {}", e))?;
    db.set_setting(
        &repository_split_prompt_layers_storage_key(repository_id),
        trimmed,
    )
}

#[tauri::command]
fn clear_repository_split_prompt_layers(
    db: tauri::State<'_, wise_db::WiseDb>,
    repository_id: i64,
) -> Result<(), String> {
    db.delete_setting(&repository_split_prompt_layers_storage_key(repository_id))
}

#[tauri::command]
fn get_prd_task_draft(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<PrdTaskDraftPayload>, String> {
    let raw = db.get_setting("prd_task_draft")?;
    if let Some(value) = raw {
        let parsed: PrdTaskDraftPayload =
            serde_json::from_str(&value).map_err(|e| format!("解析 PRD 草稿失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn set_prd_task_draft(
    db: tauri::State<'_, wise_db::WiseDb>,
    payload: PrdTaskDraftPayload,
) -> Result<(), String> {
    if payload.context_mode != "project" && payload.context_mode != "repository" {
        return Err("contextMode 仅支持 project/repository".to_string());
    }
    if let Some(requirements) = &payload.requirements {
        for item in requirements {
            if item.context_mode != "project" && item.context_mode != "repository" {
                return Err("requirements[].contextMode 仅支持 project/repository".to_string());
            }
        }
    }
    let raw = serde_json::to_string(&payload).map_err(|e| format!("序列化 PRD 草稿失败: {}", e))?;
    db.set_setting("prd_task_draft", &raw)
}

#[tauri::command]
fn clear_prd_task_draft(db: tauri::State<'_, wise_db::WiseDb>) -> Result<(), String> {
    db.delete_setting("prd_task_draft")
}

#[tauri::command]
fn get_app_setting(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
) -> Result<Option<String>, String> {
    db.get_setting(key.trim())
}

#[tauri::command]
fn set_app_setting(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    const MAX_APP_SETTING_SIZE: usize = 2 * 1024 * 1024;
    let normalized_key = key.trim();
    if normalized_key.is_empty() {
        return Err("setting key 不能为空".to_string());
    }
    if value.len() > MAX_APP_SETTING_SIZE {
        return Err("setting value 过大（超过 2MB）".to_string());
    }
    db.set_setting(normalized_key, &value)
}

#[tauri::command]
fn delete_app_setting(
    db: tauri::State<'_, wise_db::WiseDb>,
    key: String,
) -> Result<(), String> {
    db.delete_setting(key.trim())
}

#[tauri::command]
fn get_prd_task_split_result(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<serde_json::Value>, String> {
    let raw = db.get_prd_task_split_payload()?;
    if let Some(value) = raw {
        let parsed: serde_json::Value =
            serde_json::from_str(&value).map_err(|e| format!("解析任务拆分结果失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn set_prd_task_split_result(
    db: tauri::State<'_, wise_db::WiseDb>,
    split: serde_json::Value,
    executable: serde_json::Value,
) -> Result<(), String> {
    if !split.is_object() {
        return Err("任务拆分结果格式无效".to_string());
    }
    let split_raw =
        serde_json::to_string(&split).map_err(|e| format!("序列化任务拆分结果失败: {}", e))?;
    let executable_raw =
        serde_json::to_string(&executable).map_err(|e| format!("序列化可执行任务失败: {}", e))?;
    db.set_prd_task_split_and_executable_payloads(&split_raw, &executable_raw)
}

#[tauri::command]
fn get_prd_executable_tasks_result(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Option<serde_json::Value>, String> {
    let raw = db.get_prd_executable_tasks_payload()?;
    if let Some(value) = raw {
        let parsed: serde_json::Value =
            serde_json::from_str(&value).map_err(|e| format!("解析可执行任务失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn clear_prd_task_split_result(db: tauri::State<'_, wise_db::WiseDb>) -> Result<(), String> {
    db.clear_prd_task_split_payload()
}

#[tauri::command]
fn get_workflow_graph(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
) -> Result<Option<WorkflowGraphItem>, String> {
    let row = db.get_workflow_graph(workflow_id.trim())?;
    let Some(graph_row) = row else {
        return Ok(None);
    };
    let graph: serde_json::Value = serde_json::from_str(&graph_row.graph_json)
        .map_err(|e| format!("解析 workflow graph 失败: {}", e))?;
    Ok(Some(WorkflowGraphItem {
        workflow_id: graph_row.workflow_id,
        version: graph_row.version,
        graph,
        status: graph_row.status,
        created_at: graph_row.created_at,
        updated_at: graph_row.updated_at,
    }))
}

#[tauri::command]
fn save_workflow_graph(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_id: String,
    graph: serde_json::Value,
    version: Option<i64>,
    status: Option<String>,
) -> Result<WorkflowGraphItem, String> {
    let workflow_id_value = workflow_id.trim();
    if workflow_id_value.is_empty() {
        return Err("workflowId 不能为空".to_string());
    }
    let validation = validate_workflow_graph(graph.clone())?;
    if !validation.ok {
        let messages = validation
            .errors
            .iter()
            .map(|item| item.message.clone())
            .collect::<Vec<String>>()
            .join("; ");
        return Err(format!("workflow graph 校验失败: {}", messages));
    }
    let graph_json = serde_json::to_string(&graph).map_err(|e| format!("序列化 workflow graph 失败: {}", e))?;
    let version_value = version.unwrap_or(1).max(1);
    let status_value = status
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "draft".to_string());
    let now_ms = unix_now_ms();
    db.upsert_workflow_graph(workflow_id_value, version_value, &graph_json, &status_value, now_ms)?;
    get_workflow_graph(db, workflow_id_value.to_string())?
        .ok_or_else(|| "保存后读取 workflow graph 失败".to_string())
}

#[tauri::command]
fn validate_workflow_graph(graph: serde_json::Value) -> Result<WorkflowGraphValidationResult, String> {
    let mut errors = Vec::new();
    let Some(graph_obj) = graph.as_object() else {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_INVALID_FORMAT".to_string(),
            message: "graph 必须是对象".to_string(),
            node_id: None,
            edge_id: None,
        });
        return Ok(WorkflowGraphValidationResult { ok: false, errors });
    };
    let Some(nodes) = graph_obj.get("nodes").and_then(|v| v.as_array()) else {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_NODES_INVALID".to_string(),
            message: "nodes 必须是数组".to_string(),
            node_id: None,
            edge_id: None,
        });
        return Ok(WorkflowGraphValidationResult { ok: false, errors });
    };
    if nodes.is_empty() {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_NODES_EMPTY".to_string(),
            message: "nodes 不能为空".to_string(),
            node_id: None,
            edge_id: None,
        });
    }
    let mut start_count = 0;
    let mut node_ids = std::collections::HashSet::new();
    let mut duplicate_node_ids = std::collections::HashSet::new();
    let mut incoming_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut outgoing_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut approval_node_ids = std::collections::HashSet::new();
    for node in nodes {
        let node_id = node
            .get("id")
            .and_then(|v| v.as_str())
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let node_type = node.get("type").and_then(|v| v.as_str()).map(str::trim);
        let data_type = node
            .get("data")
            .and_then(|v| v.as_object())
            .and_then(|data| data.get("type").and_then(|v| v.as_str()).or_else(|| data.get("kind").and_then(|v| v.as_str())))
            .map(str::trim);
        if matches!(node_type, Some("start")) || matches!(data_type, Some("start")) {
            start_count += 1;
        }
        if matches!(node_type, Some("approval")) || matches!(data_type, Some("approval")) {
            if let Some(id) = node_id.clone() {
                approval_node_ids.insert(id);
            }
        }
        if node_type.is_none() {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_NODE_TYPE_MISSING".to_string(),
                message: "节点缺少 type".to_string(),
                node_id: node_id.clone(),
                edge_id: None,
            });
        }
        if let Some(id) = node_id {
            if !node_ids.insert(id.clone()) {
                duplicate_node_ids.insert(id.clone());
            }
            incoming_counts.entry(id.clone()).or_insert(0);
            outgoing_counts.entry(id).or_insert(0);
        } else {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_NODE_ID_MISSING".to_string(),
                message: "节点缺少 id".to_string(),
                node_id: None,
                edge_id: None,
            });
        }
    }
    for duplicate_id in duplicate_node_ids {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_NODE_ID_DUPLICATED".to_string(),
            message: "存在重复的节点 id".to_string(),
            node_id: Some(duplicate_id),
            edge_id: None,
        });
    }
    let Some(edges) = graph_obj.get("edges").and_then(|v| v.as_array()) else {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_EDGES_INVALID".to_string(),
            message: "edges 必须是数组".to_string(),
            node_id: None,
            edge_id: None,
        });
        return Ok(WorkflowGraphValidationResult { ok: false, errors });
    };
    let mut edge_ids = std::collections::HashSet::new();
    let mut duplicate_edge_ids = std::collections::HashSet::new();
    if edges.is_empty() {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_EDGES_EMPTY".to_string(),
            message: "edges 不能为空".to_string(),
            node_id: None,
            edge_id: None,
        });
    }
    {
        for edge in edges {
            let edge_id = edge
                .get("id")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            if let Some(id) = edge_id.clone() {
                if !edge_ids.insert(id.clone()) {
                    duplicate_edge_ids.insert(id);
                }
            } else {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_ID_MISSING".to_string(),
                    message: "边缺少 id".to_string(),
                    node_id: None,
                    edge_id: None,
                });
            }
            let source = edge
                .get("source")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            let target = edge
                .get("target")
                .and_then(|v| v.as_str())
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty());
            if source.is_none() || target.is_none() {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_ENDPOINT_MISSING".to_string(),
                    message: "边缺少 source 或 target".to_string(),
                    node_id: None,
                    edge_id: edge_id.clone(),
                });
                continue;
            }
            let source_id = source.unwrap_or_default();
            let target_id = target.unwrap_or_default();
            if !node_ids.contains(&source_id) {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_SOURCE_NOT_FOUND".to_string(),
                    message: "边的 source 节点不存在".to_string(),
                    node_id: Some(source_id.clone()),
                    edge_id: edge_id.clone(),
                });
            } else if let Some(count) = outgoing_counts.get_mut(&source_id) {
                *count += 1;
            }
            if !node_ids.contains(&target_id) {
                errors.push(WorkflowGraphValidationError {
                    code: "WF_GRAPH_EDGE_TARGET_NOT_FOUND".to_string(),
                    message: "边的 target 节点不存在".to_string(),
                    node_id: Some(target_id.clone()),
                    edge_id: edge_id.clone(),
                });
            } else if let Some(count) = incoming_counts.get_mut(&target_id) {
                *count += 1;
            }
        }
    }
    for duplicate_edge_id in duplicate_edge_ids {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_EDGE_ID_DUPLICATED".to_string(),
            message: "存在重复的边 id".to_string(),
            node_id: None,
            edge_id: Some(duplicate_edge_id),
        });
    }
    for approval_id in approval_node_ids {
        let incoming = incoming_counts.get(&approval_id).copied().unwrap_or(0);
        let outgoing = outgoing_counts.get(&approval_id).copied().unwrap_or(0);
        if incoming == 0 {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_APPROVAL_INCOMING_MISSING".to_string(),
                message: "审批节点至少需要一条入边".to_string(),
                node_id: Some(approval_id.clone()),
                edge_id: None,
            });
        }
        if outgoing == 0 {
            errors.push(WorkflowGraphValidationError {
                code: "WF_GRAPH_APPROVAL_OUTGOING_MISSING".to_string(),
                message: "审批节点至少需要一条出边".to_string(),
                node_id: Some(approval_id),
                edge_id: None,
            });
        }
    }
    if start_count == 0 {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_START_MISSING".to_string(),
            message: "必须包含一个 start 节点".to_string(),
            node_id: None,
            edge_id: None,
        });
    } else if start_count > 1 {
        errors.push(WorkflowGraphValidationError {
            code: "WF_GRAPH_START_DUPLICATED".to_string(),
            message: "start 节点只能有一个".to_string(),
            node_id: None,
            edge_id: None,
        });
    }
    Ok(WorkflowGraphValidationResult {
        ok: errors.is_empty(),
        errors,
    })
}

fn unix_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
fn get_workflow_run(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_run_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let raw = db.get_workflow_run_payload(&workflow_run_id)?;
    if let Some(value) = raw {
        let parsed: serde_json::Value =
            serde_json::from_str(&value).map_err(|e| format!("解析 workflow run 失败: {}", e))?;
        Ok(Some(parsed))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn set_workflow_run(
    db: tauri::State<'_, wise_db::WiseDb>,
    run: serde_json::Value,
) -> Result<(), String> {
    if !run.is_object() {
        return Err("workflow run 格式无效".to_string());
    }
    let workflow_run_id = run
        .get("workflowRunId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "workflowRunId 缺失".to_string())?;
    let session_id = run
        .get("sessionId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "sessionId 缺失".to_string())?;
    let repository_path = run
        .get("repositoryPath")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "repositoryPath 缺失".to_string())?;
    let updated_at = run
        .get("updatedAt")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(unix_now_ms);
    let raw = serde_json::to_string(&run).map_err(|e| format!("序列化 workflow run 失败: {}", e))?;
    db.set_workflow_run_payload(workflow_run_id, session_id, repository_path, &raw, updated_at)
}

#[tauri::command]
fn list_workflow_runs(
    db: tauri::State<'_, wise_db::WiseDb>,
) -> Result<Vec<serde_json::Value>, String> {
    // 与前端 listRuns 上限对齐；payload 内 tasks 可极大，列表仅用于绑定会话，剥离后再过 IPC。
    let raws = db.list_workflow_run_payloads(500)?;
    let mut out = Vec::new();
    for raw in raws {
        let mut parsed: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("解析 workflow run 失败: {}", e))?;
        if let Some(obj) = parsed.as_object_mut() {
            obj.insert("tasks".to_string(), serde_json::json!([]));
        }
        out.push(parsed);
    }
    Ok(out)
}

#[tauri::command]
fn append_workflow_event(
    db: tauri::State<'_, wise_db::WiseDb>,
    event: serde_json::Value,
) -> Result<(), String> {
    if !event.is_object() {
        return Err("workflow event 格式无效".to_string());
    }
    let event_id = event
        .get("eventId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "eventId 缺失".to_string())?;
    let workflow_run_id = event
        .get("workflowRunId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "workflowRunId 缺失".to_string())?;
    let timestamp = event
        .get("timestamp")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(unix_now_ms);
    let raw = serde_json::to_string(&event).map_err(|e| format!("序列化 workflow event 失败: {}", e))?;
    db.append_workflow_event_payload(event_id, workflow_run_id, timestamp, &raw)
}

#[tauri::command]
fn migrate_workflow_session_tab_references(
    db: tauri::State<'_, wise_db::WiseDb>,
    from_tab_id: String,
    to_session_id: String,
) -> Result<(), String> {
    db.migrate_claude_tab_session_references(&from_tab_id, &to_session_id)
}

#[tauri::command]
fn list_workflow_events(
    db: tauri::State<'_, wise_db::WiseDb>,
    workflow_run_id: String,
    from: Option<i64>,
    until: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let raws = db.list_workflow_event_payloads(&workflow_run_id, from, until)?;
    let mut out = Vec::new();
    for raw in raws {
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("解析 workflow event 失败: {}", e))?;
        out.push(parsed);
    }
    Ok(out)
}

#[tauri::command]
fn open_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    app.opener().open_path(&path, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_claude_user_agents_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = user_claude_agents_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.to_string_lossy().to_string();
    app.opener().open_path(&p, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_claude_user_agents_dir() -> Result<String, String> {
    let dir = user_claude_agents_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// macOS：`open` 失败时仍可能返回 `Ok` 给 invoke（此前未检查退出码）；WPS 营销名与 `-a` 所需名不一致。
#[cfg(target_os = "macos")]
fn macos_open_with_named_app(path: &Path, app_name: &str, args: &[String]) -> Result<(), String> {
    let mut last_stderr = String::new();

    let mut run_open = |cmd: &mut std::process::Command| -> bool {
        match cmd.output() {
            Ok(out) => {
                if out.status.success() {
                    return true;
                }
                let s = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if !s.is_empty() {
                    last_stderr = s;
                }
                false
            }
            Err(e) => {
                last_stderr = e.to_string();
                false
            }
        }
    };

    // WPS：常见安装为 `wpsoffice.app`，Bundle ID 多为 `com.kingsoft.wpsoffice.mac`（国区/国际略有差异）
    if app_name.eq_ignore_ascii_case("WPS Office") || app_name.eq_ignore_ascii_case("wpsoffice") {
        for bid in [
            "com.kingsoft.wpsoffice.mac",
            "com.kingsoft.wpsoffice.mac.global",
        ] {
            let mut c = std::process::Command::new("open");
            c.arg("-b").arg(bid).arg(path).args(args);
            if run_open(&mut c) {
                return Ok(());
            }
        }
        for an in ["wpsoffice", "WPS Office"] {
            let mut c = std::process::Command::new("open");
            c.arg("-a").arg(an).arg(path).args(args);
            if run_open(&mut c) {
                return Ok(());
            }
        }
        return Err(if last_stderr.is_empty() {
            "无法用 WPS 打开该文件，请确认已安装 WPS Office，或改用「用默认应用打开」。".to_string()
        } else {
            format!("无法用 WPS 打开：{last_stderr}")
        });
    }

    // Microsoft Word：优先显示名，失败再按 Bundle ID
    if app_name.eq_ignore_ascii_case("Microsoft Word") {
        let mut c = std::process::Command::new("open");
        c.arg("-a").arg("Microsoft Word").arg(path).args(args);
        if run_open(&mut c) {
            return Ok(());
        }
        let mut c = std::process::Command::new("open");
        c.arg("-b").arg("com.microsoft.Word").arg(path).args(args);
        if run_open(&mut c) {
            return Ok(());
        }
        return Err(if last_stderr.is_empty() {
            "无法用 Microsoft Word 打开，请确认已安装 Word，或改用「用默认应用打开」。".to_string()
        } else {
            format!("无法用 Microsoft Word 打开：{last_stderr}")
        });
    }

    let mut c = std::process::Command::new("open");
    c.arg("-a").arg(app_name).arg(path).args(args);
    if run_open(&mut c) {
        return Ok(());
    }
    Err(if last_stderr.is_empty() {
        format!("无法使用「{app_name}」打开该文件。")
    } else {
        format!("无法使用「{app_name}」打开：{last_stderr}")
    })
}

#[tauri::command]
fn open_workspace_in(
    app: tauri::AppHandle,
    path: String,
    app_name: Option<String>,
    command: Option<String>,
    args: Vec<String>,
) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if let Some(name) = app_name {
        #[cfg(target_os = "macos")]
        {
            return macos_open_with_named_app(path_buf.as_path(), name.trim(), &args);
        }
        #[cfg(target_os = "windows")]
        {
            let path_str = path_buf.to_string_lossy().to_string();
            let status = std::process::Command::new("cmd")
                .args(["/C", "start", "", name.trim(), &path_str])
                .status()
                .map_err(|e| format!("打开失败: {e}"))?;
            if !status.success() {
                return Err(format!(
                    "无法使用「{}」打开文件（退出码 {:?}）。请确认已安装该应用，或改用默认应用。",
                    name.trim(),
                    status.code()
                ));
            }
            return Ok(());
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = path_buf;
            let _ = args;
            return Err(format!(
                "指定应用「{}」打开：当前桌面环境请使用「用默认应用打开」",
                name.trim()
            ));
        }
    }

    if let Some(cmd) = command {
        let out = std::process::Command::new(&cmd)
            .arg(&path_buf)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("命令「{}」执行失败（退出码 {:?}）", cmd, out.status.code())
            } else {
                format!("命令「{}」失败：{}", cmd, err)
            });
        }
        return Ok(());
    }

    app.opener().open_path(&path, None::<String>).map_err(|e| e.to_string())
}

// ── Git Commands ──

#[tauri::command]
fn git_status(path: String) -> Result<GitStatusResponse, String> {
    let repo = open_repo(&path)?;
    let branch = get_git_branch(&path);

    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.include_ignored(false);
    opts.recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let mut staged: Vec<GitFileStatus> = Vec::new();
    let mut unstaged: Vec<GitFileStatus> = Vec::new();

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let staged_line_stats = collect_staged_line_stats(&repo, head_tree.as_ref());
    let unstaged_line_stats = collect_unstaged_line_stats(&repo);

    for entry in statuses.iter() {
        let status = entry.status();
        let file_path = entry.path().unwrap_or("").to_string();
        if file_path.is_empty() {
            continue;
        }
        let status_str = status_char_to_str(status);

        let is_index = status.is_index_new()
            || status.is_index_modified()
            || status.is_index_deleted()
            || status.is_index_renamed()
            || status.is_index_typechange();
        let is_wt = status.is_wt_new()
            || status.is_wt_modified()
            || status.is_wt_deleted()
            || status.is_wt_renamed()
            || status.is_wt_typechange();

        let file_status = GitFileStatus {
            path: file_path.clone(),
            status: status_str,
            additions: 0,
            deletions: 0,
        };

        if is_index {
            let (adds, dels) = staged_line_stats.get(&file_path).copied().unwrap_or((0, 0));
            let file_status = GitFileStatus {
                additions: adds,
                deletions: dels,
                ..file_status
            };
            if is_wt {
                let (wt_adds, wt_dels) = unstaged_line_stats.get(&file_path).copied().unwrap_or((0, 0));
                unstaged.push(GitFileStatus {
                    additions: wt_adds,
                    deletions: wt_dels,
                    ..file_status.clone()
                });
            }
            staged.push(file_status);
        } else {
            let (adds, dels) = unstaged_line_stats.get(&file_path).copied().unwrap_or_else(|| {
                if status.is_wt_new() {
                    count_file_lines_for_untracked(&path, &file_path)
                } else {
                    (0, 0)
                }
            });
            unstaged.push(GitFileStatus {
                additions: adds,
                deletions: dels,
                ..file_status
            });
        }
    }

    let total_additions = staged.iter().map(|f| f.additions).sum::<usize>()
        + unstaged.iter().map(|f| f.additions).sum::<usize>();
    let total_deletions = staged.iter().map(|f| f.deletions).sum::<usize>()
        + unstaged.iter().map(|f| f.deletions).sum::<usize>();

    let (ahead, behind, upstream) = compute_ahead_behind(&repo).unwrap_or((0, 0, None));

    Ok(GitStatusResponse {
        staged,
        unstaged,
        branch,
        additions: total_additions,
        deletions: total_deletions,
        ahead,
        behind,
        upstream,
    })
}

fn collect_staged_line_stats(
    repo: &Repository,
    head_tree: Option<&git2::Tree<'_>>,
) -> HashMap<String, (usize, usize)> {
    let Some(tree) = head_tree else {
        return HashMap::new();
    };
    let Ok(diff) = repo.diff_tree_to_index(Some(tree), None, None) else {
        return HashMap::new();
    };
    collect_line_stats_from_diff(&diff)
}

fn collect_unstaged_line_stats(repo: &Repository) -> HashMap<String, (usize, usize)> {
    let mut opts = DiffOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    let Ok(diff) = repo.diff_index_to_workdir(None, Some(&mut opts)) else {
        return HashMap::new();
    };
    collect_line_stats_from_diff(&diff)
}

fn collect_line_stats_from_diff(diff: &git2::Diff<'_>) -> HashMap<String, (usize, usize)> {
    let mut map: HashMap<String, (usize, usize)> = HashMap::new();
    let _ = diff.foreach(
        &mut |_delta, _| true,
        None,
        None,
        Some(&mut |delta, _hunk, line| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            if path.is_empty() {
                return true;
            }
            let entry = map.entry(path).or_insert((0, 0));
            match line.origin() {
                '+' => entry.0 += 1,
                '-' => entry.1 += 1,
                _ => {}
            }
            true
        }),
    );
    map
}

fn count_file_lines_for_untracked(repo_path: &str, rel_path: &str) -> (usize, usize) {
    let full_path = Path::new(repo_path).join(rel_path);
    let Ok(content) = fs::read_to_string(full_path) else {
        return (0, 0);
    };
    (content.lines().count(), 0)
}

#[tauri::command]
fn git_stage(path: String, file_path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    // Use add_all with the path to support both files and directories
    index.add_all(&[&file_path], git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())
}

/// 取消暂存单个路径：等价于 `git reset HEAD -- <path>`。
/// 已跟踪文件从 HEAD 树恢复索引项；新文件（HEAD 中不存在）从索引移除。
#[tauri::command]
fn git_unstage(path: String, file_path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let target = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.into_object());
    repo.reset_default(target.as_ref(), [&file_path])
        .map_err(|e| e.to_string())
}

/// 取消全部暂存：等价于 `git reset HEAD -- .`
#[tauri::command]
fn git_unstage_all(path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.into_object())
        .ok_or_else(|| "No commits in repository, nothing to unstage".to_string())?;
    repo.reset(&head, git2::ResetType::Mixed, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn git_commit(path: String, message: String) -> Result<String, String> {
    let repo = open_repo(&path)?;
    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Wise User", "wise@local"))
        .map_err(|e| e.to_string())?;

    let tree_id = repo
        .index()
        .map_err(|e| e.to_string())?
        .write_tree()
        .map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let parent = head.peel_to_commit().map_err(|e| e.to_string())?;

    let commit_oid = repo
        .commit(
            Some("HEAD"),
            &sig,
            &sig,
            &message,
            &tree,
            &[&parent],
        )
        .map_err(|e| e.to_string())?;

    Ok(commit_oid.to_string())
}

#[tauri::command]
fn git_push(path: String) -> Result<(), String> {
    open_repo(&path)?;
    run_git_command(&path, &["push", "origin", "HEAD"], "Push")
}

#[tauri::command]
fn git_pull(path: String) -> Result<(), String> {
    open_repo(&path)?;
    run_git_command(&path, &["pull", "--no-rebase"], "Pull")
}

#[tauri::command]
fn git_fetch(path: String) -> Result<(), String> {
    open_repo(&path)?;
    run_git_command(&path, &["fetch", "--all", "--prune"], "Fetch")
}

/// 放弃路径下更改（文件或目录）：已跟踪文件从索引恢复到工作区，未跟踪文件由 `git clean` 删除。
/// 与 `git_stage` 使用目录 pathspec 的行为一致；纯 `checkout_index` 无法丢弃未跟踪文件，故用 CLI。
#[tauri::command]
fn git_discard(path: String, file_path: String) -> Result<(), String> {
    open_repo(&path)?;
    let restore = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["restore", "--worktree", "--", &file_path])
        .output()
        .map_err(|e| format!("Discard failed to start: {}", e))?;
    if !restore.status.success() {
        let stderr = String::from_utf8_lossy(&restore.stderr);
        let s = stderr.to_lowercase();
        // 仅含未跟踪内容时 pathspec 可能不匹配，此时仍应继续 clean
        if !s.contains("did not match any file")
            && !s.contains("did not match any files")
            && !stderr.contains("未匹配")
        {
            return Err(format!("Discard failed: {}", stderr.trim()));
        }
    }
    run_git_command(&path, &["clean", "-fd", "--", &file_path], "Discard (clean)")
}

/// 放弃全部更改：等价于 `git checkout -- .` 加上清理未跟踪文件。
#[tauri::command]
fn git_discard_all(path: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    // Discard tracked file changes
    let mut checkout_opts = CheckoutBuilder::new();
    checkout_opts.force();
    repo.checkout_index(None, Some(&mut checkout_opts))
        .map_err(|e| format!("Failed to discard changes: {}", e))?;
    // Remove untracked files
    let mut remove_opts = git2::build::CheckoutBuilder::new();
    remove_opts.remove_untracked(true);
    repo.checkout_head(Some(&mut remove_opts))
        .map_err(|e| e.to_string())
}

/// `git show <revision_path>`，如 `HEAD:src/a.ts`、`:src/a.ts`（索引）。对象不存在时返回空串。
#[tauri::command]
fn git_show_revision(repository_path: String, revision_path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&repository_path)
        .arg("show")
        .arg(&revision_path)
        .output()
        .map_err(|e| format!("git show failed to start: {}", e))?;

    if output.status.success() {
        return String::from_utf8(output.stdout).map_err(|e| e.to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let lower = stderr.to_lowercase();
    let missing = lower.contains("does not exist")
        || lower.contains("exists on disk, but not in")
        || (lower.contains("pathspec") && lower.contains("did not match"))
        || lower.contains("bad revision")
        || (lower.contains("fatal:")
            && (lower.contains("not a valid object name") || lower.contains("invalid object")));
    if missing {
        return Ok(String::new());
    }
    Err(format!("git show {}: {}", revision_path, stderr.trim()))
}

#[tauri::command]
fn git_log(path: String, limit: usize) -> Result<GitLogResponse, String> {
    let repo = open_repo(&path)?;
    let (ahead, behind, upstream) = compute_ahead_behind(&repo).unwrap_or((0, 0, None));

    let head = repo.head().map_err(|e| e.to_string())?;
    let head_oid = head.target().ok_or("HEAD has no target")?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push(head_oid).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for oid in revwalk.take(limit) {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        entries.push(GitLogEntry {
            sha: oid.to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            timestamp: commit.time().seconds(),
        });
    }

    Ok(GitLogResponse {
        total: entries.len(),
        entries,
        ahead,
        behind,
        upstream,
    })
}

#[tauri::command]
fn git_init(path: String) -> Result<String, String> {
    let repo = Repository::init(&path).map_err(|e| e.to_string())?;
    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Wise User", "wise@local"))
        .map_err(|e| e.to_string())?;
    let empty_tree_id = repo
        .treebuilder(None)
        .map_err(|e| e.to_string())?
        .write()
        .map_err(|e| e.to_string())?;
    let empty_tree = repo.find_tree(empty_tree_id).map_err(|e| e.to_string())?;
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, "Initial commit", &empty_tree, &[])
        .map_err(|e| e.to_string())?;
    Ok(oid.to_string())
}

#[tauri::command]
fn git_remote_url(path: String) -> Result<Option<String>, String> {
    let repo = open_repo(&path)?;
    let result = match repo.find_remote("origin") {
        Ok(remote) => remote.url().map(|s| s.to_string()),
        Err(_) => None,
    };
    Ok(result)
}

#[tauri::command]
fn git_list_branches(path: String) -> Result<Vec<GitBranchEntry>, String> {
    let repo = open_repo(&path)?;
    let mut out: Vec<GitBranchEntry> = Vec::new();

    for branch_type in [BranchType::Local, BranchType::Remote] {
        let iter = repo.branches(Some(branch_type)).map_err(|e| e.to_string())?;
        for item in iter {
            let (branch, _) = item.map_err(|e| e.to_string())?;
            let Some(name_raw) = branch.name().map_err(|e| e.to_string())? else {
                continue;
            };
            let name = name_raw.trim().to_string();
            if name.is_empty() {
                continue;
            }
            if name == "HEAD" {
                continue;
            }
            let oid = branch.get().target();
            let (last_commit_timestamp, last_commit_summary, author) = if let Some(target_oid) = oid {
                match repo.find_commit(target_oid) {
                    Ok(commit) => (
                        Some(commit.time().seconds()),
                        commit.summary().map(|s| s.to_string()),
                        commit.author().name().map(|s| s.to_string()),
                    ),
                    Err(_) => (None, None, None),
                }
            } else {
                (None, None, None)
            };
            out.push(GitBranchEntry {
                name,
                is_remote: branch_type == BranchType::Remote,
                is_current: branch.is_head(),
                last_commit_timestamp,
                last_commit_summary,
                author,
            });
        }
    }

    out.sort_by(|a, b| {
        let ka = (!a.is_current, a.is_remote, a.name.to_lowercase());
        let kb = (!b.is_current, b.is_remote, b.name.to_lowercase());
        ka.cmp(&kb)
    });

    Ok(out)
}

#[tauri::command]
fn git_checkout_branch(path: String, branch_name: String) -> Result<(), String> {
    let repo = open_repo(&path)?;
    let name = branch_name.trim();
    if name.is_empty() {
        return Err("Branch name is empty".to_string());
    }
    if repo.find_branch(name, BranchType::Local).is_ok() {
        return run_git_command(&path, &["checkout", name], "Checkout");
    }
    if repo.find_branch(name, BranchType::Remote).is_ok() {
        return run_git_command(&path, &["checkout", "--track", name], "Checkout");
    }
    Err(format!("Branch not found: {}", name))
}

#[tauri::command]
fn git_create_branch(
    path: String,
    branch_name: String,
    from_ref: Option<String>,
    checkout: Option<bool>,
) -> Result<(), String> {
    open_repo(&path)?;
    let name = branch_name.trim();
    if name.is_empty() {
        return Err("Branch name is empty".to_string());
    }
    if name.contains(' ') {
        return Err("Branch name cannot contain spaces".to_string());
    }
    let from = from_ref
        .as_ref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());
    let should_checkout = checkout.unwrap_or(true);

    if should_checkout {
        let mut args: Vec<&str> = vec!["checkout", "-b", name];
        if let Some(from_name) = from {
            args.push(from_name);
        }
        run_git_command(&path, &args, "Create branch")
    } else {
        let mut args: Vec<&str> = vec!["branch", name];
        if let Some(from_name) = from {
            args.push(from_name);
        }
        run_git_command(&path, &args, "Create branch")
    }
}

#[tauri::command]
fn git_checkout_detached(path: String, target_ref: String) -> Result<(), String> {
    open_repo(&path)?;
    let target = target_ref.trim();
    if target.is_empty() {
        return Err("Target ref is empty".to_string());
    }
    run_git_command(&path, &["checkout", "--detach", target], "Checkout detached")
}

fn parse_git_worktree_porcelain(stdout: &str, repo_path: &str) -> Result<Vec<GitWorktreeEntry>, String> {
    let repo_canon = fs::canonicalize(Path::new(repo_path))
        .map_err(|e| format!("Invalid repository path: {}", e))?;
    let mut entries: Vec<GitWorktreeEntry> = Vec::new();
    let mut wt_path: Option<String> = None;
    let mut wt_head: Option<String> = None;
    let mut wt_branch: Option<String> = None;

    let mut flush_block =
        |path: &mut Option<String>, head: &mut Option<String>, branch: &mut Option<String>| {
            if let Some(p) = path.take() {
                let is_primary = fs::canonicalize(Path::new(&p))
                    .map(|c| c == repo_canon)
                    .unwrap_or(false);
                entries.push(GitWorktreeEntry {
                    path: p,
                    head: head.take(),
                    branch: branch.take(),
                    is_primary,
                });
            } else {
                head.take();
                branch.take();
            }
        };

    for line in stdout.lines() {
        if line.is_empty() {
            flush_block(&mut wt_path, &mut wt_head, &mut wt_branch);
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            flush_block(&mut wt_path, &mut wt_head, &mut wt_branch);
            wt_path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            wt_head = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            wt_branch = Some(rest.trim().to_string());
        }
    }
    flush_block(&mut wt_path, &mut wt_head, &mut wt_branch);
    Ok(entries)
}

fn worktree_request_matches_entry(request: &str, entry_path: &str) -> bool {
    let request = request.trim();
    let entry_path = entry_path.trim();
    if request.is_empty() || entry_path.is_empty() {
        return false;
    }
    if request == entry_path {
        return true;
    }
    let rq = request.replace('\\', "/");
    let eq = entry_path.replace('\\', "/");
    if rq == eq {
        return true;
    }
    match (
        fs::canonicalize(Path::new(request)),
        fs::canonicalize(Path::new(entry_path)),
    ) {
        (Ok(a), Ok(b)) if a == b => true,
        _ => false,
    }
}

/// Git 已解除 worktree 登记后，若磁盘上仍残留工作区目录则递归删除（与 UI「移除」语义一致）。
fn remove_worktree_directory_if_leftover(worktree_disk_path: &str, repo_path: &str) -> Result<(), String> {
    let wt = Path::new(worktree_disk_path);
    if !wt.exists() {
        return Ok(());
    }
    let repo_canon =
        fs::canonicalize(Path::new(repo_path)).map_err(|e| format!("仓库路径无效: {}", e))?;
    let wt_canon = fs::canonicalize(wt).map_err(|e| format!("无法访问 worktree 目录: {}", e))?;
    if wt_canon == repo_canon {
        return Err("安全限制：不可删除主仓库目录".to_string());
    }
    fs::remove_dir_all(&wt_canon).map_err(|e| format!("删除 worktree 目录失败: {}", e))
}

#[tauri::command]
fn git_worktree_list(path: String) -> Result<Vec<GitWorktreeEntry>, String> {
    open_repo(&path)?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["worktree", "list", "--porcelain"])
        .output()
        .map_err(|e| format!("git worktree list failed to start: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() {
            stderr
        } else {
            stdout
        };
        return Err(if detail.is_empty() {
            "git worktree list failed".to_string()
        } else {
            format!("git worktree list failed: {}", detail)
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_git_worktree_porcelain(&stdout, &path)
}

#[tauri::command]
fn git_worktree_remove(path: String, worktree_path: String) -> Result<(), String> {
    open_repo(&path)?;
    let list = git_worktree_list(path.clone())?;
    let target = worktree_path.trim();
    if target.is_empty() {
        return Err("Worktree path is empty".to_string());
    }
    let matched = list
        .iter()
        .find(|e| !e.is_primary && worktree_request_matches_entry(target, &e.path));
    let Some(entry) = matched else {
        return Err("未找到可移除的 worktree，或该路径为主工作区".to_string());
    };

    let worktree_disk_path = entry.path.clone();

    let remove_res = run_git_command(
        &path,
        &["worktree", "remove", "--force", worktree_disk_path.as_str()],
        "Remove worktree",
    );
    if remove_res.is_ok() {
        remove_worktree_directory_if_leftover(&worktree_disk_path, &path)?;
        return Ok(());
    }
    let remove_err = remove_res.unwrap_err();

    // 目录已被删等情况：remove 失败时用 prune 清理 git 登记的幽灵 worktree
    let _ = run_git_command(&path, &["worktree", "prune"], "Worktree prune");
    let after = git_worktree_list(path.clone())?;
    let still_there = after
        .iter()
        .any(|e| !e.is_primary && worktree_request_matches_entry(target, &e.path));
    if !still_there {
        remove_worktree_directory_if_leftover(&worktree_disk_path, &path)?;
        return Ok(());
    }

    Err(remove_err)
}

#[tauri::command]
fn git_worktree_add_omc_batch(
    repo_path: String,
    task_id: String,
    attempt: i64,
) -> Result<GitWorktreeAddOmcBatchResult, String> {
    open_repo(&repo_path)?;
    let top = git_rev_parse_show_toplevel(&repo_path)?;
    let top_path = Path::new(&top);
    let parent = top_path.parent().ok_or_else(|| {
        "仓库根目录无上级路径，无法在其旁创建 wise-worktrees（与 omcAdapter 约定一致）".to_string()
    })?;
    let slug = omc_batch_worktree_slug_hex(&task_id, attempt);
    let branch_name = format!("wise/o/{}", slug);
    let dir_name = slug;
    let wt_parent = parent.join("wise-worktrees");
    fs::create_dir_all(&wt_parent).map_err(|e| format!("创建 wise-worktrees 父目录失败: {}", e))?;
    let wt_path = wt_parent.join(&dir_name);

    let top_canon = fs::canonicalize(top_path).map_err(|e| format!("无效仓库根: {}", e))?;
    if wt_path.starts_with(&top_canon) {
        return Err("内部错误：计算的 worktree 路径落在主仓库目录内，已中止".to_string());
    }

    if wt_path.exists() {
        let wt_arg = wt_path.to_string_lossy().to_string();
        let _ = git_worktree_remove(top.clone(), wt_arg.clone());
        if wt_path.exists() {
            remove_worktree_directory_if_leftover(&wt_arg, &top)?;
        }
        let _ = run_git_command(&top, &["worktree", "prune"], "Worktree prune");
    }

    let wt_str = wt_path.to_string_lossy().to_string();
    run_git_command(
        &top,
        &["worktree", "add", wt_str.as_str(), "-b", branch_name.as_str(), "HEAD"],
        "git worktree add (OMC batch)",
    )?;

    let abs = fs::canonicalize(&wt_path).map_err(|e| format!("无法解析 worktree 路径: {}", e))?;
    let abs_str = abs.to_string_lossy().to_string();
    Ok(GitWorktreeAddOmcBatchResult {
        repo_root: top,
        worktree_path: abs_str,
        branch_name,
    })
}

// ── File Watcher ──

struct GitWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<String>,
}

impl GitWatcherState {
    fn new() -> Self {
        Self {
            watcher: None,
            watched_path: None,
        }
    }
}

#[tauri::command]
fn start_git_watcher(
    state: tauri::State<Mutex<GitWatcherState>>,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // If already watching the same path, skip
    if let Some(ref watched) = state.watched_path {
        if *watched == path {
            return Ok(());
        }
    }

    // Stop existing watcher if any
    state.watcher = None;
    state.watched_path = None;

    let project_path = PathBuf::from(&path);
    let git_path = project_path.join(".git");

    // Build list of paths to watch: project root + .git (if it exists)
    let mut watch_paths: Vec<PathBuf> = Vec::new();
    if project_path.exists() {
        watch_paths.push(project_path.clone());
    }
    if git_path.exists() {
        watch_paths.push(git_path);
    }

    if watch_paths.is_empty() {
        return Ok(());
    }

    let app_handle = app.clone();
    let mut watcher: RecommendedWatcher =
        RecommendedWatcher::new(
            move |result: notify::Result<notify::Event>| {
                if let Ok(event) = result {
                    // Only care about modify/create/remove events
                    let is_relevant = event.kind.is_modify()
                        || event.kind.is_create()
                        || event.kind.is_remove();
                    if is_relevant {
                        let _ = app_handle.emit("git-changed", &());
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    for watch_path in watch_paths {
        let _ = watcher.watch(&watch_path, RecursiveMode::Recursive);
    }

    state.watcher = Some(watcher);
    state.watched_path = Some(path);

    Ok(())
}

#[tauri::command]
fn stop_git_watcher(state: tauri::State<Mutex<GitWatcherState>>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.watcher = None;
    state.watched_path = None;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
struct ShellCommandResponse {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// Execute a shell command in the given directory.
#[tauri::command]
fn run_shell_command(path: String, command: String) -> Result<ShellCommandResponse, String> {
    let output = Command::new("zsh")
        .arg("-c")
        .arg(&command)
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(ShellCommandResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

/// Skip heavy / generated directories when walking a project tree.
fn should_skip_walk_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules"
            | ".git"
            | "dist"
            | "build"
            | "target"
            | ".next"
            | "__pycache__"
            | ".venv"
            | "venv"
            | ".idea"
            | ".vscode"
            | "coverage"
            | ".turbo"
            | ".nuxt"
            | ".output"
            | "out"
    )
}

fn project_file_rel_path(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

/// Fast in-process file search for @ mentions (no shell spawn).
#[tauri::command]
fn search_repository_files(root: String, query: String) -> Result<Vec<String>, String> {
    const MAX_RESULTS: usize = 50;
    const MAX_MATCH_COLLECT: usize = 150;
    const MAX_SCAN_ENTRIES: usize = 300_000;

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".to_string());
    }

    let q = query.trim().to_lowercase();
    let mut scanned: usize = 0;

    let walker = WalkDir::new(&root_path).follow_links(false).into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        if e.file_type().is_dir() && should_skip_walk_dir(&e.file_name().to_string_lossy()) {
            return false;
        }
        true
    });

    if q.is_empty() {
        let mut out: Vec<String> = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                break;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = project_file_rel_path(&root_path, entry.path()) else {
                continue;
            };
            out.push(rel);
            if out.len() >= MAX_RESULTS {
                break;
            }
        }
        Ok(out)
    } else {
        let mut scored: Vec<(u8, String)> = Vec::new();
        for entry in walker.filter_map(|e| e.ok()) {
            scanned += 1;
            if scanned > MAX_SCAN_ENTRIES {
                break;
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(rel) = project_file_rel_path(&root_path, entry.path()) else {
                continue;
            };
            let base = Path::new(&rel)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let rel_l = rel.to_lowercase();
            let base_l = base.to_lowercase();
            if !rel_l.contains(&q) && !base_l.contains(&q) {
                continue;
            }
            let score = if base_l.starts_with(&q) {
                0u8
            } else if base_l.contains(&q) {
                1u8
            } else {
                2u8
            };
            scored.push((score, rel));
            if scored.len() >= MAX_MATCH_COLLECT {
                break;
            }
        }
        scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.len().cmp(&b.1.len())));
        scored.truncate(MAX_RESULTS);
        Ok(scored.into_iter().map(|(_, p)| p).collect())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RepositoryExplorerEntry {
    path: String,
    is_dir: bool,
}

/// Join `relative_path` under repository root; rejects `..` and absolute paths.
fn safe_join_repository_root(repo_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = relative_path.trim();
    if rel.is_empty() {
        return Err("相对路径不能为空".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("必须使用仓库相对路径".into());
    }
    let mut out = repo_root.to_path_buf();
    for c in rel_path.components() {
        match c {
            Component::ParentDir => return Err("路径不允许包含 ..".into()),
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return Err("路径非法".into()),
        }
    }
    Ok(out)
}

fn assert_resolved_path_under_repo(repo_canon: &Path, path: &Path) -> Result<(), String> {
    let canon = path.canonicalize().map_err(|e| format!("解析路径失败: {e}"))?;
    if !canon.starts_with(repo_canon) {
        return Err("路径越界".into());
    }
    Ok(())
}

/// List files and directories (including empty folders) for explorer tree UI.
#[tauri::command]
fn list_repository_explorer_entries(root: String) -> Result<Vec<RepositoryExplorerEntry>, String> {
    const MAX_SCAN_ENTRIES: usize = 400_000;
    const MAX_RESULTS: usize = 30_000;

    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Not a directory".to_string());
    }
    let root_path = root_path.canonicalize().map_err(|e| e.to_string())?;

    let walker = WalkDir::new(&root_path).follow_links(false).into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        if e.file_type().is_dir() && should_skip_walk_dir(&e.file_name().to_string_lossy()) {
            return false;
        }
        true
    });

    let mut scanned: usize = 0;
    use std::collections::BTreeMap;
    let mut seen: BTreeMap<String, bool> = BTreeMap::new();

    for entry in walker.filter_map(|e| e.ok()) {
        scanned += 1;
        if scanned > MAX_SCAN_ENTRIES || seen.len() >= MAX_RESULTS {
            break;
        }
        let Some(rel) = project_file_rel_path(&root_path, entry.path()) else {
            continue;
        };
        if entry.file_type().is_dir() {
            seen.insert(rel, true);
        } else if entry.file_type().is_file() {
            seen.insert(rel, false);
        }
    }

    let mut out: Vec<RepositoryExplorerEntry> = seen
        .into_iter()
        .map(|(path, is_dir)| RepositoryExplorerEntry { path, is_dir })
        .collect();
    out.sort_by(|a, b| match a.path.cmp(&b.path) {
        std::cmp::Ordering::Equal => a.is_dir.cmp(&b.is_dir),
        o => o,
    });
    Ok(out)
}

/// Create an empty file under the repository (parent directories are created if missing).
#[tauri::command]
fn create_repository_file(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err("仓库根目录无效".into());
    }
    let base = root_pb.canonicalize().map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = safe_join_repository_root(&base, &relative_path)?;
    if full.exists() {
        return Err("目标已存在".into());
    }
    let parent = full
        .parent()
        .ok_or_else(|| "无效文件路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建父目录失败: {e}"))?;
    let canon_parent = parent.canonicalize().map_err(|e| format!("解析父目录失败: {e}"))?;
    if !canon_parent.starts_with(&base) {
        return Err("路径越界".into());
    }
    fs::File::create(&full).map_err(|e| format!("创建文件失败: {e}"))?;
    assert_resolved_path_under_repo(&base, &full)?;
    Ok(())
}

/// Create a directory under the repository (`relative_path` is the new folder path).
#[tauri::command]
fn create_repository_directory(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err("仓库根目录无效".into());
    }
    let base = root_pb.canonicalize().map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = safe_join_repository_root(&base, &relative_path)?;
    if full.exists() {
        return Err("目标已存在".into());
    }
    fs::create_dir_all(&full).map_err(|e| format!("创建目录失败: {e}"))?;
    assert_resolved_path_under_repo(&base, &full)?;
    Ok(())
}

/// Delete a file or directory under the repository (directories are removed recursively).
#[tauri::command]
fn delete_repository_entry(root: String, relative_path: String) -> Result<(), String> {
    let root_pb = PathBuf::from(&root);
    if !root_pb.is_dir() {
        return Err("仓库根目录无效".into());
    }
    let base = root_pb.canonicalize().map_err(|e| format!("解析仓库路径失败: {e}"))?;
    let full = safe_join_repository_root(&base, &relative_path)?;
    if !full.exists() {
        return Err("路径不存在".into());
    }
    assert_resolved_path_under_repo(&base, &full)?;
    let meta = fs::symlink_metadata(&full).map_err(|e| format!("读取路径信息失败: {e}"))?;
    if meta.is_dir() {
        fs::remove_dir_all(&full).map_err(|e| format!("删除目录失败: {e}"))?;
    } else if meta.is_file() || meta.file_type().is_symlink() {
        fs::remove_file(&full).map_err(|e| format!("删除文件失败: {e}"))?;
    } else {
        return Err("不支持的文件类型".into());
    }
    Ok(())
}

// ── Terminal Commands ──

#[tauri::command]
fn terminal_open(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    app: tauri::AppHandle,
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
    cwd: String,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .open(workspace_id, terminal_id, cols, rows, cwd, &app)
}

#[tauri::command]
fn terminal_write(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .write(&workspace_id, &terminal_id, &data)
}

#[tauri::command]
fn terminal_resize(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .resize(&workspace_id, &terminal_id, cols, rows)
}

#[tauri::command]
fn terminal_close(
    manager: tauri::State<std::sync::Mutex<TerminalManager>>,
    workspace_id: String,
    terminal_id: String,
) -> Result<(), String> {
    manager
        .lock()
        .map_err(|e| e.to_string())?
        .close(&workspace_id, &terminal_id)
}

// ── Claude Code Process Management ──

/// Global state to track current Claude process (single slot)
struct ClaudeProcessState {
    current_process: Arc<TokioMutex<Option<Child>>>,
    /// `stream-json` 控制协议：按 `session_id` 保存 stdin，实现会话级定向回包。
    claude_stdin_by_session: Arc<TokioMutex<HashMap<String, tokio::process::ChildStdin>>>,
    /// 在拿到 `system.init.session_id` 之前，按 spawn 序号挂 stdin（支持多进程并发首包 initialize）。
    pending_stdin_by_spawn_id: Arc<TokioMutex<HashMap<u64, tokio::process::ChildStdin>>>,
    /// 当前可写 stdin 所属的 Claude session_id（用于前端定向回包校验）。
    current_session_id: Arc<TokioMutex<Option<String>>>,
    /// Oneshot 等「非 current_process 托管」子进程：按 Claude session_id 保存 wait 句柄，供 cancel / 同会话再次 resume 时 kill。
    active_child_by_claude_session: Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
    /// Oneshot invocation 早于 `system.init.session_id` 可见；按 invocation_key 保存 wait 句柄，支持精准取消。
    active_child_by_invocation_key:
        Arc<TokioMutex<HashMap<String, Arc<TokioMutex<Option<Child>>>>>>,
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

async fn release_claude_spawn_slot(slots_mtx: &Arc<TokioMutex<HashMap<String, u32>>>, scope_key: Option<String>) {
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudeConnectionMode {
    Persistent,
    Oneshot,
}

impl ClaudeConnectionMode {
    fn from_option_str(value: Option<&str>) -> Self {
        match value.map(str::trim).map(|v| v.to_ascii_lowercase()) {
            Some(v) if v == "oneshot" || v == "one-shot" || v == "one_shot" => Self::Oneshot,
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

fn canonicalize_structured_verdict_object(obj: &serde_json::Map<String, serde_json::Value>) -> Option<serde_json::Value> {
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
            out.insert("schemaVersion".to_string(), serde_json::Value::Number(v.into()));
        }
    }
    if let Some(v) = obj.get("taskId").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            out.insert("taskId".to_string(), serde_json::Value::String(v.trim().to_string()));
        }
    }
    if let Some(v) = obj
        .get("nodeId")
        .or_else(|| obj.get("graphNodeId"))
        .and_then(|v| v.as_str())
    {
        if !v.trim().is_empty() {
            out.insert("nodeId".to_string(), serde_json::Value::String(v.trim().to_string()));
        }
    }
    if let Some(v) = obj.get("rationale").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            out.insert("rationale".to_string(), serde_json::Value::String(v.trim().to_string()));
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
struct ClaudeSessionInfo {
    session_id: String,
    project_path: String,
    model: String,
    status: String,
    started_at: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SystemResourceSnapshot {
    system_total_bytes: u64,
    system_used_bytes: u64,
    app_memory_bytes: u64,
    claude_process_count: u64,
    claude_memory_bytes: u64,
}

fn parse_kb_to_bytes(input: &str) -> Option<u64> {
    let v = input.trim().parse::<u64>().ok()?;
    Some(v.saturating_mul(1024))
}

fn parse_ps_rss_kb_for_pid(pid: u32) -> Option<u64> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_kb_to_bytes(text.trim())
}

fn collect_claude_process_memory_bytes() -> (u64, u64) {
    let output = match Command::new("ps")
        .args(["-axo", "rss=,comm=,args="])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return (0, 0),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut count: u64 = 0;
    let mut total_bytes: u64 = 0;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut cols = trimmed.split_whitespace();
        let Some(rss_kb) = cols.next() else {
            continue;
        };
        let Some(comm) = cols.next() else {
            continue;
        };
        let args: String = cols.collect::<Vec<_>>().join(" ").to_lowercase();
        let comm_lower = comm.to_lowercase();
        let is_claude = comm_lower == "claude"
            || comm_lower == "claude-code"
            || args.contains(" claude ")
            || args.contains("/claude ")
            || args.contains("claude-code");
        if !is_claude {
            continue;
        }
        if let Some(bytes) = parse_kb_to_bytes(rss_kb) {
            count = count.saturating_add(1);
            total_bytes = total_bytes.saturating_add(bytes);
        }
    }
    (count, total_bytes)
}

#[cfg(target_os = "macos")]
fn collect_system_memory_bytes() -> (u64, u64) {
    let total = Command::new("sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0);

    let vm_text = Command::new("vm_stat")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .unwrap_or_default();

    let mut page_size: u64 = 4096;
    for line in vm_text.lines() {
        if let Some(start) = line.find("page size of ") {
            let rest = &line[start + "page size of ".len()..];
            if let Some(end) = rest.find(" bytes") {
                if let Ok(parsed) = rest[..end].trim().parse::<u64>() {
                    page_size = parsed;
                }
            }
            break;
        }
    }

    let mut used_pages: u64 = 0;
    for key in [
        "Pages active",
        "Pages inactive",
        "Pages speculative",
        "Pages wired down",
        "Pages occupied by compressor",
    ] {
        if let Some(line) = vm_text.lines().find(|l| l.starts_with(key)) {
            let num = line
                .split(':')
                .nth(1)
                .unwrap_or("")
                .trim()
                .trim_end_matches('.');
            if let Ok(v) = num.replace('.', "").parse::<u64>() {
                used_pages = used_pages.saturating_add(v);
            }
        }
    }

    let used = used_pages.saturating_mul(page_size);
    (total, used.min(total))
}

#[cfg(not(target_os = "macos"))]
fn collect_system_memory_bytes() -> (u64, u64) {
    (0, 0)
}

/// Session registry for tracking running Claude sessions
#[derive(Clone)]
struct ClaudeSessionRegistry {
    sessions: Arc<Mutex<HashMap<String, ClaudeSessionInfo>>>,
}

impl ClaudeSessionRegistry {
    fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn register(&self, session_id: String, project_path: String, model: String) {
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

    fn mark_completed(&self, session_id: &str, success: bool) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(info) = sessions.get_mut(session_id) {
            info.status = if success {
                "completed".to_string()
            } else {
                "cancelled".to_string()
            };
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

// ── Claude Code disk sessions (~/.claude/projects) ──

fn claude_projects_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "HOME directory not found".to_string())?;
    Ok(home.join(".claude").join("projects"))
}

/// Encodes an absolute project path into Claude Code's directory name under `~/.claude/projects/`.
fn encoded_claude_project_dir(project_path: &Path) -> Result<String, String> {
    let canon = fs::canonicalize(project_path)
        .map_err(|e| format!("cannot canonicalize project path: {}", e))?;
    let s = canon.to_string_lossy().to_string();
    let normalized = if cfg!(windows) {
        let mut t = s.replace('\\', "/");
        if let Some(rest) = t.strip_prefix("//?/") {
            t = rest.to_string();
        }
        t.trim_start_matches('/')
            .replace('/', "-")
            .replace(':', "")
    } else {
        s.trim_start_matches('/').replace('/', "-")
    };
    Ok(format!("-{}", normalized))
}

fn is_safe_claude_session_filename(name: &str) -> bool {
    let len = name.len();
    if !(32..=48).contains(&len) {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// 从一条 user 消息的 content 数组里，尝试用 `Task` 工具调用的 input 生成列表预览（无正文文本时）。
fn preview_from_task_tool_use_in_user_content(content: &serde_json::Value) -> Option<String> {
    let arr = content.as_array()?;
    for b in arr {
        if b.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
            continue;
        }
        let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("");
        if !name.eq_ignore_ascii_case("task") {
            continue;
        }
        let Some(input) = b.get("input") else {
            continue;
        };
        let sub = input
            .get("subagent_type")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        let desc = input
            .get("description")
            .and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                input
                    .get("prompt")
                    .and_then(|x| x.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("");
        let mut out = String::new();
        if !sub.is_empty() {
            out.push('[');
            let take = sub.chars().take(36).collect::<String>();
            out.push_str(&take);
            if sub.chars().nth(36).is_some() {
                out.push('…');
            }
            out.push_str("] ");
        }
        if !desc.is_empty() {
            let take = desc.chars().take(72).collect::<String>();
            out.push_str(&take);
            if desc.chars().nth(72).is_some() {
                out.push('…');
            }
        }
        let t = out.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

fn scan_jsonl_preview(path: &Path) -> (String, Option<String>) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (String::new(), None),
    };
    let reader = std::io::BufReader::new(file);
    let mut model_hint: Option<String> = None;
    let mut preview = String::new();

    for (i, line) in reader.lines().enumerate() {
        if i > 600 {
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if model_hint.is_none() {
            if let Some(m) = v
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(|x| x.as_str())
            {
                model_hint = Some(m.to_string());
            }
        }
        if v.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        if v.get("isMeta").and_then(|x| x.as_bool()) == Some(true) {
            continue;
        }
        let content = match v.get("message").and_then(|m| m.get("content")) {
            Some(c) => c,
            None => continue,
        };
        // Content can be a string or an array of content blocks（合并全部非空 text，与前端 JSONL 解析一致）
        let text = match content.as_str() {
            Some(s) => s.to_string(),
            None => {
                let joined = content
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                if !joined.is_empty() {
                    joined
                } else {
                    preview_from_task_tool_use_in_user_content(content).unwrap_or_default()
                }
            }
        };
        if text.is_empty() {
            continue;
        }
        if text.contains("<local-command-caveat>") || text.trim_start().starts_with("<command-name>") {
            continue;
        }
        let mut ch = text.chars();
        preview = ch.by_ref().take(80).collect();
        if ch.next().is_some() {
            preview.push_str("...");
        }
        break;
    }

    (preview, model_hint)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeDiskSessionItem {
    session_id: String,
    updated_at_ms: i64,
    preview: String,
    model_hint: Option<String>,
}

#[tauri::command]
fn list_claude_disk_sessions(project_path: String) -> Result<Vec<ClaudeDiskSessionItem>, String> {
    let root = claude_projects_root()?;
    let dir_name = encoded_claude_project_dir(Path::new(&project_path))?;
    let dir = root.join(dir_name);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out: Vec<ClaudeDiskSessionItem> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read_dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if !is_safe_claude_session_filename(stem) {
            continue;
        }
        let meta = fs::metadata(&path).ok();
        let updated_at_ms = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let (preview, model_hint) = scan_jsonl_preview(&path);
        out.push(ClaudeDiskSessionItem {
            session_id: stem.to_string(),
            updated_at_ms,
            preview,
            model_hint,
        });
    }

    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

#[tauri::command]
fn load_claude_session_jsonl(
    project_path: String,
    session_id: String,
    tail_lines: Option<usize>,
) -> Result<Vec<String>, String> {
    if !is_safe_claude_session_filename(&session_id) {
        return Err("invalid session id".into());
    }
    let root = claude_projects_root()?;
    let dir_name = encoded_claude_project_dir(Path::new(&project_path))?;
    let dir = root.join(&dir_name);
    let dir_canon = fs::canonicalize(&dir).map_err(|e| format!("bad project sessions dir: {}", e))?;
    let path = dir_canon.join(format!("{}.jsonl", session_id));
    if !path.exists() || !path.is_file() {
        return Err("session file not found".into());
    }
    let path_canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !path_canon.starts_with(&dir_canon) {
        return Err("session path outside project dir".into());
    }
    let file = fs::File::open(&path_canon).map_err(|e| e.to_string())?;
    let reader = std::io::BufReader::new(file);
    match tail_lines.filter(|&n| n > 0) {
        None => {
            let mut out: Vec<String> = Vec::new();
            for line in reader.lines() {
                out.push(line.map_err(|e| e.to_string())?);
            }
            Ok(out)
        }
        Some(max) => {
            let mut dq: VecDeque<String> = VecDeque::with_capacity(max.min(8192));
            for line in reader.lines() {
                let line = line.map_err(|e| e.to_string())?;
                if dq.len() == max {
                    dq.pop_front();
                }
                dq.push_back(line);
            }
            Ok(dq.into_iter().collect())
        }
    }
}

/// Extra PATH segments so `which` / subprocesses find `claude` when the GUI app inherits a minimal PATH (e.g. Tauri `.app`).
fn claude_path_search_prefixes() -> Vec<PathBuf> {
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
            let mut nodes: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
            nodes.sort_by(|a, b| b.cmp(a));
            for node_dir in nodes {
                v.push(node_dir.join("bin"));
            }
        }
        // NVM_DIR may differ from ~/.nvm
        if let Ok(nvm_dir) = std::env::var("NVM_DIR") {
            let versions_dir = PathBuf::from(nvm_dir.trim()).join("versions/node");
            if let Ok(entries) = fs::read_dir(&versions_dir) {
                let mut nodes: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
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

fn merge_path_env(prefix_dirs: &[PathBuf]) -> String {
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
fn find_claude_binary() -> Result<String, String> {
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
struct ClaudeModelPickerOptions {
    default_model: Option<String>,
    available_models: Vec<String>,
}

fn collect_claude_model_picker_options(project_path: Option<String>) -> Result<ClaudeModelPickerOptions, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let user_settings = home.join(".claude").join("settings.json");
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

    let user_effective = user_val.as_ref().and_then(read_claude_effective_model_from_value);
    let project_effective = project_val.as_ref().and_then(read_claude_effective_model_from_value);
    let default_model = project_effective.or(user_effective);

    Ok(ClaudeModelPickerOptions {
        default_model,
        available_models,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeMcpItem {
    id: String,
    name: String,
    command: String,
    status: String,
    enabled: bool,
    tools: Vec<String>,
    scope: String,
    source_path: String,
    claude_json_project_key: Option<String>,
    /// 例如 `oh-my-claudecode@omc`（仅 `scope == plugin` 时有值）。
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_ref: Option<String>,
    /// From `claude mcp list` health check when available: `connected` | `failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_status: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeMcpStatusResponse {
    user: Vec<ClaudeMcpItem>,
    local: Vec<ClaudeMcpItem>,
    project_shared: Vec<ClaudeMcpItem>,
    legacy_user_settings: Vec<ClaudeMcpItem>,
    legacy_project_settings: Vec<ClaudeMcpItem>,
    /// MCP 声明来自已安装插件：`installed_plugins.json`（含每条记录的 `installPath` 与可选内联 `mcpServers`）、`~/.claude/settings.json` 根级或 `enabledPlugins` 内的 `plugin@marketplace` 启用项（结合 `extraKnownMarketplaces` 本地根或 `plugins/marketplaces/<id>` 后读 `plugins/<插件>/.claude-plugin/plugin.json` 等）、`marketplaces/**`、`plugins/cache/**` 等目录内的 `.mcp.json` 与 `mcpServers` / `mcp_servers`。
    plugin_mcp: Vec<ClaudeMcpItem>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeMcpRuntimeHealthEntry {
    name: String,
    status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeHookHandler {
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
struct ClaudeHookMatcherGroup {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    matcher: Option<String>,
    hooks: Vec<ClaudeHookHandler>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeHookScopeData {
    source_path: String,
    disable_all_hooks: bool,
    hooks: HashMap<String, Vec<ClaudeHookMatcherGroup>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeHooksStatusResponse {
    user: ClaudeHookScopeData,
    project: ClaudeHookScopeData,
    local: ClaudeHookScopeData,
    omc: ClaudeHookScopeData,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeHookHandlerInput {
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

fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    let data = fs::read_to_string(path).ok()?;
    let data = data.trim_start_matches('\u{feff}');
    serde_json::from_str(data).ok()
}

fn parse_mcp_tools(cfg: &serde_json::Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let candidates = [
        cfg.get("tools"),
        cfg.get("allowed_tools"),
        cfg.get("allowedTools"),
    ];
    for arr in candidates.into_iter().flatten() {
        let Some(items) = arr.as_array() else { continue };
        for item in items {
            let name = if let Some(s) = item.as_str() {
                s.trim().to_string()
            } else if let Some(obj) = item.as_object() {
                obj.get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            if !name.is_empty() && seen.insert(name.clone()) {
                out.push(name);
            }
        }
    }
    out
}

/// 环境变量名：首字符须为 ASCII 字母或 `_`，避免把 URL 里的 `%20` 等当成 `%VAR%`。
fn claude_mcp_valid_env_var_name(name: &str) -> bool {
    let mut it = name.bytes();
    let Some(first) = it.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return false;
    }
    it.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// 展开 `$VAR`、`${VAR}` 与 Windows 风格 `%VAR%`（未设置则为空串）。用于 MCP 路径与 `command`/`args` 展示。
fn expand_env_vars_in_str(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < input.len() {
        let c = input[i..].chars().next().unwrap();
        let clen = c.len_utf8();
        if c == '%' {
            if let Some(rest) = input.get(i + 1..) {
                if let Some(rel_end) = rest.find('%') {
                    let name = &rest[..rel_end];
                    if claude_mcp_valid_env_var_name(name) {
                        out.push_str(&std::env::var(name).unwrap_or_default());
                        i += 1 + rel_end + 1;
                        continue;
                    }
                }
            }
        }
        if c == '$' && i + 1 < input.len() {
            let b = input.as_bytes();
            if b[i + 1] == b'{' {
                if let Some(close) = input[i + 2..].find('}') {
                    let name = &input[i + 2..i + 2 + close];
                    if claude_mcp_valid_env_var_name(name) {
                        out.push_str(&std::env::var(name).unwrap_or_default());
                        i += 2 + close + 1;
                        continue;
                    }
                }
            } else if b[i + 1].is_ascii_alphabetic() || b[i + 1] == b'_' {
                let mut j = i + 1;
                while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
                    j += 1;
                }
                if j > i + 1 {
                    let name = &input[i + 1..j];
                    if claude_mcp_valid_env_var_name(name) {
                        out.push_str(&std::env::var(name).unwrap_or_default());
                        i = j;
                        continue;
                    }
                }
            }
        }
        out.push(c);
        i += clen;
    }
    out
}

fn parse_mcp_command(cfg: &serde_json::Value) -> String {
    let raw = if let Some(ty) = cfg.get("type").and_then(|v| v.as_str()) {
        if ty.eq_ignore_ascii_case("http") || ty.eq_ignore_ascii_case("sse") {
            if let Some(url) = cfg.get("url").and_then(|v| v.as_str()) {
                format!("{} {}", ty, url.trim())
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    if !raw.is_empty() {
        return expand_env_vars_in_str(&raw);
    }
    if let Some(cmd) = cfg.get("command").and_then(|v| v.as_str()) {
        let mut text = cmd.trim().to_string();
        if let Some(args) = cfg.get("args").and_then(|v| v.as_array()) {
            let suffix = args
                .iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !suffix.is_empty() {
                text.push(' ');
                text.push_str(&suffix);
            }
        }
        return expand_env_vars_in_str(&text);
    }
    if let Some(url) = cfg.get("url").and_then(|v| v.as_str()) {
        return expand_env_vars_in_str(url.trim());
    }
    if let Some(endpoint) = cfg.get("endpoint").and_then(|v| v.as_str()) {
        return expand_env_vars_in_str(endpoint.trim());
    }
    if let Some(transport) = cfg.get("transport").and_then(|v| v.as_str()) {
        return expand_env_vars_in_str(transport.trim());
    }
    "未配置命令".to_string()
}

fn paths_match_claude_project(project_path: &str, json_key: &str) -> bool {
    let a = project_path.trim();
    let b = json_key.trim();
    if a == b {
        return true;
    }
    let ca = fs::canonicalize(Path::new(a)).ok();
    let cb = fs::canonicalize(Path::new(b)).ok();
    match (ca, cb) {
        (Some(ref x), Some(ref y)) if x == y => true,
        (Some(ref x), None) => x.to_string_lossy() == b,
        (None, Some(ref y)) => y.to_string_lossy() == a,
        _ => false,
    }
}

fn build_mcp_items_from_map(
    map: &serde_json::Map<String, serde_json::Value>,
    scope: &str,
    source_path: &str,
    claude_json_project_key: Option<&str>,
) -> Vec<ClaudeMcpItem> {
    let mut out: Vec<ClaudeMcpItem> = Vec::new();
    for (name, cfg) in map {
        let enabled = cfg
            .get("enabled")
            .and_then(|x| x.as_bool())
            .unwrap_or(true)
            && !cfg
                .get("disabled")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
        let status = if enabled {
            "connected".to_string()
        } else {
            "disconnected".to_string()
        };
        let command = parse_mcp_command(cfg);
        let tools = parse_mcp_tools(cfg);
        out.push(ClaudeMcpItem {
            id: format!("{}::{}", scope, name),
            name: name.to_string(),
            command,
            status,
            enabled,
            tools,
            scope: scope.to_string(),
            source_path: source_path.to_string(),
            claude_json_project_key: claude_json_project_key.map(|s| s.to_string()),
            plugin_ref: None,
            runtime_status: None,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn build_mcp_items_from_settings_mcp_block(
    v: &serde_json::Value,
    scope: &str,
    source_path: &str,
    claude_json_project_key: Option<&str>,
) -> Vec<ClaudeMcpItem> {
    let Some(map) = v
        .get("mcpServers")
        .and_then(|x| x.as_object())
        .or_else(|| v.get("mcp_servers").and_then(|x| x.as_object()))
    else {
        return Vec::new();
    };
    build_mcp_items_from_map(map, scope, source_path, claude_json_project_key)
}

fn claude_plugin_data_dir_from_ref(home: &Path, plugin_ref: &str) -> PathBuf {
    let id: String = plugin_ref
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '-' => c,
            _ => '-',
        })
        .collect();
    home.join(".claude").join("plugins").join("data").join(id)
}

fn resolve_plugin_relative_path(plugin_root: &Path, rel: &str) -> PathBuf {
    let t = expand_env_vars_in_str(rel.trim());
    let t = t.strip_prefix("./").unwrap_or(t.as_str());
    plugin_root.join(t)
}

fn expand_plugin_vars_in_json_value(v: &mut serde_json::Value, root: &Path, data_dir: &str) {
    match v {
        serde_json::Value::String(s) => {
            let new_s = s
                .replace("${CLAUDE_PLUGIN_ROOT}", &root.to_string_lossy())
                .replace("${CLAUDE_PLUGIN_DATA}", data_dir);
            *s = expand_env_vars_in_str(&new_s);
        }
        serde_json::Value::Array(a) => {
            for x in a.iter_mut() {
                expand_plugin_vars_in_json_value(x, root, data_dir);
            }
        }
        serde_json::Value::Object(o) => {
            for (_, x) in o.iter_mut() {
                expand_plugin_vars_in_json_value(x, root, data_dir);
            }
        }
        _ => {}
    }
}

/// 将 `plugin.json` 的 `mcpServers` 字段（字符串路径 / 数组 / 内联对象）解析为若干 `(来源文件路径, 服务器表)`。
fn collect_mcp_maps_from_plugin_mcp_spec(
    plugin_root: &Path,
    spec: &serde_json::Value,
    hint_source: &str,
    out: &mut Vec<(String, serde_json::Map<String, serde_json::Value>)>,
) {
    match spec {
        serde_json::Value::String(rel) => {
            let path = resolve_plugin_relative_path(plugin_root, rel);
            if let Some(v) = read_json_file(&path) {
                let sp = path.to_string_lossy().to_string();
                if let Some(map) = v
                    .get("mcpServers")
                    .or_else(|| v.get("mcp_servers"))
                    .and_then(|x| x.as_object())
                {
                    out.push((sp, map.clone()));
                } else if let Some(map) = v.as_object() {
                    if !map.is_empty() && map.values().all(|vv| vv.as_object().is_some()) {
                        out.push((sp, map.clone()));
                    }
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_mcp_maps_from_plugin_mcp_spec(plugin_root, item, hint_source, out);
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(ms) = obj
                .get("mcpServers")
                .or_else(|| obj.get("mcp_servers"))
                .and_then(|x| x.as_object())
            {
                out.push((hint_source.to_string(), ms.clone()));
                return;
            }
            if !obj.is_empty() && obj.values().all(|vv| vv.as_object().is_some()) {
                out.push((hint_source.to_string(), obj.clone()));
            }
        }
        _ => {}
    }
}

/// 将已解析的 MCP 服务器表写入 `out`（展开 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}`）。
fn append_mcp_declaration_maps(
    home: &Path,
    plugin_ref: &str,
    plugin_root: &Path,
    maps: Vec<(String, serde_json::Map<String, serde_json::Value>)>,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let data_dir = claude_plugin_data_dir_from_ref(home, plugin_ref);
    let data_dir_str = data_dir.to_string_lossy().to_string();
    for (src_path, map) in maps {
        for (name, cfg_orig) in map.iter() {
            let mut cfg = cfg_orig.clone();
            expand_plugin_vars_in_json_value(&mut cfg, plugin_root, &data_dir_str);
            let enabled = cfg
                .get("enabled")
                .and_then(|x| x.as_bool())
                .unwrap_or(true)
                && !cfg
                    .get("disabled")
                    .and_then(|x| x.as_bool())
                    .unwrap_or(false);
            let status = if enabled {
                "connected".to_string()
            } else {
                "disconnected".to_string()
            };
            let command = parse_mcp_command(&cfg);
            let tools = parse_mcp_tools(&cfg);
            out.push(ClaudeMcpItem {
                id: format!("plugin::{}::{}", plugin_ref, name),
                name: name.to_string(),
                command,
                status,
                enabled,
                tools,
                scope: "plugin".to_string(),
                source_path: src_path.clone(),
                claude_json_project_key: None,
                plugin_ref: Some(plugin_ref.to_string()),
                runtime_status: None,
            });
        }
    }
}

/// 从单个插件根目录（cache 安装副本或 marketplaces 解压目录）解析 MCP 条目并追加到 `out`。
fn push_mcp_declarations_from_plugin_dir(home: &Path, plugin_ref: &str, plugin_root: &Path, out: &mut Vec<ClaudeMcpItem>) {
    let manifest_path = plugin_root.join(".claude-plugin").join("plugin.json");

    let mut maps: Vec<(String, serde_json::Map<String, serde_json::Value>)> = Vec::new();
    if let Some(manifest_v) = read_json_file(&manifest_path) {
        if let Some(spec) = manifest_v
            .get("mcpServers")
            .or_else(|| manifest_v.get("mcp_servers"))
            .filter(|s| !s.is_null())
        {
            let hint = manifest_path.to_string_lossy().to_string();
            collect_mcp_maps_from_plugin_mcp_spec(plugin_root, spec, &hint, &mut maps);
        }
    }
    if maps.is_empty() {
        let root_mcp = plugin_root.join(".mcp.json");
        if let Some(v) = read_json_file(&root_mcp) {
            if let Some(map) = v
                .get("mcpServers")
                .or_else(|| v.get("mcp_servers"))
                .and_then(|x| x.as_object())
            {
                maps.push((root_mcp.to_string_lossy().to_string(), map.clone()));
            }
        }
    }

    append_mcp_declaration_maps(home, plugin_ref, plugin_root, maps, out);
}

/// 解析 `installed_plugins.json` 中的 `installPath` / `install_path`（支持 `~`、相对路径、`$HOME/`、环境变量）。
fn resolve_claude_plugin_install_path(home: &Path, raw: &str) -> Option<PathBuf> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let t = expand_env_vars_in_str(t);
    let t = t.as_str();
    let mut pb = if let Some(rest) = t.strip_prefix("~/") {
        home.join(rest)
    } else if t == "~" {
        home.to_path_buf()
    } else if let Some(rest) = t.strip_prefix("$HOME/") {
        home.join(rest)
    } else {
        PathBuf::from(t)
    };
    if pb.as_path().is_relative() {
        pb = home.join(pb);
    }
    let pb = fs::canonicalize(&pb).unwrap_or(pb);
    if pb.is_dir() {
        Some(pb)
    } else {
        None
    }
}

fn dedupe_plugin_mcp_items(items: Vec<ClaudeMcpItem>) -> Vec<ClaudeMcpItem> {
    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut out: Vec<ClaudeMcpItem> = Vec::new();
    for it in items {
        let key = (it.name.clone(), it.command.clone());
        if seen.insert(key) {
            out.push(it);
        }
    }
    out
}

fn claude_plugins_cache_dir(home: &Path) -> PathBuf {
    home.join(".claude").join("plugins").join("cache")
}

fn dir_has_skill_md_subdirs(skills_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(skills_dir) else {
        return false;
    };
    rd.flatten().any(|e| e.path().is_dir() && e.path().join("SKILL.md").is_file())
}

fn dir_has_agent_markdown(agents_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(agents_dir) else {
        return false;
    };
    rd.flatten().any(|e| {
        e.path().is_file()
            && e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("md"))
                .unwrap_or(false)
    })
}

/// 判定目录是否为 Claude Code 插件包根（用于扫描 `plugins/cache/**`，与 installed_plugins 是否登记无关）。
fn is_claude_plugin_package_root(dir: &Path) -> bool {
    if dir.join(".claude-plugin").join("plugin.json").is_file() || dir.join(".mcp.json").is_file() {
        return true;
    }
    let agents = dir.join("agents");
    if agents.is_dir() && dir_has_agent_markdown(&agents) {
        return true;
    }
    let skills = dir.join("skills");
    skills.is_dir() && dir_has_skill_md_subdirs(&skills)
}

fn walkdir_skip_plugin_noise(e: &walkdir::DirEntry) -> bool {
    let name = e.file_name().to_string_lossy();
    if e.depth() > 0
        && (name == "node_modules"
            || name == ".git"
            || name == "target"
            || name == ".venv"
            || name == "dist")
    {
        return false;
    }
    true
}

/// 在 `root_canon` 目录树内枚举所有「插件包根」（含 `.claude-plugin/plugin.json`、根 `.mcp.json`、skills/agents 等）。
fn discover_plugin_package_roots_in_tree(root_canon: &Path) -> Vec<PathBuf> {
    if !root_canon.is_dir() {
        return Vec::new();
    }
    let mut out: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let walker = WalkDir::new(root_canon)
        .follow_links(false)
        .into_iter()
        .filter_entry(walkdir_skip_plugin_noise);
    for ent in walker.filter_map(|e| e.ok()) {
        if !ent.file_type().is_dir() {
            continue;
        }
        let path = ent.path();
        if !is_claude_plugin_package_root(path) {
            continue;
        }
        let canon = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let key = canon.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        out.push(canon);
    }
    out.sort_by(|a, b| a.to_string_lossy().cmp(&b.to_string_lossy()));
    out
}

/// 插件目录是否在 manifest 或根 `.mcp.json` 中声明了 MCP（用于跳过无 MCP 的纯技能包，减少无效解析）。
fn plugin_package_root_declares_mcp(plugin_root: &Path) -> bool {
    let manifest = plugin_root.join(".claude-plugin").join("plugin.json");
    if let Some(v) = read_json_file(&manifest) {
        let spec = v.get("mcpServers").or_else(|| v.get("mcp_servers"));
        if spec.is_some_and(|s| !s.is_null()) {
            return true;
        }
    }
    plugin_root.join(".mcp.json").is_file()
}

/// 枚举 `~/.claude/plugins/cache/**` 下全部插件包根路径，返回 `(相对 cache 的路径片段, 绝对路径)`。
fn discover_plugin_roots_under_claude_cache(home: &Path) -> Vec<(String, PathBuf)> {
    let cache = claude_plugins_cache_dir(home);
    if !cache.is_dir() {
        return Vec::new();
    }
    let cache_canon = match fs::canonicalize(&cache) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let mut out: Vec<(String, PathBuf)> = Vec::new();
    for canon in discover_plugin_package_roots_in_tree(&cache_canon) {
        if !plugin_package_root_declares_mcp(&canon) {
            continue;
        }
        let rel = match canon.strip_prefix(&cache_canon) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => canon.to_string_lossy().replace('\\', "/"),
        };
        let rel = rel.trim_matches('/').to_string();
        out.push((rel, canon));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// `~/.claude/settings.json` 顶层 `"<plugin-slug>@<marketplace-id>": true`：解析市场真实根目录后读取 `plugins/<slug>/.claude-plugin/plugin.json` 等的 `mcpServers`。
/// 市场根目录优先来自同文件 `extraKnownMarketplaces.<id>`：`source` 为 `directory` 时的嵌套 `path`，或仅顶层 `path`（如 digital-engine-plugin-marketplace）；否则回退到 `~/.claude/plugins/marketplaces/<id>` 等（见 `resolve_plugin_marketplace_root_dir`）。
fn marketplace_plugin_toggle_value_enabled(val: &serde_json::Value) -> bool {
    match val {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::String(s) => {
            let t = s.trim();
            t.eq_ignore_ascii_case("true")
                || t == "1"
                || t.eq_ignore_ascii_case("yes")
                || t.eq_ignore_ascii_case("on")
        }
        serde_json::Value::Number(n) => n.as_i64() == Some(1) || n.as_f64() == Some(1.0),
        serde_json::Value::Object(o) => {
            let disabled = o.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
            // 与 Claude / 插件市场常见写法对齐：仅有 `{}` 或版本字段时也视为已启用
            let enabled = o.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            enabled && !disabled
        }
        _ => false,
    }
}

/// 解析 `plugin@marketplace` 键（折叠 `@` 右侧空白），返回 (plugin_slug, marketplace_id)。
fn parse_settings_plugin_marketplace_toggle_key(key: &str) -> Option<(String, String)> {
    let key = key.trim();
    if !key.contains('@') {
        return None;
    }
    let (a, b) = key.split_once('@')?;
    let slug = a.trim().to_string();
    let mkt = b.split_whitespace().collect::<String>();
    let mkt = mkt.trim().to_string();
    if slug.is_empty() || mkt.is_empty() {
        return None;
    }
    Some((slug, mkt))
}

fn source_kind_is_directory(kind: &str) -> bool {
    let k = kind.trim();
    k.eq_ignore_ascii_case("directory") || k.eq_ignore_ascii_case("dir") || k.eq_ignore_ascii_case("local")
}

/// 从 `extraKnownMarketplaces` 单条 entry 提取「directory 类」本地根路径（兼容多种字段布局）。
fn extract_extra_marketplace_directory_raw_path(entry: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    // 形态 A：`{ "source": { "source": "directory", "path": "..." }, "autoUpdate": true }`
    if let Some(src_v) = entry.get("source") {
        match src_v {
            serde_json::Value::Object(src) => {
                let ty = src
                    .get("source")
                    .or_else(|| src.get("type"))
                    .or_else(|| src.get("kind"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .trim();
                if source_kind_is_directory(ty) {
                    let raw = ["path", "directory", "root", "localPath", "installPath", "install_path"]
                        .iter()
                        .find_map(|k| {
                            src.get(*k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty())
                        });
                    if let Some(s) = raw {
                        return Some(s.to_string());
                    }
                }
            }
            serde_json::Value::String(s_src) => {
                if source_kind_is_directory(s_src.as_str()) {
                    let raw = ["path", "directory", "root", "localPath", "installPath", "install_path"]
                        .iter()
                        .find_map(|k| {
                            entry
                                .get(*k)
                                .and_then(|v| v.as_str())
                                .map(str::trim)
                                .filter(|s| !s.is_empty())
                        });
                    if let Some(s) = raw {
                        return Some(s.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    // 形态 B：顶层 `type` / `kind` + `path`
    let top_ty = entry
        .get("type")
        .or_else(|| entry.get("kind"))
        .or_else(|| entry.get("source"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if source_kind_is_directory(top_ty) {
        let raw = ["path", "directory", "root", "localPath", "installPath", "install_path"]
            .iter()
            .find_map(|k| {
                entry
                    .get(*k)
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            });
        if let Some(s) = raw {
            return Some(s.to_string());
        }
    }
    // 形态 C：`extraKnownMarketplaces.<id>` 仅顶层 `path` / `root` 等（无 `source` / `type` 包裹），
    // 与 digital-engine-plugin-marketplace 等本地市场一致；排除 http(s) 以免把远程 URL 当目录。
    if let Some(s) = ["path", "directory", "root", "localPath", "installPath", "install_path"]
        .iter()
        .find_map(|k| {
            entry
                .get(*k)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
        })
    {
        let lower = s.to_lowercase();
        if !lower.starts_with("http://") && !lower.starts_with("https://") {
            return Some(s.to_string());
        }
    }
    None
}

/// 展开配置中的路径字符串（不要求目录已存在）；存在且为目录时再 canonicalize。
/// 支持 `~`、`$HOME/` 前缀，以及任意位置的 `$VAR` / `${VAR}` / `%VAR%`（当前进程环境）。
fn expand_claude_config_path_string(home: &Path, raw: &str) -> PathBuf {
    let t = raw.trim();
    let t = t.strip_prefix("file://").unwrap_or(t);
    if t.is_empty() {
        return PathBuf::new();
    }
    let t = expand_env_vars_in_str(t);
    let t = t.as_str();
    let mut pb = if let Some(rest) = t.strip_prefix("~/") {
        home.join(rest)
    } else if t == "~" {
        home.to_path_buf()
    } else if let Some(rest) = t.strip_prefix("$HOME/") {
        home.join(rest)
    } else {
        PathBuf::from(t)
    };
    if pb.as_path().is_relative() {
        pb = home.join(pb);
    }
    pb
}

/// 从已解析的 `settings.json` 根对象读取 `extraKnownMarketplaces`：收集 directory 类本地根（键为 marketplace id）。
fn extra_known_marketplace_directory_roots_from_settings_value(
    home: &Path,
    settings_root: &serde_json::Value,
) -> HashMap<String, PathBuf> {
    let Some(root) = settings_root.as_object() else {
        return HashMap::new();
    };
    let Some(ekm) = root.get("extraKnownMarketplaces").and_then(|x| x.as_object()) else {
        return HashMap::new();
    };
    let mut out: HashMap<String, PathBuf> = HashMap::new();
    for (marketplace_key, entry_v) in ekm {
        let raw_path = if let Some(entry) = entry_v.as_object() {
            extract_extra_marketplace_directory_raw_path(entry)
        } else if let Some(s) = entry_v.as_str() {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                let lower = t.to_lowercase();
                if lower.starts_with("http://") || lower.starts_with("https://") {
                    None
                } else {
                    Some(t.to_string())
                }
            }
        } else {
            None
        };
        let Some(raw_path) = raw_path else {
            continue;
        };
        let expanded = expand_claude_config_path_string(home, &raw_path);
        if expanded.as_os_str().is_empty() {
            continue;
        }
        // 与 installPath 一致：存在且为目录才采纳（避免误配空路径）
        if expanded.is_dir() {
            let pb = fs::canonicalize(&expanded).unwrap_or(expanded);
            out.insert(marketplace_key.clone(), pb);
        }
    }
    out
}

/// 定位「插件市场」根目录：优先 `~/.claude/plugins/marketplaces/<id>`，其次大小写不敏感、`plugins/<id>`、再在 `cache/**` 内按目录名匹配（兼容真实安装路径与标准布局不一致）。
fn resolve_plugin_marketplace_root_dir(home: &Path, marketplace_id: &str) -> Option<PathBuf> {
    let id_lower = marketplace_id.to_lowercase();
    let marketplaces_parent = home.join(".claude").join("plugins").join("marketplaces");
    let primary = marketplaces_parent.join(marketplace_id);
    if primary.is_dir() {
        return fs::canonicalize(&primary).ok().or(Some(primary));
    }
    if marketplaces_parent.is_dir() {
        if let Ok(rd) = fs::read_dir(&marketplaces_parent) {
            for ent in rd.flatten() {
                if !ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let name = ent.file_name().to_string_lossy().to_lowercase();
                if name == id_lower {
                    let p = ent.path();
                    return fs::canonicalize(&p).ok().or(Some(p));
                }
            }
        }
    }
    let flat = home.join(".claude").join("plugins").join(marketplace_id);
    if flat.is_dir() {
        return fs::canonicalize(&flat).ok().or(Some(flat));
    }
    let cache = claude_plugins_cache_dir(home);
    if let Ok(cache_canon) = fs::canonicalize(&cache) {
        if cache_canon.is_dir() {
            let walker = WalkDir::new(&cache_canon)
                .follow_links(false)
                .max_depth(16)
                .into_iter()
                .filter_entry(walkdir_skip_plugin_noise);
            for ent in walker.filter_map(|e| e.ok()) {
                if !ent.file_type().is_dir() || ent.depth() == 0 {
                    continue;
                }
                if ent.file_name().to_string_lossy().to_lowercase() == id_lower {
                    let p = ent.path().to_path_buf();
                    return fs::canonicalize(&p).ok().or(Some(p));
                }
            }
        }
    }
    None
}

/// 在 `parent` 的一级子目录中按不区分大小写匹配目录名（用于 `plugins/dima-plugin` 与磁盘实际大小写不一致）。
fn find_immediate_child_dir_case_insensitive(parent: &Path, name_wanted: &str) -> Option<PathBuf> {
    let w = name_wanted.trim().to_lowercase();
    if w.is_empty() {
        return None;
    }
    let rd = fs::read_dir(parent).ok()?;
    for ent in rd.flatten() {
        if !ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        if ent.file_name().to_string_lossy().to_lowercase() == w {
            return Some(ent.path());
        }
    }
    None
}

fn plugin_dir_root_if_valid(candidate: &Path) -> Option<PathBuf> {
    if !candidate.is_dir() {
        return None;
    }
    if candidate.join(".claude-plugin").join("plugin.json").is_file()
        || candidate.join(".mcp.json").is_file()
        || is_claude_plugin_package_root(candidate)
    {
        return fs::canonicalize(candidate).ok().or_else(|| Some(candidate.to_path_buf()));
    }
    None
}

fn resolve_marketplace_plugin_root_from_slugs(
    home: &Path,
    marketplace_id: &str,
    plugin_slug: &str,
    extra_marketplace_roots: &HashMap<String, PathBuf>,
) -> Option<PathBuf> {
    let mdir = extra_marketplace_roots
        .get(marketplace_id)
        .cloned()
        .or_else(|| {
            let id_lower = marketplace_id.to_lowercase();
            extra_marketplace_roots
                .iter()
                .find(|(k, _)| k.to_lowercase() == id_lower)
                .map(|(_, v)| v.clone())
        })
        .filter(|p| p.is_dir())
        .map(|p| fs::canonicalize(&p).unwrap_or(p))
        .or_else(|| resolve_plugin_marketplace_root_dir(home, marketplace_id))?;
    let direct = [mdir.join("plugins").join(plugin_slug), mdir.join(plugin_slug)];
    for c in &direct {
        if let Some(p) = plugin_dir_root_if_valid(c) {
            return Some(p);
        }
    }
    let plugins_dir = mdir.join("plugins");
    if plugins_dir.is_dir() {
        if let Some(p) = find_immediate_child_dir_case_insensitive(&plugins_dir, plugin_slug) {
            if let Some(ok) = plugin_dir_root_if_valid(&p) {
                return Some(ok);
            }
        }
    }
    if let Some(p) = find_immediate_child_dir_case_insensitive(&mdir, plugin_slug) {
        if let Some(ok) = plugin_dir_root_if_valid(&p) {
            return Some(ok);
        }
    }
    for root in discover_plugin_package_roots_in_tree(&mdir) {
        if root
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case(plugin_slug))
        {
            return Some(root);
        }
    }
    None
}

/// 单条 `plugin-slug@marketplace-id` 开关：解析磁盘上的插件根并写入 `out`（与根级、`enabledPlugins` 内写法共用）。
fn push_mcp_from_settings_plugin_marketplace_toggle_if_enabled(
    home: &Path,
    toggle_key: &str,
    val: &serde_json::Value,
    extra_marketplace_roots: &HashMap<String, PathBuf>,
    seen_roots: &mut HashSet<String>,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let Some((ref plugin_slug, ref marketplace_id)) = parse_settings_plugin_marketplace_toggle_key(toggle_key) else {
        return;
    };
    if !marketplace_plugin_toggle_value_enabled(val) {
        return;
    }
    let Some(plugin_root) = resolve_marketplace_plugin_root_from_slugs(
        home,
        marketplace_id.as_str(),
        plugin_slug.as_str(),
        extra_marketplace_roots,
    ) else {
        return;
    };
    let canon_key = plugin_root.to_string_lossy().to_string();
    if !seen_roots.insert(canon_key) {
        return;
    }
    let plugin_ref = format!("settingsToggle:{toggle_key}");
    push_mcp_declarations_from_plugin_dir(home, &plugin_ref, &plugin_root, out);
}

/// 从用户 `~/.claude/settings.json` 中读取 `plugin@marketplace` 启用项并解析对应插件包内的 MCP（与 `installed_plugins.json` / 目录扫描互补）。
/// Claude Code 常把开关写在根级，或写在 `enabledPlugins` 对象内，两者都扫描。
fn collect_mcp_from_claude_settings_marketplace_plugin_toggles(
    home: &Path,
    seen_roots: &mut HashSet<String>,
    out: &mut Vec<ClaudeMcpItem>,
) {
    let path = home.join(".claude").join("settings.json");
    let Some(file_v) = read_json_file(&path) else {
        return;
    };
    let extra_marketplace_roots = extra_known_marketplace_directory_roots_from_settings_value(home, &file_v);
    let Some(obj) = file_v.as_object() else {
        return;
    };
    for (key, val) in obj {
        let ks = key.as_str();
        if matches!(
            ks,
            "mcpServers" | "mcp_servers" | "env" | "permissions" | "hooks" | "attribution" | "model"
        ) {
            continue;
        }
        if ks == "enabledPlugins" {
            if let Some(ep) = val.as_object() {
                for (toggle_key, ev) in ep {
                    push_mcp_from_settings_plugin_marketplace_toggle_if_enabled(
                        home,
                        toggle_key.as_str(),
                        ev,
                        &extra_marketplace_roots,
                        seen_roots,
                        out,
                    );
                }
            }
            continue;
        }
        push_mcp_from_settings_plugin_marketplace_toggle_if_enabled(
            home,
            ks,
            val,
            &extra_marketplace_roots,
            seen_roots,
            out,
        );
    }
}

/// 扫描 `installed_plugins.json`、`~/.claude/settings.json`（根级与 `enabledPlugins` 内的 `plugin@marketplace` 开关）、`plugins/marketplaces/**`、`plugins/cache/**` 与各插件根目录内的 MCP 声明（只读展示用）。
fn collect_installed_plugin_mcp_items(home: &Path) -> Vec<ClaudeMcpItem> {
    let mut out: Vec<ClaudeMcpItem> = Vec::new();
    let mut seen_roots: HashSet<String> = HashSet::new();

    let installed_path = home.join(".claude").join("plugins").join("installed_plugins.json");
    let installed_hint_base = installed_path.to_string_lossy().to_string();
    if let Some(root_val) = read_json_file(&installed_path) {
        if let Some(plugins_obj) = root_val.get("plugins").and_then(|x| x.as_object()) {
            for (plugin_ref, entries_val) in plugins_obj {
                let entry_rows: Vec<&serde_json::Value> = if let Some(arr) = entries_val.as_array() {
                    arr.iter().collect()
                } else if entries_val.is_object() {
                    vec![entries_val]
                } else {
                    continue;
                };
                for ent in entry_rows {
                    let install_raw = ent
                        .get("installPath")
                        .and_then(|x| x.as_str())
                        .or_else(|| ent.get("install_path").and_then(|x| x.as_str()));
                    let Some(install_raw) = install_raw.map(str::trim).filter(|s| !s.is_empty()) else {
                        continue;
                    };
                    let Some(plugin_root) = resolve_claude_plugin_install_path(home, install_raw) else {
                        continue;
                    };
                    let canon_key = plugin_root.to_string_lossy().to_string();
                    if !seen_roots.insert(canon_key) {
                        continue;
                    }
                    push_mcp_declarations_from_plugin_dir(home, plugin_ref, &plugin_root, &mut out);
                    // 安装记录上可附带与 manifest 合并的 mcpServers（Claude Code 部分版本会写在这里）
                    if let Some(spec) = ent
                        .get("mcpServers")
                        .or_else(|| ent.get("mcp_servers"))
                        .filter(|s| !s.is_null())
                    {
                        let hint = format!("{} [{}]", installed_hint_base, plugin_ref);
                        let mut inline_maps: Vec<(String, serde_json::Map<String, serde_json::Value>)> =
                            Vec::new();
                        collect_mcp_maps_from_plugin_mcp_spec(&plugin_root, spec, &hint, &mut inline_maps);
                        append_mcp_declaration_maps(home, plugin_ref, &plugin_root, inline_maps, &mut out);
                    }
                }
            }
        }
    }

    collect_mcp_from_claude_settings_marketplace_plugin_toggles(home, &mut seen_roots, &mut out);

    // Claude Code 还会在 `~/.claude/plugins/marketplaces/<id>/` 下放一份与 cache 并行的清单。
    // 官方市场多为 monorepo（如 `plugins/<name>/.claude-plugin/plugin.json`），必须递归枚举子目录，否则会漏掉 manifest 内 `mcpServers`。
    let marketplaces = home.join(".claude").join("plugins").join("marketplaces");
    if let Ok(rd) = fs::read_dir(&marketplaces) {
        for ent in rd.flatten() {
            let root = ent.path();
            if !root.is_dir() {
                continue;
            }
            let fname = ent.file_name();
            let Some(mid) = fname.to_str() else {
                continue;
            };
            let root_canon = match fs::canonicalize(&root) {
                Ok(p) => p,
                Err(_) => root,
            };
            if !root_canon.is_dir() {
                continue;
            }
            for plugin_root in discover_plugin_package_roots_in_tree(&root_canon) {
                if !plugin_package_root_declares_mcp(&plugin_root) {
                    continue;
                }
                let canon_key = plugin_root.to_string_lossy().to_string();
                if !seen_roots.insert(canon_key) {
                    continue;
                }
                let rel_slug = plugin_root
                    .strip_prefix(&root_canon)
                    .map(|r| {
                        r.to_string_lossy()
                            .replace('\\', "/")
                            .trim_matches('/')
                            .to_string()
                    })
                    .unwrap_or_default();
                let plugin_ref = if rel_slug.is_empty() {
                    format!("marketplace:{}", mid)
                } else {
                    format!("marketplace:{}:{}", mid, rel_slug)
                };
                push_mcp_declarations_from_plugin_dir(home, &plugin_ref, &plugin_root, &mut out);
            }
        }
    }

    for (rel, plugin_root) in discover_plugin_roots_under_claude_cache(home) {
        let canon_key = plugin_root.to_string_lossy().to_string();
        if !seen_roots.insert(canon_key) {
            continue;
        }
        let plugin_ref = format!("cache:{}", rel);
        push_mcp_declarations_from_plugin_dir(home, &plugin_ref, &plugin_root, &mut out);
    }

    let mut out = dedupe_plugin_mcp_items(out);
    out.sort_by(|a, b| {
        a.plugin_ref
            .as_deref()
            .unwrap_or("")
            .cmp(b.plugin_ref.as_deref().unwrap_or(""))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/// Parses combined stdout/stderr of `claude mcp list` (e.g. `name: cmd - ✓ Connected`).
fn parse_claude_mcp_list_health_output(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.contains("Checking MCP") {
            continue;
        }
        let Some((left, right)) = line.rsplit_once(" - ") else {
            continue;
        };
        let right = right.trim();
        let rl = right.to_lowercase();
        let status = if right.contains('✓') || rl.contains("connected") {
            "connected".to_string()
        } else if right.contains('✗') || rl.contains("fail") {
            "failed".to_string()
        } else {
            continue;
        };
        let Some((name, _rest)) = left.split_once(':') else {
            continue;
        };
        let name = name.trim();
        if !name.is_empty() {
            map.insert(name.to_string(), status);
        }
    }
    map
}

/// Runs `claude mcp list` in project root (or home) to obtain per-server health from Claude CLI.
fn run_claude_mcp_list_health(project_path: Option<&str>) -> HashMap<String, String> {
    let Ok(bin) = find_claude_binary() else {
        return HashMap::new();
    };
    let Some(home) = dirs::home_dir() else {
        return HashMap::new();
    };
    let cwd = project_path
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|p| {
            let pb = PathBuf::from(p);
            if pb.is_dir() {
                fs::canonicalize(pb).ok()
            } else {
                None
            }
        })
        .unwrap_or_else(|| home.clone());

    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let Ok(out) = Command::new(&bin)
        .args(["mcp", "list"])
        .current_dir(&cwd)
        .env("PATH", path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .output()
    else {
        return HashMap::new();
    };

    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    parse_claude_mcp_list_health_output(&text)
}

fn validate_mcp_server_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if n.len() > 128 {
        return Err("名称过长（最多 128 字符）".to_string());
    }
    let ok = n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if !ok {
        return Err("名称仅允许 ASCII 字母、数字、._-".to_string());
    }
    Ok(())
}

fn mcp_cli_cwd(scope: &str, project_path: Option<&str>, home: &Path) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(home.to_path_buf()),
        "local" | "project" => {
            let p = project_path.ok_or_else(|| "需要 projectPath".to_string())?.trim();
            if p.is_empty() {
                return Err("projectPath 为空".to_string());
            }
            let root = PathBuf::from(p);
            if !root.is_dir() {
                return Err("项目目录不存在".to_string());
            }
            fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))
        }
        _ => Err(format!("无效的 MCP scope: {}", scope)),
    }
}

fn allowed_mcp_source_paths(home: &Path, project_path: Option<&str>) -> Result<Vec<PathBuf>, String> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let hj = home.join(".claude.json");
    if hj.exists() {
        paths.push(fs::canonicalize(&hj).map_err(|e| e.to_string())?);
    }
    let us = home.join(".claude").join("settings.json");
    if us.exists() {
        paths.push(fs::canonicalize(&us).map_err(|e| e.to_string())?);
    }
    if let Some(pp) = project_path.map(str::trim).filter(|s| !s.is_empty()) {
        let root = PathBuf::from(pp);
        let canon = fs::canonicalize(&root).map_err(|e| format!("项目路径无效: {}", e))?;
        let mcpj = canon.join(".mcp.json");
        if mcpj.exists() {
            paths.push(fs::canonicalize(&mcpj).map_err(|e| e.to_string())?);
        }
        let ps = canon.join(".claude").join("settings.json");
        if ps.exists() {
            paths.push(fs::canonicalize(&ps).map_err(|e| e.to_string())?);
        }
    }
    Ok(paths)
}

fn assert_allowed_mcp_source(path: &Path, home: &Path, project_path: Option<&str>) -> Result<PathBuf, String> {
    let canon = fs::canonicalize(path).map_err(|e| format!("无法访问配置文件: {}", e))?;
    let allowed = allowed_mcp_source_paths(home, project_path)?;
    if allowed.iter().any(|p| p == &canon) {
        Ok(canon)
    } else {
        Err("不允许修改该配置文件路径".to_string())
    }
}

fn run_claude_mcp_cli(args: &[String], cwd: &Path) -> Result<(), String> {
    let bin = find_claude_binary()?;
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let out = Command::new(&bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", &path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .output()
        .map_err(|e| format!("无法启动 claude: {}", e))?;
    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Err(format!(
            "claude mcp 失败（退出码 {:?}）\n{}\n{}",
            out.status.code(),
            stderr,
            stdout
        ))
    }
}

fn remove_mcp_server_key_from_file(path: &Path, server_name: &str) -> Result<(), String> {
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let removed = if let Some(obj) = v.get_mut("mcpServers").and_then(|x| x.as_object_mut()) {
        obj.remove(server_name).is_some()
    } else if let Some(obj) = v.get_mut("mcp_servers").and_then(|x| x.as_object_mut()) {
        obj.remove(server_name).is_some()
    } else {
        false
    };
    if !removed {
        return Err(format!("未在文件中找到 MCP: {}", server_name));
    }
    let out = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn patch_mcp_entry_disabled_in_file(
    path: &Path,
    scope: &str,
    server_name: &str,
    enabled: bool,
    claude_json_project_key: Option<&str>,
) -> Result<(), String> {
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let entry = match scope {
        "user" => v
            .get_mut("mcpServers")
            .and_then(|x| x.as_object_mut())
            .and_then(|m| m.get_mut(server_name)),
        "local" => {
            let key = claude_json_project_key.ok_or_else(|| "缺少 claudeJsonProjectKey".to_string())?;
            v.get_mut("projects")
                .and_then(|x| x.as_object_mut())
                .and_then(|m| m.get_mut(key))
                .and_then(|proj| proj.get_mut("mcpServers"))
                .and_then(|x| x.as_object_mut())
                .and_then(|m| m.get_mut(server_name))
        }
        "project" | "legacy_user_settings" | "legacy_project_settings" => {
            if let Some(m) = v.get_mut("mcpServers").and_then(|x| x.as_object_mut()) {
                m.get_mut(server_name)
            } else {
                v.get_mut("mcp_servers")
                    .and_then(|x| x.as_object_mut())
                    .and_then(|m| m.get_mut(server_name))
            }
        }
        "plugin" => {
            return Err("插件内置 MCP 由 Claude Code 插件管理，不能在此开关".to_string());
        }
        _ => return Err(format!("无法写入该 scope: {}", scope)),
    };
    let Some(entry) = entry else {
        return Err(format!("未找到 MCP: {}", server_name));
    };
    let obj = entry
        .as_object_mut()
        .ok_or_else(|| "MCP 条目不是 JSON 对象".to_string())?;
    if enabled {
        obj.remove("disabled");
        obj.insert("enabled".to_string(), serde_json::Value::Bool(true));
    } else {
        obj.insert("disabled".to_string(), serde_json::Value::Bool(true));
    }
    let out = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_claude_mcp_status_collect(project_path: Option<String>) -> Result<ClaudeMcpStatusResponse, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let claude_json_path = home.join(".claude.json");
    let claude_json_str = claude_json_path.to_string_lossy().to_string();

    let mut user = Vec::new();
    let mut local = Vec::new();

    if let Some(v) = read_json_file(&claude_json_path) {
        if let Some(map) = v.get("mcpServers").and_then(|x| x.as_object()) {
            user = build_mcp_items_from_map(map, "user", &claude_json_str, None);
        }

        if let (Some(pp), Some(projects)) = (
            project_path
                .as_ref()
                .map(|s| s.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty()),
            v.get("projects").and_then(|x| x.as_object()),
        ) {
            for (key, proj_val) in projects {
                if paths_match_claude_project(pp, key) {
                    if let Some(map) = proj_val.get("mcpServers").and_then(|x| x.as_object()) {
                        local = build_mcp_items_from_map(map, "local", &claude_json_str, Some(key.as_str()));
                    }
                    break;
                }
            }
        }
    }

    let mut project_shared = Vec::new();
    if let Some(pp) = project_path
        .as_ref()
        .map(|s| s.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let mcp_json = PathBuf::from(pp).join(".mcp.json");
        if let Some(v) = read_json_file(&mcp_json) {
            let sp = mcp_json.to_string_lossy().to_string();
            project_shared = build_mcp_items_from_settings_mcp_block(&v, "project", &sp, None);
        }
    }

    let user_settings_path = home.join(".claude").join("settings.json");
    let legacy_user_settings = read_json_file(&user_settings_path)
        .map(|v| {
            build_mcp_items_from_settings_mcp_block(
                &v,
                "legacy_user_settings",
                &user_settings_path.to_string_lossy(),
                None,
            )
        })
        .unwrap_or_default();

    let mut legacy_project_settings = Vec::new();
    if let Some(pp) = project_path
        .as_ref()
        .map(|s| s.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let p = PathBuf::from(pp).join(".claude").join("settings.json");
        if let Some(v) = read_json_file(&p) {
            legacy_project_settings = build_mcp_items_from_settings_mcp_block(
                &v,
                "legacy_project_settings",
                &p.to_string_lossy(),
                None,
            );
        }
    }

    let plugin_mcp = collect_installed_plugin_mcp_items(&home);

    Ok(ClaudeMcpStatusResponse {
        user,
        local,
        project_shared,
        legacy_user_settings,
        legacy_project_settings,
        plugin_mcp,
    })
}

/// Reads MCP JSON configs on a blocking thread (does not run `claude mcp list`).
#[tauri::command]
async fn get_claude_mcp_status(project_path: Option<String>) -> Result<ClaudeMcpStatusResponse, String> {
    tokio::task::spawn_blocking(move || get_claude_mcp_status_collect(project_path))
        .await
        .map_err(|e| format!("get_claude_mcp_status: {}", e))?
}

/// Runs `claude mcp list` on a blocking thread; frontend merges by server name.
#[tauri::command]
async fn get_claude_mcp_runtime_health(
    project_path: Option<String>,
) -> Result<Vec<ClaudeMcpRuntimeHealthEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let map = run_claude_mcp_list_health(project_path.as_deref());
        let mut v: Vec<ClaudeMcpRuntimeHealthEntry> = map
            .into_iter()
            .map(|(name, status)| ClaudeMcpRuntimeHealthEntry { name, status })
            .collect();
        v.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        v
    })
    .await
    .map_err(|e| format!("get_claude_mcp_runtime_health: {}", e))
}

#[tauri::command]
fn remove_claude_mcp_server(
    project_path: Option<String>,
    name: String,
    scope: String,
    source_path: String,
    _claude_json_project_key: Option<String>,
) -> Result<(), String> {
    validate_mcp_server_name(&name)?;
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim().to_string();
    match scope.as_str() {
        "legacy_user_settings" | "legacy_project_settings" => {
            let path = PathBuf::from(source_path.trim());
            assert_allowed_mcp_source(&path, &home, project_path.as_deref())?;
            remove_mcp_server_key_from_file(&path, name.trim())?;
        }
        "user" | "local" | "project" => {
            let cwd = mcp_cli_cwd(&scope, project_path.as_deref(), &home)?;
            let args = vec![
                "mcp".into(),
                "remove".into(),
                name.trim().to_string(),
                "-s".into(),
                scope.clone(),
            ];
            run_claude_mcp_cli(&args, &cwd)?;
        }
        "plugin" => {
            return Err("插件内置 MCP 由 Claude Code 插件管理，不能在此删除".to_string());
        }
        _ => return Err(format!("未知的 MCP 范围: {}", scope)),
    }
    Ok(())
}

#[tauri::command]
fn add_claude_mcp_server(
    scope: String,
    transport: String,
    name: String,
    url: Option<String>,
    command: Option<String>,
    command_args: Option<Vec<String>>,
    headers: Option<Vec<String>>,
    env_pairs: Option<Vec<String>>,
    project_path: Option<String>,
) -> Result<(), String> {
    validate_mcp_server_name(&name)?;
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim();
    if !matches!(scope, "user" | "local" | "project") {
        return Err("scope 必须是 user、local 或 project".to_string());
    }
    if matches!(scope, "local" | "project")
        && project_path
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
    {
        return Err("local / project 范围需要有效的 projectPath".to_string());
    }
    let transport = transport.trim().to_lowercase();
    if !matches!(transport.as_str(), "http" | "sse" | "stdio") {
        return Err("transport 必须是 http、sse 或 stdio".to_string());
    }

    let cwd = mcp_cli_cwd(scope, project_path.as_deref(), &home)?;

    let mut args: Vec<String> = vec![
        "mcp".into(),
        "add".into(),
        "-t".into(),
        transport.clone(),
        "-s".into(),
        scope.to_string(),
    ];

    if let Some(envs) = &env_pairs {
        for e in envs {
            let e = e.trim();
            if !e.is_empty() {
                args.push("-e".into());
                args.push(e.to_string());
            }
        }
    }
    if let Some(hdrs) = &headers {
        for h in hdrs {
            let h = h.trim();
            if !h.is_empty() {
                args.push("-H".into());
                args.push(h.to_string());
            }
        }
    }

    args.push(name.trim().to_string());

    match transport.as_str() {
        "http" | "sse" => {
            let url = url
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "HTTP/SSE 需要填写 url".to_string())?;
            args.push(url);
        }
        "stdio" => {
            let cmd = command
                .as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "stdio 需要填写 command（可执行文件）".to_string())?;
            args.push("--".into());
            args.push(cmd);
            if let Some(parts) = &command_args {
                for p in parts {
                    if !p.trim().is_empty() {
                        args.push(p.trim().to_string());
                    }
                }
            }
        }
        _ => {}
    }

    run_claude_mcp_cli(&args, &cwd)
}

fn set_claude_mcp_server_enabled_impl(
    project_path: Option<String>,
    server_name: String,
    scope: String,
    source_path: String,
    claude_json_project_key: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    validate_mcp_server_name(&server_name)?;
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let scope = scope.trim().to_string();
    if scope == "plugin" {
        return Err("插件内置 MCP 由 Claude Code 插件管理，不能在此开关".to_string());
    }
    let path = PathBuf::from(source_path.trim());
    assert_allowed_mcp_source(&path, &home, project_path.as_deref())?;
    patch_mcp_entry_disabled_in_file(
        &path,
        &scope,
        server_name.trim(),
        enabled,
        claude_json_project_key.as_deref(),
    )
}

/// Patches MCP enabled flag on a blocking thread so file I/O does not block the async runtime.
#[tauri::command]
async fn set_claude_mcp_server_enabled(
    project_path: Option<String>,
    server_name: String,
    scope: String,
    source_path: String,
    claude_json_project_key: Option<String>,
    enabled: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        set_claude_mcp_server_enabled_impl(
            project_path,
            server_name,
            scope,
            source_path,
            claude_json_project_key,
            enabled,
        )
    })
    .await
    .map_err(|e| format!("set_claude_mcp_server_enabled: {}", e))?
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
    let mut event_map: HashMap<String, Vec<ClaudeHookMatcherGroup>> = HashMap::new();
    let mut disable_all_hooks = false;
    if let Some(v) = read_json_file(path) {
        disable_all_hooks = v
            .get("disableAllHooks")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        if let Some(hooks_obj) = v.get("hooks").and_then(|x| x.as_object()) {
            for (event_name, groups_val) in hooks_obj {
                let Some(groups_arr) = groups_val.as_array() else { continue };
                let mut groups: Vec<ClaudeHookMatcherGroup> = Vec::new();
                for (g_idx, g_val) in groups_arr.iter().enumerate() {
                    let Some(g_obj) = g_val.as_object() else { continue };
                    let matcher = g_obj
                        .get("matcher")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string());
                    let mut handlers: Vec<ClaudeHookHandler> = Vec::new();
                    if let Some(hooks_arr) = g_obj.get("hooks").and_then(|x| x.as_array()) {
                        for (h_idx, h_val) in hooks_arr.iter().enumerate() {
                            let Some(h_obj) = h_val.as_object() else { continue };
                            let ty = h_obj
                                .get("type")
                                .and_then(|x| x.as_str())
                                .unwrap_or("command")
                                .to_string();
                            let headers = h_obj
                                .get("headers")
                                .and_then(|x| x.as_object())
                                .map(|m| {
                                    let mut out = HashMap::new();
                                    for (k, v) in m {
                                        if let Some(s) = v.as_str() {
                                            out.insert(k.clone(), s.to_string());
                                        }
                                    }
                                    out
                                })
                                .filter(|m: &HashMap<String, String>| !m.is_empty());
                            let allowed_env_vars = h_obj
                                .get("allowedEnvVars")
                                .and_then(|x| x.as_array())
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|x| x.as_str())
                                        .map(|s| s.to_string())
                                        .collect::<Vec<_>>()
                                })
                                .filter(|a| !a.is_empty());
                            handlers.push(ClaudeHookHandler {
                                id: format!("{}:{}:{}", event_name, g_idx, h_idx),
                                r#type: ty,
                                r#if: h_obj.get("if").and_then(|x| x.as_str()).map(|s| s.to_string()),
                                timeout: h_obj.get("timeout").and_then(|x| x.as_i64()),
                                status_message: h_obj
                                    .get("statusMessage")
                                    .and_then(|x| x.as_str())
                                    .map(|s| s.to_string()),
                                shell: h_obj.get("shell").and_then(|x| x.as_str()).map(|s| s.to_string()),
                                r#async: h_obj.get("async").and_then(|x| x.as_bool()),
                                async_rewake: h_obj.get("asyncRewake").and_then(|x| x.as_bool()),
                                command: h_obj
                                    .get("command")
                                    .and_then(|x| x.as_str())
                                    .map(|s| s.to_string()),
                                url: h_obj.get("url").and_then(|x| x.as_str()).map(|s| s.to_string()),
                                headers,
                                allowed_env_vars,
                                prompt: h_obj
                                    .get("prompt")
                                    .and_then(|x| x.as_str())
                                    .map(|s| s.to_string()),
                                model: h_obj.get("model").and_then(|x| x.as_str()).map(|s| s.to_string()),
                            });
                        }
                    }
                    groups.push(ClaudeHookMatcherGroup {
                        id: format!("{}:{}", event_name, g_idx),
                        matcher,
                        hooks: handlers,
                    });
                }
                if !groups.is_empty() {
                    event_map.insert(event_name.to_string(), groups);
                }
            }
        }
    }
    ClaudeHookScopeData {
        source_path: path.to_string_lossy().to_string(),
        disable_all_hooks,
        hooks: event_map,
    }
}

fn hooks_settings_path_for_scope(
    scope: &str,
    project_path: Option<&str>,
    home: &Path,
) -> Result<PathBuf, String> {
    match scope {
        "user" => Ok(home.join(".claude").join("settings.json")),
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
            Ok(PathBuf::from(pp).join(".claude").join("settings.local.json"))
        }
        _ => Err(format!("未知 hooks scope: {}", scope)),
    }
}

fn normalize_hook_handler_input(handler: ClaudeHookHandlerInput) -> Result<serde_json::Value, String> {
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
    if let Some(v) = handler.r#if.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
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
    if let Some(v) = handler.shell.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
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
            if let Some(model) = handler.model.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                obj.insert("model".into(), serde_json::Value::String(model));
            }
        }
        _ => {}
    }
    Ok(serde_json::Value::Object(obj))
}

#[tauri::command]
fn get_claude_hooks_status(project_path: Option<String>) -> Result<ClaudeHooksStatusResponse, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let user_path = home.join(".claude").join("settings.json");
    let project_root = canonicalize_existing_project_dir(project_path.as_deref());
    let project_path_file = project_root.as_ref().map(|p| p.join(".claude").join("settings.json"));
    let local_path_file = project_root
        .as_ref()
        .map(|p| p.join(".claude").join("settings.local.json"));
    let omc_hooks_file = resolve_omc_plugin_root()
        .map(|root| root.join("hooks").join("hooks.json"));

    Ok(ClaudeHooksStatusResponse {
        user: build_hook_scope_data(&user_path),
        project: build_hook_scope_data(
            &project_path_file.unwrap_or_else(|| PathBuf::from("<请选择项目后可查看 project hooks>")),
        ),
        local: build_hook_scope_data(
            &local_path_file.unwrap_or_else(|| PathBuf::from("<请选择项目后可查看 local hooks>")),
        ),
        omc: build_hook_scope_data(
            &omc_hooks_file.unwrap_or_else(|| PathBuf::from("<未发现 OMC 插件 hooks.json>")),
        ),
    })
}

#[tauri::command]
fn upsert_claude_hook(
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
    let matcher = matcher.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    let hooks_obj = root
        .get_mut("hooks")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| "hooks 字段必须是对象".to_string())?;
    let groups = hooks_obj
        .entry(event_name.clone())
        .or_insert_with(|| serde_json::Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "event hooks 必须是数组".to_string())?;

    if let (Some(group_id), Some(handler_id)) = (target_group_id.as_ref(), target_handler_id.as_ref()) {
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
fn remove_claude_hook(
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
fn set_claude_disable_all_hooks(
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

/// User `~/.claude/settings.json`, optionally overridden by `{project}/.claude/settings.json`.
#[tauri::command]
fn get_claude_config_model(project_path: Option<String>) -> Result<Option<String>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let user_settings = home.join(".claude").join("settings.json");
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
fn get_claude_model_picker_options(project_path: Option<String>) -> Result<ClaudeModelPickerOptions, String> {
    collect_claude_model_picker_options(project_path)
}

// ── Claude Code project skills (.claude/skills/{name}/SKILL.md) ──

pub(crate) fn validate_claude_skill_name(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("技能名称不能为空".to_string());
    }
    if name.len() > 128 {
        return Err("技能名称过长（最多 128 字符）".to_string());
    }
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if !ok {
        return Err("仅允许 ASCII 字母、数字、下划线与连字符".to_string());
    }
    Ok(())
}

fn project_claude_skills_dir(project_path: &str) -> Result<PathBuf, String> {
    let p = project_path.trim();
    if p.is_empty() {
        return Err("项目路径无效".to_string());
    }
    let root = PathBuf::from(p);
    if !root.is_dir() {
        return Err("项目目录不存在".to_string());
    }
    let canon = fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))?;
    Ok(canon.join(".claude").join("skills"))
}

fn skill_preview_from_markdown(text: &str) -> Option<String> {
    let mut in_frontmatter = false;
    let mut frontmatter_started = false;

    for line in text.lines() {
        let t = line.trim();
        if !frontmatter_started && t == "---" {
            in_frontmatter = true;
            frontmatter_started = true;
            continue;
        }
        if in_frontmatter {
            if t == "---" {
                in_frontmatter = false;
            }
            continue;
        }
        if t.is_empty() {
            continue;
        }
        let s = t.strip_prefix('#').map(str::trim).unwrap_or(t);
        if s.is_empty() {
            continue;
        }
        let mut out: String = s.chars().take(100).collect();
        if s.chars().count() > 100 {
            out.push('…');
        }
        return Some(out);
    }
    None
}

/// frontmatter 顶层的 `key:` 行（无缩进），用于块标量结束判断。
fn skill_frontmatter_root_key_line(line: &str) -> bool {
    let t = line.trim_start();
    if t.is_empty() || t.starts_with('#') {
        return false;
    }
    if line.starts_with(' ') || line.starts_with('\t') {
        return false;
    }
    let Some((k, _)) = t.split_once(':') else {
        return false;
    };
    let k = k.trim();
    !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// 将块标量各行去掉公共前导空白；`fold` 为 true 时按 YAML `>` 的简化语义把行合并为单段空格分隔。
fn skill_description_format_block(lines: &[String], fold: bool) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let non_empty: Vec<&String> = lines.iter().filter(|l| !l.trim().is_empty()).collect();
    let min_indent = if non_empty.is_empty() {
        0usize
    } else {
        non_empty
            .iter()
            .map(|l| l.chars().take_while(|c| *c == ' ' || *c == '\t').count())
            .min()
            .unwrap_or(0)
    };
    let dedented: Vec<String> = lines
        .iter()
        .map(|l| {
            if l.trim().is_empty() {
                String::new()
            } else {
                l.chars().skip(min_indent).collect::<String>()
            }
        })
        .collect();
    if fold {
        dedented
            .iter()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        dedented.join("\n")
    }
}

/// `SKILL.md` 首段 YAML frontmatter 中的 `description:`（与 Claude Code 技能约定一致）。
/// 支持：单行标量、引号包裹、`|` / `|-` / `>` / `>-` 块标量、以及 `description:` 后仅缩进续行（隐式块）。
fn parse_skill_md_frontmatter_description(text: &str) -> Option<String> {
    let normalized = text.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return None;
    }
    let mut end_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            end_idx = Some(i);
            break;
        }
    }
    let e = end_idx?;
    let fm: &[&str] = &lines[1..e];

    for (idx, line) in fm.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((k, rest)) = t.split_once(':') else {
            continue;
        };
        if k.trim() != "description" {
            continue;
        }

        let mut first = rest;
        if let Some(pos) = first.find(" #") {
            first = &first[..pos];
        }
        let first_trim = first.trim();

        if first_trim.starts_with('|') || first_trim.starts_with('>') {
            let fold = first_trim.starts_with('>');
            let mut raw: Vec<String> = Vec::new();
            for ln in fm.iter().skip(idx + 1) {
                if skill_frontmatter_root_key_line(ln) {
                    break;
                }
                raw.push((*ln).to_string());
            }
            let out = skill_description_format_block(&raw, fold);
            let out = out.trim().to_string();
            if !out.is_empty() {
                return Some(out);
            }
            continue;
        }

        if first_trim.is_empty() {
            let mut raw: Vec<String> = Vec::new();
            for ln in fm.iter().skip(idx + 1) {
                if skill_frontmatter_root_key_line(ln) {
                    break;
                }
                if ln.trim().is_empty() {
                    if raw.is_empty() {
                        continue;
                    }
                    raw.push(String::new());
                    continue;
                }
                let indent = ln.chars().take_while(|c| *c == ' ' || *c == '\t').count();
                if indent == 0 && !raw.is_empty() {
                    break;
                }
                raw.push((*ln).to_string());
            }
            let out = skill_description_format_block(&raw, false);
            let out = out.trim().to_string();
            if !out.is_empty() {
                return Some(out);
            }
            continue;
        }

        let mut val = first_trim.to_string();
        if val.len() >= 2
            && ((val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')))
        {
            val = val[1..val.len() - 1].trim().to_string();
        } else if let Some(i) = val.find(" #") {
            val = val[..i].trim_end().to_string();
        }
        if !val.is_empty() {
            return Some(val);
        }
    }
    None
}

fn read_claude_skill_entry(skill_dir: &Path) -> (bool, Option<String>) {
    let md = skill_dir.join("SKILL.md");
    if !md.is_file() {
        return (false, None);
    }
    let Ok(text) = fs::read_to_string(&md) else {
        return (true, None);
    };
    let desc = parse_skill_md_frontmatter_description(&text).or_else(|| skill_preview_from_markdown(&text));
    (true, desc)
}

fn count_skill_files_recursive(dir: &Path) -> usize {
    let mut total = 0usize;
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        let p = entry.path();
        if ft.is_file() {
            total += 1;
        } else if ft.is_dir() {
            total += count_skill_files_recursive(&p);
        }
    }
    total
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeProjectSkill {
    name: String,
    has_skill_md: bool,
    description: Option<String>,
    file_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_cache_rel_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plugin_cache_root: Option<String>,
}

fn list_claude_skills_under_dir(skills_dir: &Path) -> Result<Vec<ClaudeProjectSkill>, String> {
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(skills_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_claude_skill_name(&name).is_err() {
            continue;
        }
        let (has_skill_md, description) = read_claude_skill_entry(&entry.path());
        let file_count = count_skill_files_recursive(&entry.path());
        out.push(ClaudeProjectSkill {
            name,
            has_skill_md,
            description,
            file_count,
            plugin_cache_rel_path: None,
            plugin_cache_root: None,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn list_claude_project_skills(project_path: String) -> Result<Vec<ClaudeProjectSkill>, String> {
    let skills_dir = project_claude_skills_dir(&project_path)?;
    list_claude_skills_under_dir(&skills_dir)
}

/// 用户级 `~/.claude/skills/`（与官方 `skills` CLI `-g` 一致）。
#[tauri::command]
fn list_claude_user_skills() -> Result<Vec<ClaudeProjectSkill>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let skills_dir = home.join(".claude").join("skills");
    list_claude_skills_under_dir(&skills_dir)
}

#[tauri::command]
fn list_claude_plugin_cache_skills() -> Result<Vec<ClaudeProjectSkill>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    let mut out: Vec<ClaudeProjectSkill> = Vec::new();
    for (plugin_rel, root) in discover_plugin_roots_under_claude_cache(&home) {
        let skills_dir = root.join("skills");
        if !skills_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if validate_claude_skill_name(&name).is_err() {
                continue;
            }
            let (has_skill_md, description) = read_claude_skill_entry(&entry.path());
            let file_count = count_skill_files_recursive(&entry.path());
            let root_str = root.to_string_lossy().to_string();
            out.push(ClaudeProjectSkill {
                name,
                has_skill_md,
                description,
                file_count,
                plugin_cache_rel_path: Some(plugin_rel.clone()),
                plugin_cache_root: Some(root_str),
            });
        }
    }
    out.sort_by(|a, b| {
        let ar = a.plugin_cache_rel_path.as_deref().unwrap_or("");
        let br = b.plugin_cache_rel_path.as_deref().unwrap_or("");
        ar.cmp(br).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
fn create_claude_project_skill(project_path: String, skill_name: String) -> Result<(), String> {
    validate_claude_skill_name(&skill_name)?;
    let skill_name = skill_name.trim().to_string();
    let skills_dir = project_claude_skills_dir(&project_path)?;
    let target = skills_dir.join(&skill_name);
    if target.exists() {
        return Err(format!("技能已存在: {}", skill_name));
    }
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    fs::create_dir(&target).map_err(|e| e.to_string())?;
    let body = format!(
        "---\nname: {}\ndescription: 在此填写技能简介\n---\n\n# {}\n\n在此编写技能说明。\n",
        skill_name, skill_name
    );
    fs::write(target.join("SKILL.md"), body).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_claude_project_skill(project_path: String, skill_name: String) -> Result<(), String> {
    validate_claude_skill_name(&skill_name)?;
    let skill_name = skill_name.trim().to_string();
    let skills_dir = project_claude_skills_dir(&project_path)?;
    let target = skills_dir.join(&skill_name);
    if !target.is_dir() {
        return Err(format!("未找到技能: {}", skill_name));
    }
    let skills_canon = fs::canonicalize(&skills_dir).map_err(|e| e.to_string())?;
    let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&skills_canon) {
        return Err("路径校验失败".to_string());
    }
    fs::remove_dir_all(&target_canon).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeProjectSkillFileEntry {
    path: String,
    is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    size_bytes: Option<u64>,
}

fn project_claude_skill_dir(project_path: &str, skill_name: &str) -> Result<PathBuf, String> {
    validate_claude_skill_name(skill_name)?;
    let skill_name = skill_name.trim();
    let skills_dir = project_claude_skills_dir(project_path)?;
    let target = skills_dir.join(skill_name);
    if !target.is_dir() {
        return Err(format!("未找到技能: {}", skill_name));
    }
    let skills_canon = fs::canonicalize(&skills_dir).map_err(|e| e.to_string())?;
    let target_canon = fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !target_canon.starts_with(&skills_canon) {
        return Err("路径校验失败".to_string());
    }
    Ok(target_canon)
}

fn parse_skill_relative_path(rel: &str) -> Result<Vec<String>, String> {
    let s = rel.trim().replace('\\', "/");
    if s.is_empty() {
        return Err("路径不能为空".to_string());
    }
    if s.len() > 512 {
        return Err("路径过长".to_string());
    }
    let parts: Vec<&str> = s.split('/').filter(|x| !x.is_empty()).collect();
    if parts.is_empty() {
        return Err("路径不能为空".to_string());
    }
    for p in &parts {
        if *p == "." || *p == ".." {
            return Err("路径中含非法段".to_string());
        }
    }
    Ok(parts.into_iter().map(|x| x.to_string()).collect())
}

fn skill_join_parts(skill_root: &Path, parts: &[String]) -> PathBuf {
    let mut out = skill_root.to_path_buf();
    for seg in parts {
        out.push(seg);
    }
    out
}

#[tauri::command]
fn list_claude_project_skill_files(
    project_path: String,
    skill_name: String,
) -> Result<Vec<ClaudeProjectSkillFileEntry>, String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let mut out = Vec::new();

    fn walk(root: &Path, dir: &Path, out: &mut Vec<ClaudeProjectSkillFileEntry>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
            let rel = path
                .strip_prefix(root)
                .map_err(|_| "路径前缀异常".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if meta.is_dir() {
                out.push(ClaudeProjectSkillFileEntry {
                    path: rel,
                    is_dir: true,
                    size_bytes: None,
                });
                walk(root, &path, out)?;
            } else if meta.is_file() {
                out.push(ClaudeProjectSkillFileEntry {
                    path: rel,
                    is_dir: false,
                    size_bytes: Some(meta.len()),
                });
            }
        }
        Ok(())
    }

    walk(&skill_root, &skill_root, &mut out)?;
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn get_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
) -> Result<String, String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let path = skill_join_parts(&skill_root, &parts);
    if !path.is_file() {
        return Err("不是文件或文件不存在".to_string());
    }
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with(&skill_root) {
        return Err("路径越界".to_string());
    }
    fs::read_to_string(&canon).map_err(|_| "文件不是 UTF-8 文本或无法读取".to_string())
}

#[tauri::command]
fn save_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let path = skill_join_parts(&skill_root, &parts);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())?;
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with(&skill_root) {
        return Err("路径越界".to_string());
    }
    Ok(())
}

#[tauri::command]
fn delete_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
) -> Result<(), String> {
    let skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let path = skill_join_parts(&skill_root, &parts);
    if !path.exists() {
        return Err("路径不存在".to_string());
    }
    let canon = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canon.starts_with(&skill_root) {
        return Err("路径越界".to_string());
    }
    let meta = fs::metadata(&canon).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(&canon).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&canon).map_err(|e| e.to_string())?;
    }
    Ok(())
}


fn run_formatter_command(bin: &str, args: &[&str], input: &str) -> Result<String, String> {
    let mut child = Command::new(bin)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|_| format!("未找到格式化工具：{}", bin))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("写入格式化器 stdin 失败: {}", e))?;
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("等待格式化器输出失败: {}", e))?;

    if out.status.success() {
        String::from_utf8(out.stdout).map_err(|_| "格式化输出不是 UTF-8 文本".to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.is_empty() {
            Err(format!("格式化失败：{}", bin))
        } else {
            Err(err)
        }
    }
}

#[tauri::command]
fn format_claude_project_skill_file(
    project_path: String,
    skill_name: String,
    relative_path: String,
    content: String,
) -> Result<String, String> {
    let _skill_root = project_claude_skill_dir(&project_path, &skill_name)?;
    let parts = parse_skill_relative_path(&relative_path)?;
    let rel = parts.join("/");
    let ext = Path::new(&rel)
        .extension()
        .and_then(|x| x.to_str())
        .map(|x| x.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "md" | "markdown" | "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "json" | "yml" | "yaml" => {
            run_formatter_command("prettier", &["--stdin-filepath", &rel], &content)
        }
        "py" => run_formatter_command("ruff", &["format", "-"], &content),
        "sh" | "bash" | "zsh" => run_formatter_command("shfmt", &[], &content),
        _ => Err("该文件类型暂不支持格式化（支持 md/js/py/sh）".to_string()),
    }
}

// ── Claude Code subagents (.claude/agents/*.md, ~/.claude/agents/*.md) ──

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeSubagentItem {
    id: String,
    scope: String,
    source_path: String,
    name: String,
    description: String,
    model: Option<String>,
    tools: Vec<String>,
    disallowed_tools: Vec<String>,
    permission_mode: Option<String>,
    memory: Option<String>,
    is_collaboration_mode: bool,
    is_active: bool,
    overridden_by_id: Option<String>,
    updated_at_ms: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeSubagentDetail {
    id: String,
    scope: String,
    source_path: String,
    name: String,
    description: String,
    model: Option<String>,
    tools: Vec<String>,
    disallowed_tools: Vec<String>,
    permission_mode: Option<String>,
    memory: Option<String>,
    frontmatter: String,
    prompt: String,
    raw_content: String,
}

fn project_claude_agents_dir(project_path: &str) -> Result<PathBuf, String> {
    let p = project_path.trim();
    if p.is_empty() {
        return Err("项目路径无效".to_string());
    }
    let root = PathBuf::from(p);
    if !root.is_dir() {
        return Err("项目目录不存在".to_string());
    }
    let canon = fs::canonicalize(&root).map_err(|e| format!("无法解析项目路径: {}", e))?;
    Ok(canon.join(".claude").join("agents"))
}

fn user_claude_agents_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home directory".to_string())?;
    Ok(home.join(".claude").join("agents"))
}

fn resolve_omc_plugin_root() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let base = home.join(".claude").join("plugins").join("cache").join("omc").join("oh-my-claudecode");
    if !base.is_dir() {
        return None;
    }
    let preferred = base.join("4.13.2");
    if preferred.is_dir() {
        return Some(preferred);
    }
    let mut versions: Vec<PathBuf> = fs::read_dir(&base)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    versions.sort();
    versions.pop()
}

fn canonicalize_existing_project_dir(project_path: Option<&str>) -> Option<PathBuf> {
    let raw = project_path.map(str::trim).filter(|s| !s.is_empty())?;
    let root = PathBuf::from(raw);
    if !root.is_dir() {
        return None;
    }
    fs::canonicalize(root).ok()
}

fn parse_skill_frontmatter_name_desc(raw: &str) -> Option<(String, String)> {
    let normalized = raw.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return None;
    }
    let mut end_idx: Option<usize> = None;
    for (i, line) in lines.iter().enumerate().skip(1) {
        if line.trim() == "---" {
            end_idx = Some(i);
            break;
        }
    }
    let e = end_idx?;
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    for line in lines[1..e].iter() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((k, v)) = t.split_once(':') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim().trim_matches('"').trim_matches('\'').to_string();
        match key {
            "name" if !val.is_empty() => name = Some(val),
            "description" if !val.is_empty() => description = Some(val),
            _ => {}
        }
    }
    let n = name?;
    let d = description.unwrap_or_else(|| "OMC 协作模式".to_string());
    Some((n, d))
}

fn list_omc_collaboration_mode_items(omc_root: &Path) -> Vec<ClaudeSubagentItem> {
    let mode_names: HashSet<&str> = ["team", "omc-teams", "ultrawork", "ultraqa", "autopilot", "ralph", "ralplan"]
        .into_iter()
        .collect();
    let skills_dir = omc_root.join("skills");
    if !skills_dir.is_dir() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(skills_dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let skill_dir = entry.path();
        if !skill_dir.is_dir() {
            continue;
        }
        let Some(skill_name) = skill_dir.file_name().and_then(|x| x.to_str()) else {
            continue;
        };
        if !mode_names.contains(skill_name) {
            continue;
        }
        let skill_md = skill_dir.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&skill_md) else {
            continue;
        };
        let Some((name, description)) = parse_skill_frontmatter_name_desc(&raw) else {
            continue;
        };
        let updated_at_ms = fs::metadata(&skill_md)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        out.push(ClaudeSubagentItem {
            id: format!("plugin-mode:{}", name),
            scope: "plugin".to_string(),
            source_path: skill_md.to_string_lossy().to_string(),
            name,
            description,
            model: None,
            tools: Vec::new(),
            disallowed_tools: Vec::new(),
            permission_mode: None,
            memory: None,
            is_collaboration_mode: true,
            is_active: true,
            overridden_by_id: None,
            updated_at_ms,
        });
    }
    out
}

fn list_subagent_files_from_dir(scope: &str, dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(ext) = path.extension().and_then(|x| x.to_str()) else {
            continue;
        };
        if ext.to_lowercase() != "md" {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|x| x.to_str()) else {
            continue;
        };
        if validate_claude_subagent_name(stem).is_err() {
            continue;
        }
        out.push((scope.to_string(), path));
    }
    out
}

fn resolve_subagent_file(
    scope: &str,
    name: &str,
    project_path: Option<&str>,
) -> Result<PathBuf, String> {
    validate_claude_subagent_name(name)?;
    let base = match scope {
        "project" => {
            let p = project_path
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "project scope 需要 projectPath".to_string())?;
            project_claude_agents_dir(&p)?
        }
        "user" => user_claude_agents_dir()?,
        _ => return Err("scope 仅支持 project / user".to_string()),
    };
    Ok(base.join(format!("{}.md", name)))
}

/// 同名校验：project / user 仍按名称合并覆盖关系；`plugin` 按插件包根路径区分，避免多插件同名冲突。
fn subagent_merge_group_key(scope: &str, agent_md_path: &Path, agent_name: &str) -> String {
    if scope == "plugin" {
        if let Some(agents) = agent_md_path.parent() {
            if agents.file_name().and_then(|n| n.to_str()) == Some("agents") {
                if let Some(plugin_root) = agents.parent() {
                    return format!(
                        "plugin|{}|{}",
                        plugin_root.to_string_lossy().replace('\\', "/"),
                        agent_name
                    );
                }
            }
        }
        return format!("plugin|orphan|{}", agent_name);
    }
    agent_name.to_string()
}

#[tauri::command]
fn list_claude_subagents(project_path: Option<String>) -> Result<Vec<ClaudeSubagentItem>, String> {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    candidates.extend(list_subagent_files_from_dir("user", &user_claude_agents_dir()?));
    if let Some(omc_root) = resolve_omc_plugin_root() {
        candidates.extend(list_subagent_files_from_dir("plugin", &omc_root.join("agents")));
    }
    if let Some(home) = dirs::home_dir() {
        let omc_canon = resolve_omc_plugin_root().and_then(|p| fs::canonicalize(p).ok());
        for (_rel, root) in discover_plugin_roots_under_claude_cache(&home) {
            if let Some(ref oc) = omc_canon {
                if let Ok(rc) = fs::canonicalize(&root) {
                    if rc == *oc {
                        continue;
                    }
                }
            }
            let agents_dir = root.join("agents");
            if agents_dir.is_dir() {
                candidates.extend(list_subagent_files_from_dir("plugin", &agents_dir));
            }
        }
    }
    if let Some(project_root) = canonicalize_existing_project_dir(project_path.as_deref()) {
        let project_agents_dir = project_root.join(".claude").join("agents");
        candidates.extend(list_subagent_files_from_dir("project", &project_agents_dir));
    }

    let mut seen_agent_paths: HashSet<String> = HashSet::new();
    candidates.retain(|(_, p)| {
        let k = fs::canonicalize(p)
            .unwrap_or_else(|_| p.clone())
            .to_string_lossy()
            .to_string();
        seen_agent_paths.insert(k)
    });

    let mut by_merge_key: HashMap<String, Vec<ClaudeSubagentItem>> = HashMap::new();
    for (scope, path) in candidates {
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = parse_subagent_markdown(&raw) else {
            continue;
        };
        let meta = fs::metadata(&path).ok();
        let updated_at_ms = meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64);
        let merge_key = subagent_merge_group_key(&scope, &path, &parsed.name);
        let id = if scope == "plugin" {
            merge_key.clone()
        } else {
            format!("{}:{}", scope, parsed.name)
        };
        let item = ClaudeSubagentItem {
            id,
            scope: scope.clone(),
            source_path: path.to_string_lossy().to_string(),
            name: parsed.name.clone(),
            description: parsed.description,
            model: parsed.model,
            tools: parsed.tools,
            disallowed_tools: parsed.disallowed_tools,
            permission_mode: parsed.permission_mode,
            memory: parsed.memory,
            is_collaboration_mode: false,
            is_active: false,
            overridden_by_id: None,
            updated_at_ms,
        };
        by_merge_key.entry(merge_key).or_default().push(item);
    }

    let mut out: Vec<ClaudeSubagentItem> = Vec::new();
    for (_, mut arr) in by_merge_key {
        arr.sort_by_key(|x| match x.scope.as_str() {
            "project" => 0i32,
            "user" => 1i32,
            "plugin" => 2i32,
            _ => 99i32,
        });
        if let Some(first_id) = arr.first().map(|x| x.id.clone()) {
            for (idx, it) in arr.iter_mut().enumerate() {
                if idx == 0 {
                    it.is_active = true;
                    it.overridden_by_id = None;
                } else {
                    it.is_active = false;
                    it.overridden_by_id = Some(first_id.clone());
                }
            }
        }
        out.extend(arr);
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.scope.cmp(&b.scope))
    });
    if let Some(omc_root) = resolve_omc_plugin_root() {
        out.extend(list_omc_collaboration_mode_items(&omc_root));
        out.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.scope.cmp(&b.scope))
        });
    }
    Ok(out)
}

#[tauri::command]
fn list_claude_available_agents(project_path: Option<String>) -> Result<Vec<String>, String> {
    let mut cmd = Command::new("claude");
    cmd.arg("agents");
    if let Some(project_root) = canonicalize_existing_project_dir(project_path.as_deref()) {
        cmd.current_dir(project_root);
    }
    let out = cmd.output().map_err(|e| format!("执行 claude agents 失败: {}", e))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(if stderr.trim().is_empty() {
            "claude agents 执行失败".to_string()
        } else {
            format!("claude agents 执行失败: {}", stderr.trim())
        });
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut names: Vec<String> = Vec::new();
    for raw in stdout.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.ends_with("active agents")
            || line.ends_with("agents:")
            || line.ends_with("agents")
            || line == "Plugin agents:"
            || line == "Built-in agents:"
        {
            continue;
        }
        let normalized = line.trim_start_matches('-').trim();
        if normalized.is_empty() {
            continue;
        }
        let name = normalized
            .split_once(" · ")
            .map(|(lhs, _)| lhs.trim())
            .unwrap_or(normalized);
        if !name.is_empty() {
            names.push(name.to_string());
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

#[tauri::command]
fn create_claude_subagent(
    scope: String,
    name: String,
    description: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    validate_claude_subagent_name(&name)?;
    let desc = description.trim().to_string();
    if desc.is_empty() {
        return Err("description 不能为空".to_string());
    }
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if path.exists() {
        return Err(format!("subagent 已存在: {}", name));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = format!(
        "---\nname: {}\ndescription: {}\nmodel: inherit\n---\n\nYou are the {} subagent.\n",
        name, desc, name
    );
    fs::write(path, body).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_claude_subagent_detail(
    scope: String,
    name: String,
    project_path: Option<String>,
) -> Result<ClaudeSubagentDetail, String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if !path.is_file() {
        return Err("subagent 文件不存在".to_string());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = parse_subagent_markdown(&raw)?;
    Ok(ClaudeSubagentDetail {
        id: format!("{}:{}", scope, parsed.name),
        scope,
        source_path: path.to_string_lossy().to_string(),
        name: parsed.name,
        description: parsed.description,
        model: parsed.model,
        tools: parsed.tools,
        disallowed_tools: parsed.disallowed_tools,
        permission_mode: parsed.permission_mode,
        memory: parsed.memory,
        frontmatter: parsed.frontmatter,
        prompt: parsed.prompt,
        raw_content: raw,
    })
}

#[tauri::command]
fn save_claude_subagent(
    scope: String,
    name: String,
    raw_content: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    validate_claude_subagent_name(&name)?;
    let parsed = parse_subagent_markdown(&raw_content)?;
    if parsed.name != name {
        return Err("frontmatter.name 必须与文件名一致".to_string());
    }
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, raw_content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_claude_subagent(scope: String, name: String, project_path: Option<String>) -> Result<(), String> {
    let scope = scope.trim().to_string();
    let name = name.trim().to_string();
    let path = resolve_subagent_file(&scope, &name, project_path.as_deref())?;
    if !path.is_file() {
        return Err("subagent 文件不存在".to_string());
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}

fn trim_model_cli_arg(model: &str) -> Option<&str> {
    let m = model.trim();
    if m.is_empty() {
        None
    } else {
        Some(m)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrdSplitClaudeRunResult {
    run_id: String,
    status: String,
    exit_code: i32,
    duration_ms: u64,
    stdout_path: String,
    stderr_path: String,
    raw_result_path: String,
    notes_path: Option<String>,
}

fn parse_run_id_from_dir(run_dir: &Path) -> String {
    run_dir
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown-run".to_string())
}

fn normalize_split_run_dir(run_dir: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(run_dir);
    if !p.is_absolute() {
        return Err("run_dir 必须是绝对路径".to_string());
    }
    fs::create_dir_all(&p).map_err(|e| format!("创建 run_dir 失败: {e}"))?;
    let canon = p
        .canonicalize()
        .map_err(|e| format!("解析 run_dir 失败: {e}"))?;
    let base = crate::wise_dir()
        .map_err(|e| format!("解析 ~/.wise 失败: {e}"))?
        .join("prd-runs");
    fs::create_dir_all(&base).map_err(|e| format!("创建 ~/.wise/prd-runs 失败: {e}"))?;
    let base_canon = base
        .canonicalize()
        .map_err(|e| format!("解析 ~/.wise/prd-runs 失败: {e}"))?;
    if !canon.starts_with(&base_canon) {
        return Err("run_dir 仅允许位于 ~/.wise/prd-runs 下".to_string());
    }
    Ok(canon)
}

/// 兼容模型把 JSON 包在 ```json 代码围栏里的场景，提取可解析对象正文。
fn extract_split_json_candidate(stdout_text: &str) -> Option<String> {
    let trimmed = stdout_text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') {
        return Some(trimmed.to_string());
    }
    let mut lines = trimmed.lines();
    let first = lines.next()?.trim_start();
    if !first.starts_with("```") {
        return None;
    }
    let mut body = String::new();
    for line in lines {
        if line.trim_start().starts_with("```") {
            break;
        }
        if !body.is_empty() {
            body.push('\n');
        }
        body.push_str(line);
    }
    let candidate = body.trim();
    if candidate.starts_with('{') {
        return Some(candidate.to_string());
    }
    None
}

#[tauri::command]
async fn run_prd_split_claude(
    project_path: String,
    run_dir: String,
    prompt: String,
    model: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<PrdSplitClaudeRunResult, String> {
    let run_dir = normalize_split_run_dir(&run_dir)?;
    let run_id = parse_run_id_from_dir(&run_dir);
    let timeout_ms = timeout_ms.unwrap_or(120_000).max(1_000);

    let stdout_path = run_dir.join("claude.stdout.log");
    let stderr_path = run_dir.join("claude.stderr.log");
    let raw_result_path = run_dir.join("split-result.raw.json");
    let notes_path = run_dir.join("split-result.notes.md");

    let claude_path = find_claude_binary()?;
    let mut cmd = tokio::process::Command::new(&claude_path);
    cmd.current_dir(project_path);
    cmd.arg("-p").arg(prompt);
    cmd.arg("--permission-mode").arg("bypassPermissions");
    if let Some(m) = model.as_deref().and_then(trim_model_cli_arg) {
        cmd.arg("--model").arg(m);
    }
    cmd.env(
        "HOME",
        dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    );
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));
    // 与 `create_claude_command` 的 `--bare` 分支一致：不消费 stdin 时必须显式 null，否则继承 GUI 进程的管道会触发
    // 「no stdin data received in 3s」类 stderr 告警。
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let started = std::time::Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 Claude 失败: {e}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 Claude stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 Claude stderr".to_string())?;

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf).await;
        buf
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        buf
    });

    let wait_result = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await;
    let timed_out = wait_result.is_err();
    if timed_out {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    let stdout_bytes = stdout_task
        .await
        .map_err(|e| format!("读取 stdout 失败: {e}"))?;
    let stderr_bytes = stderr_task
        .await
        .map_err(|e| format!("读取 stderr 失败: {e}"))?;
    let stdout_text = String::from_utf8_lossy(&stdout_bytes).to_string();
    let stderr_text = String::from_utf8_lossy(&stderr_bytes).to_string();

    fs::write(&stdout_path, &stdout_text).map_err(|e| format!("写入 stdout 日志失败: {e}"))?;
    fs::write(&stderr_path, &stderr_text).map_err(|e| format!("写入 stderr 日志失败: {e}"))?;

    let json_candidate = extract_split_json_candidate(&stdout_text);
    let raw_for_persist = json_candidate.as_deref().unwrap_or(stdout_text.as_str());
    fs::write(&raw_result_path, raw_for_persist).map_err(|e| format!("写入 raw 结果失败: {e}"))?;

    let elapsed = started.elapsed().as_millis() as u64;
    let (status, exit_code, notes): (&str, i32, String) = if timed_out {
        (
            "failed",
            10,
            format!(
                "# split run failed\n\n- reason: timeout\n- timeoutMs: {timeout_ms}\n- runId: {run_id}\n"
            ),
        )
    } else {
        let cli_status_ok = wait_result
            .ok()
            .and_then(|r| r.ok())
            .map(|s| s.success())
            .unwrap_or(false);
        if !cli_status_ok {
            (
                "failed",
                10,
                "# split run failed\n\n- reason: claude process exited non-zero\n".to_string(),
            )
        } else if json_candidate.is_none() {
            (
                "failed",
                10,
                "# split run failed\n\n- reason: stdout does not contain a JSON object payload\n".to_string(),
            )
        } else {
            let first = json_candidate.as_deref().unwrap_or_default();
            match serde_json::from_str::<serde_json::Value>(first) {
                Ok(v) if v.is_object() => (
                    "succeeded",
                    0,
                    "# split run succeeded\n\n- reason: valid JSON object output\n".to_string(),
                ),
                Ok(_) => (
                    "failed",
                    20,
                    "# split run failed\n\n- reason: output is JSON but not an object\n".to_string(),
                ),
                Err(_) => (
                    "failed",
                    10,
                    "# split run failed\n\n- reason: output is not valid JSON\n".to_string(),
                ),
            }
        }
    };

    fs::write(&notes_path, notes).map_err(|e| format!("写入 notes 失败: {e}"))?;

    Ok(PrdSplitClaudeRunResult {
        run_id,
        status: status.to_string(),
        exit_code,
        duration_ms: elapsed,
        stdout_path: stdout_path.to_string_lossy().to_string(),
        stderr_path: stderr_path.to_string_lossy().to_string(),
        raw_result_path: raw_result_path.to_string_lossy().to_string(),
        notes_path: Some(notes_path.to_string_lossy().to_string()),
    })
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

    // Inherit environment
    cmd.env("HOME", dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default());

    // Subprocess PATH：与查找逻辑一致，避免 GUI 下子进程找不到 node / 其它 CLI
    cmd.env("PATH", merge_path_env(&claude_path_search_prefixes()));

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

/// Claude `-p` 与管道 stdin 并存时，CLI 可能在 stderr 打出「数秒内无 stdin」提示后自行继续；
/// 该行不应经 `claude-error*` 事件进入前端系统消息。
fn claude_stderr_line_suppressed_for_ui_events(line: &str) -> bool {
    line.to_lowercase()
        .contains("no stdin data received in 3s")
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
    let Some(rid) = req.get("request_id").and_then(|s| s.as_str()) else {
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
async fn kill_active_claude_run_for_session(process_state: &ClaudeProcessState, claude_session_id: &str) {
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
    let acquired_scope = try_acquire_claude_spawn_slot(
        &slots_mtx,
        concurrency_scope_key,
        concurrency_limit,
    )
    .await?;

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

    if let Some(sin) = stdin {
        // 不在此处向 stdin 写入占位数据：`--permission-prompt-tool stdio` 对 stdin 解析较严格，
        // 抢先写入（如 `\n`）曾导致控制流异常、会话「调不通」；无数据时 CLI 可能 stderr 提示再等约 3s，属可接受噪声。
        pending_stdin_by_spawn_mtx
            .lock()
            .await
            .insert(spawn_id, sin);
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

    // Spawn async task for stdout processing
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut real_session_id: Option<String> = None;
        let mut structured_verdict: Option<serde_json::Value> = None;
        // 带 `invocation_key` 的 oneshot 运行：只走 invocation 通道，避免全局 `claude-output` 把主会话 UI 每条流式行都打爆。
        let suppress_shared_stdout = invocation_key_clone.is_some()
            && connection_mode_stdout == ClaudeConnectionMode::Oneshot;

        while let Ok(Some(line)) = lines.next_line().await {
            maybe_ack_control_initialize(&line, &pending_stdin_by_spawn_clone, spawn_id).await;
            // Try to parse as JSON to extract session_id
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                if real_session_id.is_none()
                    && json.get("type").and_then(|v| v.as_str()) == Some("system")
                    && json.get("subtype").and_then(|v| v.as_str()) == Some("init")
                {
                    if let Some(sid) = json
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .or_else(|| json.get("sessionId").and_then(|v| v.as_str()))
                    {
                        real_session_id = Some(sid.to_string());
                        if let Some(stdin) = pending_stdin_by_spawn_clone
                            .lock()
                            .await
                            .remove(&spawn_id)
                        {
                            stdin_map_mtx_clone
                                .lock()
                                .await
                                .insert(sid.to_string(), stdin);
                        }
                        if connection_mode_stdout == ClaudeConnectionMode::Persistent {
                            *current_session_id_mtx_clone.lock().await = Some(sid.to_string());
                        }
                        if connection_mode_stdout == ClaudeConnectionMode::Oneshot {
                            let mut ac = active_child_by_session_clone.lock().await;
                            ac.insert(sid.to_string(), wait_child_mutex_clone.clone());
                        }
                        registry_clone.register(
                            sid.to_string(),
                            project_path_clone.clone(),
                            model_clone.clone(),
                        );
                    }
                }
                if let Some(candidate) = extract_structured_verdict_candidate(&json) {
                    structured_verdict = Some(candidate);
                }
            }

            let sid = real_session_id.as_deref().unwrap_or("unknown");

            // Emit output events
            if !suppress_shared_stdout {
                let _ = app_clone.emit(
                    &format!("claude-output:{}", sid),
                    &line,
                );
                // Also emit without suffix for backward compatibility
                let _ = app_clone.emit("claude-output", &line);
            }
            if let Some(inv) = invocation_key_clone.as_deref() {
                let _ = app_clone.emit(&format!("claude-output:invocation:{}", inv), &line);
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

        let success = exit_status.map(|s| s.success()).unwrap_or(false);
        let sid = real_session_id.as_deref().unwrap_or("unknown");
        let complete_payload = ClaudeCompletePayload {
            session_id: sid.to_string(),
            success,
            structured_verdict,
        };

        // Mark session as completed
        registry_clone.mark_completed(sid, success);

        // Emit completion event（invocation 独占 oneshot 时不发全局，避免误触发主会话 finalize）
        if !suppress_shared_stdout {
            let _ = app_clone.emit(
                &format!("claude-complete:{}", sid),
                &complete_payload,
            );
            let _ = app_clone.emit("claude-complete", &complete_payload);
        }
        if let Some(inv) = invocation_key_clone.as_deref() {
            let _ = app_clone.emit(
                &format!("claude-complete:invocation:{}", inv),
                &complete_payload,
            );
        }

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
        if connection_mode_stdout == ClaudeConnectionMode::Oneshot
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
            && connection_mode_stderr == ClaudeConnectionMode::Oneshot;

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

/// Launches macOS `screencapture -i` for interactive area selection.
/// Returns base64-encoded image data and original filename.
///
/// Note: We intentionally do **not** fall back to `screencapture -w`. On recent macOS,
/// `-w` often fails with stderr like "could not create image from window" (permissions /
/// compositor), and `-i` failing (e.g. user pressed Esc) would incorrectly trigger that path.
#[tauri::command]
fn capture_screenshot() -> Result<ScreenshotResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("截屏仅支持 macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        let tmp_dir = std::env::temp_dir();
        // UUID：避免同一秒内并发/双监听两次截屏时争用同一临时文件名
        let filename = format!("screenshot_{}.png", Uuid::new_v4());
        let tmp_path = tmp_dir.join(&filename);
        let tmp_str = tmp_path.to_str().ok_or("invalid temp path")?;

        let out = Command::new("screencapture")
            .args(["-i", "-x", tmp_str])
            .output()
            .map_err(|e| format!("无法启动 screencapture: {e}"))?;

        if !out.status.success() {
            let _ = fs::remove_file(&tmp_path);
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let sys = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                String::new()
            };
            let sys_lower = sys.to_lowercase();
            // `screencapture -i` 框选失败时常见：未授权、跨屏选区、受保护内容（CG 无法从 rect 出图）
            let rect_hint = if sys_lower.contains("rect") || sys_lower.contains("could not create image") {
                " 若已授权仍失败：请只在主显示器上框选（勿跨多块屏幕），并避开视频/DRM 等受保护窗口。"
            } else {
                ""
            };
            let base = "截屏未完成（可能已按 Esc 取消），或未授予屏幕录制权限。";
            let perm = "请在「系统设置 → 隐私与安全性 → 屏幕录制」中为 Wise 开启；使用 `bun run tauri:dev` 时请同时为承载该命令的终端（如 Cursor 内置终端对应的 App）开启屏幕录制。";
            if sys.is_empty() {
                return Err(format!("{base}{rect_hint} {perm}"));
            }
            return Err(format!("{base}{rect_hint} {perm} 系统输出：{sys}"));
        }

        if !tmp_path.is_file() {
            return Err(format!(
                "截屏命令已成功结束，但未生成图片文件（{tmp_str}）。请确认「屏幕录制」中已允许 Wise；若使用 tauri:dev，也请允许启动它的终端应用。框选时请避免跨显示器。"
            ));
        }

        let bytes = fs::read(&tmp_path).map_err(|e| format!("读取截屏文件失败: {e}"))?;
        let _ = fs::remove_file(&tmp_path);

        Ok(ScreenshotResult {
            filename,
            mime: "image/png".to_string(),
            base64_data: B64.encode(&bytes),
        })
    }
}

#[derive(Serialize)]
struct ScreenshotResult {
    filename: String,
    mime: String,
    base64_data: String,
}

// ── Composer attachments (images → project files for @ mention) ──

/// Writes base64 file bytes under `{project}/.wise/composer-attachments/`.
/// Returns POSIX-style relative path for use in prompts (e.g. `@.wise/...`).
#[tauri::command]
fn save_composer_image(
    project_path: String,
    filename: String,
    base64_data: String,
) -> Result<String, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("project_path is not a directory".into());
    }
    let safe_name: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    if safe_name.is_empty() {
        return Err("invalid filename".into());
    }
    let id = Uuid::new_v4();
    let rel = format!(".wise/composer-attachments/{id}-{safe_name}");
    let dest = project.join(&rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let cleaned = base64_data.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    let bytes = B64.decode(cleaned).map_err(|e| format!("base64: {e}"))?;
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    let canon_proj = fs::canonicalize(&project).map_err(|e| e.to_string())?;
    let canon_dest = fs::canonicalize(&dest).map_err(|e| e.to_string())?;
    if !canon_dest.starts_with(&canon_proj) {
        let _ = fs::remove_file(&dest);
        return Err("attachment path outside project".into());
    }
    Ok(rel.replace('\\', "/"))
}

fn repository_bucket_key(repository_path: &str) -> String {
    let repo_name = Path::new(repository_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(repository_path);
    let mut key = String::with_capacity(repo_name.len());
    let mut prev_dash = false;
    for ch in repo_name.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if prev_dash {
                continue;
            }
            prev_dash = true;
            key.push('-');
        } else {
            prev_dash = false;
            key.push(mapped);
        }
    }
    let trimmed = key.trim_matches('-').to_string();
    if trimmed.is_empty() {
        return "unknown-repository".to_string();
    }
    trimmed
}

fn sanitize_bucket_segment(input: &str) -> String {
    let mut key = String::with_capacity(input.len());
    let mut prev_dash = false;
    for ch in input.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if prev_dash {
                continue;
            }
            prev_dash = true;
            key.push('-');
        } else {
            prev_dash = false;
            key.push(mapped);
        }
    }
    key.trim_matches('-').to_string()
}

/// Writes base64 image bytes under `~/.wise/prd-images/<repository-key>/`.
/// Returns absolute file path for frontend URL conversion.
#[tauri::command]
fn save_prd_pasted_image(
    repository_path: String,
    repository_name: Option<String>,
    repository_id: Option<i64>,
    project_name: Option<String>,
    project_id: Option<String>,
    filename: String,
    base64_data: String,
) -> Result<String, String> {
    let safe_name: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    if safe_name.is_empty() {
        return Err("invalid filename".into());
    }

    let repository_bucket = repository_name
        .as_deref()
        .map(sanitize_bucket_segment)
        .filter(|s| !s.is_empty())
        .zip(repository_id)
        .map(|(name, id)| format!("{name}-{id}"));
    let project_bucket = project_name
        .as_deref()
        .map(sanitize_bucket_segment)
        .filter(|s| !s.is_empty())
        .zip(project_id.as_deref().map(sanitize_bucket_segment).filter(|s| !s.is_empty()))
        .map(|(name, id)| format!("{name}-{id}"));
    let bucket = repository_bucket
        .or(project_bucket)
        .unwrap_or_else(|| repository_bucket_key(&repository_path));

    let base_dir = wise_dir()?.join("prd-images").join(bucket);
    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let id = Uuid::new_v4();
    let final_name = format!("{id}-{safe_name}");
    let dest = base_dir.join(final_name);

    let cleaned = base64_data.chars().filter(|c| !c.is_whitespace()).collect::<String>();
    let bytes = B64.decode(cleaned).map_err(|e| format!("base64: {e}"))?;
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn materialize_prd_snapshot(
    project_path: String,
    prd_markdown: String,
    split_markdown: Option<String>,
    run_id: Option<String>,
    requirements_index_json: Option<String>,
    snapshot_meta_json: Option<String>,
) -> Result<prd_materialize::MaterializePrdSnapshotResult, String> {
    prd_materialize::materialize_prd_snapshot(
        project_path,
        prd_markdown,
        split_markdown,
        run_id,
        requirements_index_json,
        snapshot_meta_json,
    )
}

#[tauri::command]
fn read_project_relative_file(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    prd_materialize::read_project_relative_file(project_path, relative_path)
}

#[tauri::command]
fn read_project_relative_file_base64(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    prd_materialize::read_project_relative_file_base64(project_path, relative_path)
}

#[tauri::command]
fn read_snapshot_file(file_path: String) -> Result<String, String> {
    prd_materialize::read_snapshot_file(file_path)
}

#[tauri::command]
fn append_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    prd_materialize::append_project_relative_file(project_path, relative_path, payload)
}

#[tauri::command]
fn write_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    prd_materialize::write_project_relative_file(project_path, relative_path, payload)
}

#[tauri::command]
fn append_wise_relative_file(
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    prd_materialize::append_wise_relative_file(relative_path, payload)
}

#[tauri::command]
fn read_wise_relative_file(relative_path: String) -> Result<String, String> {
    prd_materialize::read_wise_relative_file(relative_path)
}

// ── Claude Commands ──

#[tauri::command]
async fn execute_claude_code(
    app: tauri::AppHandle,
    project_path: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    connection_mode: Option<String>,
    concurrency_scope_key: Option<String>,
    concurrency_limit: Option<u32>,
    bare: Option<bool>,
) -> Result<(), String> {
    let registry = app.state::<ClaudeSessionRegistry>();
    let app_clone = app.clone();
    let model_for_cmd = model.as_deref().and_then(trim_model_cli_arg);
    let cmd = create_claude_command(
        &project_path,
        &prompt,
        model_for_cmd,
        &[],
        bare.unwrap_or(false),
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
    )
    .await
}

#[tauri::command]
async fn resume_claude_code(
    app: tauri::AppHandle,
    project_path: String,
    session_id: String,
    prompt: String,
    model: Option<String>,
    invocation_key: Option<String>,
    connection_mode: Option<String>,
    concurrency_scope_key: Option<String>,
    concurrency_limit: Option<u32>,
) -> Result<(), String> {
    let process_state = app.state::<ClaudeProcessState>();
    kill_active_claude_run_for_session(&process_state, &session_id).await;

    let registry = app.state::<ClaudeSessionRegistry>();
    let app_clone = app.clone();
    let model_for_cmd = model.as_deref().and_then(trim_model_cli_arg);
    let cmd = create_claude_command(
        &project_path,
        &prompt,
        model_for_cmd,
        &["-r", &session_id],
        false,
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
    )
    .await
}

#[tauri::command]
async fn cancel_claude_execution(
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
        process_state.claude_stdin_by_session.lock().await.remove(sid);
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
            process_state.claude_stdin_by_session.lock().await.remove(sid);
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
async fn cancel_claude_invocation(
    app: tauri::AppHandle,
    invocation_key: String,
) -> Result<bool, String> {
    let process_state = app.state::<ClaudeProcessState>();
    let inv = invocation_key.trim();
    if inv.is_empty() {
        return Err("invocation_key 不能为空".to_string());
    }
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
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 读取指定 `projectId:repositoryId` 下当前占用的 Claude spawn 槽位数（含批量 OMC 等无 UI 会话的 oneshot）。
#[tauri::command]
async fn get_claude_spawn_slot_count(
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
async fn claude_submit_stdin_line(
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
        return Err(format!("会话 {} 没有可写 stdin（可能已结束）", resolved_sid));
    };
    use tokio::io::AsyncWriteExt;
    sin.write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    sin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    sin.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_running_claude_sessions(app: tauri::AppHandle) -> Vec<ClaudeSessionInfo> {
    let registry = app.state::<ClaudeSessionRegistry>();
    registry.list()
}

#[tauri::command]
fn get_system_resource_snapshot() -> SystemResourceSnapshot {
    let (system_total_bytes, system_used_bytes) = collect_system_memory_bytes();
    let app_memory_bytes = parse_ps_rss_kb_for_pid(std::process::id()).unwrap_or(0);
    let (claude_process_count, claude_memory_bytes) = collect_claude_process_memory_bytes();
    SystemResourceSnapshot {
        system_total_bytes,
        system_used_bytes,
        app_memory_bytes,
        claude_process_count,
        claude_memory_bytes,
    }
}

// ── App Entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
            use keyboard_types::{Code, Modifiers};
            let screenshot_shortcut = Shortcut::new(None, Code::F3);
            app.global_shortcut().on_shortcut(screenshot_shortcut, |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    // Trigger screenshot via frontend event
                    let _ = _app.emit("global-screenshot", ());
                }
            }).map_err(|e| e.to_string())?;

            // ⌥Z / Alt+Z：置顶主窗口并通知前端聚焦会话输入框（macOS 上 Alt 对应 Option）
            let focus_composer_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyZ);
            app.global_shortcut()
                .on_shortcut(focus_composer_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-focus-composer", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            // ⌥S / Alt+S：置顶主窗口并切换小窗口模式（与左栏按钮一致）
            let toggle_compact_layout_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);
            app.global_shortcut()
                .on_shortcut(toggle_compact_layout_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-toggle-compact-layout", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            // ⌥K / Alt+K：置顶主窗口并切换双栏（与中栏按钮一致）
            let toggle_dual_pane_shortcut = Shortcut::new(Some(Modifiers::ALT), Code::KeyK);
            app.global_shortcut()
                .on_shortcut(toggle_dual_pane_shortcut, |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = wise_mascot::wise_main_window_focus(_app.clone());
                        let _ = _app.emit("global-toggle-dual-pane", ());
                    }
                })
                .map_err(|e| e.to_string())?;

            app.manage(wise_mascot::WiseToastMerge::default());
            app.manage(wise_push::WisePushControl::default());
            app.manage(dingtalk_stream_gateway::DingTalkStreamGatewayControl::default());
            let wise_db = wise_db::WiseDb::open().map_err(|e| e.to_string())?;
            wise_mascot::restore_mascot_on_launch(app.handle(), &wise_db)?;
            app.manage(wise_db);

            #[cfg(target_os = "macos")]
            if let Some(w) = app.handle().get_webview_window("mascot") {
                let _ = w.set_always_on_top(true);
            }

            Ok(())
        })
        .manage(Mutex::new(GitWatcherState::new()))
        .manage(Mutex::new(TerminalManager::new()))
        .manage(ClaudeProcessState::default())
        .manage(ClaudeSessionRegistry::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            list_repositories,
            create_repository_from_path,
            update_repository_icon_display,
            remove_repository,
            remove_repository_global,
            list_projects,
            create_project,
            update_project_name,
            update_project_icon_badge,
            delete_project,
            add_repository_to_project,
            reorder_project_repositories,
            remove_repository_from_project,
            get_active_project_id,
            set_active_project_id,
            list_employees,
            create_employee,
            update_employee,
            delete_employee,
            move_employee_display_order,
            list_employee_task_counts,
            list_workflow_templates,
            save_workflow_template,
            delete_workflow_template,
            get_workflow_graph,
            save_workflow_graph,
            validate_workflow_graph,
            create_workflow_task,
            list_workflow_tasks,
            list_task_events,
            get_acceptance_verdict_source_stats,
            append_task_event,
            list_task_pending_employees,
            decide_workflow_task_stage,
            end_workflow_task,
            get_task_template,
            set_task_template,
            get_repo_task_split_prompt_section,
            set_repo_task_split_prompt_section,
            clear_repo_task_split_prompt_section,
            get_platform_split_prompt_layers,
            get_project_split_prompt_layers,
            set_project_split_prompt_layers,
            clear_project_split_prompt_layers,
            get_repository_split_prompt_layers,
            set_repository_split_prompt_layers,
            clear_repository_split_prompt_layers,
            get_prd_task_draft,
            set_prd_task_draft,
            clear_prd_task_draft,
            get_app_setting,
            set_app_setting,
            delete_app_setting,
            get_prd_task_split_result,
            get_prd_executable_tasks_result,
            set_prd_task_split_result,
            clear_prd_task_split_result,
            get_workflow_run,
            set_workflow_run,
            list_workflow_runs,
            append_workflow_event,
            migrate_workflow_session_tab_references,
            list_workflow_events,
            fetch_prd_from_url,
            open_in_finder,
            open_claude_user_agents_dir,
            get_claude_user_agents_dir,
            open_workspace_in,
            git_status,
            git_stage,
            git_unstage,
            git_unstage_all,
            git_commit,
            git_push,
            git_pull,
            git_fetch,
            git_show_revision,
            git_discard,
            git_discard_all,
            git_log,
            git_init,
            git_remote_url,
            git_list_branches,
            git_checkout_branch,
            git_create_branch,
            git_checkout_detached,
            git_worktree_list,
            git_worktree_remove,
            git_worktree_add_omc_batch,
            start_git_watcher,
            stop_git_watcher,
            run_shell_command,
            search_repository_files,
            list_repository_explorer_entries,
            create_repository_file,
            create_repository_directory,
            delete_repository_entry,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
            execute_claude_code,
            resume_claude_code,
            cancel_claude_execution,
            cancel_claude_invocation,
            get_claude_spawn_slot_count,
            claude_submit_stdin_line,
            list_running_claude_sessions,
            get_system_resource_snapshot,
            claude_code_usage::get_claude_code_usage_snapshot,
            get_claude_config_model,
            get_claude_model_picker_options,
            get_claude_mcp_status,
            get_claude_mcp_runtime_health,
            remove_claude_mcp_server,
            add_claude_mcp_server,
            cua_driver::get_cua_driver_status,
            cua_driver::install_cua_driver,
            cua_driver::macos_open_privacy_pane,
            skills_sh::skills_sh_search,
            skills_sh::skills_cli_add_from_registry,
            skills_sh::skills_cli_remove_from_registry,
            set_claude_mcp_server_enabled,
            get_claude_hooks_status,
            upsert_claude_hook,
            remove_claude_hook,
            set_claude_disable_all_hooks,
            list_claude_subagents,
            list_claude_available_agents,
            create_claude_subagent,
            get_claude_subagent_detail,
            save_claude_subagent,
            delete_claude_subagent,
            list_claude_project_skills,
            list_claude_user_skills,
            list_claude_plugin_cache_skills,
            create_claude_project_skill,
            delete_claude_project_skill,
            list_claude_project_skill_files,
            get_claude_project_skill_file,
            save_claude_project_skill_file,
            delete_claude_project_skill_file,
            format_claude_project_skill_file,
            list_claude_disk_sessions,
            load_claude_session_jsonl,
            save_composer_image,
            save_prd_pasted_image,
            materialize_prd_snapshot,
            read_project_relative_file,
            read_project_relative_file_base64,
            read_snapshot_file,
            append_project_relative_file,
            write_project_relative_file,
            append_wise_relative_file,
            read_wise_relative_file,
            run_prd_split_claude,
            capture_screenshot,
            load_session_tabs,
            save_session_tabs,
            wise_mascot::wise_mascot_show,
            wise_mascot::wise_mascot_hide,
            wise_mascot::wise_mascot_save_position,
            wise_mascot::wise_notification_unread_total,
            wise_mascot::wise_notification_ingest,
            wise_mascot::wise_notification_mark_all_read,
            wise_mascot::wise_notification_mark_read,
            wise_mascot::wise_notification_mark_omc_direct_batch_read_for_batch,
            wise_mascot::wise_notification_list_recent,
            wise_mascot::wise_main_window_focus,
            wise_push::wise_push_start,
            wise_push::wise_push_stop,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_ping,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_markdown,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_image_by_url,
            dingtalk_enterprise_bot::dingtalk_enterprise_bot_oto_send_image_file,
            dingtalk_stream_gateway::dingtalk_stream_gateway_start,
            dingtalk_stream_gateway::dingtalk_stream_gateway_stop,
            dingtalk_stream_gateway::dingtalk_stream_gateway_is_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS：点击程序坞图标时 NSApplication 触发 Reopen；聚焦主窗口（含从最小化恢复）。
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                let _ = wise_mascot::wise_main_window_focus(app_handle.clone());
            }
        });
}
