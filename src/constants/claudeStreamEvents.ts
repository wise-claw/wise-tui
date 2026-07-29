/**
 * Claude 执行子进程的 Tauri 事件名。
 *
 * 与 `src-tauri/src/claude_events.rs` 一一对应，是跨前后端的字符串契约。
 * Codex / Cursor / Opencode / Qoder 引擎的 stdout 也被适配成 Claude stream-json 后
 * 复用同一批事件名，因此这里的 `claude-` 前缀表示「流协议」而非「模型厂商」。
 *
 * 三条通道并存，用途不同：
 * - invocation 通道：每次 spawn 唯一，多标签并行时的默认路由，避免串屏。
 * - session 通道：长驻 streaming 会话按 Claude `session_id` 续订后续轮。
 * - 全局通道：未带 invocation key 时的兜底，单屏场景由 `streamingTargetIdRef` 路由。
 */

export const CLAUDE_STREAM_EVENT_OUTPUT = "claude-output";
export const CLAUDE_STREAM_EVENT_ERROR = "claude-error";
export const CLAUDE_STREAM_EVENT_COMPLETE = "claude-complete";

export type ClaudeStreamEventKind = "output" | "error" | "complete";

const BASE_BY_KIND: Record<ClaudeStreamEventKind, string> = {
  output: CLAUDE_STREAM_EVENT_OUTPUT,
  error: CLAUDE_STREAM_EVENT_ERROR,
  complete: CLAUDE_STREAM_EVENT_COMPLETE,
};

/** 全局兜底通道（Rust 侧带 invocation key 的 oneshot/streaming 会抑制该通道）。 */
export function claudeStreamEvent(kind: ClaudeStreamEventKind): string {
  return BASE_BY_KIND[kind];
}

/** 单次 spawn 的定向通道。 */
export function claudeInvocationStreamEvent(
  kind: ClaudeStreamEventKind,
  invocationKey: string,
): string {
  return `${BASE_BY_KIND[kind]}:invocation:${invocationKey}`;
}

/** 按 Wise tab id 或 Claude `session_id` 的定向通道。 */
export function claudeSessionStreamEvent(
  kind: ClaudeStreamEventKind,
  sessionId: string,
): string {
  return `${BASE_BY_KIND[kind]}:${sessionId}`;
}

/** invocation 三通道成组订阅/退订时使用。 */
export function claudeInvocationStreamEvents(invocationKey: string): {
  output: string;
  error: string;
  complete: string;
} {
  return {
    output: claudeInvocationStreamEvent("output", invocationKey),
    error: claudeInvocationStreamEvent("error", invocationKey),
    complete: claudeInvocationStreamEvent("complete", invocationKey),
  };
}
