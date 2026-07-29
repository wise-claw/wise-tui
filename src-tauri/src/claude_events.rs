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

#[cfg(test)]
mod tests {
    use super::*;

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
