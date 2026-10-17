//! 独立屏幕顶部灵动岛通知，生命周期与 HUD 输入模式无关。
use serde::Serialize;
use crate::wise_db::WiseDb;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State};


const COMPLETION_WINDOW_LABEL: &str = "dynamic-island";
const COMPLETION_EVENT: &str = "wise-island-session-complete";

#[derive(Default)]
pub struct IslandCompletionDelivery {
    ready: bool,
    pending: Vec<serde_json::Value>,
    revision: u64,
}

impl IslandCompletionDelivery {
    fn can_hide(&self, revision: u64) -> bool {
        self.revision == revision && self.pending.is_empty()
    }

    fn ready_batch(&mut self) -> IslandCompletionBatch {
        self.ready = true;
        IslandCompletionBatch { items: std::mem::take(&mut self.pending), revision: self.revision }
    }
}

#[derive(Clone, Serialize)]
pub struct IslandCompletionBatch {
    items: Vec<serde_json::Value>,
    revision: u64,
}

fn island_top_position(left: i32, top: i32, screen_width: u32, window_width: u32, scale: f64) -> (i32, i32) {
    (left + ((screen_width as i32 - window_width as i32) / 2).max(0), top + (8.0 * scale).round() as i32)
}

fn show_completion_window(app: &AppHandle) -> Result<(), String> {
    let win = app.get_webview_window(COMPLETION_WINDOW_LABEL)
        .ok_or("完成通知窗口未初始化")?;
    if !win.is_visible().unwrap_or(false) {
        win.set_size(LogicalSize::new(384.0, 96.0)).map_err(|e| e.to_string())?;
        if let Some(monitor) = win.primary_monitor().map_err(|e| e.to_string())? {
            let area = monitor.work_area();
            let size = win.outer_size().map_err(|e| e.to_string())?;
            let (x, y) = island_top_position(area.position.x, area.position.y, area.size.width, size.width, monitor.scale_factor());
            win.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
        }
    }
    let _ = win.set_always_on_top(true);
    let _ = win.set_visible_on_all_workspaces(true);
    // focusable: false 在窗口配置中禁止通知成为键盘焦点窗口；
    // focus: false 仅影响初始化，不能阻止 show() 抢走会话输入焦点。
    win.show().map_err(|e| e.to_string())
}

