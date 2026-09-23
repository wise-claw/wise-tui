//! Run arbitrary `claude` CLI subcommands (non-interactive) from Wise IPC.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::cli_probe::{blocking_output_with_timeout, CaptureError};
use super::{claude_path_search_prefixes, find_claude_binary, merge_path_env};
use super::shared::canonicalize_existing_project_dir;

const DEFAULT_CLI_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_CLI_TIMEOUT: Duration = Duration::from_secs(600);

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())
}

fn resolve_cwd(repository_path: Option<&str>) -> Result<PathBuf, String> {
    let home = home_dir()?;
    Ok(canonicalize_existing_project_dir(repository_path).unwrap_or(home))
}

fn resolve_cli_timeout(timeout_ms: Option<u64>) -> Duration {
    let Some(ms) = timeout_ms.filter(|v| *v > 0) else {
        return DEFAULT_CLI_TIMEOUT;
    };
    Duration::from_millis(ms.min(MAX_CLI_TIMEOUT.as_millis() as u64))
}

fn run_claude_cli_in(
    home: &Path,
    cwd: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let bin = find_claude_binary()?;
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let mut cmd = Command::new(&bin);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", &path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .env("CI", "1");
    let output = match blocking_output_with_timeout(&mut cmd, timeout) {
        Ok(output) => output,
        Err(CaptureError::Io(e)) => return Err(format!("无法启动 claude: {}", e)),
        Err(CaptureError::TimedOut) => return Err(format!("claude 命令超时（>{timeout:?}）")),
    };
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(if stdout.is_empty() { stderr } else { stdout });
    }
    Err(format!(
        "claude 命令失败（退出码 {:?}）\n{stderr}\n{stdout}",
        output.status.code()
    ))
}

/// Run `claude <args...>` in project cwd (or home). For `doctor`, `mcp list`, etc.
#[tauri::command]
pub async fn run_claude_cli_command(
    args: Vec<String>,
    repository_path: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    if args.is_empty() {
        return Err("claude 子命令参数为空".to_string());
    }
    let argv: Vec<String> = args
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if argv.is_empty() {
        return Err("claude 子命令参数为空".to_string());
    }
    let timeout = resolve_cli_timeout(timeout_ms);
    let repo = repository_path;
    tokio::task::spawn_blocking(move || {
        let home = home_dir()?;
        let cwd = resolve_cwd(repo.as_deref())?;
        let arg_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
        run_claude_cli_in(&home, &cwd, &arg_refs, timeout)
    })
    .await
    .map_err(|e| format!("run_claude_cli_command: {e}"))?
}
