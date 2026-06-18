//! Resolve `codex` CLI binary paths for GUI apps with a minimal inherited PATH.

use std::path::Path;

/// Enumerate likely `codex` paths (GUI apps often lack NVM/fnm on PATH).
pub(crate) fn codex_binary_candidates() -> Vec<String> {
    let out: Vec<String> = crate::claude_commands::claude_path_search_prefixes()
        .into_iter()
        .map(|dir| {
            #[cfg(windows)]
            {
                dir.join("codex.cmd").to_string_lossy().to_string()
            }
            #[cfg(not(windows))]
            {
                dir.join("codex").to_string_lossy().to_string()
            }
        })
        .collect();

    #[cfg(windows)]
    {
        let mut out = out;
        out.extend(
            crate::claude_commands::claude_path_search_prefixes()
                .into_iter()
                .map(|dir| dir.join("codex.exe").to_string_lossy().to_string()),
        );
        out
    }

    #[cfg(not(windows))]
    {
        out
    }
}

#[cfg(unix)]
fn try_codex_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v codex"]),
        ("/bin/bash", vec!["-lc", "command -v codex"]),
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

/// Finds the `codex` binary in common locations (works when packaged app has a narrow PATH).
pub(crate) fn find_codex_binary() -> Result<String, String> {
    for candidate in codex_binary_candidates() {
        if Path::new(&candidate).is_file() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    {
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("where")
            .arg("codex")
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
            .arg("codex")
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
        if let Some(p) = try_codex_from_login_shell() {
            return Ok(p);
        }
    }

    Err(
        "未找到 codex 可执行文件。请确认已安装 codex（npm install -g @openai/codex），\
并确保其位于 PATH，或安装在 /opt/homebrew/bin、/usr/local/bin、以及 nvm/fnm 的 node 版本 bin 目录下。"
            .to_string(),
    )
}

/// Merged PATH for codex child processes (prefix dirs + inherited PATH).
pub(crate) fn codex_merged_path_env() -> String {
    crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes())
}

/// Apply environment variables commonly missing from GUI-launched apps.
pub(crate) fn apply_codex_child_env(cmd: &mut tokio::process::Command, path_env: &str) {
    cmd.env("PATH", path_env);
    if let Some(home) = dirs::home_dir() {
        let home_s = home.to_string_lossy().to_string();
        if std::env::var("HOME")
            .map(|v| v.trim().is_empty())
            .unwrap_or(true)
        {
            cmd.env("HOME", &home_s);
        }
        if std::env::var("NVM_DIR")
            .map(|v| v.trim().is_empty())
            .unwrap_or(true)
        {
            let nvm = home.join(".nvm");
            if nvm.is_dir() {
                cmd.env("NVM_DIR", nvm);
            }
        }
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
    fn codex_candidates_include_homebrew_and_nvm_bins() {
        let candidates = codex_binary_candidates();
        assert!(candidates
            .iter()
            .any(|p| p.contains("/opt/homebrew/bin/codex") || p.contains("codex")));
    }

    #[test]
    fn merged_path_env_is_non_empty() {
        let path = codex_merged_path_env();
        assert!(!path.trim().is_empty());
    }
}
