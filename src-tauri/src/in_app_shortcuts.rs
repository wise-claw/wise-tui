//! 应用内快捷键：仅在主窗口聚焦时注册，并在回调里再次校验聚焦状态，
//! 避免在其他应用中误触。
//!
//! - `filename` / `content`：统一为 Ctrl+F / Ctrl+Shift+F（macOS 也用 CONTROL 而非 SUPER），
//!   避免占用 ⌘F / ⌘⇧F，让 Monaco 编辑器在聚焦时能正常触发自身内查找。
//! - `new_session`：⌘N / Ctrl+N，新建会话；刻意做成「应用内」，避免在别的 App 里误触。
//!
//! 双重保险：
//! 1. 主窗口 `Focused` 事件驱动注册/注销（见 `set_main_window_search_shortcuts_active`）。
//! 2. 回调里再调 `main_window_focused` 兜底，应对 `Focused` 事件漏报/延迟。

use keyboard_types::{Code, Modifiers};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// 仅在主工作区窗口处于前台时返回 `true`。
///
/// 全局快捷键插件按下时不会自动校验窗口聚焦状态，因此即便
/// `Focused` 事件出现延迟/漏报（例如系统弹窗抢焦点、最小化恢复、
/// 辅助窗口跨屏切换），也得在回调里再次确认。
fn main_window_focused(app: &AppHandle) -> bool {
    if let Some(win) = crate::main_window::resolve_main_workspace_window_for_focus(app) {
        if win.is_focused().unwrap_or(false) {
            return true;
        }
    }
    // 兜底：再扫一遍，避免 `resolve_main_workspace_window_for_focus`
    // 出于辅助窗口策略没挑中刚聚焦的那个主窗。
    for (label, win) in app.webview_windows() {
        if crate::main_window::is_main_workspace_window_label(&label)
            && win.is_focused().unwrap_or(false)
        {
            return true;
        }
    }
    false
}

struct InAppSearchShortcutState {
    filename: Shortcut,
    content: Shortcut,
    new_session: Shortcut,
    registered: bool,
}

impl InAppSearchShortcutState {
    fn new() -> Self {
        // 文件名 / 内容搜索统一走 Ctrl+F / Ctrl+Shift+F（macOS 也用 CONTROL），
        // 释放 ⌘F / ⌘⇧F 给 Monaco 编辑器自身处理内查找。
        let filename_mods = Modifiers::CONTROL;
        let content_mods = Modifiers::CONTROL | Modifiers::SHIFT;

        #[cfg(target_os = "macos")]
        let new_session_mods = Modifiers::SUPER;
        #[cfg(not(target_os = "macos"))]
        let new_session_mods = Modifiers::CONTROL;

        Self {
            filename: Shortcut::new(Some(filename_mods), Code::KeyF),
            content: Shortcut::new(Some(content_mods), Code::KeyF),
            new_session: Shortcut::new(Some(new_session_mods), Code::KeyN),
            registered: false,
        }
    }
}

pub fn init(app: &AppHandle) {
    app.manage(Mutex::new(InAppSearchShortcutState::new()));
}

fn with_state<F, R>(app: &AppHandle, f: F) -> Result<R, String>
where
    F: FnOnce(&mut InAppSearchShortcutState) -> Result<R, String>,
{
    let state = app.state::<Mutex<InAppSearchShortcutState>>();
    let mut guard = state.lock().map_err(|_| "in_app_shortcuts lock poisoned".to_string())?;
    f(&mut guard)
}

pub fn register_search_shortcuts(app: &AppHandle) -> Result<(), String> {
    with_state(app, |state| {
        if state.registered {
            return Ok(());
        }
        let filename = state.filename.clone();
        let content = state.content.clone();
        let new_session = state.new_session.clone();
        let app_for_filename = app.clone();
        let app_for_content = app.clone();
        let app_for_new_session = app.clone();

        app.global_shortcut()
            .on_shortcut(filename, move |_app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if !main_window_focused(&app_for_filename) {
                    return;
                }
                let _ = app_for_filename.emit("global-open-filename-search", ());
            })
            .map_err(|e| e.to_string())?;

        app.global_shortcut()
            .on_shortcut(content, move |_app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if !main_window_focused(&app_for_content) {
                    return;
                }
                let _ = app_for_content.emit("global-open-content-search", ());
            })
            .map_err(|e| e.to_string())?;

        app.global_shortcut()
            .on_shortcut(new_session, move |_app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                // 全局快捷键插件不会替我们校验窗口聚焦；为避免在别的
                // App 里误触，最后一道兜底就是这里再查一次主窗口状态。
                if !main_window_focused(&app_for_new_session) {
                    return;
                }
                let _ = app_for_new_session.emit("global-create-new-session", ());
            })
            .map_err(|e| e.to_string())?;

        state.registered = true;
        Ok(())
    })
}

pub fn unregister_search_shortcuts(app: &AppHandle) -> Result<(), String> {
    with_state(app, |state| {
        if !state.registered {
            return Ok(());
        }
        let filename = state.filename.clone();
        let content = state.content.clone();
        let new_session = state.new_session.clone();
        app.global_shortcut()
            .unregister(filename)
            .map_err(|e| e.to_string())?;
        app.global_shortcut()
            .unregister(content)
            .map_err(|e| e.to_string())?;
        app.global_shortcut()
            .unregister(new_session)
            .map_err(|e| e.to_string())?;
        state.registered = false;
        Ok(())
    })
}

pub fn set_main_window_search_shortcuts_active(app: &AppHandle, active: bool) -> Result<(), String> {
    if active {
        register_search_shortcuts(app)
    } else {
        unregister_search_shortcuts(app)
    }
}
