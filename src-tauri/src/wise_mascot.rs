//! 桌面小人窗口 + 未读广播骨架。

use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::wise_db::{WiseDb, WiseMessageListItem};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestInboundPayload {
    pub conversation_id: String,
    pub body: String,
    pub server_msg_id: Option<String>,
}

/// 短防抖：短时间多次 ingest 只弹出最后一次预览的气泡（尾沿合并）。
pub struct WiseToastMerge {
    toast_ticket: AtomicU64,
    pending_preview: Mutex<String>,
}

impl Default for WiseToastMerge {
    fn default() -> Self {
        Self {
            toast_ticket: AtomicU64::new(0),
            pending_preview: Mutex::new(String::new()),
        }
    }
}

impl WiseToastMerge {
    pub fn schedule_toast(&self, app: AppHandle, merge_ms: u64, preview: String) {
        if merge_ms == 0 {
            let _ = app.emit(
                "wise-toast",
                &serde_json::json!({ "title": "新消息", "body": preview }),
            );
            return;
        }
        {
            let mut p = self.pending_preview.lock().unwrap();
            *p = preview;
        }
        let ms = merge_ms.max(40);
        let my = self.toast_ticket.fetch_add(1, Ordering::SeqCst) + 1;
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            let Some(merge) = app2.try_state::<WiseToastMerge>() else {
                return;
            };
            if merge.toast_ticket.load(Ordering::SeqCst) != my {
                return;
            }
            let body = merge.pending_preview.lock().unwrap().clone();
            let _ = app2.emit(
                "wise-toast",
                &serde_json::json!({ "title": "新消息", "body": body }),
            );
        });
    }
}

fn emit_unread(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    let total = db.unread_total()?;
    let _ = app.emit(
        "wise-unread-changed",
        &serde_json::json!({ "total": total }),
    );
    Ok(())
}

/// 入站 body 为 JSON 且 `wiseAutomation: "dingtalk:v1"` 时，向主窗派发自动化载荷（与前端 `listen` 约定一致）。
/// 返回是否已派发。与 `ingest_inbound` 是否插入新行无关：网关若固定 `server_msg_id` 导致重复入库被忽略时，仍应能触发自动化。
fn emit_dingtalk_wise_automation_v1_if_applicable(app: &AppHandle, body: &str) -> bool {
    let trimmed = body.trim();
    if !trimmed.starts_with('{') {
        return false;
    }
    let v: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let marker = v.get("wiseAutomation").and_then(|x| x.as_str());
    if marker != Some("dingtalk:v1") {
        return false;
    }
    let user = v
        .get("dingTalkUserId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    if user.is_empty() {
        return false;
    }
    let prompt = v
        .get("prompt")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    let image_data_urls: Option<Vec<String>> = v
        .get("imageDataUrls")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|u| u.as_str().map(|s| s.trim().to_string()))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|arr| !arr.is_empty());
    if prompt.is_empty() && image_data_urls.as_ref().map_or(true, |a| a.is_empty()) {
        return false;
    }
    let repository_name = v
        .get("repositoryName")
        .and_then(|x| x.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let mut json_payload = serde_json::json!({
        "dingTalkUserId": user,
        "repositoryName": repository_name,
        "prompt": prompt,
    });
    if let Some(urls) = image_data_urls {
        json_payload["imageDataUrls"] = serde_json::json!(urls);
    }
    if let Err(e) = app.emit("wise-dingtalk-automation-v1", &json_payload) {
        eprintln!("wise_mascot: emit wise-dingtalk-automation-v1 失败: {}", e);
        return false;
    }
    true
}

fn focus_main_window_for_automation(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
}

/// 入库 + 未读广播 +（可选）气泡；供 `wise_notification_ingest` 与推送循环共用。
pub(crate) fn process_inbound_ingest(
    app: &AppHandle,
    db: &WiseDb,
    merge: &WiseToastMerge,
    payload: IngestInboundPayload,
) -> Result<i64, String> {
    let preview_src = payload.body.clone();
    let inserted = db.ingest_inbound(
        &payload.conversation_id,
        &payload.body,
        payload.server_msg_id.as_deref(),
    )?;
    let automation_emitted = emit_dingtalk_wise_automation_v1_if_applicable(app, &payload.body);
    if automation_emitted {
        focus_main_window_for_automation(app);
    }
    let total = db.unread_total()?;
    let _ = app.emit(
        "wise-unread-changed",
        &serde_json::json!({ "total": total }),
    );
    if inserted && !automation_emitted && !db.mascot_dnd_active()? {
        let merge_ms = db.mascot_toast_merge_ms()?;
        let preview: String = preview_src.chars().take(120).collect();
        merge.schedule_toast(app.clone(), merge_ms, preview);
    }
    Ok(total)
}

