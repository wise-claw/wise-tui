//! [free-claude-code](https://github.com/jiaolong1021/free-claude-code) 本地 Anthropic 兼容代理集成。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tokio::net::TcpStream;
use tokio::process::Child;

use crate::claude_config_dir::{
    is_local_fcc_proxy_base_url, read_claude_json_env_block, sanitize_claude_root_json_for_fcc_proxy,
    user_claude_dir,
};

/// Wise 集成的 FCC 发行源（百炼等定制 provider）。
pub const FCC_REPO_GIT_URL: &str = "git+https://github.com/jiaolong1021/free-claude-code.git";

/// `uv tool install` / `uv tool uninstall` 使用的工具名（见 `uv tool list`）。
pub const FCC_UV_TOOL_NAME: &str = "free-claude-code";

static MANAGED_SERVER_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn managed_child_cell() -> &'static Mutex<Option<Child>> {
    MANAGED_SERVER_CHILD.get_or_init(|| Mutex::new(None))
}

fn fcc_config_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".fcc").join(".env"))
        .unwrap_or_else(|| PathBuf::from(".fcc/.env"))
}

/// 解析 `~/.fcc/.env`（仅 `KEY=VALUE`，忽略注释与空行）。
pub(crate) fn parse_fcc_dotenv(path: &Path) -> HashMap<String, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return HashMap::new(),
    };
    let mut out = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let mut val = v.trim().to_string();
        if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')) {
            val = val[1..val.len().saturating_sub(1)].to_string();
        }
        if !val.is_empty() {
            out.insert(key.to_string(), val);
        }
    }
    out
}

fn resolve_fcc_server_binary() -> Option<PathBuf> {
    let home_bin = dirs::home_dir().map(|h| h.join(".local/bin/fcc-server"));
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(p) = home_bin {
        candidates.push(p);
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':').map(str::trim).filter(|s| !s.is_empty()) {
            candidates.push(PathBuf::from(dir).join("fcc-server"));
        }
    }
    candidates.push(PathBuf::from("fcc-server"));
    for p in candidates {
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

async fn tcp_port_open(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    tokio::time::timeout(Duration::from_millis(800), TcpStream::connect(addr))
        .await
        .ok()
        .and_then(|r| r.ok())
        .is_some()
}

fn fcc_port_from_env(env: &HashMap<String, String>) -> u16 {
    env.get("PORT")
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|p| *p > 0)
        .unwrap_or(8082)
}

fn fcc_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn fcc_admin_url(port: u16) -> String {
    format!("{}/admin", fcc_base_url(port))
}

fn claude_settings_aligned(fcc_env: &HashMap<String, String>, port: u16) -> bool {
    let settings_path = user_claude_dir().join("settings.json");
    let user_env = read_claude_json_env_block(&settings_path);
    let expected_token = fcc_env
        .get("ANTHROPIC_AUTH_TOKEN")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let expected_base = fcc_base_url(port);
    let token_ok = match expected_token {
        Some(tok) => user_env.get("ANTHROPIC_AUTH_TOKEN").map(|s| s.trim()) == Some(tok),
        None => true,
    };
    let base_ok = user_env
        .get("ANTHROPIC_BASE_URL")
        .map(|s| s.trim().trim_end_matches('/'))
        == Some(expected_base.trim_end_matches('/'));
    let discovery_ok = user_env
        .get("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY")
        .map(|s| s.trim())
        == Some("1");
    token_ok && base_ok && discovery_ok
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeClaudeCodeStatus {
    pub uv_ready: bool,
    pub claude_cli_ready: bool,
    pub installed: bool,
    pub server_running: bool,
    pub managed_by_wise: bool,
    pub port: u16,
    pub auth_token: Option<String>,
    pub model: Option<String>,
    pub admin_url: String,
    pub proxy_base_url: String,
    pub binary_path: Option<String>,
    pub repo_url: String,
    pub config_path: String,
    pub claude_settings_aligned: bool,
}

async fn build_status() -> FreeClaudeCodeStatus {
    let fcc_env = parse_fcc_dotenv(&fcc_config_path());
    let port = fcc_port_from_env(&fcc_env);
    let uv_ready = which_uv_binary().is_some();
    let claude_cli_ready = crate::claude_commands::find_claude_binary().is_ok();
    let binary_path = resolve_fcc_server_binary();
    let installed = binary_path.is_some();
    let managed = managed_child_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()
        .map(|c| matches!(c.try_wait(), Ok(None)))
        .unwrap_or(false);
    let server_running = managed || tcp_port_open("127.0.0.1", port).await;
    let auth_token = fcc_env.get("ANTHROPIC_AUTH_TOKEN").cloned();
    let model = fcc_env.get("MODEL").cloned();
    let config_path = fcc_config_path();
    FreeClaudeCodeStatus {
        uv_ready,
        claude_cli_ready,
        installed,
        server_running,
        managed_by_wise: managed,
        port,
        auth_token,
        model,
        admin_url: fcc_admin_url(port),
        proxy_base_url: fcc_base_url(port),
        binary_path: binary_path.map(|p| p.to_string_lossy().to_string()),
        repo_url: FCC_REPO_GIT_URL.to_string(),
        config_path: config_path.to_string_lossy().to_string(),
        claude_settings_aligned: claude_settings_aligned(&fcc_env, port),
    }
}

#[tauri::command]
pub async fn get_free_claude_code_status() -> Result<FreeClaudeCodeStatus, String> {
    Ok(build_status().await)
}

fn take_managed_child() -> Option<Child> {
    managed_child_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

async fn stop_managed_server_async() {
    if let Some(mut child) = take_managed_child() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(8), child.wait()).await;
    }
}

