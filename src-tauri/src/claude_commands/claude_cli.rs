//! Run arbitrary `claude` CLI subcommands (non-interactive) from Wise IPC.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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
    let mut child = Command::new(&bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", &path_merged)
        .env("HOME", home.to_string_lossy().to_string())
        .env("CI", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 claude: {}", e))?;

    let start = Instant::now();
    loop {
        match child
            .try_wait()
            .map_err(|e| format!("等待 claude 子进程失败: {e}"))?
        {
            Some(status) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stdout.take() {
                    let _ = pipe.read_to_string(&mut stdout);
                }
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                let stdout = stdout.trim().to_string();
                let stderr = stderr.trim().to_string();
                if status.success() {
                    return Ok(if stdout.is_empty() { stderr } else { stdout });
                }
                return Err(format!(
                    "claude 命令失败（退出码 {:?}）\n{stderr}\n{stdout}",
                    status.code()
                ));
            }
            None => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("claude 命令超时（>{timeout:?}）"));
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
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
