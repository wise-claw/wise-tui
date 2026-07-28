/**
 * 终端隐藏 textarea 的 IME（中文等组字）辅助。
 * canvas + 透明 textarea 场景下，组字期间禁止把拼音 keydown 写入 PTY，
 * 并避免在 composition 中清空 textarea（否则会打断 IME）。
 */

export function shouldIgnoreTerminalKeyDuringIme(
  event: Pick<KeyboardEvent, "isComposing" | "key" | "keyCode">,
): boolean {
  if (event.isComposing) return true;
  if (event.key === "Process") return true;
  // WebKit / macOS IME：组字中 keydown 常为 keyCode 229，且 isComposing 可能滞后。
  if (event.keyCode === 229) return true;
  return false;
}

/** compositionend 提交的最终文本（可能为空：用户取消组字）。 */
export function terminalTextFromCompositionEnd(
  event: Pick<CompositionEvent, "data">,
): string {
  return typeof event.data === "string" ? event.data : "";
}

/**
 * 非组字 input：部分环境会用 insertText 送入字符。
 * 组字过程中的 insertCompositionText 由 compositionend 负责，此处跳过以免重复。
 */
export function terminalTextFromNonImeInput(
  event: Pick<InputEvent, "data" | "inputType" | "isComposing">,
  composing: boolean,
): string | null {
  if (composing || event.isComposing) return null;
  if (event.inputType === "insertCompositionText") return null;
  if (event.inputType === "insertText" && event.data) return event.data;
  return null;
}
