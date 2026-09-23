import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";

/** 补全优先；仅普通 Tab 将消息交给支持 steering 的运行中会话。 */
export function shouldSteerComposer(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  repeat: boolean;
}, engine: SessionExecutionEngine, busy: boolean, completing: boolean, claudeStreaming = false): boolean {
  return event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey &&
    !event.altKey && !event.isComposing && !event.repeat && !completing && busy &&
    (engine === "codex" || engine === "codex-rpc" || (engine === "claude" && claudeStreaming));
}