/// 监听 `port` 的进程 PID（`lsof -sTCP:LISTEN`）。
fn listen_pids_on_port(port: u16) -> Vec<u32> {
    let Ok(out) = Command::new("lsof")
        .args(["-n", "-P", "-sTCP:LISTEN", "-ti", &format!(":{port}")])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| *pid > 0)
        .collect()
}

fn pid_command_line(pid: u32) -> Option<String> {
    let Ok(out) = Command::new("ps")
        .args(["-p", pid.to_string().as_str(), "-o", "command="])
        .output()
    else {
        return None;
    };
    let cmd = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if cmd.is_empty() {
        None
    } else {
        Some(cmd)
    }
}

fn command_looks_like_fcc_server(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    lower.contains("fcc-server")
        || lower.contains("free-claude-code")
        || lower.contains("free_claude_code")
}

/// 仅终止命令行像 fcc-server 的监听进程，避免误杀占用同端口的其它服务。
fn kill_fcc_listeners_on_port(port: u16) -> Vec<u32> {
    let mut killed = Vec::new();
    for pid in listen_pids_on_port(port) {
        let Some(cmd) = pid_command_line(pid) else {
            continue;
        };
        if !command_looks_like_fcc_server(&cmd) {
            continue;
        }
        let _ = Command::new("kill").arg(pid.to_string()).status();
        killed.push(pid);
    }
    killed
}

async fn wait_until_port_closed(host: &str, port: u16, attempts: u32, interval: Duration) -> bool {
    for _ in 0..attempts {
        if !tcp_port_open(host, port).await {
            return true;
        }
        tokio::time::sleep(interval).await;
    }
    !tcp_port_open(host, port).await
}

