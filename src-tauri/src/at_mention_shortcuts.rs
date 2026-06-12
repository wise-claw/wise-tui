//! 全局 @提及 快捷键：将用户配置的 chord（如 Mod+Shift+Digit2）注册为系统级全局快捷键。

use keyboard_types::{Code, Modifiers};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

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

fn parse_chord_to_shortcut(chord: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = chord.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return Err(format!("chord must have at least one modifier and one key: {}", chord));
    }

    let mut mods = Modifiers::empty();
    let mut code_str = "";

    for part in &parts {
        let lower = part.to_lowercase();
        match lower.as_str() {
            "mod" | "meta" | "control" | "ctrl" | "cmd" | "command" => {
                #[cfg(target_os = "macos")]
                { mods |= Modifiers::SUPER; }
                #[cfg(not(target_os = "macos"))]
                { mods |= Modifiers::CONTROL; }
            }
            "alt" | "option" => {
                mods |= Modifiers::ALT;
            }
            "shift" => {
                mods |= Modifiers::SHIFT;
            }
            _ => {
                code_str = *part;
            }
        }
    }

    if code_str.is_empty() {
        return Err(format!("chord missing key code: {}", chord));
    }

    let code = parse_code(code_str)?;
    let shortcut = if mods.is_empty() {
        Shortcut::new(None, code)
    } else {
        Shortcut::new(Some(mods), code)
    };
    Ok(shortcut)
}

fn parse_code(s: &str) -> Result<Code, String> {
    let upper = s.to_uppercase();
    // KeyA .. KeyZ
    if upper.starts_with("KEY") && upper.len() == 4 {
        let c = upper.as_bytes()[3];
        if (b'A'..=b'Z').contains(&c) {
            return match c {
                b'A' => Ok(Code::KeyA),
                b'B' => Ok(Code::KeyB),
                b'C' => Ok(Code::KeyC),
                b'D' => Ok(Code::KeyD),
                b'E' => Ok(Code::KeyE),
                b'F' => Ok(Code::KeyF),
                b'G' => Ok(Code::KeyG),
                b'H' => Ok(Code::KeyH),
                b'I' => Ok(Code::KeyI),
                b'J' => Ok(Code::KeyJ),
                b'K' => Ok(Code::KeyK),
                b'L' => Ok(Code::KeyL),
                b'M' => Ok(Code::KeyM),
                b'N' => Ok(Code::KeyN),
                b'O' => Ok(Code::KeyO),
                b'P' => Ok(Code::KeyP),
                b'Q' => Ok(Code::KeyQ),
                b'R' => Ok(Code::KeyR),
                b'S' => Ok(Code::KeyS),
                b'T' => Ok(Code::KeyT),
                b'U' => Ok(Code::KeyU),
                b'V' => Ok(Code::KeyV),
                b'W' => Ok(Code::KeyW),
                b'X' => Ok(Code::KeyX),
                b'Y' => Ok(Code::KeyY),
                b'Z' => Ok(Code::KeyZ),
                _ => unreachable!(),
            };
        }
    }
    // Digit0 .. Digit9
    if upper.starts_with("DIGIT") && upper.len() == 6 {
        let c = upper.as_bytes()[5];
        if (b'0'..=b'9').contains(&c) {
            return match c {
                b'0' => Ok(Code::Digit0),
                b'1' => Ok(Code::Digit1),
                b'2' => Ok(Code::Digit2),
                b'3' => Ok(Code::Digit3),
                b'4' => Ok(Code::Digit4),
                b'5' => Ok(Code::Digit5),
                b'6' => Ok(Code::Digit6),
                b'7' => Ok(Code::Digit7),
                b'8' => Ok(Code::Digit8),
                b'9' => Ok(Code::Digit9),
                _ => unreachable!(),
            };
        }
    }
    // Named codes
    match upper.as_str() {
        "BACKQUOTE" => Ok(Code::Backquote),
        "MINUS" => Ok(Code::Minus),
        "EQUAL" => Ok(Code::Equal),
        "BRACKETLEFT" => Ok(Code::BracketLeft),
        "BRACKETRIGHT" => Ok(Code::BracketRight),
        "SEMICOLON" => Ok(Code::Semicolon),
        "QUOTE" => Ok(Code::Quote),
        "COMMA" => Ok(Code::Comma),
        "PERIOD" => Ok(Code::Period),
        "SLASH" => Ok(Code::Slash),
        "BACKSLASH" => Ok(Code::Backslash),
        "BACKSPACE" => Ok(Code::Backspace),
        "TAB" => Ok(Code::Tab),
        "ENTER" | "RETURN" => Ok(Code::Enter),
        "ESCAPE" | "ESC" => Ok(Code::Escape),
        "SPACE" => Ok(Code::Space),
        "F1" => Ok(Code::F1),
        "F2" => Ok(Code::F2),
        "F3" => Ok(Code::F3),
        "F4" => Ok(Code::F4),
        "F5" => Ok(Code::F5),
        "F6" => Ok(Code::F6),
        "F7" => Ok(Code::F7),
        "F8" => Ok(Code::F8),
        "F9" => Ok(Code::F9),
        "F10" => Ok(Code::F10),
        "F11" => Ok(Code::F11),
        "F12" => Ok(Code::F12),
        "ARROWUP" | "UP" => Ok(Code::ArrowUp),
        "ARROWDOWN" | "DOWN" => Ok(Code::ArrowDown),
        "ARROWLEFT" | "LEFT" => Ok(Code::ArrowLeft),
        "ARROWRIGHT" | "RIGHT" => Ok(Code::ArrowRight),
        _ => Err(format!("unsupported code: {}", s)),
    }
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
                let Some(win) = crate::main_window::resolve_main_workspace_window_for_focus(&app_clone) else {
                    let _ = app_clone.emit("global-at-mention-shortcut", payload);
                    return;
                };
                let _ = crate::main_window::focus_main_workspace_window(&app_clone);
                let _ = win.emit("global-at-mention-shortcut", payload);
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
