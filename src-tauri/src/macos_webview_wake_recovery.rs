//! macOS：WKWebView 在休眠唤醒后偶发白屏（tauri-apps/tauri#10662）。
//! 曾监听 NSWorkspace 唤醒并 `window.reload()` 恢复 UI，但全页刷新会丢失会话现场。
//! 默认不再在息屏/唤醒时 reload；若白屏复现，可在此恢复观察者并改为仅对空白窗口 reload。

use tauri::AppHandle;

pub fn register_macos_webview_wake_recovery(_app: &AppHandle) {
    // Preserve UI and session state across screen wake and system sleep.
}
