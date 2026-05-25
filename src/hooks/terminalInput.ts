import type { Terminal } from "@xterm/xterm";

export const TERMINAL_HISTORY_MAX = 200;

/** Bytes sent to PTY for common line-editing keys (zsh/bash readline). */
export const TERMINAL_KEY_BYTES = {
  backspace: "\x7f",
  delete: "\x1b[3~",
  killLine: "\x15",
  killToEol: "\x0b",
  killWord: "\x17",
  altBackspace: "\x1b\x7f",
  enter: "\r",
} as const;

export type TerminalKeyAction =
  | { kind: "send"; data: string }
  | { kind: "history-prev" }
  | { kind: "history-next" };

/** 去掉 ANSI 与常见 shell 提示符，只保留用户输入的命令文本。 */
export function normalizeTerminalCommandInput(raw: string): string {
  let line = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
  line = line.replace(/\x1b\][^\x07]*\x07/g, "");
  const lastNl = line.lastIndexOf("\n");
  if (lastNl >= 0) {
    line = line.slice(lastNl + 1);
  }
  line = line.trimEnd();

  const promptPrefix =
    /^\s*(?:(?:[❯➜]|[#$%])>\s+|[❯➜]\s+|>\s+|[#$%]\s+)/;
  let trimmed = line;
  let prev = "";
  while (trimmed !== prev) {
    prev = trimmed;
    trimmed = trimmed.replace(promptPrefix, "");
  }
  return trimmed.trim();
}

export function applyInputToDraft(draft: string, data: string): string {
  if (!data) {
    return draft;
  }
  if (data === TERMINAL_KEY_BYTES.killLine) {
    return "";
  }
  if (data === TERMINAL_KEY_BYTES.killToEol) {
    return draft;
  }
  if (data === TERMINAL_KEY_BYTES.killWord) {
    const trimmed = draft.replace(/\s+$/, "");
    const lastSpace = trimmed.lastIndexOf(" ");
    return lastSpace < 0 ? "" : trimmed.slice(0, lastSpace + 1);
  }
  if (data === TERMINAL_KEY_BYTES.backspace || data === TERMINAL_KEY_BYTES.altBackspace) {
    return draft.slice(0, -1);
  }
  if (data === TERMINAL_KEY_BYTES.delete) {
    return draft;
  }
  if (data === TERMINAL_KEY_BYTES.enter || data === "\n") {
    return "";
  }
  if (data.startsWith("\x1b")) {
    return draft;
  }
  if (data.length === 1 && data >= " " && data !== "\x7f") {
    return draft + data;
  }
  if (!data.startsWith("\x1b") && !/[\x00-\x1f\x7f]/.test(data)) {
    return draft + data;
  }
  return draft;
}

export function commitDraftToHistory(history: string[], draft: string): string[] {
  const trimmed = normalizeTerminalCommandInput(draft);
  if (!trimmed) {
    return history;
  }
  const withoutDup = history.filter((line) => line !== trimmed);
  const next = [...withoutDup, trimmed];
  if (next.length <= TERMINAL_HISTORY_MAX) {
    return next;
  }
  return next.slice(next.length - TERMINAL_HISTORY_MAX);
}

export function pickCommandSuggestion(history: string[], draft: string): string | null {
  const trimmed = normalizeTerminalCommandInput(draft);
  if (!trimmed) {
    return null;
  }
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = normalizeTerminalCommandInput(history[i] ?? "");
    if (entry.startsWith(trimmed) && entry !== trimmed) {
      return entry;
    }
  }
  return null;
}

export function suggestionSuffix(suggestion: string, draft: string): string {
  const normalizedDraft = normalizeTerminalCommandInput(draft);
  const normalizedSuggestion = normalizeTerminalCommandInput(suggestion);
  if (!normalizedSuggestion.startsWith(normalizedDraft)) {
    return "";
  }
  return normalizedSuggestion.slice(normalizedDraft.length);
}

export function resolveTerminalKeydown(event: KeyboardEvent): TerminalKeyAction | null {
  if (event.type !== "keydown") {
    return null;
  }
  if (event.metaKey) {
    return null;
  }

  const { key, ctrlKey, altKey, shiftKey } = event;

  if (ctrlKey && !altKey) {
    if (key === "u" || key === "U") {
      return { kind: "send", data: TERMINAL_KEY_BYTES.killLine };
    }
    if (key === "k" || key === "K") {
      return { kind: "send", data: TERMINAL_KEY_BYTES.killToEol };
    }
    if (key === "w" || key === "W") {
      return { kind: "send", data: TERMINAL_KEY_BYTES.killWord };
    }
    return null;
  }

  if (key === "Backspace") {
    if (altKey) {
      return { kind: "send", data: TERMINAL_KEY_BYTES.altBackspace };
    }
    return { kind: "send", data: TERMINAL_KEY_BYTES.backspace };
  }

  if (key === "Delete") {
    return { kind: "send", data: TERMINAL_KEY_BYTES.delete };
  }

  if (key === "ArrowUp" && !ctrlKey && !altKey) {
    return { kind: "history-prev" };
  }

  if (key === "ArrowDown" && !ctrlKey && !altKey) {
    return { kind: "history-next" };
  }

  return null;
}

export function readTerminalInputDraft(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(buffer.cursorY + buffer.viewportY);
  if (!line) {
    return "";
  }
  const raw = line.translateToString(true, 0, buffer.cursorX);
  return normalizeTerminalCommandInput(raw);
}

export function historyEntryAt(
  history: string[],
  indexFromEnd: number,
): string | null {
  if (history.length === 0 || indexFromEnd < 0) {
    return null;
  }
  const idx = history.length - 1 - indexFromEnd;
  if (idx < 0 || idx >= history.length) {
    return null;
  }
  return history[idx] ?? null;
}
