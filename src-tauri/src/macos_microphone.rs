//! macOS：通过 AVFoundation 触发系统级麦克风授权（WKWebView 内 SpeechRecognition 不会单独弹窗）。

use std::sync::mpsc;
use std::time::Duration;

use tauri::AppHandle;

#[cfg(target_os = "macos")]
fn request_microphone_access_on_main_thread() -> Result<bool, String> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaTypeAudio};

    let media_type = unsafe { AVMediaTypeAudio }.ok_or("AVMediaTypeAudio 不可用")?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    if status == AVAuthorizationStatus::Authorized {
        return Ok(true);
    }
    if status == AVAuthorizationStatus::Denied || status == AVAuthorizationStatus::Restricted {
        return Ok(false);
    }

    let (tx, rx) = mpsc::sync_channel(1);
    let block = RcBlock::new(move |granted: Bool| {
        let _ = tx.send(bool::from(granted));
    });
    unsafe {
        AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &block);
    }
    rx.recv_timeout(Duration::from_secs(120))
        .map_err(|_| "等待麦克风授权超时".to_string())
}

/// 在主线程弹出系统麦克风授权；已授权返回 true，拒绝/受限返回 false。
#[tauri::command]
pub fn macos_request_microphone_access(app: AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = request_microphone_access_on_main_thread();
            let _ = tx.send(result);
        })
        .map_err(|e| format!("主线程调度失败: {e}"))?;
        return rx
            .recv()
            .map_err(|_| "读取麦克风授权结果失败".to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("仅 macOS 支持".to_string())
    }
}
