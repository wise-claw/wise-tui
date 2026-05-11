import type { ContentPart, Prompt, FileSelection } from "../../types";
import { DEFAULT_PROMPT as _DEFAULT_PROMPT } from "../../types";
import { deleteAppSetting, getAppSetting, setAppSetting } from "../../services/appSettingsStore";

export { _DEFAULT_PROMPT as DEFAULT_PROMPT };

function isPartEqual(a: ContentPart, b: ContentPart): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "text" && b.type === "text") return a.text === b.text;
  if (a.type === "file" && b.type === "file") {
    if (a.path !== b.path) return false;
    const sa = a.selection, sb = b.selection;
    if (!sa && !sb) return true;
    if (!sa || !sb) return false;
    return sa.startLine === sb.startLine && sa.startChar === sb.startChar && sa.endLine === sb.endLine && sa.endChar === sb.endChar;
  }
  if (a.type === "agent" && b.type === "agent") return a.name === b.name;
  if (a.type === "team" && b.type === "team") return a.name === b.name && a.workflowId === b.workflowId;
  return false;
}

export function isPromptEqual(a: Prompt, b: Prompt): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!isPartEqual(a[i], b[i])) return false;
  }
  return true;
}

export function promptLength(prompt: Prompt): number {
  return prompt.reduce((sum, part) => {
    if (part.type === "text") return sum + part.text.length;
    return sum + 1; // file / agent / team pill counts as 1 logical char
  }, 0);
}

function clonePart(p: ContentPart): ContentPart {
  return { ...p, start: 0, end: 0 };
}

/** 合并相邻 text part，避免粘贴拆出多段纯文本。 */
function mergeAdjacentTextParts(parts: Prompt): Prompt {
  const out: Prompt = [];
  for (const p of parts) {
    if (p.type === "text" && out.length > 0) {
      const prev = out[out.length - 1]!;
      if (prev.type === "text") {
        out[out.length - 1] = { ...prev, text: prev.text + p.text, start: 0, end: 0 };
        continue;
      }
    }
    out.push(clonePart(p));
  }
  return out;
}

/**
 * 在逻辑光标处插入纯文本（含换行），与 `promptLength` / contenteditable 逻辑长度一致。
 * 不操作 DOM，供 WebView 下粘贴等场景绕过不可靠的 `insertNode`。
 */
export function insertPlainTextAtLogicalCursor(
  prompt: Prompt,
  cursorPos: number,
  insertion: string,
): { prompt: Prompt; cursor: number } {
  if (insertion.length === 0) {
    return { prompt: prompt.map(clonePart), cursor: cursorPos };
  }
  const max = promptLength(prompt);
  const cursor = Math.max(0, Math.min(cursorPos, max));
  let remaining = cursor;

  for (let i = 0; i < prompt.length; i++) {
    const part = prompt[i]!;
    if (part.type === "text") {
      const L = part.text.length;
      if (remaining <= L) {
        const newText = part.text.slice(0, remaining) + insertion + part.text.slice(remaining);
        const out: Prompt = [
          ...prompt.slice(0, i).map(clonePart),
          { ...part, text: newText, start: 0, end: 0 },
          ...prompt.slice(i + 1).map(clonePart),
        ];
        return { prompt: mergeAdjacentTextParts(out), cursor: cursor + insertion.length };
      }
      remaining -= L;
    } else {
      if (remaining === 0) {
        const insPart: ContentPart = { type: "text", text: insertion, start: 0, end: 0 };
        const out: Prompt = [...prompt.slice(0, i).map(clonePart), insPart, clonePart(part), ...prompt.slice(i + 1).map(clonePart)];
        return { prompt: mergeAdjacentTextParts(out), cursor: cursor + insertion.length };
      }
      remaining -= 1;
    }
  }

  const out: Prompt = prompt.map(clonePart);
  const last = out[out.length - 1]!;
  if (last.type === "text") {
    out[out.length - 1] = { ...last, text: last.text + insertion, start: 0, end: 0 };
  } else {
    out.push({ type: "text", text: insertion, start: 0, end: 0 });
  }
  return { prompt: mergeAdjacentTextParts(out), cursor: cursor + insertion.length };
}

// ── History Storage ──

const HISTORY_KEY_NORMAL = "wise.prompt.history.v1.normal";
const HISTORY_KEY_SHELL = "wise.prompt.history.v1.shell";
const LEGACY_APP_SETTING_KEY_PROMPT_HISTORY_NORMAL = "claude-prompt-history-v1";
const LEGACY_APP_SETTING_KEY_PROMPT_HISTORY_SHELL = "claude-prompt-history-shell-v1";
const MAX_HISTORY = 100;

