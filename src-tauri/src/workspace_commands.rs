use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_opener::OpenerExt;

fn user_claude_agents_dir() -> Result<PathBuf, String> {
    Ok(crate::claude_config_dir::user_claude_dir().join("agents"))
}

#[tauri::command]
pub(crate) fn open_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn open_claude_user_agents_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = user_claude_agents_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.to_string_lossy().to_string();
    app.opener()
        .open_path(&p, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn get_claude_user_agents_dir() -> Result<String, String> {
    let dir = user_claude_agents_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// macOS：`open` 失败时仍可能返回 `Ok` 给 invoke（此前未检查退出码）；WPS 营销名与 `-a` 所需名不一致。
#[cfg(target_os = "macos")]
fn macos_open_with_named_app(path: &Path, app_name: &str, args: &[String]) -> Result<(), String> {
    let mut last_stderr = String::new();

    let mut run_open = |cmd: &mut std::process::Command| -> bool {
        match cmd.output() {
            Ok(out) => {
                if out.status.success() {
                    return true;
                }
                let s = String::from_utf8_lossy(&out.stderr).trim().to_string();
                if !s.is_empty() {
                    last_stderr = s;
                }
                false
            }
            Err(e) => {
                last_stderr = e.to_string();
                false
            }
        }
    };

    // WPS：常见安装为 `wpsoffice.app`，Bundle ID 多为 `com.kingsoft.wpsoffice.mac`（国区/国际略有差异）
    if app_name.eq_ignore_ascii_case("WPS Office") || app_name.eq_ignore_ascii_case("wpsoffice") {
        for bid in [
            "com.kingsoft.wpsoffice.mac",
            "com.kingsoft.wpsoffice.mac.global",
        ] {
            let mut c = std::process::Command::new("open");
            c.arg("-b").arg(bid).arg(path).args(args);
            if run_open(&mut c) {
                return Ok(());
            }
        }
        for an in ["wpsoffice", "WPS Office"] {
            let mut c = std::process::Command::new("open");
            c.arg("-a").arg(an).arg(path).args(args);
            if run_open(&mut c) {
                return Ok(());
            }
        }
        return Err(if last_stderr.is_empty() {
            "无法用 WPS 打开该文件，请确认已安装 WPS Office，或改用「用默认应用打开」。".to_string()
        } else {
            format!("无法用 WPS 打开：{last_stderr}")
        });
    }

    // Microsoft Word：优先显示名，失败再按 Bundle ID
    if app_name.eq_ignore_ascii_case("Microsoft Word") {
        let mut c = std::process::Command::new("open");
        c.arg("-a").arg("Microsoft Word").arg(path).args(args);
        if run_open(&mut c) {
            return Ok(());
        }
        let mut c = std::process::Command::new("open");
        c.arg("-b").arg("com.microsoft.Word").arg(path).args(args);
        if run_open(&mut c) {
            return Ok(());
        }
        return Err(if last_stderr.is_empty() {
            "无法用 Microsoft Word 打开，请确认已安装 Word，或改用「用默认应用打开」。".to_string()
        } else {
            format!("无法用 Microsoft Word 打开：{last_stderr}")
        });
    }

    let mut c = std::process::Command::new("open");
    c.arg("-a").arg(app_name).arg(path).args(args);
    if run_open(&mut c) {
        return Ok(());
    }
    Err(if last_stderr.is_empty() {
        format!("无法使用「{app_name}」打开该文件。")
    } else {
        format!("无法使用「{app_name}」打开：{last_stderr}")
    })
}

#[tauri::command]
pub(crate) fn open_workspace_in(
    app: tauri::AppHandle,
    path: String,
    app_name: Option<String>,
    command: Option<String>,
    args: Vec<String>,
) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if let Some(name) = app_name {
        #[cfg(target_os = "macos")]
        {
            return macos_open_with_named_app(path_buf.as_path(), name.trim(), &args);
        }
        #[cfg(target_os = "windows")]
        {
            let path_str = path_buf.to_string_lossy().to_string();
            let status = std::process::Command::new("cmd")
                .args(["/C", "start", "", name.trim(), &path_str])
                .status()
                .map_err(|e| format!("打开失败: {e}"))?;
            if !status.success() {
                return Err(format!(
                    "无法使用「{}」打开文件（退出码 {:?}）。请确认已安装该应用，或改用默认应用。",
                    name.trim(),
                    status.code()
                ));
            }
            return Ok(());
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = path_buf;
            let _ = args;
            return Err(format!(
                "指定应用「{}」打开：当前桌面环境请使用「用默认应用打开」",
                name.trim()
            ));
        }
    }

    if let Some(cmd) = command {
        let out = std::process::Command::new(&cmd)
            .arg(&path_buf)
            .args(&args)
            .output()
            .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(if err.is_empty() {
                format!("命令「{}」执行失败（退出码 {:?}）", cmd, out.status.code())
            } else {
                format!("命令「{}」失败：{}", cmd, err)
            });
        }
        return Ok(());
    }

    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|e| e.to_string())
}

// ── File Watcher ──

pub(crate) struct GitWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_path: Option<String>,
}

impl GitWatcherState {
    pub(crate) fn new() -> Self {
        Self {
            watcher: None,
            watched_path: None,
        }
    }
}

#[tauri::command]
pub(crate) fn start_git_watcher(
    state: tauri::State<Mutex<GitWatcherState>>,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;

    // If already watching the same path, skip
    if let Some(ref watched) = state.watched_path {
        if *watched == path {
            return Ok(());
        }
    }

    // Stop existing watcher if any
    state.watcher = None;
    state.watched_path = None;

    let project_path = PathBuf::from(&path);
    let git_path = project_path.join(".git");

    // Build list of paths to watch: project root + .git (if it exists)
    let mut watch_paths: Vec<PathBuf> = Vec::new();
    if project_path.exists() {
        watch_paths.push(project_path.clone());
    }
    if git_path.exists() {
        watch_paths.push(git_path);
    }

    if watch_paths.is_empty() {
        return Ok(());
    }

    let app_handle = app.clone();
    let mut watcher: RecommendedWatcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                // Only care about modify/create/remove events
                let is_relevant =
                    event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove();
                if is_relevant {
                    let _ = app_handle.emit("git-changed", &());
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    for watch_path in watch_paths {
        let _ = watcher.watch(&watch_path, RecursiveMode::Recursive);
    }

    state.watcher = Some(watcher);
    state.watched_path = Some(path);

    Ok(())
}

#[tauri::command]
pub(crate) fn stop_git_watcher(state: tauri::State<Mutex<GitWatcherState>>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.watcher = None;
    state.watched_path = None;
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ShellCommandResponse {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

/// Execute a shell command in the given directory.
#[tauri::command]
pub(crate) fn run_shell_command(
    path: String,
    command: String,
) -> Result<ShellCommandResponse, String> {
    let output = Command::new("zsh")
        .arg("-c")
        .arg(&command)
        .current_dir(&path)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    Ok(ShellCommandResponse {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}
