use crate::wise_dir;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

/// Launches macOS `screencapture -i` for interactive area selection.
/// Returns base64-encoded image data and original filename.
///
/// Note: We intentionally do **not** fall back to `screencapture -w`. On recent macOS,
/// `-w` often fails with stderr like "could not create image from window" (permissions /
/// compositor), and `-i` failing (e.g. user pressed Esc) would incorrectly trigger that path.
#[tauri::command]
pub(crate) fn capture_screenshot() -> Result<ScreenshotResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("截屏仅支持 macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        let tmp_dir = std::env::temp_dir();
        // UUID：避免同一秒内并发/双监听两次截屏时争用同一临时文件名
        let filename = format!("screenshot_{}.png", Uuid::new_v4());
        let tmp_path = tmp_dir.join(&filename);
        let tmp_str = tmp_path.to_str().ok_or("invalid temp path")?;

        let out = Command::new("screencapture")
            .args(["-i", "-x", tmp_str])
            .output()
            .map_err(|e| format!("无法启动 screencapture: {e}"))?;

        if !out.status.success() {
            let _ = fs::remove_file(&tmp_path);
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let sys = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                String::new()
            };
            let sys_lower = sys.to_lowercase();
            // `screencapture -i` 框选失败时常见：未授权、跨屏选区、受保护内容（CG 无法从 rect 出图）
            let rect_hint = if sys_lower.contains("rect")
                || sys_lower.contains("could not create image")
            {
                " 若已授权仍失败：请只在主显示器上框选（勿跨多块屏幕），并避开视频/DRM 等受保护窗口。"
            } else {
                ""
            };
            let base = "截屏未完成（可能已按 Esc 取消），或未授予屏幕录制权限。";
            let perm = "请在「系统设置 → 隐私与安全性 → 屏幕录制」中为 Wise 开启；使用 `bun run tauri:dev` 时请同时为承载该命令的终端（如 Cursor 内置终端对应的 App）开启屏幕录制。";
            if sys.is_empty() {
                return Err(format!("{base}{rect_hint} {perm}"));
            }
            return Err(format!("{base}{rect_hint} {perm} 系统输出：{sys}"));
        }

        if !tmp_path.is_file() {
            return Err(format!(
                "截屏命令已成功结束，但未生成图片文件（{tmp_str}）。请确认「屏幕录制」中已允许 Wise；若使用 tauri:dev，也请允许启动它的终端应用。框选时请避免跨显示器。"
            ));
        }

        let bytes = fs::read(&tmp_path).map_err(|e| format!("读取截屏文件失败: {e}"))?;
        let _ = fs::remove_file(&tmp_path);

        Ok(ScreenshotResult {
            filename,
            mime: "image/png".to_string(),
            base64_data: B64.encode(&bytes),
        })
    }
}

#[derive(Serialize)]
pub(crate) struct ScreenshotResult {
    filename: String,
    mime: String,
    base64_data: String,
}

// ── Composer attachments (images → ~/.wise for @ mention) ──

/// Writes base64 image bytes under `~/.wise/composer-images/<repository-key>/`.
/// Returns absolute POSIX path for Claude Code `@` mentions.
#[tauri::command]
pub(crate) fn save_composer_image(
    project_path: String,
    filename: String,
    base64_data: String,
) -> Result<String, String> {
    let project = PathBuf::from(&project_path);
    if !project.is_dir() {
        return Err("project_path is not a directory".into());
    }
    let safe_name: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    if safe_name.is_empty() {
        return Err("invalid filename".into());
    }

    let bucket = repository_bucket_key(&project_path);
    let base_dir = wise_dir()?.join("composer-images").join(bucket);
    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let id = Uuid::new_v4();
    let final_name = format!("{id}-{safe_name}");
    let dest = base_dir.join(final_name);

    let cleaned = base64_data
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();
    let bytes = B64.decode(cleaned).map_err(|e| format!("base64: {e}"))?;
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;

    Ok(dest.to_string_lossy().to_string())
}

/// 读取 `~/.wise/composer-images/` 下已落盘图片，返回 `data:*;base64,...` 供 Composer 缩略图恢复。
#[tauri::command]
pub(crate) fn read_composer_image(abs_path: String) -> Result<String, String> {
    let path = PathBuf::from(abs_path.trim());
    if !path.is_absolute() {
        return Err("abs_path must be absolute".into());
    }
    let wise_root = wise_dir()?;
    let composer_root = wise_root.join("composer-images");
    if !path.starts_with(&composer_root) {
        return Err("path outside ~/.wise/composer-images".into());
    }
    if !path.is_file() {
        return Err("composer image not found".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = composer_image_mime_from_path(&path);
    let b64 = B64.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

fn composer_image_mime_from_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        Some("heic") | Some("heif") => "image/heic",
        _ => "application/octet-stream",
    }
}

fn repository_bucket_key(repository_path: &str) -> String {
    let repo_name = Path::new(repository_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(repository_path);
    let mut key = String::with_capacity(repo_name.len());
    let mut prev_dash = false;
    for ch in repo_name.chars() {
        let mapped = if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
        } else {
            '-'
        };
        if mapped == '-' {
            if prev_dash {
                continue;
            }
            prev_dash = true;
            key.push('-');
        } else {
            prev_dash = false;
            key.push(mapped);
        }
    }
    let trimmed = key.trim_matches('-').to_string();
    if trimmed.is_empty() {
        return "unknown-repository".to_string();
    }
    trimmed
}
