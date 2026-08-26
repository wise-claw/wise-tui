//! Stagehand / browse CLI 浏览器自动化：持久 sidecar + 一次性 browse 命令。

use crate::claude_commands;
use crate::wise_paths::wise_dir;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};
use tokio::time::timeout;

const RPC_TIMEOUT: Duration = Duration::from_secs(180);
const BROWSE_TIMEOUT: Duration = Duration::from_secs(120);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(180);

const BROWSE_ROOT_COMMANDS: &[&str] = &[
    "open",
    "reload",
    "back",
    "forward",
    "snapshot",
    "click",
    "fill",
    "select",
    "type",
    "press",
    "key",
    "upload",
    "highlight",
    "mouse",
    "get",
    "is",
    "eval",
    "viewport",
    "cursor",
    "screenshot",
    "wait",
    "tab",
    "network",
    "status",
    "stop",
    "doctor",
    "cdp",
    "env",
    "skills",
    "cloud",
    "functions",
    "templates",
    "start",
    "help",
    "version",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagehandBrowseProbe {
    pub browse_available: bool,
    pub browse_binary: Option<String>,
    pub browse_version: Option<String>,
    pub sidecar_available: bool,
    pub sidecar_dir: Option<String>,
    pub sidecar_ready: bool,
    pub runtime: Option<String>,
    pub has_browserbase_key: bool,
    pub cli_available: bool,
    pub cli_binary: Option<String>,
    pub skill_installed: bool,
    pub config_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StagehandBrowseConfig {
    pub env: Option<String>,
    pub headed: Option<bool>,
    pub model: Option<String>,
    pub model_api_key: Option<String>,
    pub browserbase_api_key: Option<String>,
    pub browserbase_project_id: Option<String>,
    pub cdp_url: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagehandBrowseExecResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagehandBrowseInstallResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub shim_path: Option<String>,
    pub sidecar_dir: Option<String>,
    pub skill_installed: bool,
    pub path_status: Option<String>,
    pub runtime: Option<String>,
}

const WISE_PATH_MARKER: &str = "wise-cli PATH (managed by Wise)";

pub(crate) fn rc_has_wise_bin(content: &str) -> bool {
    content.contains(WISE_PATH_MARKER)
        || content.contains("$HOME/.wise/bin")
        || content.contains("%USERPROFILE%\\.wise\\bin")
}

pub(crate) fn wise_bin_path_export_block() -> String {
    format!("\n# {WISE_PATH_MARKER}\nexport PATH=\"$HOME/.wise/bin:$PATH\"\n")
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagehandStartOptions {
    pub env: Option<String>,
    pub headed: Option<bool>,
    pub model: Option<String>,
    pub model_api_key: Option<String>,
    pub browserbase_api_key: Option<String>,
    pub browserbase_project_id: Option<String>,
    pub cdp_url: Option<String>,
}

struct SidecarSession {
    child: Child,
    stdin: ChildStdin,
    pending: HashMap<u64, oneshot::Sender<Value>>,
}

pub struct StagehandBrowseState {
    next_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<String, SidecarSession>>>,
}

impl Default for StagehandBrowseState {
    fn default() -> Self {
        Self {
            next_id: AtomicU64::new(0),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn merged_path() -> String {
    claude_commands::merge_path_env(&claude_commands::claude_path_search_prefixes())
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path_env = merged_path();
    if cfg!(windows) {
        let output = std::process::Command::new("where")
            .arg(name)
            .env("PATH", &path_env)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        if line.is_empty() {
            return None;
        }
        let p = PathBuf::from(line);
        return p.exists().then_some(p);
    }
    for dir in claude_commands::claude_path_search_prefixes() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let output = std::process::Command::new("which")
        .arg(name)
        .env("PATH", &path_env)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let p = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    p.is_file().then_some(p)
}

fn find_browse_binary() -> Option<PathBuf> {
    which_in_path("browse")
}

fn find_js_runtime() -> Result<(PathBuf, &'static str), String> {
    if let Some(bun) = which_in_path("bun") {
        return Ok((bun, "bun"));
    }
    if let Some(node) = which_in_path("node") {
        return Ok((node, "node"));
    }
    Err("未找到 bun 或 node。请安装 Bun / Node.js 22.18+ 以运行 Stagehand sidecar。".into())
}

fn repo_sidecar_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../stagehand-cli")
}

fn user_sidecar_dir() -> Result<PathBuf, String> {
    Ok(wise_dir()
        .map_err(|e| format!("无法解析 ~/.wise：{e}"))?
        .join("stagehand-cli"))
}

fn screenshot_dir() -> Result<PathBuf, String> {
    let dir = automation_dir()?.join("screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建截图目录：{e}"))?;
    Ok(dir)
}

fn automation_dir() -> Result<PathBuf, String> {
    let dir = wise_dir()
        .map_err(|e| format!("无法解析 ~/.wise：{e}"))?
        .join("stagehand-automation");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建配置目录：{e}"))?;
    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    Ok(automation_dir()?.join("config.json"))
}

fn wise_bin_dir() -> Result<PathBuf, String> {
    let dir = wise_dir()
        .map_err(|e| format!("无法解析 ~/.wise：{e}"))?
        .join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建 ~/.wise/bin：{e}"))?;
    Ok(dir)
}

fn find_wise_browse_binary() -> Option<PathBuf> {
    which_in_path("wise-browse").or_else(|| {
        dirs::home_dir()
            .map(|home| home.join(".wise/bin/wise-browse"))
            .filter(|p| p.is_file())
    })
}

fn skill_is_installed() -> bool {
    let home = dirs::home_dir();
    let claude = crate::claude_config_dir::user_claude_dir()
        .join("skills")
        .join("wise-browse")
        .join("SKILL.md");
    if claude.is_file() {
        return true;
    }
    home.map(|h| {
        h.join(".codex/skills/wise-browse/SKILL.md").is_file()
            || h.join(".agents/skills/wise-browse/SKILL.md").is_file()
    })
    .unwrap_or(false)
}

fn bundled_skill_md(app: &AppHandle) -> Result<PathBuf, String> {
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources/skills/wise-browse/SKILL.md");
    if repo.is_file() {
        return Ok(repo);
    }
    if let Ok(res) = app.path().resource_dir() {
        for candidate in [
            res.join("resources/skills/wise-browse/SKILL.md"),
            res.join("skills/wise-browse/SKILL.md"),
            res.join("wise-browse/SKILL.md"),
        ] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    Err("未找到 wise-browse SKILL.md".into())
}

fn copy_file(src: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建 {}：{e}", parent.display()))?;
    }
    std::fs::copy(src, dest).map_err(|e| {
        format!(
            "复制 {} → {} 失败：{e}",
            src.display(),
            dest.display()
        )
    })?;
    Ok(())
}

fn write_unix_script(path: &Path, body: &str) -> Result<(), String> {
    std::fs::write(path, body).map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("无法设置 {} 可执行：{e}", path.display()))?;
    }
    Ok(())
}

fn install_cli_shims(sidecar_dir: &Path, runtime: &Path) -> Result<PathBuf, String> {
    let bin_dir = wise_bin_dir()?;
    let script = sidecar_dir.join("cli.mjs");
    #[cfg(windows)]
    {
        let wise_browse = bin_dir.join("wise-browse.cmd");
        let wise = bin_dir.join("wise.cmd");
        let browse_body = format!(
            "@echo off\r\nset \"PATH={path};%PATH%\"\r\nset \"STAGEHAND_SCREENSHOT_DIR=%USERPROFILE%\\.wise\\stagehand-automation\\screenshots\"\r\ncd /d \"{dir}\" || exit /b 1\r\n\"{runtime}\" \"{script}\" %*\r\n",
            path = merged_path().replace('"', ""),
            dir = sidecar_dir.display(),
            runtime = runtime.display(),
            script = script.display(),
        );
        let wise_body = "@echo off\r\nset \"DIR=%~dp0\"\r\nif /I \"%1\"==\"browse\" (\r\n  shift\r\n  \"%DIR%wise-browse.cmd\" %*\r\n  exit /b %ERRORLEVEL%\r\n)\r\nif /I \"%1\"==\"browser\" (\r\n  shift\r\n  \"%DIR%wise-browse.cmd\" %*\r\n  exit /b %ERRORLEVEL%\r\n)\r\necho Usage: wise browse ^<command^> [args]\r\nexit /b 0\r\n";
        std::fs::write(&wise_browse, browse_body)
            .map_err(|e| format!("写入 {} 失败：{e}", wise_browse.display()))?;
        std::fs::write(&wise, wise_body).map_err(|e| format!("写入 {} 失败：{e}", wise.display()))?;
        return Ok(wise_browse);
    }
    #[cfg(not(windows))]
    {
        let wise_browse = bin_dir.join("wise-browse");
        let wise = bin_dir.join("wise");
        let browse_body = format!(
            "#!/bin/sh\nexport PATH=\"{path}\"\nexport STAGEHAND_SCREENSHOT_DIR=\"$HOME/.wise/stagehand-automation/screenshots\"\ncd \"{dir}\" || exit 1\nexec \"{runtime}\" \"{script}\" \"$@\"\n",
            path = merged_path().replace('"', "\\\""),
            dir = sidecar_dir.display(),
            runtime = runtime.display(),
            script = script.display(),
        );
        let wise_body = "#!/bin/sh\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nsub=\"$1\"\nshift\ncase \"$sub\" in\n  browse|browser)\n    exec \"$DIR/wise-browse\" \"$@\"\n    ;;\n  help|--help|-h|\"\")\n    echo \"Usage: wise browse <command> [args]\"\n    echo \"       wise-browse <command> [args]\"\n    exit 0\n    ;;\n  *)\n    echo \"Unknown command: $sub\" >&2\n    echo \"Usage: wise browse <command> [args]\" >&2\n    exit 1\n    ;;\nesac\n";
        write_unix_script(&wise_browse, &browse_body)?;
        write_unix_script(&wise, wise_body)?;
        Ok(wise_browse)
    }
}

fn ensure_wise_bin_on_user_path() -> Result<&'static str, String> {
    #[cfg(windows)]
    {
        return Ok("skipped");
    }
    #[cfg(not(windows))]
    {
        let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
        let names = [".zprofile", ".zshrc", ".bash_profile", ".bashrc", ".profile"];
        for name in names {
            let path = home.join(name);
            if !path.is_file() {
                continue;
            }
            let raw = std::fs::read_to_string(&path)
                .map_err(|e| format!("读取 {} 失败：{e}", path.display()))?;
            if rc_has_wise_bin(&raw) {
                return Ok("already");
            }
        }
        let dest = names
            .iter()
            .map(|name| home.join(name))
            .find(|path| path.is_file())
            .unwrap_or_else(|| home.join(".zprofile"));
        let mut raw = if dest.is_file() {
            std::fs::read_to_string(&dest)
                .map_err(|e| format!("读取 {} 失败：{e}", dest.display()))?
        } else {
            String::new()
        };
        if rc_has_wise_bin(&raw) {
            return Ok("already");
        }
        if !raw.is_empty() && !raw.ends_with('\n') {
            raw.push('\n');
        }
        raw.push_str(&wise_bin_path_export_block());
        std::fs::write(&dest, raw).map_err(|e| format!("写入 {} 失败：{e}", dest.display()))?;
        Ok("added")
    }
}

fn install_user_skill(app: &AppHandle) -> Result<(), String> {
    let src = bundled_skill_md(app)?;
    let mut dests: Vec<PathBuf> = vec![
        crate::claude_config_dir::user_claude_dir()
            .join("skills")
            .join("wise-browse")
            .join("SKILL.md"),
    ];
    if let Some(home) = dirs::home_dir() {
        dests.push(home.join(".codex/skills/wise-browse/SKILL.md"));
        dests.push(home.join(".agents/skills/wise-browse/SKILL.md"));
    }
    for dest in dests {
        copy_file(&src, &dest)?;
    }
    Ok(())
}

fn ensure_cli_lightweight(app: &AppHandle) {
    let _ = wise_bin_dir();
    let _ = install_user_skill(app);
    let _ = sync_user_sidecar(app);
    if find_wise_browse_binary().is_some() {
        return;
    }
    let Ok((runtime, _)) = find_js_runtime() else {
        return;
    };
    if let Ok(dir) = resolve_sidecar_dir(app) {
        if sidecar_ready(&dir) && dir.join("cli.mjs").is_file() && dir.join("assert.mjs").is_file() {
            let _ = install_cli_shims(&dir, &runtime);
        }
    }
}

fn source_sidecar_scripts(app: &AppHandle) -> Result<PathBuf, String> {
    let repo = repo_sidecar_dir();
    if repo.join("cli.mjs").is_file() {
        return Ok(repo);
    }
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("stagehand-cli");
        if bundled.join("cli.mjs").is_file() {
            return Ok(bundled);
        }
        if res.join("cli.mjs").is_file() {
            return Ok(res);
        }
    }
    Err("未找到 Stagehand CLI 脚本（stagehand-cli/cli.mjs）。".into())
}

