/** 流式听写：在输入框锚点处合并 partial / final 转写文本。 */

import { buildSpeechInsertion } from "./composerSpeechRecognition";

export interface ComposerSpeechStreamAnchor {
  prefix: string;
  suffix: string;
}

export function createComposerSpeechStreamAnchor(plain: string, cursor: number): ComposerSpeechStreamAnchor {
  const c = Math.max(0, Math.min(cursor, plain.length));
  return {
    prefix: plain.slice(0, c),
    suffix: plain.slice(c),
  };
}

/** 输入框已清空但听写锚点仍保留上一轮文本时，丢弃陈旧锚点（常见于发送后连续录音）。 */
export function reconcileComposerSpeechStreamAnchor(
  anchor: ComposerSpeechStreamAnchor | null,
  plain: string,
  cursor: number,
): ComposerSpeechStreamAnchor {
  if (!anchor) {
    return createComposerSpeechStreamAnchor(plain, cursor);
  }
  if (!plain && (anchor.prefix.length > 0 || anchor.suffix.length > 0)) {
    return createComposerSpeechStreamAnchor("", 0);
  }
  return anchor;
}

export function normalizeSpeechTranscriptLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

const SPEECH_COMPARE_STRIP_RE = /[\s，。！？、,.!?;:：；'"''""\-—…]/gu;

function isSpeechCompareSeparator(ch: string): boolean {
  return /[\s，。！？、,.!?;:：；'"''""\-—…]/u.test(ch);
}

/** 忽略标点/空白后用于 baseline 前缀比对。 */
export function stripSpeechCompareNoise(raw: string): string {
  return raw.replace(SPEECH_COMPARE_STRIP_RE, "");
}

/** 将 compare 前缀长度映射回 raw 字符串上的切分点（跳过标点/空白）。 */
export function sliceRawTranscriptAfterComparePrefix(raw: string, comparePrefixLen: number): string {
  if (comparePrefixLen <= 0) {
    return normalizeSpeechTranscriptLine(raw);
  }
  let cmpLen = 0;
  let rawIdx = 0;
  while (rawIdx < raw.length && cmpLen < comparePrefixLen) {
    const ch = raw[rawIdx]!;
    if (!isSpeechCompareSeparator(ch)) {
      cmpLen += 1;
    }
    rawIdx += 1;
  }
  while (rawIdx < raw.length && isSpeechCompareSeparator(raw[rawIdx]!)) {
    rawIdx += 1;
  }
  return raw.slice(rawIdx).trimStart();
}

/**
 * 从引擎 cumulative 转写中提取相对 baseline 的新增片段。
 * macOS / Web 连续听写会话会返回自会话开始以来的全文，发送后须以 baseline 截断避免重复。
 */
export function extractComposerSpeechTranscriptDelta(
  baseline: string,
  rawTranscript: string,
): string {
  const raw = normalizeSpeechTranscriptLine(rawTranscript);
  const base = normalizeSpeechTranscriptLine(baseline);
  if (!raw) return "";
  if (!base) return raw;
  if (raw === base) return "";
  if (raw.startsWith(base)) {
    return raw.slice(base.length).trimStart();
  }
  if (base.startsWith(raw)) return "";

  const rawCmp = stripSpeechCompareNoise(raw);
  const baseCmp = stripSpeechCompareNoise(base);
  if (!rawCmp) return "";
  if (!baseCmp) return raw;
  if (rawCmp === baseCmp) return "";
  if (rawCmp.startsWith(baseCmp)) {
    return sliceRawTranscriptAfterComparePrefix(raw, baseCmp.length);
  }
  if (baseCmp.startsWith(rawCmp)) return "";

  const baseHead = baseCmp.slice(0, Math.min(baseCmp.length, 12));
  if (baseHead.length > 0 && !rawCmp.startsWith(baseHead)) {
    // 句段 final 后引擎可能只推送下一句（不再带 baseline 前缀）。
    return raw;
  }

  let shared = 0;
  while (shared < rawCmp.length && shared < baseCmp.length && rawCmp[shared] === baseCmp[shared]) {
    shared += 1;
  }
  return sliceRawTranscriptAfterComparePrefix(raw, shared);
}

/** 发送后推进 baseline，使后续 delta 不再包含已发送片段。 */
export function advanceComposerSpeechTranscriptBaseline(
  baseline: string,
  rawTranscript: string,
): string {
  const raw = normalizeSpeechTranscriptLine(rawTranscript);
  if (!raw) return baseline;
  const base = normalizeSpeechTranscriptLine(baseline);
  if (!base || raw.startsWith(base) || base.startsWith(raw)) {
    return raw;
  }
  const rawCmp = stripSpeechCompareNoise(raw);
  const baseCmp = stripSpeechCompareNoise(base);
  if (!baseCmp || rawCmp.startsWith(baseCmp) || baseCmp.startsWith(rawCmp)) {
    return raw;
  }
  return raw;
}

/** 连续听写：输入框仅展示相对 baseline 的 delta（整段替换，不在 anchor 上叠加）。 */
export function resolveComposerSpeechDisplayText(delta: string): { plain: string; cursor: number } {
  const plain = normalizeSpeechTranscriptLine(delta);
  return { plain, cursor: plain.length };
}

/** 将当前 utterance 的 partial 或 final 文本合并进 plain。final 时提交到 prefix。 */
export function applyComposerSpeechStreamTranscript(
  anchor: ComposerSpeechStreamAnchor,
  utterance: string,
  isFinal: boolean,
): { anchor: ComposerSpeechStreamAnchor; plain: string; cursor: number } {
  const chunk = utterance.replace(/\s+/g, " ").trim();
  if (!chunk) {
    return {
      anchor,
      plain: anchor.prefix + anchor.suffix,
      cursor: anchor.prefix.length,
    };
  }

  const { insertion } = buildSpeechInsertion(anchor.prefix, anchor.prefix.length, chunk);
  const displayPlain = anchor.prefix + insertion + anchor.suffix;
  const displayCursor = anchor.prefix.length + insertion.length;

  if (!isFinal) {
    return { anchor, plain: displayPlain, cursor: displayCursor };
  }

  const committedPrefix = anchor.prefix + insertion;
  return {
    anchor: { prefix: committedPrefix, suffix: anchor.suffix },
    plain: committedPrefix + anchor.suffix,
    cursor: committedPrefix.length,
  };
}
