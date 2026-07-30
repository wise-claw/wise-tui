/**
 * 终端隐藏 textarea 是否处于可聚焦/可输入态。
 *
 * 中栏终端与消息/文件 DOM 并存，靠父级 `.app-claude-chat-center-pane` 的
 * `inert` / `is-hidden` 互斥显隐。父级 inert 时 textarea.focus() 会静默失败；
 * 从文件视图切回终端时若未重新 focus，就会表现为「无法输入」。
 */
export function isTerminalInputArmed(
  start: Element | null | undefined,
  doc: Pick<Document, "hidden"> | null | undefined = typeof document !== "undefined"
    ? document
    : null,
): boolean {
  if (!start) return false;
  if (doc?.hidden) return false;
  let el: Element | null = start;
  while (el) {
    if (el.hasAttribute("inert")) return false;
    // happy-dom / 部分测试环境可能没有全局 HTMLElement；用 duck-type 读 inert。
    if ("inert" in el && Boolean((el as HTMLElement).inert)) return false;
    if (el.classList.contains("is-hidden")) return false;
    el = el.parentElement;
  }
  return true;
}
