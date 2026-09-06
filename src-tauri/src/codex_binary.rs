//! Resolve `codex` CLI binary paths for GUI apps with a minimal inherited PATH.

use std::path::Path;
#[cfg(unix)]
use std::sync::OnceLock;
#[cfg(unix)]
use std::time::{Duration, Instant};

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

/// 缓存登录环境选择的路径（升级时同路径/symlink 仍会指向新版本），避免每轮启动 shell。
#[cfg(unix)]
static LOGIN_SHELL_CODEX: OnceLock<Option<String>> = OnceLock::new();

#[cfg(unix)]
fn try_codex_from_login_shell() -> Option<String> {
    for (shell, args) in [
        ("/bin/zsh", vec!["-l", "-c", "command -v codex"]),
        ("/bin/bash", vec!["-lc", "command -v codex"]),
    ] {
        let Ok(mut child) = std::process::Command::new(shell)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        else {
            continue;
        };
        // 用户的 shell 初始化可能等待网络/交互；探测必须有界，超时继续常见路径兜底。
        let deadline = Instant::now() + Duration::from_secs(2);
        let completed = loop {
            match child.try_wait() {
                Ok(Some(_)) => break true,
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => break false,
            }
        };
        if !completed {
            let _ = child.kill();
            let _ = child.wait();
            continue;
        }
        let Ok(output) = child.wait_with_output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        // 忽略 shell 启动横幅，只接受实际存在且可执行的绝对路径。
        if let Some(path) = String::from_utf8_lossy(&output.stdout)
            .lines()
            .rev()
            .map(str::trim)
            .find(|path| Path::new(path).is_absolute() && is_codex_executable(path))
        {
            return Some(path.to_string());
        }
    }
    None
}

fn is_codex_executable(path: &str) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn select_codex_binary(preferred: Option<&str>, candidates: &[String]) -> Option<String> {
    preferred
        .into_iter()
        .chain(candidates.iter().map(String::as_str))
        .find(|path| is_codex_executable(path))
        .map(str::to_owned)
}

#[cfg(unix)]
fn local_bin_codex(home: &Path) -> Option<String> {
    let path = home.join(".local/bin/codex").to_string_lossy().into_owned();
    is_codex_executable(&path).then_some(path)
}

/// Finds the `codex` binary in common locations (works when packaged app has a narrow PATH).
pub(crate) fn find_codex_binary() -> Result<String, String> {
    // 用户 bin 安装最高优先级；每次检查 symlink，升级后无需等待 shell 路径缓存刷新。
    #[cfg(unix)]
    if let Some(path) = dirs::home_dir().as_deref().and_then(local_bin_codex) {
        return Ok(path);
    }

    // GUI 进程的 PATH 往往不完整；先尊重用户登录环境里的选择，再扫描安装目录。
    // 否则 /opt/homebrew/bin 的旧版本会遮蔽 ~/.local/bin 中已升级的 Codex。
    #[cfg(unix)]
    let preferred = LOGIN_SHELL_CODEX
        .get_or_init(try_codex_from_login_shell)
        .as_deref();
    #[cfg(not(unix))]
    let preferred = None;
    if let Some(path) = select_codex_binary(preferred, &codex_binary_candidates()) {
        return Ok(path);
    }

    #[cfg(windows)]
    {
        let path_merged = crate::claude_commands::merge_path_env(
            &crate::claude_commands::claude_path_search_prefixes(),
        );
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
                if !line.is_empty() && is_codex_executable(&line) {
                    return Ok(line);
                }
            }
        }
    }

    #[cfg(not(windows))]
    {
        let path_merged = crate::claude_commands::merge_path_env(
            &crate::claude_commands::claude_path_search_prefixes(),
        );
        if let Ok(output) = std::process::Command::new("which")
            .arg("codex")
            .env("PATH", &path_merged)
            .output()
        {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() && is_codex_executable(&p) {
                    return Ok(p);
                }
            }
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

    #[cfg(unix)]
    fn test_binary(dir: &Path, name: &str, executable: bool) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(
            &path,
            std::fs::Permissions::from_mode(if executable { 0o755 } else { 0o644 }),
        )
        .unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    #[cfg(unix)]
    fn login_shell_choice_precedes_stale_common_installation() {
        let dir = tempfile::tempdir().unwrap();
        let selected = test_binary(dir.path(), "codex-current", true);
        let stale = test_binary(dir.path(), "codex-homebrew", true);
        assert_eq!(
            select_codex_binary(Some(&selected), &[stale]),
            Some(selected)
        );
    }

    #[test]
    #[cfg(unix)]
    fn unavailable_login_choice_falls_back_to_executable_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing").to_string_lossy().into_owned();
        let non_executable = test_binary(dir.path(), "codex-broken", false);
        let usable = test_binary(dir.path(), "codex-usable", true);
        let candidates = vec![
            dir.path().to_string_lossy().into_owned(),
            non_executable,
            usable.clone(),
        ];
        assert_eq!(
            select_codex_binary(Some(&missing), &candidates),
            Some(usable)
        );
        assert_eq!(select_codex_binary(None, &[]), None);
    }

    #[test]
    #[cfg(unix)]
    fn selected_symlink_is_preserved_for_future_upgrades() {
        let dir = tempfile::tempdir().unwrap();
        let target = test_binary(dir.path(), "codex-version", true);
        let link = dir.path().join("codex");
        std::os::unix::fs::symlink(target, &link).unwrap();
        let selected = link.to_string_lossy().into_owned();
        assert_eq!(select_codex_binary(Some(&selected), &[]), Some(selected));
    }

    #[test]
    #[cfg(unix)]
    fn user_local_bin_is_used_when_executable() {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let codex = test_binary(&bin, "codex", true);
        assert_eq!(local_bin_codex(home.path()), Some(codex));
    }

    #[test]
    #[cfg(unix)]
    fn unavailable_user_local_bin_allows_fallback() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(local_bin_codex(home.path()), None);
        let bin = home.path().join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        test_binary(&bin, "codex", false);
        assert_eq!(local_bin_codex(home.path()), None);
    }
}
