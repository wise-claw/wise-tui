/**
 * Kitty / fixterms CSI-u 键盘协议序列若未被消费，会落成可见的 `6;5u` 等碎片。
 * 在按原始字节流展示前可选择性剥离。
 */
const KITTY_KEYBOARD_OUTPUT =
  /\x1b\[>[0-9:;]*u|\x1b\[[0-9:;]*[~u]/g;

/**
 * zsh/bash 开启 bracketed paste 的 DECSET（`\e[?2004h`）。
 * 多次收起/展开时若与协议 reset 并发写入，ESC 可能丢失并落成可见的 `?2004h`。
 */
const BRACKETED_PASTE_MODE = /\x1b\[\?2004[hls]|\?2004[hls]/g;

/** 关闭增强键盘模式（不影响 PTY 内 shell 状态）。 */
export const TERMINAL_KEYBOARD_PROTOCOL_RESET = "\x1b[<u\x1b[>4;0m";

type TerminalOutputWriter = {
  push: (data: string) => void;
  flush: (done?: () => void) => void;
};

/** 经输出队列串行写入，避免与 PTY replay 并发抢占解析状态。 */
export function resetTerminalKeyboardProtocol(
  writer: TerminalOutputWriter,
): void {
  try {
    writer.push(TERMINAL_KEYBOARD_PROTOCOL_RESET);
    writer.flush();
  } catch {
    // ignore
  }
}

export function sanitizeTerminalPtyOutput(data: string): string {
  if (!data) {
    return data;
  }
  let next = data;
  if (next.includes("\x1b")) {
    next = next.replace(KITTY_KEYBOARD_OUTPUT, "");
  }
  if (next.includes("?2004") || next.includes("\x1b[?2004")) {
    next = next.replace(BRACKETED_PASTE_MODE, "");
  }
  return next;
}
