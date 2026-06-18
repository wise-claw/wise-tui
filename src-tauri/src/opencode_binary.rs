//! Resolve `opencode` CLI binary paths for GUI apps with a minimal inherited PATH.

use std::path::Path;

pub(crate) fn opencode_binary_candidates() -> Vec<String> {
    let out: Vec<String> = crate::claude_commands::claude_path_search_prefixes()
        .into_iter()
        .map(|dir| {
            #[cfg(windows)]
            {
                dir.join("opencode.cmd").to_string_lossy().to_string()
            }
            #[cfg(not(windows))]
            {
                dir.join("opencode").to_string_lossy().to_string()
            }
        })
        .collect();

    #[cfg(windows)]
    {
        let mut out = out;
        out.extend(
            crate::claude_commands::claude_path_search_prefixes()
                .into_iter()
                .map(|dir| dir.join("opencode.exe").to_string_lossy().to_string()),
        );
        out
    }

    #[cfg(not(windows))]
    {
        out
    }
}

#[cfg(unix)]
fn try_opencode_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v opencode"]),
        ("/bin/bash", vec!["-lc", "command -v opencode"]),
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

pub(crate) fn find_opencode_binary() -> Result<String, String> {
    if let Ok(from_env) = std::env::var("OPENCODE_BIN") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() && Path::new(trimmed).is_file() {
            return Ok(trimmed.to_string());
        }
    }

    for candidate in opencode_binary_candidates() {
        if Path::new(&candidate).is_file() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    {
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("where")
            .arg("opencode")
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
            .arg("opencode")
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
        if let Some(p) = try_opencode_from_login_shell() {
            return Ok(p);
        }
    }

    Err(
        "未找到 opencode 可执行文件。请确认已安装 OpenCode（npm install -g opencode-ai），\
并确保其位于 PATH，或安装在 /opt/homebrew/bin、~/.opencode/bin 等常见目录下。"
            .to_string(),
    )
}

pub(crate) fn opencode_merged_path_env() -> String {
    crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes())
}

pub(crate) fn apply_opencode_child_env(cmd: &mut tokio::process::Command, path_env: &str) {
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
