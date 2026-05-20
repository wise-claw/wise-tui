//! macOS：息屏 / 休眠唤醒后 WKWebView 内容进程可能被系统回收，窗口会白屏。
//! 监听 NSWorkspace 唤醒通知，延迟 reload 所有 WebView 窗口以恢复 UI。
//! 参见 tauri-apps/tauri#10662 与 lib_impl 中 window.hide 白屏注释。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

const RELOAD_DEBOUNCE: Duration = Duration::from_secs(8);
const RELOAD_DELAY: Duration = Duration::from_secs(2);

static LAST_RELOAD_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn reload_wise_webviews(app: &AppHandle) {
    {
        let mut last = LAST_RELOAD_AT.lock().expect("wake reload debounce lock");
        let now = Instant::now();
        if last
            .map(|prev| now.duration_since(prev) < RELOAD_DEBOUNCE)
            .unwrap_or(false)
        {
            return;
        }
        *last = Some(now);
    }

    for label in ["main", "mascot"] {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.reload();
        }
    }
}

fn schedule_reload(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(RELOAD_DELAY).await;
        reload_wise_webviews(&app);
    });
}

fn register_wake_observer(
    center: &objc2_foundation::NSNotificationCenter,
    name: &'static objc2_foundation::NSNotificationName,
    app: AppHandle,
) {
    use block2::RcBlock;
    use objc2_foundation::NSOperationQueue;

    let block = RcBlock::new(move |_notification| {
        schedule_reload(app.clone());
    });

    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            Some(NSOperationQueue::mainQueue().as_ref()),
            &block,
        )
    };

    // 观察者 token 需存活到进程结束。
    std::mem::forget(token);
}

pub fn register_macos_webview_wake_recovery(app: &AppHandle) {
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceScreensDidWakeNotification,
    };

    let app_handle = app.clone();
    let workspace = NSWorkspace::sharedWorkspace();
    let center = workspace.notificationCenter();

    unsafe {
        register_wake_observer(
            center.as_ref(),
            NSWorkspaceScreensDidWakeNotification,
            app_handle.clone(),
        );
        register_wake_observer(
            center.as_ref(),
            NSWorkspaceDidWakeNotification,
            app_handle,
        );
    }
}
