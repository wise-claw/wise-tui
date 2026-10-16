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

/** Codex 空闲时直接发送，运行中通过 steering 补充当前轮次。 */
export function getComposerTabSendMode(
  event: Parameters<typeof shouldSteerComposer>[0],
  engine: SessionExecutionEngine,
  busy: boolean,
  completing: boolean,
  canSteer: boolean,
): "send" | "steer" | null {
  if (!busy && (engine === "codex" || engine === "codex-rpc") &&
    shouldSteerComposer(event, engine, true, completing)) return "send";
  if (canSteer && shouldSteerComposer(event, engine, busy, completing, canSteer)) return "steer";
  return null;
}

/** 用事件来源判定归属；WebView 的 activeElement 可能仍指向 body 或底栏按钮。 */
export function handleComposerTabKeyDown(event: KeyboardEvent, options: {
  root: HTMLElement;
  shell: HTMLElement | null;
  engine: SessionExecutionEngine;
  busy: boolean;
  completing: boolean;
  canSteer: boolean;
  canSend: boolean;
  send: (mode: "send" | "steer") => void;
  focusEditor: () => void;
}): void {
  if (event.key !== "Tab") return;
  const target = event.target as Node | null;
  if (!target || !options.root.contains(target)) return;
  event.preventDefault();
  const editor = options.shell?.querySelector(".ProseMirror");
  if (!editor?.contains(target)) {
    event.stopPropagation();
    options.focusEditor();
    return;
  }
  if (options.completing) return;
  event.stopPropagation();
  const mode = getComposerTabSendMode(event, options.engine, options.busy, false, options.canSteer);
  if (mode && options.canSend) options.send(mode);
}
