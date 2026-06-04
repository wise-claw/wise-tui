const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/** 将键盘事件规范为存储用 chord：`Mod+Shift+Digit1`（Mod = ⌘ 或 Ctrl）。 */
export function keyboardEventToChord(event: KeyboardEvent): string | null {
  if (event.isComposing) return null;
  if (MODIFIER_KEYS.has(event.key)) return null;

  const code = event.code?.trim();
  if (!code || code === "Unidentified") return null;

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (parts.length === 0) return null;
  parts.push(code);
  return parts.join("+");
}

export function normalizeChord(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parts = trimmed.split("+").map((part) => part.trim()).filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "meta" || lower === "control" || lower === "ctrl" || lower === "cmd" || lower === "command") {
      if (!normalized.includes("Mod")) normalized.push("Mod");
      continue;
    }
    if (lower === "alt" || lower === "option") {
      if (!normalized.includes("Alt")) normalized.push("Alt");
      continue;
    }
    if (lower === "shift") {
      if (!normalized.includes("Shift")) normalized.push("Shift");
      continue;
    }
    const keyMatch = /^key([a-z0-9])$/i.exec(part);
    const digitMatch = /^digit([0-9])$/i.exec(part);
    if (keyMatch) {
      normalized.push(`Key${keyMatch[1]!.toUpperCase()}`);
    } else if (digitMatch) {
      normalized.push(`Digit${digitMatch[1]}`);
    } else if (part.startsWith("Key") || part.startsWith("Digit")) {
      normalized.push(part.charAt(0).toUpperCase() + part.slice(1));
    } else {
      normalized.push(part);
    }
  }
  const code = normalized.find((part) => !["Mod", "Alt", "Shift"].includes(part));
  if (!code) return "";
  const mods = normalized.filter((part) => part !== code);
  if (mods.length === 0) return "";
  return [...mods, code].join("+");
}

export function chordMatchesKeyboardEvent(chord: string, event: KeyboardEvent): boolean {
  const normalized = normalizeChord(chord);
  if (!normalized) return false;
  const actual = keyboardEventToChord(event);
  return actual === normalized;
}

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function formatChordPart(part: string): string {
  if (part === "Mod") return isMacPlatform() ? "⌘" : "Ctrl";
  if (part === "Alt") return isMacPlatform() ? "⌥" : "Alt";
  if (part === "Shift") return isMacPlatform() ? "⇧" : "Shift";
  if (part.startsWith("Digit")) return part.slice(5);
  if (part.startsWith("Key")) return part.slice(3);
  if (part === "Backquote") return "`";
  if (part === "Minus") return "-";
  if (part === "Equal") return "=";
  if (part === "BracketLeft") return "[";
  if (part === "BracketRight") return "]";
  if (part === "Semicolon") return ";";
  if (part === "Quote") return "'";
  if (part === "Comma") return ",";
  if (part === "Period") return ".";
  if (part === "Slash") return "/";
  return part;
}

export function formatChordForDisplay(chord: string): string {
  const normalized = normalizeChord(chord);
  if (!normalized) return "";
  const parts = normalized.split("+").map(formatChordPart);
  return isMacPlatform() ? parts.join("") : parts.join("+");
}

/** 与内置 composer 快捷键冲突时拒绝保存。 */
export function isReservedComposerChord(chord: string): boolean {
  const normalized = normalizeChord(chord);
  return normalized === "Mod+KeyI";
}
