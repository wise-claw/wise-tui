//! 全局 @提及 快捷键：将用户配置的 chord（如 Mod+Shift+Digit2）注册为系统级全局快捷键。

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::shortcut_chord::parse_chord_to_shortcut;

#[derive(Debug, Clone)]
struct RegisteredAtMentionShortcut {
    shortcut: Shortcut,
    #[allow(dead_code)]
    target_key: String,
}

struct AtMentionShortcutState {
    registered: Vec<RegisteredAtMentionShortcut>,
}

impl AtMentionShortcutState {
    fn new() -> Self {
        Self { registered: Vec::new() }
    }
}

pub fn init(app: &AppHandle) {
    app.manage(Mutex::new(AtMentionShortcutState::new()));
}

fn with_state<F, R>(app: &AppHandle, f: F) -> Result<R, String>
where
    F: FnOnce(&mut AtMentionShortcutState) -> Result<R, String>,
{
    let state = app.state::<Mutex<AtMentionShortcutState>>();
    let mut guard = state.lock().map_err(|_| "at_mention_shortcuts lock poisoned".to_string())?;
    f(&mut guard)
}

pub fn register_at_mention_shortcuts(
    app: &AppHandle,
    bindings: HashMap<String, String>,
) -> Result<(), String> {
    with_state(app, |state| {
        // Unregister existing shortcuts first
        for reg in &state.registered {
            let _ = app.global_shortcut().unregister(reg.shortcut.clone());
        }
        state.registered.clear();

        for (target_key, chord) in bindings {
            let chord = chord.trim();
            if chord.is_empty() {
                continue;
            }
            let shortcut = match parse_chord_to_shortcut(&chord) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[at_mention_shortcuts] skip invalid chord '{}': {}", chord, e);
                    continue;
                }
            };
            if app.global_shortcut().is_registered(shortcut.clone()) {
                let _ = app.global_shortcut().unregister(shortcut.clone());
            }
            let app_clone = app.clone();
            let target_key_clone = target_key.clone();
            if let Err(e) = app.global_shortcut().on_shortcut(shortcut.clone(), move |_app, _sc, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                let payload = serde_json::json!({ "targetKey": target_key_clone });
                let _ = crate::wise_hud::focus_active_composer_surface(&app_clone);
                crate::wise_hud::emit_to_active_composer_surface(
                    &app_clone,
                    "global-at-mention-shortcut",
                    payload,
                );
            }) {
                eprintln!("[at_mention_shortcuts] failed to register '{}': {}", chord, e);
                continue;
            }
            state.registered.push(RegisteredAtMentionShortcut { shortcut, target_key });
        }
        Ok(())
    })
}

#[tauri::command]
pub fn cmd_register_at_mention_shortcuts(
    app: AppHandle,
    bindings: HashMap<String, String>,
) -> Result<(), String> {
    register_at_mention_shortcuts(&app, bindings)
}
