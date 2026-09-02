//! 仓库操作快捷键：将用户配置的「打开终端 / 打开编辑器」chord 注册为系统级全局快捷键。
//! 应用未聚焦时也可触发，由主窗根据当前选中仓库执行打开动作。

use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::shortcut_chord::parse_chord_to_shortcut;

pub const GLOBAL_REPOSITORY_ACTION_SHORTCUT_EVENT: &str = "global-repository-action-shortcut";

#[derive(Debug, Clone, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryActionShortcutBindings {
    #[serde(default)]
    pub terminal_shortcut: String,
    #[serde(default)]
    pub editor_shortcut: String,
}

#[derive(Debug, Clone, Copy)]
enum RepositoryActionKind {
    Terminal,
    Editor,
}

impl RepositoryActionKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Terminal => "terminal",
            Self::Editor => "editor",
        }
    }
}

struct RepositoryActionShortcutState {
    registered: Vec<Shortcut>,
}

impl RepositoryActionShortcutState {
    fn new() -> Self {
        Self {
            registered: Vec::new(),
        }
    }
}

pub fn init(app: &AppHandle) {
    app.manage(Mutex::new(RepositoryActionShortcutState::new()));
}

fn with_state<F, R>(app: &AppHandle, f: F) -> Result<R, String>
where
    F: FnOnce(&mut RepositoryActionShortcutState) -> Result<R, String>,
{
    let state = app.state::<Mutex<RepositoryActionShortcutState>>();
    let mut guard = state
        .lock()
        .map_err(|_| "repository_action_shortcuts lock poisoned".to_string())?;
    f(&mut guard)
}

fn register_one(
    app: &AppHandle,
    chord: &str,
    action: RepositoryActionKind,
    registered: &mut Vec<Shortcut>,
) {
    let chord = chord.trim();
    if chord.is_empty() {
        return;
    }
    let shortcut = match parse_chord_to_shortcut(chord) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "[repository_action_shortcuts] skip invalid chord '{}': {}",
                chord, e
            );
            return;
        }
    };
    if app.global_shortcut().is_registered(shortcut.clone()) {
        let _ = app.global_shortcut().unregister(shortcut.clone());
    }
    let app_clone = app.clone();
    if let Err(e) = app.global_shortcut().on_shortcut(shortcut.clone(), move |_app, _sc, event| {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        crate::main_window::emit_to_focused_main_workspace_window(
            &app_clone,
            GLOBAL_REPOSITORY_ACTION_SHORTCUT_EVENT,
            serde_json::json!({ "action": action.as_str() }),
        );
    }) {
        eprintln!(
            "[repository_action_shortcuts] failed to register '{}': {}",
            chord, e
        );
        return;
    }
    registered.push(shortcut);
}

pub fn register_repository_action_shortcuts(
    app: &AppHandle,
    bindings: RepositoryActionShortcutBindings,
) -> Result<(), String> {
    with_state(app, |state| {
        for shortcut in &state.registered {
            let _ = app.global_shortcut().unregister(shortcut.clone());
        }
        state.registered.clear();

        register_one(
            app,
            &bindings.terminal_shortcut,
            RepositoryActionKind::Terminal,
            &mut state.registered,
        );
        let editor = bindings.editor_shortcut.trim();
        let terminal = bindings.terminal_shortcut.trim();
        if !editor.is_empty() && editor != terminal {
            register_one(
                app,
                &bindings.editor_shortcut,
                RepositoryActionKind::Editor,
                &mut state.registered,
            );
        }
        Ok(())
    })
}

#[tauri::command]
pub fn cmd_register_repository_action_shortcuts(
    app: AppHandle,
    bindings: RepositoryActionShortcutBindings,
) -> Result<(), String> {
    register_repository_action_shortcuts(&app, bindings)
}