interface HistoryEntry {
  prompt: Prompt;
  comments: { path: string; selection?: FileSelection; text: string }[];
  timestamp: number;
}

const historyCache: Record<"normal" | "shell", HistoryEntry[]> = {
  normal: [],
  shell: [],
};
let historyHydrating = false;
let historyHydrated = false;

function keyByMode(mode: "normal" | "shell"): string {
  return mode === "shell" ? HISTORY_KEY_SHELL : HISTORY_KEY_NORMAL;
}

function hydrateHistoryFromDb() {
  if (historyHydrated || historyHydrating) return;
  historyHydrating = true;
  void (async () => {
    let [normalRaw, shellRaw] = await Promise.all([getAppSetting(HISTORY_KEY_NORMAL), getAppSetting(HISTORY_KEY_SHELL)]);
    if (!normalRaw) {
      const legacy = await getAppSetting(LEGACY_APP_SETTING_KEY_PROMPT_HISTORY_NORMAL);
      if (legacy) {
        normalRaw = legacy;
        await setAppSetting(HISTORY_KEY_NORMAL, legacy);
        await deleteAppSetting(LEGACY_APP_SETTING_KEY_PROMPT_HISTORY_NORMAL);
      }
    }
    if (!shellRaw) {
      const legacy = await getAppSetting(LEGACY_APP_SETTING_KEY_PROMPT_HISTORY_SHELL);
      if (legacy) {
        shellRaw = legacy;
        await setAppSetting(HISTORY_KEY_SHELL, legacy);
        await deleteAppSetting(LEGACY_APP_SETTING_KEY_PROMPT_HISTORY_SHELL);
      }
    }
    try {
      historyCache.normal = normalRaw ? (JSON.parse(normalRaw) as HistoryEntry[]) : [];
    } catch {
      historyCache.normal = [];
    }
    try {
      historyCache.shell = shellRaw ? (JSON.parse(shellRaw) as HistoryEntry[]) : [];
    } catch {
      historyCache.shell = [];
    }
    historyHydrated = true;
    historyHydrating = false;
  })();
}

function loadHistory(mode: "normal" | "shell"): HistoryEntry[] {
  hydrateHistoryFromDb();
  return historyCache[mode] ?? [];
}

function saveHistory(mode: "normal" | "shell", entries: HistoryEntry[]) {
  const next = entries.slice(0, MAX_HISTORY);
  historyCache[mode] = next;
  void setAppSetting(keyByMode(mode), JSON.stringify(next));
}

export function addToHistory(prompt: Prompt, mode: "normal" | "shell", comments?: { path: string; selection?: FileSelection; text: string }[]) {
  if (isPromptEqual(prompt, _DEFAULT_PROMPT)) return;
  const history = loadHistory(mode);
  if (history.length > 0 && isPromptEqual(history[0].prompt, prompt)) return;
  history.unshift({ prompt, comments: comments ?? [], timestamp: Date.now() });
  saveHistory(mode, history);
}

export function navigatePromptHistory(
  direction: "up" | "down",
  currentPrompt: Prompt,
  currentIndex: number,
  mode: "normal" | "shell",
): { prompt: Prompt; index: number; savedCurrent: HistoryEntry | null } {
  const history = loadHistory(mode);
  let index = currentIndex;
  let savedCurrent: HistoryEntry | null = null;

  if (direction === "up") {
    if (index === -1 && history.length === 0) return { prompt: currentPrompt, index: -1, savedCurrent: null };
    if (index === -1) {
      savedCurrent = { prompt: currentPrompt, comments: [], timestamp: Date.now() };
      index = 0;
    } else {
      index = Math.min(index + 1, history.length - 1);
    }
    return { prompt: history[index].prompt, index, savedCurrent };
  }

  if (direction === "down") {
    if (index === -1) return { prompt: currentPrompt, index: -1, savedCurrent: null };
    if (index === 0) {
      index = -1;
      return { prompt: currentPrompt, index: -1, savedCurrent: null };
    }
    index = index - 1;
    if (index === -1) return { prompt: currentPrompt, index: -1, savedCurrent: null };
    return { prompt: history[index].prompt, index, savedCurrent: null };
  }

  return { prompt: currentPrompt, index: -1, savedCurrent: null };
}

export function canNavigateHistoryAtCursor(cursorPos: number, promptText: string): boolean {
  const beforeCursor = promptText.substring(0, cursorPos);
  const afterCursor = promptText.substring(cursorPos);
  return beforeCursor.trim().length === 0 && afterCursor.trim().length === 0;
}
