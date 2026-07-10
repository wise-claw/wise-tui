//! 主工作区窗口：支持多开（类似 VS Code New Window），共享后端数据、按窗口隔离 tabs。

use std::fs;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::app_state_commands::load_repositories;
use crate::wise_db::WiseDb;
use crate::wise_paths::{self, sanitize_window_label_for_filename};

pub const PRIMARY_MAIN_WINDOW_LABEL: &str = "main";
pub const AUX_MAIN_WINDOW_LABEL_PREFIX: &str = "main-dock";

pub fn is_main_workspace_window_label(label: &str) -> bool {
    label == PRIMARY_MAIN_WINDOW_LABEL || label.starts_with(AUX_MAIN_WINDOW_LABEL_PREFIX)
}

pub fn is_primary_main_workspace_window_label(label: &str) -> bool {
    label == PRIMARY_MAIN_WINDOW_LABEL
}

pub fn workspace_window_selection_storage_key(window_label: &str) -> String {
    format!(
        "wise.workspace.windowSelection.v1:{}",
        sanitize_window_label_for_filename(window_label)
    )
}

pub fn workspace_window_multi_pane_storage_key(window_label: &str) -> String {
    format!(
        "wise.mainLayout.multiPaneState.v1:{}",
        sanitize_window_label_for_filename(window_label)
    )
}

/// 辅助窗销毁后清理按窗隔离的 tabs 与侧栏选中快照。
pub fn cleanup_aux_main_workspace_window_assets(app: &AppHandle, window_label: &str) {
    if !window_label.starts_with(AUX_MAIN_WINDOW_LABEL_PREFIX) {
        return;
    }
    if let Ok(path) = wise_paths::wise_tabs_json_for_window(Some(window_label)) {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    if let Some(db) = app.try_state::<WiseDb>() {
        let selection_key = workspace_window_selection_storage_key(window_label);
        let _ = db.delete_setting(&selection_key);
        let multi_pane_key = workspace_window_multi_pane_storage_key(window_label);
        let _ = db.delete_setting(&multi_pane_key);
    }
}

fn initial_window_title(app: &AppHandle, repository_id: Option<i64>) -> String {
    let Some(repo_id) = repository_id else {
        return "Wise".to_string();
    };
    load_repositories(app)
        .into_iter()
        .find(|repo| repo.id == repo_id)
        .map(|repo| {
            let name = repo.name.trim();
            if name.is_empty() {
                "Wise".to_string()
            } else {
                format!("Wise — {name}")
            }
        })
        .unwrap_or_else(|| "Wise".to_string())
}

fn focus_window(win: &tauri::WebviewWindow) -> Result<(), String> {
    let _ = win.unminimize();
    win.show().map_err(|e| e.to_string())?;
    win.set_focus().map_err(|e| e.to_string())
}

/// 解析应接收全局快捷键/前台操作的主工作区窗口。
pub fn resolve_main_workspace_window_for_focus(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let mut focused: Option<tauri::WebviewWindow> = None;
    let mut primary: Option<tauri::WebviewWindow> = None;
    let mut any_aux: Option<tauri::WebviewWindow> = None;

    for (label, window) in app.webview_windows() {
        if !is_main_workspace_window_label(&label) {
            continue;
        }
        if window.is_focused().unwrap_or(false) {
            focused = Some(window);
            break;
        }
        if label == PRIMARY_MAIN_WINDOW_LABEL {
            primary = Some(window);
        } else if any_aux.is_none() {
            any_aux = Some(window);
        }
    }

    focused.or(primary).or(any_aux)
}

/// 聚焦最近使用的主工作区窗口；优先已聚焦窗口，其次 `main`，再其它辅助窗。
pub fn focus_main_workspace_window(app: &AppHandle) -> Result<(), String> {
    let win = resolve_main_workspace_window_for_focus(app).ok_or_else(|| "未找到 Wise 主窗口".to_string())?;
    focus_window(&win)
}

pub fn open_main_workspace_window(
    app: &AppHandle,
    repository_id: Option<i64>,
) -> Result<String, String> {
    let label = format!(
        "{AUX_MAIN_WINDOW_LABEL_PREFIX}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    );
    let mut route = String::from("index.html");
    if let Some(repo_id) = repository_id {
        route.push_str(&format!("?dockRepoId={repo_id}"));
    }

    let title = initial_window_title(app, repository_id);
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(route.into()))
        .title(title)
        .inner_size(1060.0, 700.0)
        // 与主窗口 tauri.conf.json 的 `dragDropEnabled:false` 对齐：禁用 Tauri 原生拖拽拦截，
        // 否则辅助窗口内 webview 的 HTML5 dragover/drop 事件会被抑制，文件树/系统文件拖到会话输入框均无法放入。
        .disable_drag_drop_handler();

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay);
    }

    let win = builder
        .build()
        .map_err(|e| e.to_string())?;
    focus_window(&win)?;
    Ok(label)
}

/// 关闭当前聚焦的主工作区窗口；主窗在 macOS 上为隐藏应用。
pub fn close_focused_main_workspace_window(app: &AppHandle) -> Result<(), String> {
    for (label, win) in app.webview_windows() {
        if !is_main_workspace_window_label(&label) || !win.is_focused().unwrap_or(false) {
            continue;
        }
        if is_primary_main_workspace_window_label(&label) {
            #[cfg(target_os = "macos")]
            {
                app.hide().map_err(|e| e.to_string())?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                win.close().map_err(|e| e.to_string())?;
            }
        } else {
            win.close().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    focus_main_workspace_window(app)?;
    for (label, win) in app.webview_windows() {
        if !is_main_workspace_window_label(&label) || !win.is_focused().unwrap_or(false) {
            continue;
        }
        if is_primary_main_workspace_window_label(&label) {
            #[cfg(target_os = "macos")]
            {
                app.hide().map_err(|e| e.to_string())?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                win.close().map_err(|e| e.to_string())?;
            }
        } else {
            win.close().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    Err("未找到可关闭的主工作区窗口".to_string())
}

#[tauri::command]
pub fn wise_open_main_window(
    app: AppHandle,
    repository_id: Option<i64>,
) -> Result<String, String> {
    open_main_workspace_window(&app, repository_id)
}

#[tauri::command]
pub fn wise_close_main_workspace_window(app: AppHandle) -> Result<(), String> {
    close_focused_main_workspace_window(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_main_workspace_labels() {
        assert!(is_main_workspace_window_label("main"));
        assert!(is_main_workspace_window_label("main-dock-123"));
        assert!(!is_main_workspace_window_label("mascot"));
    }

    #[test]
    fn primary_label_is_exclusive() {
        assert!(is_primary_main_workspace_window_label("main"));
        assert!(!is_primary_main_workspace_window_label("main-dock-1"));
    }

    #[test]
    fn workspace_selection_key_matches_frontend() {
        assert_eq!(
            workspace_window_selection_storage_key("main-dock-123"),
            "wise.workspace.windowSelection.v1:main-dock-123"
        );
    }

    #[test]
    fn workspace_multi_pane_key_matches_frontend() {
        assert_eq!(
            workspace_window_multi_pane_storage_key("main-dock-123"),
            "wise.mainLayout.multiPaneState.v1:main-dock-123"
        );
    }
}
