use crate::prd_materialize;
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

fn sanitize_bucket_segment(input: &str) -> String {
    let mut key = String::with_capacity(input.len());
    let mut prev_dash = false;
    for ch in input.chars() {
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
    key.trim_matches('-').to_string()
}

/// Writes base64 image bytes under `~/.wise/prd-images/<repository-key>/`.
/// Returns absolute file path for frontend URL conversion.
#[tauri::command]
pub(crate) fn save_prd_pasted_image(
    repository_path: String,
    repository_name: Option<String>,
    repository_id: Option<i64>,
    project_name: Option<String>,
    project_id: Option<String>,
    filename: String,
    base64_data: String,
) -> Result<String, String> {
    let safe_name: String = filename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    if safe_name.is_empty() {
        return Err("invalid filename".into());
    }

    let repository_bucket = repository_name
        .as_deref()
        .map(sanitize_bucket_segment)
        .filter(|s| !s.is_empty())
        .zip(repository_id)
        .map(|(name, id)| format!("{name}-{id}"));
    let project_bucket = project_name
        .as_deref()
        .map(sanitize_bucket_segment)
        .filter(|s| !s.is_empty())
        .zip(
            project_id
                .as_deref()
                .map(sanitize_bucket_segment)
                .filter(|s| !s.is_empty()),
        )
        .map(|(name, id)| format!("{name}-{id}"));
    let bucket = repository_bucket
        .or(project_bucket)
        .unwrap_or_else(|| repository_bucket_key(&repository_path));

    let base_dir = wise_dir()?.join("prd-images").join(bucket);
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

#[tauri::command]
pub(crate) fn materialize_prd_snapshot(
    project_path: String,
    prd_markdown: String,
    split_markdown: Option<String>,
    run_id: Option<String>,
    requirements_index_json: Option<String>,
    snapshot_meta_json: Option<String>,
) -> Result<prd_materialize::MaterializePrdSnapshotResult, String> {
    prd_materialize::materialize_prd_snapshot(
        project_path,
        prd_markdown,
        split_markdown,
        run_id,
        requirements_index_json,
        snapshot_meta_json,
    )
}

#[tauri::command]
pub(crate) fn read_project_relative_file(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    prd_materialize::read_project_relative_file(project_path, relative_path)
}

#[tauri::command]
pub(crate) fn read_project_relative_file_base64(
    project_path: String,
    relative_path: String,
) -> Result<String, String> {
    prd_materialize::read_project_relative_file_base64(project_path, relative_path)
}

#[tauri::command]
pub(crate) fn list_project_relative_directory(
    project_path: String,
    relative_path: String,
) -> Result<Vec<String>, String> {
    prd_materialize::list_project_relative_directory(project_path, relative_path)
}

#[tauri::command]
pub(crate) fn read_snapshot_file(file_path: String) -> Result<String, String> {
    prd_materialize::read_snapshot_file(file_path)
}

#[tauri::command]
pub(crate) fn append_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    prd_materialize::append_project_relative_file(project_path, relative_path, payload)
}

#[tauri::command]
pub(crate) fn write_project_relative_file(
    project_path: String,
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    prd_materialize::write_project_relative_file(project_path, relative_path, payload)
}

#[tauri::command]
pub(crate) fn append_wise_relative_file(
    relative_path: String,
    payload: String,
) -> Result<(), String> {
    prd_materialize::append_wise_relative_file(relative_path, payload)
}

#[tauri::command]
pub(crate) fn read_wise_relative_file(relative_path: String) -> Result<String, String> {
    prd_materialize::read_wise_relative_file(relative_path)
}