/// 显示 mascot 窗口并刷新未读（供 invoke 与快捷键共用）。
pub fn mascot_show_window(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    let w = app
        .get_webview_window("mascot")
        .ok_or_else(|| "mascot 窗口未注册（检查 tauri.conf.json）".to_string())?;
    #[cfg(target_os = "macos")]
    {
        let _ = w.set_always_on_top(true);
    }
    let _ = w.unminimize();
    w.show().map_err(|e| e.to_string())?;
    let _ = w.set_focus();
    db.set_mascot_visible_pref(true)?;
    emit_unread(app, db)?;
    Ok(())
}

/// 启动时恢复位置；若上次为显示状态则再次 show 并推送未读。
pub fn restore_mascot_on_launch(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    apply_mascot_position_from_db(app, db)?;
    if db.mascot_visible_pref()? {
        mascot_show_window(app, db)?;
    }
    Ok(())
}

#[tauri::command]
pub fn wise_mascot_show(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    mascot_show_window(&app, &db)
}

#[tauri::command]
pub fn wise_mascot_hide(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    let w = app
        .get_webview_window("mascot")
        .ok_or_else(|| "mascot 窗口未注册".to_string())?;
    w.hide().map_err(|e| e.to_string())?;
    db.set_mascot_visible_pref(false)?;
    Ok(())
}

#[tauri::command]
pub fn wise_mascot_save_position(db: State<WiseDb>, x: i32, y: i32) -> Result<(), String> {
    db.save_mascot_position(x, y)
}

#[tauri::command]
pub fn wise_notification_unread_total(db: State<WiseDb>) -> Result<i64, String> {
    db.unread_total()
}

#[tauri::command]
pub fn wise_notification_ingest(
    app: AppHandle,
    db: State<WiseDb>,
    merge: State<WiseToastMerge>,
    payload: IngestInboundPayload,
) -> Result<i64, String> {
    process_inbound_ingest(&app, &db, &merge, payload)
}

#[tauri::command]
pub fn wise_notification_mark_all_read(app: AppHandle, db: State<WiseDb>) -> Result<(), String> {
    db.mark_all_read()?;
    emit_unread(&app, &db)?;
    Ok(())
}

#[tauri::command]
pub fn wise_notification_mark_read(
    app: AppHandle,
    db: State<WiseDb>,
    message_id: String,
) -> Result<(), String> {
    db.mark_inbound_read_by_id(&message_id)?;
    emit_unread(&app, &db)?;
    Ok(())
}

#[tauri::command]
pub fn wise_notification_mark_omc_direct_batch_read_for_batch(
    app: AppHandle,
    db: State<WiseDb>,
    conversation_ids: Vec<String>,
    batch_epoch: i64,
) -> Result<(), String> {
    db.mark_inbound_read_omc_direct_batch_for_conversations_epoch(&conversation_ids, batch_epoch)?;
    emit_unread(&app, &db)?;
    Ok(())
}

#[tauri::command]
pub fn wise_notification_list_recent(
    db: State<WiseDb>,
    limit: Option<i64>,
) -> Result<Vec<WiseMessageListItem>, String> {
    db.list_inbound_recent(limit.unwrap_or(50))
}

#[tauri::command]
pub fn wise_main_window_focus(app: AppHandle) -> Result<(), String> {
    let w = app
        .get_webview_window("main")
        .ok_or_else(|| "main 窗口未找到".to_string())?;
    let _ = w.unminimize();
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn apply_mascot_position_from_db(app: &AppHandle, db: &WiseDb) -> Result<(), String> {
    let Some((x, y)) = db.mascot_position_opt()? else {
        return Ok(());
    };
    let Some(w) = app.get_webview_window("mascot") else {
        return Ok(());
    };
    let size = w.outer_size().map_err(|e| e.to_string())?;
    let win_w = size.width as i32;
    let win_h = size.height as i32;
    let cx = x as f64 + (win_w.max(1) as f64) * 0.5;
    let cy = y as f64 + (win_h.max(1) as f64) * 0.5;
    let mon = w
        .monitor_from_point(cx, cy)
        .ok()
        .flatten()
        .or_else(|| w.primary_monitor().ok().flatten());

    let (mut nx, mut ny) = (x, y);
    if let Some(m) = mon {
        let wa = m.work_area();
        let px = wa.position.x;
        let py = wa.position.y;
        let pw = wa.size.width as i32;
        let ph = wa.size.height as i32;
        nx = nx.max(px);
        ny = ny.max(py);
        if pw >= win_w {
            nx = nx.min(px + pw - win_w);
        } else {
            nx = px;
        }
        if ph >= win_h {
            ny = ny.min(py + ph - win_h);
        } else {
            ny = py;
        }
    }
    w.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        nx, ny,
    )))
    .map_err(|e| e.to_string())?;
    Ok(())
}
