//! Hermes 风格 HUD：无边框置顶胶囊输入条，主工作区窗口让出桌面。

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::main_window;
use crate::wise_db::WiseDb;

pub const HUD_WINDOW_LABEL: &str = "hud";
pub const HUD_ACTIVE_EVENT: &str = "wise-hud-active-changed";

const HUD_BOUNDS_SETTING_KEY: &str = "wise.hud.window.v1";
const DEFAULT_HUD_WIDTH: f64 = 720.0;
/// 与前端 `HUD_RESTING_OVERLAY_HEIGHT` 对齐：空闲态也保持菜单高度，点按钮不再拉伸窗口。
const DEFAULT_HUD_HEIGHT: f64 = 420.0;
const HUD_COMPACT_LOGICAL_HEIGHT: f64 = 64.0;
const HUD_BOTTOM_MARGIN: i32 = 48;

/// 只改高度，保持窗口底边不动，避免胶囊在屏幕上跳。
fn overlay_frame_keeping_bottom(
    current_y: i32,
    current_height: u32,
    desired_height: u32,
    min_height: u32,
    monitor_top: i32,
) -> (i32, u32) {
    let bottom = current_y.saturating_add(current_height as i32);
    let max_height = (bottom - monitor_top).max(min_height as i32) as u32;
    let new_h = desired_height.clamp(min_height, max_height.max(min_height));
    let new_y = bottom - new_h as i32;
    (new_y, new_h)
}

fn overlay_height_already_applied(current: f64, desired: f64) -> bool {
    (current - desired).abs() < 0.5
}

/// Cocoa 原点在左下：保持 `window_bottom`，只改高度，窗口向上长/缩。
fn cocoa_overlay_height_keeping_bottom(
    desired_height: f64,
    min_height: f64,
    window_bottom: f64,
    work_area_top: f64,
) -> f64 {
    let max_height = (work_area_top - window_bottom).max(min_height);
    desired_height.max(min_height).min(max_height)
}

fn hud_set_overlay_height(win: &WebviewWindow, logical_height: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return hud_set_overlay_height_macos(win, logical_height);
    }
    #[cfg(not(target_os = "macos"))]
    {
        hud_set_overlay_height_cross_platform(win, logical_height)
    }
}

