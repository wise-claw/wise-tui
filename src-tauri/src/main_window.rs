//! 主工作区窗口：支持多开（类似 VS Code New Window），共享后端数据、按窗口隔离 tabs。

use std::fs;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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

/// Overlay 标题栏会在按下时自己拖窗口；再叠 `data-tauri-drag-region` 就会瞬移。
/// 关掉系统标题栏拖动，只保留我们在 LeftMouseDown 里按光标窗口坐标调用的 startDragging。
#[cfg(target_os = "macos")]
pub fn disable_native_overlay_titlebar_drag(win: &tauri::WebviewWindow) {
    let win = win.clone();
    let _ = win.clone().run_on_main_thread(move || {
        let Ok(ptr) = win.ns_window() else {
            return;
        };
        if ptr.is_null() {
            return;
        }
        unsafe {
            let obj = ptr as *const objc2::runtime::AnyObject;
            let _: () = objc2::msg_send![obj, setMovable: false];
            let _: () = objc2::msg_send![obj, setMovableByWindowBackground: false];
        }
    });
}

/// Overlay 顶栏必须在 LeftMouseDown 当下调用 `performWindowDragWithEvent:`。
/// 抓取点用窗口内当前光标，避免 hide/show（HUD 切回）后 webview 事件坐标过期导致单击偏移。
#[cfg(target_os = "macos")]
fn perform_overlay_chrome_drag(
    ns_window: *const objc2::runtime::AnyObject,
    event: Option<&objc2_app_kit::NSEvent>,
) {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSEvent;
    use objc2_foundation::NSPoint;

    unsafe {
        let screen = NSEvent::mouseLocation();
        let grab: NSPoint = objc2::msg_send![ns_window, convertPointFromScreen: screen];
        let window_number: isize = match event {
            Some(current) => current.windowNumber(),
            None => objc2::msg_send![ns_window, windowNumber],
        };
        let flags = event
            .map(|current| current.modifierFlags())
            .unwrap_or(objc2_app_kit::NSEventModifierFlags::empty());
        let timestamp = event.map(|current| current.timestamp()).unwrap_or(0.0);
        let corrected: *mut AnyObject = objc2::msg_send![
            objc2::class!(NSEvent),
            mouseEventWithType: 1usize,
            location: grab,
            modifierFlags: flags,
            timestamp: timestamp,
            windowNumber: window_number,
            context: std::ptr::null::<AnyObject>(),
            eventNumber: 0isize,
            clickCount: 1isize,
            pressure: 1.0f32
        ];
        if !corrected.is_null() {
            let _: () = objc2::msg_send![ns_window, performWindowDragWithEvent: corrected];
        } else if let Some(current) = event {
            let _: () = objc2::msg_send![ns_window, performWindowDragWithEvent: current];
        }
    }
}

/// Overlay 顶栏必须在 LeftMouseDown 当下调用 `performWindowDragWithEvent:`。
/// 抓取点用窗口内当前光标，避免 hide/show（HUD 切回）后 webview 事件坐标过期导致单击偏移。
#[cfg(target_os = "macos")]
fn start_overlay_window_drag_macos(win: &tauri::WebviewWindow) {
    use objc2::MainThreadMarker;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSApplication, NSEvent};

    if NSEvent::pressedMouseButtons() & 1 == 0 {
        return;
    }
    let Ok(ptr) = win.ns_window() else {
        return;
    };
    if ptr.is_null() {
        return;
    }
    let ns_window = ptr as *const AnyObject;
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(mtm);
    perform_overlay_chrome_drag(ns_window, app.currentEvent().as_deref());
}

#[cfg(target_os = "macos")]
fn set_overlay_drag_cursor_macos(kind: &str) {
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

    static MODE: AtomicU8 = AtomicU8::new(0);
    static MONITOR_INSTALLED: AtomicBool = AtomicBool::new(false);

    fn apply(mode: u8) {
        use objc2::runtime::AnyObject;
        unsafe {
            let class = objc2::class!(NSCursor);
            let cursor: *const AnyObject = match mode {
                2 => objc2::msg_send![class, closedHandCursor],
                0 => objc2::msg_send![class, arrowCursor],
                _ => objc2::msg_send![class, openHandCursor],
            };
            if !cursor.is_null() {
                let _: () = objc2::msg_send![cursor, set];
            }
        }
    }

    let mode: u8 = match kind {
        "grabbing" => 2,
        "reset" => 0,
        _ => 1,
    };
    MODE.store(mode, Ordering::Relaxed);
    apply(mode);

    if MONITOR_INSTALLED.swap(true, Ordering::Relaxed) {
        return;
    }
    use std::ptr::NonNull;
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};

    let block = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
        let current = MODE.load(Ordering::Relaxed);
        if current != 0 {
            apply(current);
        }
        event.as_ptr()
    });
    unsafe {
        let _monitor = NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::MouseMoved | NSEventMask::LeftMouseDragged,
            &block,
        );
    }
    std::mem::forget(block);
}

/// Overlay 顶栏在 mousedown 当下调用：用当前光标窗口坐标开始拖，避免单击偏移。
#[tauri::command]
pub fn start_overlay_window_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        window
            .clone()
            .run_on_main_thread(move || {
                start_overlay_window_drag_macos(&window);
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.start_dragging().map_err(|e| e.to_string())
    }
}

/// Overlay 标题栏会盖住 CSS cursor；悬停拖区时改用系统开/合掌光标。
#[tauri::command]
pub fn set_overlay_drag_cursor(
    window: tauri::WebviewWindow,
    kind: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        window
            .clone()
            .run_on_main_thread(move || {
                set_overlay_drag_cursor_macos(&kind);
            })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, kind);
        Ok(())
    }
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

/// 仅向当前应接收快捷键的主工作区窗口派发事件（避免多开窗口全部响应）。
pub fn emit_to_focused_main_workspace_window<S: serde::Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: S,
) {
    if let Some(win) = resolve_main_workspace_window_for_focus(app) {
        let _ = win.emit(event, payload);
        return;
    }
    let _ = app.emit(event, payload);
}

/// HUD 等非主窗必须打到 `main`：桥接只在主窗 label 上 listen，不能走「当前聚焦窗」。
pub fn emit_to_primary_main_workspace_window<S: serde::Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: S,
) {
    if let Some(win) = app.get_webview_window(PRIMARY_MAIN_WINDOW_LABEL) {
        let _ = win.emit(event, payload);
        return;
    }
    let _ = app.emit(event, payload);
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
    #[cfg(target_os = "macos")]
    disable_native_overlay_titlebar_drag(&win);
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
        assert!(!is_main_workspace_window_label("hud"));
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
