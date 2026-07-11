import { formatChordForDisplay, normalizeChord } from "../utils/atMentionShortcutChord";

/** `send` 直接发送；`insert` 填入输入框（不发送） */
export type ComposerCommonPhraseAction = "send" | "insert";

export interface ComposerCommonPhrase {
  id: string;
  /** 按钮/列表展示用简称 */
  title: string;
  /** 发送正文 */
  text: string;
  /** 点击 chip / 快捷键时的行为，默认 `send` */
  action?: ComposerCommonPhraseAction;
  /** 可选组合键（`Mod+Shift+KeyQ`） */
  chord?: string;
  /** 是否在会话快捷操作栏展示名称 chip，默认 true */
  showInQuickBar?: boolean;
}

export function resolveComposerCommonPhraseShowInQuickBar(
  phrase: Pick<ComposerCommonPhrase, "showInQuickBar">,
): boolean {
  return phrase.showInQuickBar !== false;
}

/** 快捷操作栏展示用（过滤掉关闭显示的条目） */
export function filterComposerCommonPhrasesForQuickBar(
  phrases: readonly ComposerCommonPhrase[],
): ComposerCommonPhrase[] {
  return phrases.filter((phrase) => resolveComposerCommonPhraseShowInQuickBar(phrase));
}

export const COMPOSER_COMMON_PHRASE_ACTION_LABELS: Record<
  ComposerCommonPhraseAction,
  string
> = {
  send: "直接发送",
  insert: "填入输入框",
};

export function normalizeComposerCommonPhraseAction(raw: unknown): ComposerCommonPhraseAction {
  return raw === "insert" ? "insert" : "send";
}

export function resolveComposerCommonPhraseAction(
  phrase: Pick<ComposerCommonPhrase, "action">,
): ComposerCommonPhraseAction {
  return normalizeComposerCommonPhraseAction(phrase.action);
}

export const MAX_COMPOSER_COMMON_PHRASES = 24;

const PHRASE_TOOLTIP_TEXT_MAX = 160;

/** 折叠空白并截断，供 Tooltip / 列表预览使用 */
export function truncateComposerCommonPhraseText(text: string, maxLen = PHRASE_TOOLTIP_TEXT_MAX): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen)}…`;
}

export function buildComposerCommonPhraseTooltipTitle(
  phrase: Pick<ComposerCommonPhrase, "text" | "action" | "chord">,
): string {
  const actionLabel = COMPOSER_COMMON_PHRASE_ACTION_LABELS[resolveComposerCommonPhraseAction(phrase)];
  const body = truncateComposerCommonPhraseText(phrase.text);
  const keys = phrase.chord?.trim() ? formatChordForDisplay(phrase.chord) : "";
  if (!body) return actionLabel;
  return keys ? `${actionLabel}：${body}（${keys}）` : `${actionLabel}：${body}`;
}

export function createComposerCommonPhraseId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `phrase-${crypto.randomUUID()}`;
  }
  return `phrase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeComposerCommonPhrases(raw: unknown): ComposerCommonPhrase[] {
  if (!Array.isArray(raw)) return [];
  const out: ComposerCommonPhrase[] = [];
  const usedChords = new Set<string>();
  const usedIds = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<ComposerCommonPhrase>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) continue;

    let id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || usedIds.has(id)) {
      id = createComposerCommonPhraseId();
    }
    usedIds.add(id);

    const titleRaw = typeof record.title === "string" ? record.title.trim() : "";
    const title =
      titleRaw ||
      (text.length > 16 ? `${text.slice(0, 16)}…` : text);

    const chordRaw = typeof record.chord === "string" ? normalizeChord(record.chord) : "";
    let chord: string | undefined;
    if (chordRaw && !usedChords.has(chordRaw)) {
      usedChords.add(chordRaw);
      chord = chordRaw;
    }

    const action = normalizeComposerCommonPhraseAction(record.action);
    const showInQuickBar = record.showInQuickBar !== false;
    const base = showInQuickBar
      ? { id, title, text, action }
      : { id, title, text, action, showInQuickBar: false as const };
    out.push(chord ? { ...base, chord } : base);
    if (out.length >= MAX_COMPOSER_COMMON_PHRASES) break;
  }
  return out;
}

/**
 * 合并全局 + 仓库级常用语用于展示（「全局 + 仓库合并」作用域语义）：
 * - 顺序：全局在前，仓库级在后（「通用 + 本仓库特有」）。
 * - chord 冲突：仓库级优先，全局中与仓库级同 chord 的条目剥离 chord（条目保留，仍可点击发送，仅失去快捷键）。
 * - id 冲突：全局与仓库级是独立 id 空间，调用方渲染 React key 时需用 `source:id` 区分，避免潜在 key 撞车。
 * - 上限：合并后截断到 MAX_COMPOSER_COMMON_PHRASES（截掉仓库级尾部，优先保留全局全部）。
 */
export function mergeComposerCommonPhrases(
  global: readonly ComposerCommonPhrase[],
  repo: readonly ComposerCommonPhrase[],
): ComposerCommonPhrase[] {
  const repoChords = new Set<string>();
  for (const phrase of repo) {
    const chord = phrase.chord?.trim();
    if (chord) repoChords.add(chord);
  }
  const merged: ComposerCommonPhrase[] = [];
  for (const phrase of global) {
    const chord = phrase.chord?.trim();
    if (chord && repoChords.has(chord)) {
      const { chord: _removed, ...rest } = phrase;
      merged.push(rest);
    } else {
      merged.push({ ...phrase });
    }
  }
  for (const phrase of repo) {
    merged.push({ ...phrase });
  }
  return merged.slice(0, MAX_COMPOSER_COMMON_PHRASES);
}
