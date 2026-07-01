use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
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
    // macOS `open -a App` 可能因授权弹窗而卡住，使用 spawn 避免阻塞 Tauri IPC。
    let run_open = |cmd: &mut std::process::Command| -> bool {
        cmd.spawn().map(|_| true).unwrap_or(false)
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
        return Err("无法用 WPS 打开该文件，请确认已安装 WPS Office，或改用「用默认应用打开」。".to_string());
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
        return Err("无法用 Microsoft Word 打开，请确认已安装 Word，或改用「用默认应用打开」。".to_string());
    }

    let mut c = std::process::Command::new("open");
    c.arg("-a").arg(app_name).arg(path).args(args);
    if run_open(&mut c) {
        return Ok(());
    }
    Err(format!("无法使用「{app_name}」打开该文件。"))
}

fn is_skipped_binary_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "ico"
            | "icns"
            | "woff"
            | "woff2"
            | "ttf"
            | "eot"
            | "zip"
            | "gz"
            | "tgz"
            | "rar"
            | "7z"
            | "pdf"
            | "wasm"
            | "so"
            | "dylib"
            | "dll"
            | "exe"
            | "jar"
            | "class"
            | "o"
            | "a"
            | "mp3"
            | "mp4"
            | "mov"
            | "avi"
            | "lock"
    )
}

/// 在目录下 BFS 找第一个「像源码」的普通文件，供 `code 仓库 -g 文件:1:1` 在整仓上下文中打开并靠近该目录。
fn first_source_like_file_under(
    dir: &Path,
    max_dirs_visited: usize,
    max_file_checks: usize,
) -> Option<PathBuf> {
    let mut queue: VecDeque<PathBuf> = VecDeque::new();
    queue.push_back(dir.to_path_buf());
    let mut dirs_visited = 0usize;
    let mut file_checks = 0usize;

    while let Some(d) = queue.pop_front() {
        if !d.is_dir() {
            continue;
        }
        dirs_visited += 1;
        if dirs_visited > max_dirs_visited {
            break;
        }

        let mut subdirs: Vec<PathBuf> = Vec::new();
        let mut files: Vec<PathBuf> = Vec::new();
        let Ok(rd) = fs::read_dir(&d) else {
            continue;
        };
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                subdirs.push(p);
            } else if p.is_file() {
                files.push(p);
            }
        }
        files.sort();
        for f in files {
            file_checks += 1;
            if file_checks > max_file_checks {
                return None;
            }
            if is_skipped_binary_extension(&f) {
                continue;
            }
            return Some(f);
        }
        subdirs.sort();
        for sd in subdirs {
            queue.push_back(sd);
        }
    }
    None
}

fn is_vscode_family_cli(cmd: &str) -> bool {
    let base = Path::new(cmd)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(cmd)
        .trim_end_matches(".exe")
        .trim_end_matches(".cmd")
        .trim_end_matches(".AppImage")
        .to_ascii_lowercase();
    matches!(
        base.as_str(),
        "code" | "cursor" | "codium" | "qoder" | "trae"
    )
}

fn app_name_to_vscode_cli(app_name: &str) -> Option<&'static str> {
    let lower = app_name.trim().to_ascii_lowercase();
    if lower.contains("cursor") {
        return Some("cursor");
    }
    if lower.contains("visual studio code") || lower == "vscode" {
        return Some("code");
    }
    if lower.contains("codium") || lower.contains("vscodium") {
        return Some("codium");
    }
    if lower.contains("qoder") {
        return Some("qoder");
    }
    if lower.contains("trae") {
        return Some("trae");
    }
    None
}

fn vscode_family_cli_on_path(cli: &str) -> bool {
    #[cfg(windows)]
    {
        return std::process::Command::new("where")
            .arg(cli)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    }
    #[cfg(not(windows))]
    {
        return std::process::Command::new("which")
            .arg(cli)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
    }
}

