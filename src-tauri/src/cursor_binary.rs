//! Resolve Cursor Agent CLI (`agent`) binary paths for GUI apps with a minimal inherited PATH.

use std::path::Path;
use std::sync::OnceLock;

static CACHED_CURSOR_AGENT_BIN: OnceLock<String> = OnceLock::new();

/// Enumerate likely `agent` paths (GUI apps often lack Homebrew/`~/.local/bin` on PATH).
pub(crate) fn cursor_agent_binary_candidates() -> Vec<String> {
    let mut out: Vec<String> = crate::claude_commands::claude_path_search_prefixes()
        .into_iter()
        .map(|dir| {
            #[cfg(windows)]
            {
                dir.join("agent.cmd").to_string_lossy().to_string()
            }
            #[cfg(not(windows))]
            {
                dir.join("agent").to_string_lossy().to_string()
            }
        })
        .collect();

    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".local/bin/agent").to_string_lossy().to_string());
        out.push(home.join(".cursor/bin/agent").to_string_lossy().to_string());
    }

    #[cfg(windows)]
    {
        out.extend(
            crate::claude_commands::claude_path_search_prefixes()
                .into_iter()
                .map(|dir| dir.join("agent.exe").to_string_lossy().to_string()),
        );
    }

    out
}

#[cfg(unix)]
fn try_agent_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v agent"]),
        ("/bin/bash", vec!["-lc", "command -v agent"]),
    ] {
        let output = std::process::Command::new(shell)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            continue;
        }
        let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !p.is_empty() && Path::new(&p).is_file() {
            return Some(p);
        }
    }
    None
}

/// Finds the Cursor `agent` CLI binary in common locations.
pub(crate) fn find_cursor_agent_binary() -> Result<String, String> {
    if let Ok(raw) = std::env::var("WISE_CURSOR_AGENT_BIN") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let path = Path::new(trimmed);
            if path.is_file() {
                return Ok(trimmed.to_string());
            }
            return Err(format!(
                "WISE_CURSOR_AGENT_BIN 指向的文件不存在: {trimmed}"
            ));
        }
    }

    if let Some(cached) = CACHED_CURSOR_AGENT_BIN.get() {
        if Path::new(cached).is_file() {
            return Ok(cached.clone());
        }
    }

    let resolved = find_cursor_agent_binary_uncached()?;
    let _ = CACHED_CURSOR_AGENT_BIN.set(resolved.clone());
    Ok(resolved)
}

fn find_cursor_agent_binary_uncached() -> Result<String, String> {
    for candidate in cursor_agent_binary_candidates() {
        if Path::new(&candidate).is_file() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    {
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("where")
            .arg("agent")
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
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("which")
            .arg("agent")
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
        if let Some(p) = try_agent_from_login_shell() {
            return Ok(p);
        }
    }

    Err(
        "未找到 Cursor Agent CLI（`agent`）。请安装：curl https://cursor.com/install -fsS | bash，\
并确保 `agent` 位于 PATH、~/.local/bin，或设置 WISE_CURSOR_AGENT_BIN。"
            .to_string(),
    )
}

pub(crate) fn cursor_merged_path_env() -> String {
    let mut prefixes = crate::claude_commands::claude_path_search_prefixes();
    if let Some(home) = dirs::home_dir() {
        prefixes.insert(0, home.join(".local/bin"));
        prefixes.insert(0, home.join(".cursor/bin"));
    }
    crate::claude_commands::merge_path_env(&prefixes)
}

pub(crate) fn apply_cursor_child_env(cmd: &mut tokio::process::Command, path_env: &str) {
    cmd.env("PATH", path_env);
    // GUI 进程偶发 HOME/USER 异常时，强制对齐到真实用户目录，确保能读到 `agent login` 凭证。
    if let Some(home) = dirs::home_dir() {
        let home_s = home.to_string_lossy().to_string();
        cmd.env("HOME", &home_s);
        if std::env::var("USER")
            .map(|v| v.trim().is_empty())
            .unwrap_or(true)
        {
            if let Some(user) = home.file_name().and_then(|s| s.to_str()) {
                cmd.env("USER", user);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_include_local_bin() {
        let candidates = cursor_agent_binary_candidates();
        assert!(candidates.iter().any(|p| p.ends_with("/agent") || p.contains("agent")));
    }

    #[test]
    fn merged_path_env_is_non_empty() {
        assert!(!cursor_merged_path_env().trim().is_empty());
    }
}
