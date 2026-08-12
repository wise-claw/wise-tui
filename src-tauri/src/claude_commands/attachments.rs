use crate::wise_dir;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::Client;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
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

const MAX_PASTED_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const PASTED_IMAGE_FETCH_TIMEOUT_SECS: u64 = 20;

#[derive(Serialize)]
pub(crate) struct FetchedImageData {
    mime: String,
    base64: String,
}

fn is_image_path(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());
    matches!(
        ext.as_deref(),
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("svg")
            | Some("bmp")
            | Some("ico")
            | Some("avif")
            | Some("heic")
            | Some("heif")
    )
}

/// 粘贴「网页复制图片」兜底：剪贴板只有远端 `<img src>` 时，经后端下载（绕过 CORS）转 base64。
#[tauri::command]
pub(crate) async fn wise_fetch_remote_image(url: String) -> Result<FetchedImageData, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return Err("仅支持 http/https 图片地址".into());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(PASTED_IMAGE_FETCH_TIMEOUT_SECS))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15")
        .build()
        .map_err(|e| format!("创建网络客户端失败: {e}"))?;
    let response = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("图片下载失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("图片下载失败（HTTP {}）", response.status().as_u16()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    let mime = if content_type.starts_with("image/") {
        content_type
    } else if is_image_path(trimmed) {
        composer_image_mime_from_path(Path::new(trimmed)).to_string()
    } else {
        return Err("响应不是图片".into());
    };

    let mut body: Vec<u8> = Vec::new();
    let mut stream = response;
    loop {
        match stream.chunk().await {
            Ok(Some(chunk)) => {
                body.extend_from_slice(&chunk);
                if body.len() > MAX_PASTED_IMAGE_BYTES {
                    return Err(format!(
                        "图片超过 {}MB，未粘贴",
                        MAX_PASTED_IMAGE_BYTES / 1024 / 1024
                    ));
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("图片下载失败: {e}")),
        }
    }
    Ok(FetchedImageData {
        mime,
        base64: B64.encode(&body),
    })
}

/// 粘贴「Finder 复制图片文件」兜底：剪贴板只有 `file://` 路径时，读盘转 base64。
#[tauri::command]
pub(crate) fn wise_read_local_image(abs_path: String) -> Result<FetchedImageData, String> {
    let trimmed = abs_path.trim();
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("必须是绝对路径".into());
    }
    if !is_image_path(trimmed) {
        return Err("仅支持常见图片文件".into());
    }
    if !path.is_file() {
        return Err("图片文件不存在".into());
    }
    let meta = fs::metadata(&path).map_err(|e| format!("读取图片失败: {e}"))?;
    if meta.len() > MAX_PASTED_IMAGE_BYTES as u64 {
        return Err(format!(
            "图片超过 {}MB，未粘贴",
            MAX_PASTED_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(&path).map_err(|e| format!("读取图片失败: {e}"))?;
    Ok(FetchedImageData {
        mime: composer_image_mime_from_path(&path).to_string(),
        base64: B64.encode(&bytes),
    })
}

/// 粘贴图片最终兜底：macOS WKWebView 的 DOM paste 事件经常拿不到剪贴板图片
/// （`items`/`files` 为空，只剩 URL 文本或什么都没有），这里直接从系统剪贴板读取。
/// 优先命中 PNG/JPEG/GIF/WebP 等原始 UTI；TIFF 转 PNG；仅文件 URL 时读盘。
#[tauri::command]
pub(crate) fn wise_read_clipboard_image() -> Result<FetchedImageData, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err("系统剪贴板读取仅支持 macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        use core::ffi::c_void;
        use objc2_app_kit::{
            NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardTypeFileURL,
            NSPasteboardTypePNG, NSPasteboardTypeTIFF,
        };
        use objc2_foundation::{NSData, NSDictionary, NSString};

        fn data_to_bytes(data: &NSData) -> Vec<u8> {
            let len = data.length() as usize;
            if len == 0 {
                return Vec::new();
            }
            let mut buf = vec![0u8; len];
            unsafe {
                data.getBytes_length(
                    core::ptr::NonNull::new(buf.as_mut_ptr().cast::<c_void>()).unwrap(),
                    len,
                );
            }
            buf
        }

        fn encode(mime: &str, bytes: Vec<u8>) -> Result<FetchedImageData, String> {
            if bytes.is_empty() {
                return Err("剪贴板图片数据为空".into());
            }
            if bytes.len() > MAX_PASTED_IMAGE_BYTES {
                return Err(format!(
                    "图片超过 {}MB，未粘贴",
                    MAX_PASTED_IMAGE_BYTES / 1024 / 1024
                ));
            }
            Ok(FetchedImageData {
                mime: mime.to_string(),
                base64: B64.encode(&bytes),
            })
        }

        let pb = NSPasteboard::generalPasteboard();

        // 1) 直接可读的图片 UTI
        if let Some(data) = unsafe { pb.dataForType(NSPasteboardTypePNG) } {
            return encode("image/png", data_to_bytes(&data));
        }
        let direct_utis: &[(&str, &str)] = &[
            ("public.jpeg", "image/jpeg"),
            ("public.gif", "image/gif"),
            ("public.webp", "image/webp"),
            ("public.bmp", "image/bmp"),
            ("public.heic", "image/heic"),
            ("public.heif", "image/heif"),
        ];
        for (uti, mime) in direct_utis {
            let type_ref = NSString::from_str(uti);
            if let Some(data) = pb.dataForType(&type_ref) {
                return encode(mime, data_to_bytes(&data));
            }
        }

        // 2) TIFF → PNG（网页/截图复制图片的常见落点）
        if let Some(tiff) = unsafe { pb.dataForType(NSPasteboardTypeTIFF) } {
            if let Some(rep) = NSBitmapImageRep::imageRepWithData(&tiff) {
                let png = unsafe {
                    rep.representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                };
                if let Some(png) = png {
                    return encode("image/png", data_to_bytes(&png));
                }
            }
        }

        // 3) Finder 复制的图片文件 → 读盘
        if let Some(url_str) = unsafe { pb.stringForType(NSPasteboardTypeFileURL) } {
            if let Some(path) = decode_file_url(&url_str.to_string()) {
                if is_image_path(&path) {
                    if let Ok(data) = wise_read_local_image(path) {
                        return Ok(data);
                    }
                }
            }
        }

        Err("系统剪贴板中没有图片".into())
    }
}

/// `file:///a/b.png` → `/a/b.png`（percent-decode）；普通绝对路径原样返回。
fn decode_file_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut path = trimmed.to_string();
    if let Some(rest) = path.strip_prefix("file://") {
        path = if let Some(slash) = rest.find('/') {
            rest[slash..].to_string()
        } else {
            return None;
        };
    }
    if !path.starts_with('/') {
        return None;
    }
    urlencoding::decode(&path).ok().map(|s| s.into_owned())
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
