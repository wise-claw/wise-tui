//! macOS Computer Use：解析 / 安装 [cua-driver](https://github.com/trycua/cua)（官方 install.sh）。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

const INSTALL_SCRIPT_URL: &str =
    "https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh";
const BUNDLE_BINARY: &str = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CuaDriverStatus {
    pub platform_macos: bool,
    /// 已找到可执行的 `cua-driver`（PATH 或常见路径）。
    pub installed: bool,
    pub resolved_path: Option<String>,
    /// `cua-driver --version` 首行，失败则为 null。
    pub version_line: Option<String>,
    pub hint: String,
}

fn is_macos() -> bool {
    cfg!(target_os = "macos")
}

fn file_executable(p: &Path) -> bool {
    p.is_file() && {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::metadata(p)
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}

fn try_which_cua_driver() -> Option<PathBuf> {
    let out = Command::new("/usr/bin/which")
        .arg("cua-driver")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        return None;
    }
    let p = PathBuf::from(s);
    if file_executable(&p) {
        Some(p)
    } else {
        None
    }
}

/// 优先 PATH，其次常见安装位置（安装脚本默认 `~/.local/bin` + `/Applications/...`）。
pub fn resolve_cua_driver_executable() -> Option<PathBuf> {
    if !is_macos() {
        return None;
    }
    if let Some(p) = try_which_cua_driver() {
        return Some(p);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = dirs::home_dir() {
        candidates.push(h.join(".local/bin/cua-driver"));
    }
    candidates.push(PathBuf::from("/usr/local/bin/cua-driver"));
    candidates.push(PathBuf::from(BUNDLE_BINARY));
    for p in candidates {
        if file_executable(&p) {
            return Some(p);
        }
    }
    None
}

fn parse_version_output(out: &std::process::Output) -> Option<String> {
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    line.or_else(|| {
        String::from_utf8_lossy(&out.stderr)
            .lines()
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

async fn read_version_line_async(bin: &Path) -> Option<String> {
    match tokio::time::timeout(
        Duration::from_secs(4),
        tokio::process::Command::new(bin)
            .kill_on_drop(true)
            .arg("--version")
            .output(),
    )
    .await
    {
        Ok(Ok(out)) => parse_version_output(&out),
        _ => None,
    }
}

/// 安装子进程使用「干净 PATH + 非登录 shell」，避免从 Dock 启动时 `bash -lc` 执行用户 `.zshrc`（nvm/conda 等）导致长时间阻塞或卡死。
fn default_path_for_install_subprocess() -> String {
    let base = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin";
    match std::env::var("PATH") {
        Ok(p) if !p.trim().is_empty() => format!("{}:{}", base, p),
        _ => base.to_string(),
    }
}

#[tauri::command]
pub async fn get_cua_driver_status() -> Result<CuaDriverStatus, String> {
    if !is_macos() {
        return Ok(CuaDriverStatus {
            platform_macos: false,
            installed: false,
            resolved_path: None,
            version_line: None,
            hint: "cua-driver 仅支持 macOS（后台注入事件）。".to_string(),
        });
    }
    let resolved = tokio::task::spawn_blocking(|| resolve_cua_driver_executable())
        .await
        .map_err(|e| format!("检测 cua-driver 时被中断: {}", e))?;
    let installed = resolved.is_some();
    let resolved_path = resolved.as_ref().map(|p| p.to_string_lossy().to_string());
    let version_line = match &resolved {
        Some(p) => read_version_line_async(p).await,
        None => None,
    };
    let hint = if installed {
        "首次使用请在「系统设置 → 隐私与安全性」中为 Wise（或终端）开启「辅助功能」与「屏幕录制」，并可运行 `cua-driver check_permissions` 自检。"
            .to_string()
    } else {
        "尚未检测到 cua-driver。可点击「安装」自动执行官方 install.sh 并注册 MCP。安装后需授予辅助功能 / 屏幕录制。"
            .to_string()
    };
    Ok(CuaDriverStatus {
        platform_macos: true,
        installed,
        resolved_path,
        version_line,
        hint,
    })
}

/// 拉取并执行官方 install.sh（无 sudo；默认不改 PATH，避免从 GUI 启动时写 shell 配置）。
#[tauri::command]
pub async fn install_cua_driver() -> Result<String, String> {
    if !is_macos() {
        return Err("install_cua_driver 仅支持 macOS".to_string());
    }
    let script = format!(
        "set -euo pipefail; curl -fsSL --connect-timeout 30 --max-time 900 \"{url}\" | bash -s -- --no-modify-path",
        url = INSTALL_SCRIPT_URL
    );
    let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
    let home_s = home.to_string_lossy().to_string();
    let path_env = default_path_for_install_subprocess();

    let out = tokio::task::spawn_blocking(move || {
        Command::new("/bin/bash")
            .arg("-c")
            .arg(&script)
            .env("HOME", &home_s)
            .env("CUA_DRIVER_NO_MODIFY_PATH", "1")
            .env("PATH", &path_env)
            .output()
    })
    .await
    .map_err(|e| format!("安装任务被中断: {}", e))?
    .map_err(|e| format!("无法执行安装脚本: {}", e))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let combined = format!(
        "{}{}",
        stdout,
        if stderr.is_empty() {
            String::new()
        } else {
            format!("\n--- stderr ---\n{}", stderr)
        }
    );
    if out.status.success() {
        Ok(combined.trim().to_string())
    } else {
        Err(format!(
            "cua-driver 安装失败（退出码 {:?}）\n{}",
            out.status.code(),
            combined.trim()
        ))
    }
}

/// 打开「系统设置 → 隐私与安全性」子项。使用 `/usr/bin/open`，不经由 opener 插件（`opener:default` 不允许 `x-apple.*` URL）。
#[tauri::command]
pub fn macos_open_privacy_pane(pane: String) -> Result<(), String> {
    if !is_macos() {
        return Err("仅 macOS 支持".to_string());
    }
    let url = match pane.trim() {
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        "screenCapture" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        other => {
            return Err(format!(
                "未知面板「{}」；仅支持 accessibility、screenCapture",
                other
            ));
        }
    };
    let status = Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|e| format!("无法执行 /usr/bin/open: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open 未成功（退出码 {:?}）", status.code()))
    }
}
