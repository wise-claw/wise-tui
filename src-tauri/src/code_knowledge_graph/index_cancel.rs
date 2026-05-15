//! 代码图谱单次检索任务的取消信号（与 `spawn_blocking` 内的 GitNexus 子进程配合）。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

/// 与前端约定：该文案表示用户主动停止，而非失败。
pub const INDEX_CANCELLED_MSG: &str = "检索已取消";

/// DB 仍为 `indexing` 但进程内已无会话（早期失败、崩溃、应用重启等）时写入 `error`，供 UI 与「暂停」恢复。
pub const INDEX_STALE_ORPHAN_MSG: &str =
    "索引未在进程中运行（可能已异常退出或应用重启）。请重新点击「开始检索」。";

static ACTIVE: OnceLock<Mutex<HashMap<i64, Arc<AtomicBool>>>> = OnceLock::new();

fn active_map() -> &'static Mutex<HashMap<i64, Arc<AtomicBool>>> {
    ACTIVE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 新一次检索开始前调用：若同仓仍有在跑的任务，会先将其标记为取消。
pub fn begin_session(repo_id: i64) -> Arc<AtomicBool> {
    let mut m = active_map().lock().unwrap();
    if let Some(prev) = m.remove(&repo_id) {
        prev.store(true, Ordering::SeqCst);
    }
    let flag = Arc::new(AtomicBool::new(false));
    m.insert(repo_id, Arc::clone(&flag));
    flag
}

/// 用户点击「暂停检索」：向当前会话发出取消（`true` 表示确有在跑的任务）。
pub fn request_cancel(repo_id: i64) -> bool {
    let mut m = active_map().lock().unwrap();
    if let Some(f) = m.remove(&repo_id) {
        f.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

/// 索引任务结束（成功 / 失败 / 取消）后调用，避免 map 泄漏；仅移除与 `flag` 指针相同的会话。
pub fn end_session(repo_id: i64, flag: &Arc<AtomicBool>) {
    let mut m = active_map().lock().unwrap();
    if let Some(cur) = m.get(&repo_id) {
        if Arc::ptr_eq(cur, flag) {
            m.remove(&repo_id);
        }
    }
}

pub fn is_cancelled(cancel: Option<&Arc<AtomicBool>>) -> bool {
    cancel.map(|c| c.load(Ordering::SeqCst)).unwrap_or(false)
}