fn parse_island_notifications_enabled(raw: Option<&str>) -> bool {
    raw.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .and_then(|config| config.get("showDynamicIslandNotifications").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

fn island_notifications_enabled(db: &WiseDb) -> bool {
    let raw = db.get_setting("wise.defaultConfig.v1").ok().flatten();
    parse_island_notifications_enabled(raw.as_deref())
}

#[derive(Debug, PartialEq)]
enum CompletionSurface { Hud, Island, Hidden }

fn completion_surface(hud_visible: bool, island_enabled: bool) -> CompletionSurface {
    if hud_visible { CompletionSurface::Hud }
    else if island_enabled { CompletionSurface::Island }
    else { CompletionSurface::Hidden }
}

#[tauri::command]
pub fn wise_island_notify_completion(
    app: AppHandle,
    db: State<WiseDb>,
    state: State<std::sync::Mutex<IslandCompletionDelivery>>,
    items: Vec<serde_json::Value>,
) -> Result<(), String> {
    if items.is_empty() { return Ok(()); }
    match completion_surface(crate::wise_hud::hud_is_visible(&app), island_notifications_enabled(&db)) {
        CompletionSurface::Hud => {
            return app.get_webview_window(crate::wise_hud::HUD_WINDOW_LABEL)
                .ok_or("HUD 窗口未初始化")?
                .emit("wise-hud-session-complete", serde_json::json!({ "items": items }))
                .map_err(|e| e.to_string());
        }
        CompletionSurface::Hidden => return Ok(()),
        CompletionSurface::Island => {}
    }
    let mut delivery = state.lock().map_err(|e| e.to_string())?;
    delivery.pending.extend(items);
    delivery.revision += 1;
    if !delivery.ready { return Ok(()); }
    show_completion_window(&app)?;
    let batch = IslandCompletionBatch { items: delivery.pending.clone(), revision: delivery.revision };
    app.get_webview_window(COMPLETION_WINDOW_LABEL).ok_or("完成通知窗口未初始化")?
        .emit(COMPLETION_EVENT, batch).map_err(|e| e.to_string())?;
    delivery.pending.clear();
    Ok(())
}

/// 前端安装监听后再领取首批通知，避免窗口初始化期间事件丢失。
#[tauri::command]
pub fn wise_island_completion_ready(
    app: AppHandle,
    db: State<WiseDb>,
    state: State<std::sync::Mutex<IslandCompletionDelivery>>,
) -> Result<IslandCompletionBatch, String> {
    let mut delivery = state.lock().map_err(|e| e.to_string())?;
    if crate::wise_hud::hud_is_visible(&app) || !island_notifications_enabled(&db) {
        delivery.pending.clear();
    }
    if !delivery.pending.is_empty() { show_completion_window(&app)?; }
    Ok(delivery.ready_batch())
}

/// 旧批次的收起请求不能隐藏刚刚送达的新通知。
#[tauri::command]
pub fn wise_island_completion_hide(
    app: AppHandle,
    state: State<std::sync::Mutex<IslandCompletionDelivery>>,
    revision: u64,
) -> Result<(), String> {
    let delivery = state.lock().map_err(|e| e.to_string())?;
    if delivery.can_hide(revision) {
        if let Some(win) = app.get_webview_window(COMPLETION_WINDOW_LABEL) {
            win.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}


#[cfg(test)]
mod completion_delivery_tests {
    use super::*;

    #[test]
    fn island_window_never_takes_keyboard_focus() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let island = config["app"]["windows"].as_array().unwrap().iter()
            .find(|window| window["label"] == COMPLETION_WINDOW_LABEL).unwrap();
        assert_eq!(island["focus"], false);
        assert_eq!(island["focusable"], false);
    }

    #[test]
    fn hud_completions_stay_near_hud_regardless_of_island_setting() {
        assert_eq!(completion_surface(true, true), CompletionSurface::Hud);
        assert_eq!(completion_surface(true, false), CompletionSurface::Hud);
        assert_eq!(completion_surface(false, true), CompletionSurface::Island);
        assert_eq!(completion_surface(false, false), CompletionSurface::Hidden);
    }

    #[test]
    fn notification_setting_defaults_on_and_respects_explicit_choice() {
        assert!(parse_island_notifications_enabled(None));
        assert!(parse_island_notifications_enabled(Some("{}")));
        assert!(!parse_island_notifications_enabled(Some(r#"{"showDynamicIslandNotifications":false}"#)));
        assert!(parse_island_notifications_enabled(Some(r#"{"showDynamicIslandNotifications":true}"#)));
    }

    #[test]
    fn island_stays_at_top_center_on_retina_and_offset_monitors() {
        assert_eq!(island_top_position(0, 48, 2880, 768, 2.0), (1056, 64));
        assert_eq!(island_top_position(-1920, 24, 1920, 384, 1.0), (-1152, 32));
    }

    #[test]
    fn listener_ready_drains_startup_notifications_once() {
        let mut delivery = IslandCompletionDelivery::default();
        delivery.pending.push(serde_json::json!({"id": "first"}));
        delivery.revision = 1;
        assert!(!delivery.ready);
        assert!(!delivery.can_hide(1));
        let batch = delivery.ready_batch();
        assert_eq!(batch.items.len(), 1);
        assert_eq!(batch.revision, 1);
        assert!(delivery.ready);
        assert!(delivery.ready_batch().items.is_empty());
    }

    #[test]
    fn previous_timeout_cannot_hide_a_newer_completion() {
        let mut delivery = IslandCompletionDelivery::default();
        delivery.revision = 2;
        assert!(!delivery.can_hide(1));
        assert!(delivery.can_hide(2));
        delivery.pending.push(serde_json::json!({"id": "queued"}));
        assert!(!delivery.can_hide(2));
    }
}

#[tauri::command]
pub fn wise_island_open_session(app: AppHandle, session_id: String) -> Result<(), String> {
    let id = session_id.trim();
    if id.is_empty() { return Err("会话 ID 不能为空".into()); }
    crate::main_window::emit_to_primary_main_workspace_window(
        &app, "wise-hud-select-session", serde_json::json!({"sessionId": id}),
    );
    crate::wise_hud::hud_exit(&app)
}

/// 配置落盘后立即收起现有通知并清空等待队列。
#[tauri::command]
pub fn wise_island_refresh_settings(
    app: AppHandle,
    db: State<WiseDb>,
    state: State<std::sync::Mutex<IslandCompletionDelivery>>,
) -> Result<(), String> {
    let enabled = island_notifications_enabled(&db);
    let mut delivery = state.lock().map_err(|e| e.to_string())?;
    if !enabled {
        delivery.pending.clear();
        delivery.revision += 1;
    }
    if let Some(win) = app.get_webview_window(COMPLETION_WINDOW_LABEL) {
        if !enabled { win.hide().map_err(|e| e.to_string())?; }
        win.emit("wise-island-notifications-changed", enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 切入 HUD 后收起顶部通知，完成消息随后只发往 HUD。
pub fn dismiss_for_hud(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<std::sync::Mutex<IslandCompletionDelivery>>();
    let mut delivery = state.lock().map_err(|e| e.to_string())?;
    delivery.pending.clear();
    delivery.revision += 1;
    if let Some(win) = app.get_webview_window(COMPLETION_WINDOW_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
        win.emit("wise-island-reset", ()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
