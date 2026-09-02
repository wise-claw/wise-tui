//! 将前端存储的 chord（如 `Mod+Alt+KeyT`）解析为 Tauri 全局快捷键。

use keyboard_types::{Code, Modifiers};
use tauri_plugin_global_shortcut::Shortcut;

pub(crate) fn parse_chord_to_shortcut(chord: &str) -> Result<Shortcut, String> {
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
                {
                    mods |= Modifiers::SUPER;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    mods |= Modifiers::CONTROL;
                }
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
