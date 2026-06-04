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
