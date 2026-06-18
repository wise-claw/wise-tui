use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
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

fn vscode_cli_failure(cmd: &Path, out: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let label = cmd.to_string_lossy();
    if err.is_empty() {
        format!(
            "命令「{}」执行失败（退出码 {:?}）",
            label,
            out.status.code()
        )
    } else {
        format!("命令「{}」失败：{}", label, err)
    }
}

/// 在已打开/新窗口中以仓库为工作区并 `-g` 到目标文件（搜索、图谱文件节点）
fn run_vscode_family_cli_repo_goto(
    cmd: &Path,
    root_canon: &Path,
    goto_arg: &str,
    file_abs: &Path,
    args: &[String],
) -> Result<(), String> {
    let mut strategies: Vec<std::process::Command> = Vec::new();

    let mut reuse_root_goto = std::process::Command::new(cmd);
    reuse_root_goto
        .arg("-r")
        .arg(root_canon)
        .arg("-g")
        .arg(goto_arg)
        .args(args);
    strategies.push(reuse_root_goto);

    let mut reuse_goto_only = std::process::Command::new(cmd);
    reuse_goto_only.arg("-r").arg("-g").arg(goto_arg).args(args);
    strategies.push(reuse_goto_only);

    let mut reuse_root_file = std::process::Command::new(cmd);
    reuse_root_file.arg("-r").arg(root_canon).arg(file_abs).args(args);
    strategies.push(reuse_root_file);

    let mut last_err = String::new();
    for mut attempt in strategies {
        let out = attempt
            .output()
            .map_err(|e| format!("Failed to run command {}: {}", cmd.display(), e))?;
        if out.status.success() {
            return Ok(());
        }
        last_err = vscode_cli_failure(cmd, &out);
    }
    Err(last_err)
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
                    let out = std::process::Command::new(&cmd)
                        .arg(&root_canon)
                        .arg("-g")
                        .arg(&goto_arg)
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

        if let Some(name) = app_name {
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
            let out = std::process::Command::new(&cmd)
                .arg("-g")
                .arg(&goto_arg)
                .args(args)
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
                            let payload = GitChangedPayload {
                                path: repo_path.clone(),
                            };
                            let _ = app_handle.emit("git-changed", payload);
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
