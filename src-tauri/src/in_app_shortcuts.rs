//! 应用内搜索快捷键：仅在主窗口聚焦时注册，避免在其他应用中抢占 Ctrl+F / Ctrl+Shift+F。

use keyboard_types::{Code, Modifiers};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct InAppSearchShortcutState {
    filename: Shortcut,
    content: Shortcut,
    registered: bool,
}

impl InAppSearchShortcutState {
    fn new() -> Self {
        #[cfg(target_os = "macos")]
        let filename_mods = Modifiers::SUPER;
        #[cfg(not(target_os = "macos"))]
        let filename_mods = Modifiers::CONTROL;

        #[cfg(target_os = "macos")]
        let content_mods = Modifiers::SUPER | Modifiers::SHIFT;
        #[cfg(not(target_os = "macos"))]
        let content_mods = Modifiers::CONTROL | Modifiers::SHIFT;

        Self {
            filename: Shortcut::new(Some(filename_mods), Code::KeyF),
            content: Shortcut::new(Some(content_mods), Code::KeyF),
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
        let app_for_filename = app.clone();
        let app_for_content = app.clone();

        app.global_shortcut()
            .on_shortcut(filename, move |_app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
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
                let _ = app_for_content.emit("global-open-content-search", ());
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
        app.global_shortcut()
            .unregister(filename)
            .map_err(|e| e.to_string())?;
        app.global_shortcut()
            .unregister(content)
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