fn sync_user_sidecar(app: &AppHandle) -> Result<PathBuf, String> {
    let src = source_sidecar_scripts(app)?;
    let dest = user_sidecar_dir()?;
    std::fs::create_dir_all(&dest).map_err(|e| format!("无法创建 {}：{e}", dest.display()))?;
    for name in ["cli.mjs", "argv.mjs", "assert.mjs", "package.json"] {
        let from = src.join(name);
        if from.is_file() {
            copy_file(&from, &dest.join(name))?;
        }
    }
    Ok(dest)
}

fn load_config_file() -> Result<StagehandBrowseConfig, String> {
    let path = config_path()?;
    if !path.is_file() {
        return Ok(StagehandBrowseConfig {
            env: Some("local".into()),
            headed: Some(true),
            ..StagehandBrowseConfig::default()
        });
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取配置失败：{e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("配置 JSON 无效：{e}"))
}

fn save_config_file(config: &StagehandBrowseConfig) -> Result<PathBuf, String> {
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败：{e}"))?;
    std::fs::write(&path, raw).map_err(|e| format!("写入配置失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

fn resolve_sidecar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let user = user_sidecar_dir()?;
    if user.join("cli.mjs").is_file() && sidecar_ready(&user) {
        return Ok(user);
    }
    let repo = repo_sidecar_dir();
    if repo.join("cli.mjs").is_file() {
        return Ok(repo);
    }
    if let Ok(res) = app.path().resource_dir() {
        let bundled = res.join("stagehand-cli");
        if bundled.join("cli.mjs").is_file() {
            return Ok(bundled);
        }
        if res.join("cli.mjs").is_file() {
            return Ok(res);
        }
    }
    if user.join("cli.mjs").is_file() {
        return Ok(user);
    }
    Err("未找到 Stagehand sidecar（stagehand-cli/cli.mjs）。请确认仓库内存在该目录。".into())
}

fn sidecar_ready(dir: &Path) -> bool {
    dir.join("node_modules/@browserbasehq/stagehand").is_dir()
        || dir.join("node_modules/@browserbasehq/stagehand").is_file()
}

fn sanitize_session_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("sessionId 不能为空".into());
    }
    let safe: String = trimmed
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    if safe.is_empty() {
        return Err("sessionId 无效".into());
    }
    Ok(safe)
}

fn browse_session_name(session_id: &str) -> String {
    format!("wise-{session_id}")
}

fn validate_browse_args(args: &[String]) -> Result<(), String> {
    let command = args
        .iter()
        .find(|part| !part.starts_with('-'))
        .map(|s| s.as_str())
        .unwrap_or("");
    if command.is_empty() {
        return Err("browse 命令不能为空".into());
    }
    if !BROWSE_ROOT_COMMANDS.contains(&command) {
        return Err(format!("不允许的 browse 命令：{command}"));
    }
    Ok(())
}

fn apply_common_env(cmd: &mut Command, extra: Option<&HashMap<String, String>>) {
    cmd.env("PATH", merged_path());
    cmd.env("BROWSE_LOAD_DOTENV", "0");
    if let Some(home) = dirs::home_dir() {
        cmd.env("HOME", home);
    }
    if let Some(map) = extra {
        for (key, value) in map {
            let k = key.trim();
            if k.is_empty() {
                continue;
            }
            if matches!(
                k,
                "PATH" | "DYLD_INSERT_LIBRARIES" | "LD_PRELOAD" | "LD_LIBRARY_PATH"
            ) {
                continue;
            }
            cmd.env(k, value);
        }
    }
}

async fn run_output(mut cmd: Command, max_wait: Duration) -> Result<StagehandBrowseExecResult, String> {
    let output = timeout(max_wait, cmd.output())
        .await
        .map_err(|_| "命令执行超时".to_string())?
        .map_err(|e| format!("启动进程失败：{e}"))?;
    Ok(StagehandBrowseExecResult {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

fn spawn_stdout_reader(
    mut reader: BufReader<tokio::process::ChildStdout>,
    session_id: String,
    sessions: Arc<Mutex<HashMap<String, SidecarSession>>>,
) {
    tokio::spawn(async move {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let parsed: Value = match serde_json::from_str(trimmed) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let id = parsed.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                    let mut guard = sessions.lock().await;
                    if let Some(session) = guard.get_mut(&session_id) {
                        if let Some(tx) = session.pending.remove(&id) {
                            let _ = tx.send(parsed);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn drain_stderr(stderr: tokio::process::ChildStderr) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });
}

async fn spawn_sidecar(
    app: &AppHandle,
    state: &State<'_, StagehandBrowseState>,
    session_id: &str,
    env_vars: Option<&HashMap<String, String>>,
) -> Result<(), String> {
    {
        let guard = state.sessions.lock().await;
        if guard.contains_key(session_id) {
            return Ok(());
        }
    }
    let dir = resolve_sidecar_dir(app)?;
    if !sidecar_ready(&dir) {
        return Err("Stagehand 运行时依赖未安装。请先点击「安装依赖」。".into());
    }
    let script = dir.join("cli.mjs");
    let (runtime, _) = find_js_runtime()?;
    let shots = screenshot_dir()?;
    let mut cmd = Command::new(&runtime);
    cmd.arg(&script)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_common_env(&mut cmd, env_vars);
    cmd.env("STAGEHAND_SCREENSHOT_DIR", shots);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 Stagehand sidecar 失败：{e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin 不可用".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout 不可用".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        drain_stderr(stderr);
    }
    let reader = BufReader::new(stdout);
    {
        let mut guard = state.sessions.lock().await;
        guard.insert(
            session_id.to_string(),
            SidecarSession {
                child,
                stdin,
                pending: HashMap::new(),
            },
        );
    }
    spawn_stdout_reader(reader, session_id.to_string(), Arc::clone(&state.sessions));
    Ok(())
}

async fn sidecar_rpc(
    state: &State<'_, StagehandBrowseState>,
    session_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = oneshot::channel::<Value>();
    {
        let mut guard = state.sessions.lock().await;
        let session = guard
            .get_mut(session_id)
            .ok_or_else(|| "浏览器自动化会话未启动".to_string())?;
        session.pending.insert(id, tx);
        let payload = json!({ "id": id, "method": method, "params": params });
        let mut line = payload.to_string();
        line.push('\n');
        if let Err(e) = session.stdin.write_all(line.as_bytes()).await {
            drop(guard);
            kill_sidecar(state, session_id).await;
            return Err(format!("写入浏览器进程失败：{e}"));
        }
        if let Err(e) = session.stdin.flush().await {
            drop(guard);
            kill_sidecar(state, session_id).await;
            return Err(format!("刷新浏览器进程失败：{e}"));
        }
    }
    let response = match timeout(RPC_TIMEOUT, rx).await {
        Ok(Ok(value)) => value,
        Ok(Err(_)) => {
            kill_sidecar(state, session_id).await;
            return Err("浏览器进程已退出，请重新启动".into());
        }
        Err(_) => return Err("Stagehand 调用超时".into()),
    };
    if response.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(Value::Null));
    }
    let err = response
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("sidecar 返回错误");
    Err(err.to_string())
}

async fn kill_sidecar(state: &State<'_, StagehandBrowseState>, session_id: &str) {
    let mut guard = state.sessions.lock().await;
    if let Some(mut session) = guard.remove(session_id) {
        let _ = session.stdin.write_all(b"{\"id\":0,\"method\":\"stop\",\"params\":{}}\n").await;
        let _ = session.child.kill().await;
        let _ = session.child.wait().await;
    }
}

#[tauri::command]
pub async fn stagehand_browse_probe(app: AppHandle) -> Result<StagehandBrowseProbe, String> {
    ensure_cli_lightweight(&app);
    let browse_binary = find_browse_binary();
    let browse_version = if let Some(bin) = &browse_binary {
        std::process::Command::new(bin)
            .arg("--version")
            .env("PATH", merged_path())
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    let sidecar_dir = resolve_sidecar_dir(&app).ok();
    let sidecar_ready_flag = sidecar_dir.as_ref().map(|d| sidecar_ready(d)).unwrap_or(false);
    let user_ready = user_sidecar_dir().ok().map(|d| sidecar_ready(&d)).unwrap_or(false);
    let runtime_ready = sidecar_ready_flag || user_ready;
    let runtime = find_js_runtime()
        .ok()
        .map(|(path, kind)| format!("{kind} {}", path.display()));
    let cli_binary = find_wise_browse_binary();
    let error = if sidecar_dir.is_none() && !user_ready {
        Some("未找到 Stagehand 运行时脚本".into())
    } else if !runtime_ready {
        Some("Stagehand 运行时依赖未安装".into())
    } else if cli_binary.is_none() {
        Some("wise browse CLI 未安装，请点击「安装 CLI」".into())
    } else {
        None
    };
    Ok(StagehandBrowseProbe {
        browse_available: browse_binary.is_some(),
        browse_binary: browse_binary.map(|p| p.display().to_string()),
        browse_version,
        sidecar_available: sidecar_dir.is_some() || user_ready,
        sidecar_dir: sidecar_dir
            .map(|p| p.display().to_string())
            .or_else(|| user_sidecar_dir().ok().map(|p| p.display().to_string())),
        sidecar_ready: runtime_ready,
        runtime,
        has_browserbase_key: std::env::var("BROWSERBASE_API_KEY")
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        cli_available: cli_binary.is_some(),
        cli_binary: cli_binary.map(|p| p.display().to_string()),
        skill_installed: skill_is_installed(),
        config_path: config_path().ok().map(|p| p.display().to_string()),
        error,
    })
}

#[tauri::command]
pub async fn stagehand_browse_install_deps(app: AppHandle) -> Result<StagehandBrowseInstallResult, String> {
    let mut notes: Vec<String> = Vec::new();
    let dir = sync_user_sidecar(&app)?;
    notes.push(format!("已同步脚本 → {}", dir.display()));
    let (runtime, kind) = find_js_runtime()?;
    notes.push(format!("使用运行时 {kind} {}", runtime.display()));

    let mut cmd = Command::new(&runtime);
    if kind == "bun" {
        cmd.args(["install"]);
    } else if let Some(npm) = which_in_path("npm") {
        cmd = Command::new(npm);
        cmd.args(["install"]);
    } else {
        return Err("未找到 bun 或 npm，无法安装 Stagehand 依赖。请先安装 Bun 或 Node.js。".into());
    }
    cmd.current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_common_env(&mut cmd, None);
    let deps = run_output(cmd, INSTALL_TIMEOUT).await?;
    if deps.ok {
        notes.push("已安装 Stagehand 运行时依赖".into());
    }

    let shim_path = install_cli_shims(&dir, &runtime)?;
    notes.push(format!("已写入 CLI → {}", shim_path.display()));
    install_user_skill(&app)?;
    notes.push("已挂载会话 Skill（Claude / Codex / agents）".into());
    let path_status = ensure_wise_bin_on_user_path().unwrap_or("skipped");
    match path_status {
        "added" => notes.push("已把 ~/.wise/bin 写入登录 shell PATH".into()),
        "already" => notes.push("~/.wise/bin 已在 PATH 中".into()),
        _ => {}
    }
    if !config_path()?.is_file() {
        let _ = save_config_file(&StagehandBrowseConfig {
            env: Some("local".into()),
            headed: Some(true),
            ..StagehandBrowseConfig::default()
        });
        notes.push("已写入默认配置".into());
    }

    let ready = deps.ok && sidecar_ready(&dir);
    let mut stdout = notes.join("\n");
    if !deps.stdout.trim().is_empty() {
        stdout.push_str("\n\n");
        stdout.push_str(deps.stdout.trim());
    }
    Ok(StagehandBrowseInstallResult {
        ok: ready,
        stdout,
        stderr: deps.stderr,
        exit_code: if ready { 0 } else { deps.exit_code.max(1) },
        shim_path: Some(shim_path.display().to_string()),
        sidecar_dir: Some(dir.display().to_string()),
        skill_installed: skill_is_installed(),
        path_status: Some(path_status.to_string()),
        runtime: Some(format!("{kind} {}", runtime.display())),
    })
}

#[tauri::command]
pub async fn stagehand_browse_load_config() -> Result<StagehandBrowseConfig, String> {
    load_config_file()
}

#[tauri::command]
pub async fn stagehand_browse_save_config(
    config: StagehandBrowseConfig,
) -> Result<StagehandBrowseConfig, String> {
    save_config_file(&config)?;
    load_config_file()
}

#[tauri::command]
pub async fn stagehand_browse_latest_report() -> Result<Value, String> {
    let pointer = automation_dir()?.join("reports").join("latest.json");
    if !pointer.is_file() {
        return Ok(json!({ "found": false }));
    }
    let raw = std::fs::read_to_string(&pointer).map_err(|e| format!("无法读取验收报告：{e}"))?;
    let parsed: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    let mut out = match parsed {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    out.insert("found".into(), json!(true));
    Ok(Value::Object(out))
}

fn wise_browse_command(args: &[&str]) -> Result<Command, String> {
    let bin = find_wise_browse_binary().ok_or_else(|| {
        "未找到 wise-browse。请先在右上角点击「安装 CLI」。".to_string()
    })?;
    let mut cmd = Command::new(&bin);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_common_env(&mut cmd, None);
    Ok(cmd)
}

#[tauri::command]
pub async fn stagehand_browse_daemon_status() -> Result<Value, String> {
    let Some(_) = find_wise_browse_binary() else {
        return Ok(json!({
            "running": false,
            "cliAvailable": false,
            "url": null,
            "title": null,
            "pageCount": 0
        }));
    };
    let cmd = wise_browse_command(&["status"])?;
    let result = run_output(cmd, Duration::from_secs(8)).await?;
    let stdout = result.stdout.trim();
    if stdout.is_empty() {
        return Ok(json!({ "running": false, "cliAvailable": true }));
    }
    match serde_json::from_str::<Value>(stdout) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("cliAvailable".into(), json!(true));
            }
            Ok(value)
        }
        Err(_) => Ok(json!({
            "running": false,
            "cliAvailable": true,
            "raw": stdout
        })),
    }
}

#[tauri::command]
pub async fn stagehand_browse_daemon_stop() -> Result<Value, String> {
    let cmd = wise_browse_command(&["stop"])?;
    let result = run_output(cmd, Duration::from_secs(20)).await?;
    if !result.ok {
        let detail = result.stderr.trim().to_string();
        if detail.is_empty() {
            return Err(result.stdout.trim().to_string());
        }
        return Err(detail);
    }
    let stdout = result.stdout.trim();
    if stdout.is_empty() {
        return Ok(json!({ "stopped": true }));
    }
    Ok(serde_json::from_str(stdout).unwrap_or_else(|_| json!({ "stopped": true, "raw": stdout })))
}

#[tauri::command]
pub async fn stagehand_browse_start(
    app: AppHandle,
    state: State<'_, StagehandBrowseState>,
    session_id: String,
    options: Option<StagehandStartOptions>,
    env_vars: Option<HashMap<String, String>>,
) -> Result<Value, String> {
    let session_id = sanitize_session_id(&session_id)?;
    spawn_sidecar(&app, &state, &session_id, env_vars.as_ref()).await?;
    let opts = options.unwrap_or(StagehandStartOptions {
        env: Some("local".into()),
        headed: Some(true),
        model: None,
        model_api_key: None,
        browserbase_api_key: None,
        browserbase_project_id: None,
        cdp_url: None,
    });
    let params = json!({
        "env": opts.env.unwrap_or_else(|| "local".into()),
        "headed": opts.headed.unwrap_or(true),
        "model": opts.model,
        "modelApiKey": opts.model_api_key,
        "browserbaseApiKey": opts.browserbase_api_key,
        "browserbaseProjectId": opts.browserbase_project_id,
        "cdpUrl": opts.cdp_url,
    });
    match sidecar_rpc(&state, &session_id, "start", params).await {
        Ok(result) => Ok(result),
        Err(err) => {
            kill_sidecar(&state, &session_id).await;
            Err(err)
        }
    }
}

#[tauri::command]
pub async fn stagehand_browse_stop(
    state: State<'_, StagehandBrowseState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = sanitize_session_id(&session_id)?;
    let _ = sidecar_rpc(&state, &session_id, "stop", json!({})).await;
    kill_sidecar(&state, &session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn stagehand_browse_call(
    state: State<'_, StagehandBrowseState>,
    session_id: String,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let session_id = sanitize_session_id(&session_id)?;
    let method = method.trim();
    if method.is_empty() {
        return Err("method 不能为空".into());
    }
    if method == "start" || method == "stop" {
        return Err("请使用专用的启动/停止命令".into());
    }
    sidecar_rpc(&state, &session_id, method, params.unwrap_or_else(|| json!({}))).await
}

#[tauri::command]
pub async fn stagehand_browse_exec(
    session_id: String,
    args: Vec<String>,
    env_vars: Option<HashMap<String, String>>,
    cwd: Option<String>,
) -> Result<StagehandBrowseExecResult, String> {
    let session_id = sanitize_session_id(&session_id)?;
    if args.is_empty() {
        return Err("browse 参数不能为空".into());
    }
    validate_browse_args(&args)?;
    let browse = find_browse_binary().ok_or_else(|| {
        "未找到 browse CLI。请执行 `npm install -g browse`，或确保 browse 在 PATH 中。".to_string()
    })?;
    let mut cmd = Command::new(&browse);
    cmd.arg("--json")
        .arg("--session")
        .arg(browse_session_name(&session_id))
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.current_dir(dir);
    }
    apply_common_env(&mut cmd, env_vars.as_ref());
    run_output(cmd, BROWSE_TIMEOUT).await
}

#[cfg(test)]
mod tests {
    use super::{
        rc_has_wise_bin, sanitize_session_id, validate_browse_args, wise_bin_path_export_block,
        StagehandBrowseConfig, BROWSE_ROOT_COMMANDS,
    };

    #[test]
    fn rejects_empty_session() {
        assert!(sanitize_session_id("  ").is_err());
    }

    #[test]
    fn sanitizes_session() {
        assert_eq!(sanitize_session_id("abc/def").unwrap(), "abc_def");
    }

    #[test]
    fn allows_known_browse_commands() {
        assert!(validate_browse_args(&["open".into(), "https://example.com".into()]).is_ok());
        assert!(!BROWSE_ROOT_COMMANDS.contains(&"act"));
        assert!(validate_browse_args(&["rm".into(), "-rf".into()]).is_err());
    }

    #[test]
    fn default_config_is_local_headed() {
        let config = StagehandBrowseConfig {
            env: Some("local".into()),
            headed: Some(true),
            ..StagehandBrowseConfig::default()
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("\"env\":\"local\"") || json.contains("\"env\": \"local\""));
        let parsed: StagehandBrowseConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.env.as_deref(), Some("local"));
        assert_eq!(parsed.headed, Some(true));
    }

    #[test]
    fn detects_wise_bin_path_export() {
        assert!(rc_has_wise_bin("# wise-cli PATH (managed by Wise)\nexport PATH=\"$HOME/.wise/bin:$PATH\"\n"));
        assert!(rc_has_wise_bin("export PATH=\"$HOME/.wise/bin:$PATH\"\n"));
        assert!(!rc_has_wise_bin("export PATH=\"/usr/local/bin:$PATH\"\n"));
        assert!(wise_bin_path_export_block().contains("$HOME/.wise/bin"));
    }
}
