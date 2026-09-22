//! Claude 执行子进程向前端广播的事件名。
//!
//! 与 `src/constants/claudeStreamEvents.ts` 一一对应，是跨前后端的字符串契约。
//! Codex / Cursor / Opencode / Qoder 的 stdout 被适配成 Claude stream-json 后复用
//! 同一批事件名，因此 `claude-` 前缀表示「流协议」而非模型厂商。

pub const CLAUDE_STREAM_EVENT_OUTPUT: &str = "claude-output";
pub const CLAUDE_STREAM_EVENT_ERROR: &str = "claude-error";
pub const CLAUDE_STREAM_EVENT_COMPLETE: &str = "claude-complete";

/// 单次 spawn 的定向通道；多标签并行时的默认路由。
pub fn invocation_event(base: &str, invocation_key: &str) -> String {
    format!("{}:invocation:{}", base, invocation_key)
}

/// 按 Claude `session_id`（或 Wise tab id）的定向通道。
pub fn session_event(base: &str, session_id: &str) -> String {
    format!("{}:{}", base, session_id)
}

/// 引擎适配器统一的三通道广播：session 定向 + 全局兜底 + invocation 定向。
///
/// 带 `invocation_key` 时抑制全局通道：前端定向监听已建立，再走全局会让多屏并行
/// 时的单值兜底路由把输出串到别的窗格。Codex / Cursor / Opencode / Qoder 共用此规则。
pub fn emit_adapted_stream_payload<P: serde::Serialize>(
    app: &tauri::AppHandle,
    base: &str,
    session_id: &str,
    payload: &P,
    invocation_key: Option<&str>,
) {
    use tauri::Emitter;
    use tauri::Manager;
    // Invocation routing is needed only while the turn is live. Ordinary
    // completion must release it too, not just cancel_claude_invocation.
    if base == CLAUDE_STREAM_EVENT_COMPLETE {
        if let Some(registry) = app.try_state::<crate::claude_commands::ClaudeSessionRegistry>() {
            registry.remove_completed(session_id);
        }
        if let (Some(inv), Some(state)) = (
            invocation_key,
            app.try_state::<crate::claude_commands::ClaudeProcessState>(),
        ) {
            forget_completed_invocation(&state.invocation_tab_session_by_key, inv);
        }
    }
    if !session_id.is_empty() {
        let _ = app.emit(&session_event(base, session_id), payload);
    }
    if invocation_key.is_none() {
        let _ = app.emit(base, payload);
    }
    if let Some(inv) = invocation_key {
        let _ = app.emit(&invocation_event(base, inv), payload);
    }
}

fn forget_completed_invocation(
    mappings: &std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, String>>>,
    invocation_key: &str,
) {
    if let Ok(mut map) = mappings.try_lock() {
        map.remove(invocation_key);
    } else {
        let mappings = std::sync::Arc::clone(mappings);
        let invocation_key = invocation_key.to_string();
        tauri::async_runtime::spawn(async move {
            mappings.lock().await.remove(&invocation_key);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn completed_invocations_release_routing_even_when_the_map_is_busy() {
        use std::{collections::HashMap, sync::Arc};
        use tokio::sync::Mutex;
        let mappings = Arc::new(Mutex::new(HashMap::new()));
        for i in 0..10_000 {
            let inv = format!("inv-{i}");
            mappings.lock().await.insert(inv.clone(), "tab".into());
            forget_completed_invocation(&mappings, &inv);
            assert!(mappings.lock().await.is_empty());
        }
        let mut held = mappings.lock().await;
        held.insert("done".into(), "old".into());
        held.insert("running".into(), "live".into());
        forget_completed_invocation(&mappings, "done");
        drop(held);
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if !mappings.lock().await.contains_key("done") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            mappings.lock().await.get("running").map(String::as_str),
            Some("live")
        );
    }

    #[test]
    fn builds_scoped_event_names() {
        assert_eq!(
            invocation_event(CLAUDE_STREAM_EVENT_OUTPUT, "inv-1"),
            "claude-output:invocation:inv-1"
        );
        assert_eq!(
            session_event(CLAUDE_STREAM_EVENT_COMPLETE, "sid-1"),
            "claude-complete:sid-1"
        );
        assert_eq!(
            session_event(CLAUDE_STREAM_EVENT_ERROR, "sid-1"),
            "claude-error:sid-1"
        );
    }
}
