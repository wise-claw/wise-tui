//! 在已有仓库根目录执行 `trellis init`，供 Wise「新建项目」可选内置 Trellis 脚手架。
//!
//! 优先使用本机 `trellis` CLI；若未安装则回退为 `npx --yes @mindfoldhq/trellis@latest init -y`（需 Node / npm）。

use crate::claude_commands::{claude_path_search_prefixes, merge_path_env};
use crate::claude_commands::shared::find_trellis_project_root_from_path;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// npm 包名：与全局 `trellis` CLI 等价入口，供 `npx` 在未全局安装时使用。
const TRELLIS_NPX_PACKAGE: &str = "@mindfoldhq/trellis@latest";

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
fn try_trellis_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v trellis"]),
        ("/bin/bash", vec!["-lc", "command -v trellis"]),
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

fn trellis_binary_candidates() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in claude_path_search_prefixes() {
        out.push(d.join("trellis"));
    }
    #[cfg(windows)]
    {
        if let Some(h) = dirs::home_dir() {
            out.push(h.join("AppData/Roaming/npm/trellis.cmd"));
            out.push(h.join("AppData/Roaming/npm/trellis.exe"));
        }
        out.push(PathBuf::from(r"C:\Program Files\nodejs\trellis.cmd"));
        out.push(PathBuf::from(r"C:\Program Files\nodejs\trellis.exe"));
    }
    out
}

fn find_trellis_cli_binary() -> Option<String> {
    for c in trellis_binary_candidates() {
        if c.is_file() {
            return Some(c.to_string_lossy().to_string());
        }
    }

    #[cfg(windows)]
    {
        let path_merged = merge_path_env(&claude_path_search_prefixes());
        if let Ok(output) = Command::new("where")
            .arg("trellis")
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
            .arg("trellis")
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
        if let Some(p) = try_trellis_from_login_shell() {
            return Some(p);
        }
    }

    None
}

/// 若 `repository_path` 及其祖先尚无 `.trellis/scripts/task.py`，则在仓库根执行 `trellis init -y`。
#[tauri::command]
pub fn bootstrap_trellis_if_missing(repository_path: String) -> Result<(), String> {
    let canon = validate_repository_root_for_bootstrap(&repository_path)?;
    let canon_str = canon.to_string_lossy().to_string();
    if find_trellis_project_root_from_path(&canon_str).is_some() {
        return Ok(());
    }
    let path_merged = merge_path_env(&claude_path_search_prefixes());
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let trellis_cli = find_trellis_cli_binary();
    let via_npx = trellis_cli.is_none();
    let out = match &trellis_cli {
        Some(bin) => Command::new(bin)
            .args(["init", "-y"])
            .current_dir(&canon)
            .env("PATH", &path_merged)
            .env("HOME", &home)
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("无法启动 trellis: {e}")),
        None => Command::new(npx_program())
            .arg("--yes")
            .arg(TRELLIS_NPX_PACKAGE)
            .args(["init", "-y"])
            .current_dir(&canon)
            .env("PATH", &path_merged)
            .env("HOME", &home)
            .env("npm_config_yes", "true")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| {
                format!(
                    "未找到本机 trellis，且无法启动 npx（{e}）。请安装 Node.js/npm，\
                    或安装 Trellis CLI 并加入 PATH（参见 https://trellis.dev/docs/install/）；\
                    从 .app 启动时可将 trellis / npx 置于 /opt/homebrew/bin、/usr/local/bin 或 nvm/fnm 的 node bin 目录。"
                )
            }),
    }?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let label = if via_npx {
        format!("npx {TRELLIS_NPX_PACKAGE}")
    } else {
        "trellis".to_string()
    };
    Err(format!(
        "{label} init 失败（退出码 {:?}）\n{}\n{}",
        out.status.code(),
        stderr,
        stdout
    ))
}
