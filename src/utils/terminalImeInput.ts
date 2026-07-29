/**
 * 终端隐藏 textarea 的 IME（中文等组字）辅助。
 * canvas + 透明 textarea 场景下，组字期间禁止把拼音 keydown 写入 PTY，
 * 并避免在 composition 中清空 textarea（否则会打断 IME）。
 *
 * 中文标点（，。；：等）通常不走 compositionstart/end，而是由输入法直接
 * insertText 提交。若在 keydown 里对 `,` `.` 等 ASCII 标点 preventDefault，
 * 第三方输入法无法完成全角转换，字符会丢失或变成英文标点。
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

/**
 * ASCII 标点/符号（非字母数字）交给 input 的 insertText，以便中文输入法
 * 将 `,`→`，`、`.`→`。` 等。字母数字仍走 keydown，保持英文输入手感。
 */
export function shouldDeferTerminalKeyToInput(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">,
): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key.length !== 1) return false;
  const code = event.key.charCodeAt(0);
  if (code < 0x20 || code > 0x7e) return false;
  const isAlnum =
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122);
  return !isAlnum;
}

/** compositionend 提交的最终文本（可能为空：用户取消组字）。 */
export function terminalTextFromCompositionEnd(
  event: Pick<CompositionEvent, "data">,
): string {
  return typeof event.data === "string" ? event.data : "";
}

/**
 * 非组字 input：部分环境会用 insertText 送入字符（含中文标点）。
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
