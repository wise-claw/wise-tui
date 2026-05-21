//! 在工作区根目录执行 `openspec init`，供 Wise「新建工作区」可选内置 OpenSpec。
//!
//! 优先使用本机 `openspec` CLI；若未安装则回退为 `npx --yes @fission-ai/openspec@latest init`（需 Node / npm）。

use crate::claude_commands::{claude_path_search_prefixes, merge_path_env};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const OPENSPEC_NPX_PACKAGE: &str = "@fission-ai/openspec@latest";

fn npx_program() -> &'static str {
    #[cfg(windows)]
    {
        "npx.cmd"
    }
    #[cfg(not(windows))]
    {
        "npx"
    }
}

fn validate_repository_root_for_bootstrap(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("仓库路径为空".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.is_absolute() {
        return Err("仓库路径必须为绝对路径".to_string());
    }
    if !root.is_dir() {
        return Err("仓库目录不存在或不可访问".to_string());
    }
    fs::canonicalize(&root).map_err(|e| format!("无法解析仓库路径: {e}"))
}

#[cfg(unix)]
fn try_openspec_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v openspec"]),
        ("/bin/bash", vec!["-lc", "command -v openspec"]),
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

fn openspec_binary_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in claude_path_search_prefixes() {
        out.push(d.join("openspec"));
    }
    #[cfg(windows)]
    {
        if let Some(h) = dirs::home_dir() {
            out.push(h.join("AppData/Roaming/npm/openspec.cmd"));
            out.push(h.join("AppData/Roaming/npm/openspec.exe"));
        }
        out.push(PathBuf::from(r"C:\Program Files\nodejs\openspec.cmd"));
        out.push(PathBuf::from(r"C:\Program Files\nodejs\openspec.exe"));
    }
    out
}

fn find_openspec_cli_binary() -> Option<String> {
    for c in openspec_binary_candidates() {
        if c.is_file() {
            return Some(c.to_string_lossy().to_string());
        }
    }

    #[cfg(windows)]
    {
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        if let Ok(output) = Command::new("where")
            .arg("openspec")
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
                    return Some(line);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        if let Ok(output) = Command::new("which")
            .arg("openspec")
            .env("PATH", &path_merged)
            .output()
        {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() && Path::new(&p).is_file() {
                    return Some(p);
                }
            }
        }
        if let Some(p) = try_openspec_from_login_shell() {
            return Some(p);
        }
    }

    None
}

fn openspec_initialized_at_exact(root: &Path) -> bool {
    root.join(".openspec").is_dir()
}

/// If `repository_path` has no `.openspec/`, run `openspec init` with Claude tooling preset.
#[tauri::command]
pub fn bootstrap_openspec_if_missing(repository_path: String) -> Result<(), String> {
    let canon = validate_repository_root_for_bootstrap(&repository_path)?;
    if openspec_initialized_at_exact(&canon) {
        return Ok(());
    }
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let openspec_cli = find_openspec_cli_binary();
    let via_npx = openspec_cli.is_none();
    let init_args: Vec<&str> = vec!["init", "--tools", "claude", "--force"];
    let out = match &openspec_cli {
        Some(bin) => Command::new(bin)
            .args(&init_args)
            .current_dir(&canon)
            .env("PATH", &path_merged)
            .env("HOME", &home)
            .env("CI", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .map_err(|e| format!("无法启动 openspec: {e}")),
        None => Command::new(npx_program())
            .arg("--yes")
            .arg(OPENSPEC_NPX_PACKAGE)
            .args(&init_args)
            .current_dir(&canon)
            .env("PATH", &path_merged)
            .env("HOME", &home)
            .env("CI", "1")
            .env("npm_config_yes", "true")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .map_err(|e| {
                format!(
                    "未找到本机 openspec，且无法启动 npx（{e}）。请安装 Node.js/npm，\
                    或全局安装 @fission-ai/openspec 并加入 PATH。"
                )
            }),
    }?;
    if out.status.success() || openspec_initialized_at_exact(&canon) {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let label = if via_npx {
        format!("npx {OPENSPEC_NPX_PACKAGE}")
    } else {
        "openspec".to_string()
    };
    Err(format!(
        "{label} init 失败（退出码 {:?}）\n{stderr}\n{stdout}",
        out.status.code()
    ))
}