/// 分两步改 frame 时胶囊会先跳后回。非 macOS 仍走这条路径。
fn hud_set_overlay_height_cross_platform(
    win: &WebviewWindow,
    logical_height: f64,
) -> Result<(), String> {
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let min_h = (HUD_COMPACT_LOGICAL_HEIGHT * scale).round().max(1.0) as u32;
    let desired = (logical_height.max(HUD_COMPACT_LOGICAL_HEIGHT) * scale)
        .round()
        .max(1.0) as u32;
    let monitor_top = win
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.work_area().position.y)
        .unwrap_or(0);
    let (new_y, new_h) = overlay_frame_keeping_bottom(pos.y, size.height, desired, min_h, monitor_top);
    if new_h == size.height && new_y == pos.y {
        return Ok(());
    }
    let growing = new_h > size.height;
    if growing {
        win.set_position(PhysicalPosition::new(pos.x, new_y))
            .map_err(|e| e.to_string())?;
        win.set_size(PhysicalSize::new(size.width, new_h))
            .map_err(|e| e.to_string())?;
    } else {
        win.set_size(PhysicalSize::new(size.width, new_h))
            .map_err(|e| e.to_string())?;
        win.set_position(PhysicalPosition::new(pos.x, new_y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn hud_set_overlay_height_macos(win: &WebviewWindow, logical_height: f64) -> Result<(), String> {
    if objc2::MainThreadMarker::new().is_some() {
        return unsafe { hud_apply_overlay_height_macos(win, logical_height) };
    }
    let win = win.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    win.clone()
        .run_on_main_thread(move || {
            let result = unsafe { hud_apply_overlay_height_macos(&win, logical_height) };
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv()
        .unwrap_or_else(|_| Err("HUD 主线程未响应".into()))
}

/// 一次 `setFrame` 只改高度、底边不动，避免先 set_position 再 set_size 把胶囊闪一下。
#[cfg(target_os = "macos")]
unsafe fn hud_apply_overlay_height_macos(
    win: &WebviewWindow,
    logical_height: f64,
) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let Ok(ptr) = win.ns_window() else {
        return hud_set_overlay_height_cross_platform(win, logical_height);
    };
    if ptr.is_null() {
        return hud_set_overlay_height_cross_platform(win, logical_height);
    }
    let obj = ptr as *const AnyObject;
    let frame: NSRect = objc2::msg_send![obj, frame];
    let desired = logical_height.max(HUD_COMPACT_LOGICAL_HEIGHT);
    let screen: *const AnyObject = objc2::msg_send![obj, screen];
    let work_area_top = if screen.is_null() {
        frame.origin.y + desired.max(frame.size.height)
    } else {
        let visible: NSRect = objc2::msg_send![screen, visibleFrame];
        visible.origin.y + visible.size.height
    };
    let new_h = cocoa_overlay_height_keeping_bottom(
        desired,
        HUD_COMPACT_LOGICAL_HEIGHT,
        frame.origin.y,
        work_area_top,
    );
    if overlay_height_already_applied(frame.size.height, new_h) {
        return Ok(());
    }
    let new_frame = NSRect {
        origin: NSPoint {
            x: frame.origin.x,
            y: frame.origin.y,
        },
        size: NSSize {
            width: frame.size.width,
            height: new_h,
        },
    };
    let _: () = objc2::msg_send![obj, setFrame: new_frame, display: true, animate: false];
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HudBounds {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub width: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudActiveChanged {
    pub active: bool,
}

#[cfg(test)]
fn is_hud_window_label(label: &str) -> bool {
    label == HUD_WINDOW_LABEL
}

fn hud_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(HUD_WINDOW_LABEL)
        .ok_or_else(|| "hud 窗口未注册（检查 tauri.conf.json）".to_string())
}

fn emit_active(app: &AppHandle, active: bool) {
    let _ = app.emit(HUD_ACTIVE_EVENT, HudActiveChanged { active });
}

fn parse_hud_bounds(raw: &str) -> Option<HudBounds> {
    let parsed: HudBounds = serde_json::from_str(raw).ok()?;
    Some(parsed)
}

fn load_hud_bounds(db: &WiseDb) -> Option<HudBounds> {
    let raw = db.get_setting(HUD_BOUNDS_SETTING_KEY).ok().flatten()?;
    parse_hud_bounds(&raw)
}

fn save_hud_bounds_value(db: &WiseDb, bounds: &HudBounds) -> Result<(), String> {
    let raw = serde_json::to_string(bounds).map_err(|e| e.to_string())?;
    db.set_setting(HUD_BOUNDS_SETTING_KEY, &raw)
}

fn clamp_hud_to_monitor(
    win: &WebviewWindow,
    mut x: i32,
    mut y: i32,
) -> Result<(i32, i32), String> {
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let win_w = size.width as i32;
    let win_h = size.height as i32;
    let cx = x as f64 + (win_w.max(1) as f64) * 0.5;
    let cy = y as f64 + (win_h.max(1) as f64) * 0.5;
    let mon = win
        .monitor_from_point(cx, cy)
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    if let Some(m) = mon {
        let wa = m.work_area();
        let px = wa.position.x;
        let py = wa.position.y;
        let pw = wa.size.width as i32;
        let ph = wa.size.height as i32;
        x = x.max(px);
        y = y.max(py);
        if pw >= win_w {
            x = x.min(px + pw - win_w);
        } else {
            x = px;
        }
        if ph >= win_h {
            y = y.min(py + ph - win_h);
        } else {
            y = py;
        }
    }
    Ok((x, y))
}

fn apply_hud_size(win: &WebviewWindow, width: f64) -> Result<(), String> {
    let w = width.clamp(560.0, 1200.0);
    win.set_size(LogicalSize::new(w, DEFAULT_HUD_HEIGHT))
        .map_err(|e| e.to_string())
}

fn place_hud_default(win: &WebviewWindow) -> Result<(), String> {
    let _ = apply_hud_size(win, DEFAULT_HUD_WIDTH);
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let win_w = size.width as i32;
    let win_h = size.height as i32;
    let cursor = win.cursor_position().ok();
    let mon = cursor
        .and_then(|pos| win.monitor_from_point(pos.x, pos.y).ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(m) = mon else {
        return Ok(());
    };
    let wa = m.work_area();
    let x = wa.position.x + ((wa.size.width as i32 - win_w) / 2).max(0);
    let y = wa.position.y + wa.size.height as i32 - win_h - HUD_BOTTOM_MARGIN;
    let (nx, ny) = clamp_hud_to_monitor(win, x, y)?;
    win.set_position(tauri::Position::Physical(PhysicalPosition::new(nx, ny)))
        .map_err(|e| e.to_string())
}

fn apply_saved_or_default_bounds(win: &WebviewWindow, db: &WiseDb) -> Result<(), String> {
    if let Some(bounds) = load_hud_bounds(db) {
        let width = bounds.width.unwrap_or(DEFAULT_HUD_WIDTH).max(DEFAULT_HUD_WIDTH);
        let _ = apply_hud_size(win, width);
        let (nx, ny) = clamp_hud_to_monitor(win, bounds.x, bounds.y)?;
        win.set_position(tauri::Position::Physical(PhysicalPosition::new(nx, ny)))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    place_hud_default(win)
}

fn hide_main_workspace_windows(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if main_window::is_main_workspace_window_label(&label) {
            let _ = win.hide();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComposerShortcutSurface {
    Hud,
    Main,
}

/// HUD 开着时会话快捷键只打 HUD；否则只打主工作区。
pub fn resolve_composer_shortcut_surface(hud_visible: bool) -> ComposerShortcutSurface {
    if hud_visible {
        ComposerShortcutSurface::Hud
    } else {
        ComposerShortcutSurface::Main
    }
}

/// 只向当前输入面派发，避免 `app.emit` 让主窗和 HUD 同时响应。
pub fn emit_to_active_composer_surface<S: serde::Serialize + Clone>(
    app: &AppHandle,
    event: &str,
    payload: S,
) {
    if resolve_composer_shortcut_surface(hud_is_visible(app)) == ComposerShortcutSurface::Hud {
        if let Ok(hud) = hud_window(app) {
            let _ = hud.emit(event, payload);
            return;
        }
    }
    crate::main_window::emit_to_focused_main_workspace_window(app, event, payload);
}

/// 聚焦当前输入面：HUD 开着时不要把主窗口重新 show 出来。
pub fn focus_active_composer_surface(app: &AppHandle) -> Result<(), String> {
    if resolve_composer_shortcut_surface(hud_is_visible(app)) == ComposerShortcutSurface::Hud {
        let hud = hud_window(app)?;
        let _ = hud.set_always_on_top(true);
        let _ = hud.unminimize();
        hud.show().map_err(|e| e.to_string())?;
        hud.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    crate::main_window::focus_main_workspace_window(app)
}

fn show_main_workspace_windows(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if main_window::is_main_workspace_window_label(&label) {
            let _ = win.unminimize();
            let _ = win.show();
            #[cfg(target_os = "macos")]
            main_window::disable_native_overlay_titlebar_drag(&win);
        }
    }
    let _ = main_window::focus_main_workspace_window(app);
}

pub fn hud_is_visible(app: &AppHandle) -> bool {
    app.get_webview_window(HUD_WINDOW_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

pub fn hud_enter(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    let hud = hud_window(app)?;
    let _ = hud.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    apply_saved_or_default_bounds(&hud, db)?;
    let _ = hud.set_always_on_top(true);
    let _ = hud.set_skip_taskbar(true);
    let _ = hud.unminimize();
    hud.show().map_err(|e| e.to_string())?;
    hide_main_workspace_windows(app);
    let _ = hud.set_focus();
    emit_active(app, true);
    Ok(())
}

pub fn hud_exit(app: &AppHandle) -> Result<(), String> {
    if let Ok(hud) = hud_window(app) {
        let _ = hud.hide();
    }
    show_main_workspace_windows(app);
    emit_active(app, false);
    Ok(())
}

pub fn hud_toggle(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    if hud_is_visible(app) {
        hud_exit(app)
    } else {
        hud_enter(app, db)
    }
}

pub fn hud_snap_to_cursor(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    if !hud_is_visible(app) {
        hud_enter(app, db)?;
    }
    let hud = hud_window(app)?;
    let size = hud.outer_size().map_err(|e| e.to_string())?;
    let cursor = hud.cursor_position().map_err(|e| e.to_string())?;
    let x = cursor.x.round() as i32 - (size.width as i32 / 2);
    let y = cursor.y.round() as i32 - (size.height as i32 / 2);
    let (nx, ny) = clamp_hud_to_monitor(&hud, x, y)?;
    hud.set_position(tauri::Position::Physical(PhysicalPosition::new(nx, ny)))
        .map_err(|e| e.to_string())?;
    let _ = save_hud_bounds_value(
        db,
        &HudBounds {
            x: nx,
            y: ny,
            width: load_hud_bounds(db).and_then(|b| b.width).or(Some(DEFAULT_HUD_WIDTH)),
        },
    );
    let _ = hud.set_always_on_top(true);
    let _ = hud.set_focus();
    Ok(())
}

#[tauri::command]
pub fn wise_hud_toggle(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    hud_toggle(&app, &db)
}

#[tauri::command]
pub fn wise_hud_enter(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    hud_enter(&app, &db)
}

#[tauri::command]
pub fn wise_hud_exit(app: AppHandle) -> Result<(), String> {
    hud_exit(&app)
}

#[tauri::command]
pub fn wise_hud_snap_to_cursor(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    hud_snap_to_cursor(&app, &db)
}

#[tauri::command]
pub fn wise_hud_reset_layout(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    let _ = db.delete_setting(HUD_BOUNDS_SETTING_KEY);
    let hud = hud_window(&app)?;
    place_hud_default(&hud)?;
    Ok(())
}

#[tauri::command]
pub fn wise_hud_save_bounds(db: State<WiseDb>, x: i32, y: i32, width: Option<f64>) -> Result<(), String> {
    save_hud_bounds_value(
        &db,
        &HudBounds {
            x,
            y,
            width: width.filter(|w| w.is_finite() && *w >= 560.0),
        },
    )
}

#[tauri::command]
pub fn wise_hud_is_active(app: AppHandle) -> bool {
    hud_is_visible(&app)
}

#[tauri::command]
pub fn wise_focus_composer_surface(app: AppHandle) -> Result<(), String> {
    focus_active_composer_surface(&app)
}

#[tauri::command]
pub fn wise_hud_set_overlay_height(app: AppHandle, height: f64) -> Result<(), String> {
    let hud = hud_window(&app)?;
    hud_set_overlay_height(&hud, height)
}

const HUD_FORWARD_EVENTS: &[&str] = &[
    "wise-hud-submit",
    "wise-hud-cancel",
    "wise-hud-request-state",
    "wise-hud-select-repository",
    "wise-hud-new-session",
    "wise-hud-set-engine",
    "wise-hud-set-model",
    "wise-hud-set-details-open",
    "wise-hud-activate-assistant",
];

fn is_hud_forward_event(event: &str) -> bool {
    HUD_FORWARD_EVENTS.contains(&event)
}

/// HUD 窗把提交/选仓库等打到主窗。全局 JS emit 在主窗 hide 后经常丢；必须 `main.emit`。
#[tauri::command]
pub fn wise_hud_emit_to_main(
    app: AppHandle,
    event: String,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    if !is_hud_forward_event(&event) {
        return Err(format!("拒绝转发未知 HUD 事件：{event}"));
    }
    main_window::emit_to_primary_main_workspace_window(&app, &event, payload);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hud_label_is_exclusive() {
        assert!(is_hud_window_label("hud"));
        assert!(!is_hud_window_label("main"));
        assert!(!is_hud_window_label("mascot"));
    }

    #[test]
    fn parses_saved_bounds() {
        let bounds = parse_hud_bounds(r#"{"x":12,"y":40,"width":720}"#).expect("bounds");
        assert_eq!(
            bounds,
            HudBounds {
                x: 12,
                y: 40,
                width: Some(720.0)
            }
        );
    }

    #[test]
    fn parses_bounds_without_width() {
        let bounds = parse_hud_bounds(r#"{"x":1,"y":2}"#).expect("bounds");
        assert_eq!(bounds.x, 1);
        assert_eq!(bounds.y, 2);
        assert_eq!(bounds.width, None);
    }

    #[test]
    fn rejects_invalid_bounds() {
        assert!(parse_hud_bounds("nope").is_none());
        assert!(parse_hud_bounds("{}").is_none());
    }

    #[test]
    fn overlay_grows_up_without_moving_bottom() {
        let (y, h) = overlay_frame_keeping_bottom(900, 56, 360, 56, 0);
        assert_eq!(h, 360);
        assert_eq!(y, 596);
        assert_eq!(y + h as i32, 956);
    }

    #[test]
    fn overlay_shrink_restores_compact_origin() {
        let (y, h) = overlay_frame_keeping_bottom(596, 360, 56, 56, 0);
        assert_eq!((y, h), (900, 56));
    }

    #[test]
    fn overlay_clamps_to_monitor_top_without_moving_bottom() {
        let (y, h) = overlay_frame_keeping_bottom(40, 56, 360, 56, 0);
        assert_eq!(y, 0);
        assert_eq!(h, 96);
        assert_eq!(y + h as i32, 96);
    }

    #[test]
    fn cocoa_overlay_grows_height_without_moving_bottom() {
        let height = cocoa_overlay_height_keeping_bottom(400.0, 64.0, 48.0, 1080.0);
        assert_eq!(height, 400.0);
    }

    #[test]
    fn cocoa_overlay_clamps_to_work_area_top() {
        let height = cocoa_overlay_height_keeping_bottom(400.0, 64.0, 1000.0, 1080.0);
        assert_eq!(height, 80.0);
    }

    #[test]
    fn overlay_height_skips_subpixel_noop() {
        assert!(overlay_height_already_applied(400.0, 400.2));
        assert!(!overlay_height_already_applied(64.0, 400.0));
    }

    #[test]
    fn only_forwards_known_hud_events() {
        assert!(is_hud_forward_event("wise-hud-submit"));
        assert!(is_hud_forward_event("wise-hud-new-session"));
        assert!(is_hud_forward_event("wise-hud-set-engine"));
        assert!(is_hud_forward_event("wise-hud-set-model"));
        assert!(is_hud_forward_event("wise-hud-set-details-open"));
        assert!(is_hud_forward_event("wise-hud-activate-assistant"));
        assert!(!is_hud_forward_event("wise-hud-active-changed"));
        assert!(!is_hud_forward_event("wise-hud-state"));
        assert!(!is_hud_forward_event(""));
    }

    #[test]
    fn composer_shortcuts_target_hud_only_when_hud_visible() {
        assert_eq!(
            resolve_composer_shortcut_surface(true),
            ComposerShortcutSurface::Hud
        );
        assert_eq!(
            resolve_composer_shortcut_surface(false),
            ComposerShortcutSurface::Main
        );
    }
}