#[tauri::command]
pub async fn stop_free_claude_code_server() -> Result<FreeClaudeCodeStatus, String> {
    let fcc_env = parse_fcc_dotenv(&fcc_config_path());
    let port = fcc_port_from_env(&fcc_env);

    stop_managed_server_async().await;

    if tcp_port_open("127.0.0.1", port).await {
        let port_for_kill = port;
        let killed = tokio::task::spawn_blocking(move || kill_fcc_listeners_on_port(port_for_kill))
            .await
            .map_err(|e| format!("停止任务被中断: {e}"))?;
        if killed.is_empty() {
            let listeners = listen_pids_on_port(port);
            if !listeners.is_empty() {
                return Err(format!(
                    "端口 {port} 仍被非 Wise 进程占用（PID {}），请在终端手动结束后再试。",
                    listeners
                        .iter()
                        .map(|p| p.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                ));
            }
        }
        let _ = wait_until_port_closed("127.0.0.1", port, 24, Duration::from_millis(250)).await;
    }

    if tcp_port_open("127.0.0.1", port).await {
        let port_for_kill = port;
        let _ = tokio::task::spawn_blocking(move || {
            for pid in kill_fcc_listeners_on_port(port_for_kill) {
                let _ = Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .status();
            }
        })
        .await
        .map_err(|e| format!("停止任务被中断: {e}"))?;
        let _ = wait_until_port_closed("127.0.0.1", port, 12, Duration::from_millis(250)).await;
    }

    if tcp_port_open("127.0.0.1", port).await {
        return Err(format!(
            "fcc-server 仍在监听 {port}，请执行 lsof -i :{port} 查看进程后手动结束。"
        ));
    }

    Ok(build_status().await)
}

#[tauri::command]
pub async fn start_free_claude_code_server() -> Result<FreeClaudeCodeStatus, String> {
    let binary = resolve_fcc_server_binary()
        .ok_or_else(|| "未找到 fcc-server，请先安装 free-claude-code。".to_string())?;
    let fcc_env = parse_fcc_dotenv(&fcc_config_path());
    let port = fcc_port_from_env(&fcc_env);

    if tcp_port_open("127.0.0.1", port).await {
        return Ok(build_status().await);
    }

    if let Some(mut child) = take_managed_child() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.stdout(Stdio::null()).stderr(Stdio::null()).stdin(Stdio::null());
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    let path_env = crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
    cmd.env("PATH", path_env);

    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 fcc-server 失败: {e}"))?;
    {
        let mut guard = managed_child_cell().lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(child);
    }

    for _ in 0..40 {
        if tcp_port_open("127.0.0.1", port).await {
            return Ok(build_status().await);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Err(format!(
        "fcc-server 已启动，但 {port} 端口在 10 秒内未就绪，请查看终端日志或 Admin UI。"
    ))
}

fn default_path_for_subprocess() -> String {
    let base = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
    match std::env::var("PATH") {
        Ok(p) if !p.trim().is_empty() => format!("{base}:{p}"),
        _ => base.to_string(),
    }
}

fn run_uv_tool_subcommand(home_s: &str, path_env: &str, sub_args: &[&str]) -> Result<std::process::Output, String> {
    let uv_bin = which_uv_binary().ok_or_else(|| {
        "未找到 uv。请先安装：https://astral.sh/uv ，或执行 curl -LsSf https://astral.sh/uv/install.sh | sh"
            .to_string()
    })?;
    let mut cmd = std::process::Command::new(uv_bin);
    cmd.arg("tool").env("HOME", home_s).env("PATH", path_env);
    for arg in sub_args {
        cmd.arg(arg);
    }
    cmd.output()
        .map_err(|e| format!("执行 uv tool {} 失败: {e}", sub_args.first().copied().unwrap_or("")))
}

#[tauri::command]
pub async fn install_free_claude_code() -> Result<String, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
    let home_s = home.to_string_lossy().to_string();
    let path_env = default_path_for_subprocess();
    let spec = FCC_REPO_GIT_URL.to_string();

    let out = tokio::task::spawn_blocking(move || {
        run_uv_tool_subcommand(
            &home_s,
            &path_env,
            &["install", "--force", spec.as_str()],
        )
    })
    .await
    .map_err(|e| format!("安装任务被中断: {e}"))??;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if !out.status.success() {
        return Err(format!(
            "安装 free-claude-code 失败（退出码 {:?}）\n{stdout}\n{stderr}",
            out.status.code()
        ));
    }
    Ok(format!("{stdout}\n{stderr}").trim().to_string())
}

#[tauri::command]
pub async fn uninstall_free_claude_code() -> Result<FreeClaudeCodeStatus, String> {
    let fcc_env = parse_fcc_dotenv(&fcc_config_path());
    let port = fcc_port_from_env(&fcc_env);

    stop_managed_server_async().await;
    if tcp_port_open("127.0.0.1", port).await {
        let port_for_kill = port;
        let _ = tokio::task::spawn_blocking(move || kill_fcc_listeners_on_port(port_for_kill))
            .await
            .map_err(|e| format!("停止任务被中断: {e}"))?;
        let _ = wait_until_port_closed("127.0.0.1", port, 24, Duration::from_millis(250)).await;
    }

    if tcp_port_open("127.0.0.1", port).await {
        return Err(
            "代理服务仍在运行，请先点击「停止」或关闭外部 fcc-server 后再卸载。".to_string(),
        );
    }

    let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
    let home_s = home.to_string_lossy().to_string();
    let path_env = default_path_for_subprocess();
    let tool_name = FCC_UV_TOOL_NAME.to_string();

    let out = tokio::task::spawn_blocking(move || {
        run_uv_tool_subcommand(&home_s, &path_env, &["uninstall", tool_name.as_str()])
    })
    .await
    .map_err(|e| format!("卸载任务被中断: {e}"))??;

    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let combined = format!("{stdout}\n{stderr}").to_lowercase();
        if !combined.contains("not installed") && !combined.contains("not found") {
            return Err(format!(
                "卸载 free-claude-code 失败（退出码 {:?}）\n{stdout}\n{stderr}",
                out.status.code()
            ));
        }
    }

    Ok(build_status().await)
}

fn which_uv_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = dirs::home_dir() {
        candidates.push(h.join(".local/bin/uv"));
        candidates.push(h.join(".cargo/bin/uv"));
    }
    candidates.push(PathBuf::from("uv"));
    for p in candidates {
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
pub async fn open_free_claude_code_admin() -> Result<(), String> {
    let status = build_status().await;
    let url = status.admin_url;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开 Admin UI 失败: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Err(format!("请手动在浏览器打开: {url}"));
    }
}

/// 将 `~/.fcc/.env` 中的代理地址与认证写入用户 `settings.json`，供 Wise / CLI 共用。
#[tauri::command]
pub async fn apply_free_claude_code_claude_settings() -> Result<bool, String> {
    tokio::task::spawn_blocking(apply_free_claude_code_claude_settings_sync)
        .await
        .map_err(|e| format!("同步任务被中断: {e}"))?
}

fn apply_free_claude_code_claude_settings_sync() -> Result<bool, String> {
    let fcc_env = parse_fcc_dotenv(&fcc_config_path());
    let port = fcc_port_from_env(&fcc_env);
    let base_url = fcc_base_url(port);
    let auth_token = fcc_env
        .get("ANTHROPIC_AUTH_TOKEN")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "~/.fcc/.env 中缺少 ANTHROPIC_AUTH_TOKEN".to_string())?;

    let settings_path = user_claude_dir().join("settings.json");
    std::fs::create_dir_all(user_claude_dir()).map_err(|e| e.to_string())?;

    let mut root: serde_json::Value = if settings_path.is_file() {
        let text = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let env = root
        .as_object_mut()
        .ok_or_else(|| "settings.json 根节点不是对象".to_string())?
        .entry("env")
        .or_insert_with(|| serde_json::json!({}));
    let env_obj = env
        .as_object_mut()
        .ok_or_else(|| "settings.json env 不是对象".to_string())?;

    env_obj.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        serde_json::Value::String(auth_token),
    );
    env_obj.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        serde_json::Value::String(base_url),
    );
    env_obj.insert(
        "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY".to_string(),
        serde_json::Value::String("1".to_string()),
    );
    env_obj.insert(
        "CLAUDE_CODE_AUTO_COMPACT_WINDOW".to_string(),
        serde_json::Value::String("190000".to_string()),
    );
    env_obj.remove("ANTHROPIC_API_KEY");

    let serialized = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    crate::wise_paths::write_file_atomic(&settings_path, &serialized)?;
    let _ = sanitize_claude_root_json_for_fcc_proxy();
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fcc_dotenv_ignores_comments() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(".env");
        std::fs::write(
            &path,
            "# comment\nPORT=9090\nANTHROPIC_AUTH_TOKEN=freecc\nMODEL=bailian_coding_plan/qwen\n",
        )
        .unwrap();
        let env = parse_fcc_dotenv(&path);
        assert_eq!(env.get("PORT").map(String::as_str), Some("9090"));
        assert_eq!(env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str), Some("freecc"));
        assert_eq!(
            env.get("MODEL").map(String::as_str),
            Some("bailian_coding_plan/qwen")
        );
    }

    #[test]
    fn is_local_fcc_matches_loopback() {
        assert!(is_local_fcc_proxy_base_url("http://localhost:8082"));
        assert!(is_local_fcc_proxy_base_url("http://127.0.0.1:8082"));
        assert!(!is_local_fcc_proxy_base_url("https://api.anthropic.com"));
    }

    #[test]
    fn command_looks_like_fcc_server_matches_binary_names() {
        assert!(command_looks_like_fcc_server(
            "/Users/x/.local/bin/fcc-server"
        ));
        assert!(command_looks_like_fcc_server(
            "python -m free_claude_code.server"
        ));
        assert!(!command_looks_like_fcc_server("node /tmp/other-proxy.js"));
    }
}