#[cfg(target_os = "macos")]
fn macos_bundle_vscode_cli(cli: &str) -> Option<PathBuf> {
    let candidates: &[&str] = match cli {
        "code" => &[
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
            "/Applications/Code.app/Contents/Resources/app/bin/code",
        ],
        "cursor" => &["/Applications/Cursor.app/Contents/Resources/app/bin/cursor"],
        "codium" => &["/Applications/VSCodium.app/Contents/Resources/app/bin/codium"],
        _ => return None,
    };
    for p in candidates {
        let path = PathBuf::from(p);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn windows_bundle_vscode_cli(cli: &str) -> Option<PathBuf> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let base = PathBuf::from(local);
    let candidates: Vec<PathBuf> = match cli {
        "code" => vec![
            base.join("Programs/Microsoft VS Code/bin/code.cmd"),
            base.join("Programs/Microsoft VS Code/bin/code.exe"),
        ],
        "cursor" => vec![
            base.join("Programs/cursor/resources/app/bin/cursor.cmd"),
            base.join("Programs/Cursor/resources/app/bin/cursor.cmd"),
        ],
        "codium" => vec![base.join("Programs/VSCodium/bin/codium.cmd")],
        _ => return None,
    };
    candidates.into_iter().find(|p| p.is_file())
}

/// 解析 VS Code 系 CLI 可执行文件（PATH → macOS/Windows 应用 bundle 内置 bin）
fn resolve_vscode_family_cli(cli: &str) -> Option<PathBuf> {
    let direct = PathBuf::from(cli);
    if direct.is_file() {
        return Some(direct);
    }
    if vscode_family_cli_on_path(cli) {
        return Some(PathBuf::from(cli));
    }
    #[cfg(target_os = "macos")]
    {
        if let Some(p) = macos_bundle_vscode_cli(cli) {
            return Some(p);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(p) = windows_bundle_vscode_cli(cli) {
            return Some(p);
        }
    }
    None
}

/// 在已打开/新窗口中以仓库为工作区并 `-g` 到目标文件（搜索、图谱文件节点）
fn run_vscode_family_cli_repo_goto(
    cmd: &Path,
    root_canon: &Path,
    goto_arg: &str,
    _file_abs: &Path,
    args: &[String],
) -> Result<(), String> {
    // 使用 spawn 避免 CLI 阻塞 Tauri IPC 导致 webview 重载。
    let mut child = std::process::Command::new(cmd);
    child
        .arg("-r")
        .arg(root_canon)
        .arg("-g")
        .arg(goto_arg)
        .args(args);
    child.spawn().map_err(|e| {
        format!(
            "无法启动「{}」：{}。请在编辑器中执行 Shell Command: Install '{}' command in PATH。",
            cmd.display(),
            e,
            cmd.display(),
        )
    })?;
    Ok(())
}

fn open_ide_file_with_vscode_cli(
    cli: &str,
    root_canon: &Path,
    goto_arg: &str,
    file_abs: &Path,
    args: &[String],
) -> Result<(), String> {
    let exe = resolve_vscode_family_cli(cli).ok_or_else(|| {
        format!(
            "未找到「{cli}」命令行工具。请在编辑器中执行 Shell Command: Install '{cli}' command in PATH，或确认已安装对应应用。"
        )
    })?;
    run_vscode_family_cli_repo_goto(&exe, root_canon, goto_arg, file_abs, args)
}

/// `path` 为仓库根、`relative` 为仓库内相对路径 → (canonical root, canonical file)
fn resolve_repo_relative_file(
    root_buf: &Path,
    relative: &str,
) -> Result<(PathBuf, PathBuf), String> {
    if !root_buf.is_dir() {
        return Err("ideGotoRelative 要求 path 为仓库根目录".to_string());
    }
    let root_canon = fs::canonicalize(root_buf).unwrap_or_else(|_| root_buf.to_path_buf());
    let rel_norm = relative.replace('\\', "/");
    let file_buf = root_canon.join(rel_norm.trim_start_matches('/'));
    let file_abs = match fs::canonicalize(&file_buf) {
        Ok(p) => p,
        Err(_) => file_buf.clone(),
    };
    if !file_abs.starts_with(&root_canon) {
        return Err("目标文件不在仓库根路径之下".to_string());
    }
    if !file_abs.is_file() {
        return Err(format!("文件不存在: {}", file_abs.display()));
    }
    Ok((root_canon, file_abs))
}

/// `graph_ide_folder_relative`：打开仓库内相对目录时，`path` 为仓库根、本字段为相对目录，VS Code 系 CLI 使用 `cursor 根 -g 目录下源文件:1:1`。
/// `ide_goto_relative`：文件搜索等场景，`path` 为仓库根、本字段为要选中的相对文件，VS Code 系使用 `cursor 根 -g 文件:行:列`。
#[allow(unused_variables)] // goto_* 仅在 command 且 code 系 CLI 分支使用
#[tauri::command]
pub(crate) fn open_workspace_in(
    app: tauri::AppHandle,
    path: String,
    app_name: Option<String>,
    command: Option<String>,
    args: Vec<String>,
    goto_line: Option<u32>,
    goto_column: Option<u32>,
    graph_ide_folder_relative: Option<String>,
    ide_goto_relative: Option<String>,
) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    let ide_file_rel = ide_goto_relative
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "." && *s != "/");

    if let Some(rel) = ide_file_rel {
        let (root_canon, file_abs) = resolve_repo_relative_file(&path_buf, rel)?;
        let line = goto_line.unwrap_or(1).max(1);
        let col = goto_column.unwrap_or(1).max(1);
        let goto_arg = format!("{}:{}:{}", file_abs.to_string_lossy(), line, col);

        if let Some(cmd) = command.clone() {
            if is_vscode_family_cli(&cmd) {
                return open_ide_file_with_vscode_cli(&cmd, &root_canon, &goto_arg, &file_abs, &args);
            }
            let out = std::process::Command::new(&cmd)
                .arg(&root_canon)
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

        if let Some(name) = app_name.clone() {
            if let Some(cli) = app_name_to_vscode_cli(name.trim()) {
                return open_ide_file_with_vscode_cli(cli, &root_canon, &goto_arg, &file_abs, &args);
            }
            #[cfg(target_os = "macos")]
            {
                return macos_open_with_named_app(root_canon.as_path(), name.trim(), &args);
            }
            #[cfg(target_os = "windows")]
            {
                let path_str = root_canon.to_string_lossy().to_string();
                let status = std::process::Command::new("cmd")
                    .args(["/C", "start", "", name.trim(), &path_str])
                    .status()
                    .map_err(|e| format!("打开失败: {e}"))?;
                if !status.success() {
                    return Err(format!(
                        "无法使用「{}」打开仓库（退出码 {:?}）。",
                        name.trim(),
                        status.code()
                    ));
                }
                return Ok(());
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let _ = root_canon;
                let _ = args;
                return Err(format!(
                    "指定应用「{}」打开：当前桌面环境请使用命令行方式",
                    name.trim()
                ));
            }
        }

        return app
            .opener()
            .open_path(root_canon.to_string_lossy().as_ref(), None::<String>)
            .map_err(|e| e.to_string());
    }

    let graph_rel = graph_ide_folder_relative
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "." && *s != "/");

    if graph_rel.is_some() {
        let root_buf = path_buf.clone();
        if !root_buf.is_dir() {
            return Err("graphIdeFolderRelative 要求 path 为仓库根目录".to_string());
        }
        let root_canon = fs::canonicalize(&root_buf).unwrap_or_else(|_| root_buf.clone());
        let rel_norm = graph_rel.unwrap().replace('\\', "/");
        let folder_buf = root_canon.join(rel_norm.trim_start_matches('/'));
        let folder_abs = match fs::canonicalize(&folder_buf) {
            Ok(p) => p,
            Err(_) => folder_buf.clone(),
        };
        if !folder_abs.starts_with(&root_canon) {
            return Err("目标目录不在仓库根路径之下".to_string());
        }
        if !folder_abs.is_dir() {
            return Err(format!("目录不存在: {}", folder_abs.display()));
        }

        if let Some(cmd) = command.clone() {
            if is_vscode_family_cli(&cmd) {
                let goto_file = first_source_like_file_under(&folder_abs, 500, 4000);
                if let Some(f) = goto_file {
                    let f_c = fs::canonicalize(&f).unwrap_or_else(|_| f);
                    let goto_arg = format!("{}:1:1", f_c.to_string_lossy());
                    std::process::Command::new(&cmd)
                        .arg(&root_canon)
                        .arg("-g")
                        .arg(&goto_arg)
                        .args(&args)
                        .spawn()
                        .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
                    return Ok(());
                }
                std::process::Command::new(&cmd)
                    .arg(&root_canon)
                    .args(&args)
                    .spawn()
                    .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
                return Ok(());
            }
            std::process::Command::new(&cmd)
                .arg(&root_canon)
                .args(&args)
                .spawn()
                .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
            return Ok(());
        }

        if let Some(name) = app_name {
            #[cfg(target_os = "macos")]
            {
                // VS Code 系优先使用 CLI（避免 `open -a` 触发 Launch Services 导致 webview 重载）
                if let Some(cli) = app_name_to_vscode_cli(name.trim()) {
                    if let Some(exe) = resolve_vscode_family_cli(cli) {
                        std::process::Command::new(exe)
                            .arg(&root_canon)
                            .args(&args)
                            .spawn()
                            .map_err(|e| format!("无法启动「{}」：{}", cli, e))?;
                        return Ok(());
                    }
                }
                return macos_open_with_named_app(root_canon.as_path(), name.trim(), &args);
            }
            #[cfg(target_os = "windows")]
            {
                let path_str = root_canon.to_string_lossy().to_string();
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
                let _ = root_canon;
                let _ = args;
                return Err(format!(
                    "指定应用「{}」打开：当前桌面环境请使用「用默认应用打开」",
                    name.trim()
                ));
            }
        }

        return app
            .opener()
            .open_path(root_canon.to_string_lossy().as_ref(), None::<String>)
            .map_err(|e| e.to_string());
    }

    if let Some(name) = app_name {
        #[cfg(target_os = "macos")]
        {
            // VS Code 系优先使用 CLI（避免 `open -a` 触发 Launch Services 导致 webview 重载）
            if let Some(cli) = app_name_to_vscode_cli(name.trim()) {
                if let Some(exe) = resolve_vscode_family_cli(cli) {
                    std::process::Command::new(exe)
                        .arg(&path_buf)
                        .args(&args)
                        .spawn()
                        .map_err(|e| format!("无法启动「{}」：{}", cli, e))?;
                    return Ok(());
                }
            }
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
        if goto_line.is_some() && is_vscode_family_cli(&cmd) {
            let line = goto_line.unwrap().max(1);
            let col = goto_column.unwrap_or(1).max(1);
            let abs = fs::canonicalize(&path_buf).unwrap_or_else(|_| path_buf.clone());
            let goto_arg = format!("{}:{}:{}", abs.to_string_lossy(), line, col);
            std::process::Command::new(&cmd)
                .arg("-g")
                .arg(&goto_arg)
                .args(args)
                .spawn()
                .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
            return Ok(());
        }

        std::process::Command::new(&cmd)
            .arg(&path_buf)
            .args(&args)
            .spawn()
            .map_err(|e| format!("Failed to run command {}: {}", cmd, e))?;
        return Ok(());
    }

    app.opener()
        .open_path(&path, None::<String>)
        .map_err(|e| e.to_string())
}

// ── File Watcher ──

/// git 事件 debounce 窗口：commit/checkout 等会在 `.git` 与工作树产生大量文件事件，
/// 合并到该窗口结束后统一 emit，避免事件风暴打爆前端刷新。
const GIT_WATCHER_DEBOUNCE: Duration = Duration::from_millis(250);

pub(crate) struct GitWatcherState {
    watcher: Option<RecommendedWatcher>,
    watched_paths: Vec<String>,
}

impl GitWatcherState {
    pub(crate) fn new() -> Self {
        Self {
            watcher: None,
            watched_paths: Vec::new(),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitChangedPayload {
    path: String,
}

#[tauri::command]
pub(crate) fn start_git_watcher(
    state: tauri::State<Mutex<GitWatcherState>>,
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut normalized: Vec<String> = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();

    let mut state = state.lock().map_err(|e| e.to_string())?;

    if normalized == state.watched_paths {
        return Ok(());
    }

    state.watcher = None;
    state.watched_paths.clear();

    if normalized.is_empty() {
        return Ok(());
    }

    let mut watch_targets: Vec<(PathBuf, String)> = Vec::new();
    for repo_path in &normalized {
        let project_path = PathBuf::from(repo_path);
        let git_path = project_path.join(".git");
        if project_path.exists() {
            watch_targets.push((project_path.clone(), repo_path.clone()));
        }
        if git_path.exists() {
            watch_targets.push((git_path, repo_path.clone()));
        }
    }

    if watch_targets.is_empty() {
        return Ok(());
    }

    let watch_targets_for_emit = watch_targets.clone();
    let app_handle = app.clone();
    // debounce：用「脏仓库集合 + 单计时器」合并事件。首个相关事件启动 250ms 计时器，
    // 期间累积触发的仓库，到点后一次性 emit 各仓库的 git-changed，避免 git 操作产生的
    // 事件风暴逐条打爆前端刷新。.git 仍用 Recursive（NonRecursive 对子目录变化捕获不稳定）。
    let dirty_repos: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let timer_active: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    let mut watcher: RecommendedWatcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                let is_relevant =
                    event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove();
                if !is_relevant {
                    return;
                }
                for watch_path in &event.paths {
                    let watch_str = watch_path.to_string_lossy();
                    for (target_path, repo_path) in &watch_targets_for_emit {
                        if watch_str.starts_with(target_path.to_string_lossy().as_ref()) {
                            // 累积命中的仓库到脏集合
                            if let Ok(mut dirty) = dirty_repos.lock() {
                                dirty.insert(repo_path.clone());
                            }
                            // 仅首个事件启动计时器，后续事件只累积不重启（固定窗口）
                            if !timer_active.swap(true, Ordering::SeqCst) {
                                let dirty_arc = dirty_repos.clone();
                                let timer_arc = timer_active.clone();
                                let app_h = app_handle.clone();
                                tauri::async_runtime::spawn(async move {
                                    tokio::time::sleep(GIT_WATCHER_DEBOUNCE).await;
                                    let repos: Vec<String> = dirty_arc
                                        .lock()
                                        .map(|mut g| g.drain().collect())
                                        .unwrap_or_default();
                                    for repo in repos {
                                        let _ = app_h
                                            .emit("git-changed", GitChangedPayload { path: repo });
                                    }
                                    timer_arc.store(false, Ordering::SeqCst);
                                });
                            }
                            return;
                        }
                    }
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    for (watch_path, _) in &watch_targets {
        let _ = watcher.watch(watch_path, RecursiveMode::Recursive);
    }

    state.watcher = Some(watcher);
    state.watched_paths = normalized;

    Ok(())
}

#[tauri::command]
pub(crate) fn stop_git_watcher(state: tauri::State<Mutex<GitWatcherState>>) -> Result<(), String> {
    let mut state = state.lock().map_err(|e| e.to_string())?;
    state.watcher = None;
    state.watched_paths.clear();
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

/// 将文本写入用户通过系统对话框选择的绝对路径（供会话链路包导出等）。
#[tauri::command]
pub(crate) fn write_text_file_absolute(path: String, contents: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".to_string());
    }
    let p = PathBuf::from(trimmed);
    if !p.is_absolute() {
        return Err("仅允许写入绝对路径".to_string());
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    crate::wise_paths::write_file_atomic(&p, &contents)
}

// ── 外部终端注入运行指令 ──
//
// 在用户的默认终端（Terminal / iTerm / Ghostty / Warp / Kitty / Alacritty /
// WezTerm / Hyper）中打开新窗口，先 `cd` 到工作区路径再执行用户配置的运行
// 指令。命令为空字符串时退化为 `cd "<path>"` 单纯打开终端，等价于只打开
// 工作目录的行为。
#[cfg(target_os = "macos")]
fn shell_single_quote(s: &str) -> String {
    // 把所有单引号换成 `'\''`，再用单引号包起来，确保 shell 解析时原样保留。
    let escaped = s.replace('\'', "'\\''");
    format!("'{escaped}'")
}

#[cfg(target_os = "macos")]
fn composed_cd_command(path: &str, command: &str) -> String {
    let cd = shell_single_quote(path);
    let trimmed = command.trim();
    if trimmed.is_empty() {
        format!("cd {cd} && clear")
    } else {
        format!("cd {cd} && {trimmed}")
    }
}

#[cfg(target_os = "macos")]
fn find_terminal_def(app_name: &str) -> Option<&'static crate::macos_terminal_detect::TerminalDef> {
    let needle = app_name.trim();
    if needle.is_empty() {
        return None;
    }
    crate::macos_terminal_detect::CATALOG
        .iter()
        .find(|def| def.open_app_name.eq_ignore_ascii_case(needle))
}

/// 通过 `osascript` 执行 AppleScript，让 Terminal.app/iTerm/Warp/Hyper 新建
/// 窗口并跑一段 shell。返回值表示 osascript 退出是否成功。
#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> Result<(), String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("无法启动 osascript：{e}"))?;
    if !output.status.success() {
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "未知".to_string());
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.is_empty() {
            return Err(format!("osascript 执行失败（退出码 {code}）"));
        }
        Err(format!(
            "osascript 执行失败（退出码 {code}）：{stderr_trimmed}"
        ))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn escape_for_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// 用 `open -na <App> --args <...>` 强制开新实例并把参数透传给 CLI 终端
/// (Ghostty / Kitty / Alacritty / WezTerm)。`-n` 是关键：app 已运行时
/// `open -a` 不会开新窗口，`--args` 也会被 macOS 静默丢弃，导致点击"打开
/// 外部终端"后毫无反应。Ghostty 官方 README 也明确要求 `open -na
/// Ghostty.app --args ...`。
#[cfg(target_os = "macos")]
fn spawn_app_with_args(app_name: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    cmd.arg("-na").arg(app_name);
    cmd.arg("--args");
    for a in args {
        cmd.arg(a);
    }
    cmd.spawn()
        .map_err(|e| format!("无法启动「{app_name}」：{e}"))?;
    Ok(())
}

/// 在 macOS 默认终端中打开工作区路径并执行运行指令。命令为空字符串时
/// 退化为只打开终端到指定目录，保持原有"打开外部终端"行为不变。
#[cfg(target_os = "macos")]
#[tauri::command]
pub(crate) fn macos_open_terminal_with_command(
    #[allow(non_snake_case)] appName: String,
    path: String,
    command: String,
) -> Result<(), String> {
    let path_trimmed = path.trim();
    if path_trimmed.is_empty() {
        return Err("工作区路径不能为空".to_string());
    }
    let path_buf = PathBuf::from(path_trimmed);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path_trimmed));
    }
    let def = find_terminal_def(&appName)
        .ok_or_else(|| format!("未知的终端应用：{appName}"))?;

    match def.id {
        // Terminal.app：AppleScript 新窗口执行 `cd && command`
        "terminal" => {
            let composed = composed_cd_command(path_trimmed, &command);
            let script = format!(
                "tell application \"Terminal\" to do script \"{}\"",
                escape_for_applescript(&composed)
            );
            run_osascript(&script)
        }

        // iTerm：activate 后等待窗口就绪，再创建新窗口执行命令
        "iterm" => {
            let composed = composed_cd_command(path_trimmed, &command);
            let script = format!(
                "tell application \"iTerm\"\n\
                 \x20\x20activate\n\
                 \x20\x20delay 1.0\n\
                 \x20\x20create window with default profile command \"{}\"\n\
                 end tell",
                escape_for_applescript(&composed),
            );
            run_osascript(&script)
        }

        // Ghostty：不支持 CLI 位置参数传命令，先用 --working-directory
        // 打开终端，再用 AppleScript 模拟键入命令。
        "ghostty" => {
            if command.trim().is_empty() {
                spawn_app_with_args(
                    def.open_app_name,
                    &[format!("--working-directory={path_trimmed}").as_str()],
                )
            } else {
                spawn_app_with_args(
                    def.open_app_name,
                    &[format!("--working-directory={path_trimmed}").as_str()],
                )?;
                let composed = composed_cd_command(path_trimmed, &command);
                let script = format!(
                    "tell application \"Ghostty\" to activate\n\
                     delay 1.0\n\
                     tell application \"System Events\"\n\
                     \x20\x20tell process \"Ghostty\"\n\
                     \x20\x20\x20\x20keystroke \"{}\"\n\
                     \x20\x20\x20\x20key code 36\n\
                     \x20\x20end tell\n\
                     end tell",
                    escape_for_applescript(&composed)
                );
                run_osascript(&script)
            }
        }

        // Warp：不支持 CLI 命令注入；通过 AppleScript 让 Warp 新建会话并预填 cd 命令
        "warp" => {
            let composed = composed_cd_command(path_trimmed, &command);
            let script = format!(
                "tell application \"Warp\"\n\
                 \x20\x20activate\n\
                 end tell\n\
                 delay 1.0\n\
                 tell application \"System Events\"\n\
                 \x20\x20tell process \"Warp\"\n\
                 \x20\x20\x20\x20keystroke \"l\" using {{command down}}\n\
                 \x20\x20\x20\x20delay 0.3\n\
                 \x20\x20\x20\x20keystroke \"{}\"\n\
                 \x20\x20\x20\x20key code 36\n\
                 \x20\x20end tell\n\
                 end tell",
                escape_for_applescript(&composed)
            );
            run_osascript(&script)
        }

        // Kitty：`open -a kitty --args -d <path> <shell> -lc <cmd>`
        // 追加 exec $SHELL 保持终端窗口在命令执行完后不关闭。
        "kitty" => {
            if command.trim().is_empty() {
                spawn_app_with_args("kitty", &[format!("--directory={path_trimmed}").as_str()])
            } else {
                let exec_command = format!("{}; exec $SHELL", command);
                spawn_app_with_args(
                    "kitty",
                    &[
                        format!("--directory={path_trimmed}").as_str(),
                        "/bin/zsh",
                        "-lc",
                        &exec_command,
                    ],
                )
            }
        }

        // Alacritty：`open -a Alacritty --args --working-directory <path> -e <shell> -lc <cmd>`
        "alacritty" => {
            if command.trim().is_empty() {
                spawn_app_with_args(
                    def.open_app_name,
                    &[format!("--working-directory={path_trimmed}").as_str()],
                )
            } else {
                let exec_command = format!("{}; exec $SHELL", command);
                spawn_app_with_args(
                    def.open_app_name,
                    &[
                        format!("--working-directory={path_trimmed}").as_str(),
                        "-e",
                        "/bin/zsh",
                        "-lc",
                        &exec_command,
                    ],
                )
            }
        }

        // WezTerm：`open -a WezTerm --args start --cwd <path> -- /bin/zsh -lc <cmd>`
        "wezterm" => {
            if command.trim().is_empty() {
                spawn_app_with_args(def.open_app_name, &[format!("--cwd={path_trimmed}").as_str()])
            } else {
                let exec_command = format!("{}; exec $SHELL", command);
                spawn_app_with_args(
                    def.open_app_name,
                    &[
                        format!("--cwd={path_trimmed}").as_str(),
                        "--",
                        "/bin/zsh",
                        "-lc",
                        &exec_command,
                    ],
                )
            }
        }

        // Hyper：activate 后等待窗口就绪，再模拟键入命令
        "hyper" => {
            let composed = composed_cd_command(path_trimmed, &command);
            let script = format!(
                "tell application \"Hyper\" to activate\n\
                 delay 1.0\n\
                 tell application \"System Events\"\n\
                 \x20\x20tell process \"Hyper\"\n\
                 \x20\x20\x20\x20keystroke \"{}\"\n\
                 \x20\x20\x20\x20key code 36\n\
                 \x20\x20end tell\n\
                 end tell",
                escape_for_applescript(&composed)
            );
            run_osascript(&script)
        }

        other => Err(format!("暂不支持在该终端注入运行指令：{other}")),
    }
}
