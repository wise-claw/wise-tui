//! Resolve the DeepSeek Harness (`dsh`) CLI binary for GUI apps with a minimal inherited PATH.

use std::path::Path;
use std::sync::OnceLock;

static CACHED_DSH_BIN: OnceLock<String> = OnceLock::new();

pub(crate) fn dsh_binary_candidates() -> Vec<String> {
    let out: Vec<String> = crate::claude_commands::claude_path_search_prefixes()
        .into_iter()
        .map(|dir| {
            #[cfg(windows)]
            {
                dir.join("dsh.cmd").to_string_lossy().to_string()
            }
            #[cfg(not(windows))]
            {
                dir.join("dsh").to_string_lossy().to_string()
            }
        })
        .collect();

    #[cfg(windows)]
    {
        let mut out = out;
        out.extend(
            crate::claude_commands::claude_path_search_prefixes()
                .into_iter()
                .map(|dir| dir.join("dsh.exe").to_string_lossy().to_string()),
        );
        out
    }

    #[cfg(not(windows))]
    {
        out
    }
}

#[cfg(unix)]
fn try_dsh_from_login_shell() -> Option<String> {
    crate::login_shell_probe::find_in_login_shell("command -v dsh")
}

pub(crate) fn find_dsh_binary() -> Result<String, String> {
    if let Ok(from_env) = std::env::var("DSH_BIN") {
        let trimmed = from_env.trim();
        if !trimmed.is_empty() && Path::new(trimmed).is_file() {
            return Ok(trimmed.to_string());
        }
    }

    if let Some(cached) = CACHED_DSH_BIN.get() {
        if Path::new(cached).is_file() {
            return Ok(cached.clone());
        }
    }

    let resolved = find_dsh_binary_uncached()?;
    let _ = CACHED_DSH_BIN.set(resolved.clone());
    Ok(resolved)
}

fn find_dsh_binary_uncached() -> Result<String, String> {
    for candidate in dsh_binary_candidates() {
        if Path::new(&candidate).is_file() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    {
        let path_merged =
            crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes());
        if let Ok(output) = std::process::Command::new("where")
            .arg("dsh")
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
            .arg("dsh")
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
        if let Some(p) = try_dsh_from_login_shell() {
            return Ok(p);
        }
    }

    Err(
        "未找到 dsh（DeepSeek Harness）可执行文件。请先安装 DeepSeek Harness（npm install -g @deepseek-ai/dsh），\
并确保 dsh 位于 PATH，或通过 DSH_BIN 指定绝对路径。"
            .to_string(),
    )
}

pub(crate) fn dsh_merged_path_env() -> String {
    crate::claude_commands::merge_path_env(&crate::claude_commands::claude_path_search_prefixes())
}

pub(crate) fn apply_dsh_child_env(cmd: &mut tokio::process::Command, path_env: &str) {
    cmd.env("PATH", path_env);
    // 与 claude_commands 对齐：无条件设置 HOME，确保子进程有确定的家目录。
    if let Some(home) = dirs::home_dir() {
        let home_s = home.to_string_lossy().to_string();
        cmd.env("HOME", &home_s);
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
