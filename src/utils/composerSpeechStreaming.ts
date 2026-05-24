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

function sliceRawTranscriptAfterCompareSubstring(raw: string, compareStart: number, compareLen: number): string {
  return sliceRawTranscriptAfterComparePrefix(raw, compareStart + compareLen);
}

/** 在多个候选 baseline 中取最长且互相扩展关系最优者，避免被短 raw 覆盖 cumulative baseline。 */
export function pickLongerSpeechBaseline(...candidates: string[]): string {
  const normalized = candidates
    .map((candidate) => normalizeSpeechTranscriptLine(candidate))
    .filter(Boolean);
  if (normalized.length === 0) return "";
  return normalized.reduce((best, cur) => {
    const bestCmp = stripSpeechCompareNoise(best);
    const curCmp = stripSpeechCompareNoise(cur);
    if (curCmp.startsWith(bestCmp)) return cur;
    if (bestCmp.startsWith(curCmp)) return best;
    return curCmp.length > bestCmp.length ? cur : best;
  });
}

/** 将已发送片段追加到 cumulative baseline（勿用单句 sentPlain / 短 raw 覆盖整段 baseline）。 */
export function appendSpeechBaselineSegment(
  baseline: string,
  sentPlain: string,
  rawHint?: string,
): string {
  const base = normalizeSpeechTranscriptLine(baseline);
  const sent = normalizeSpeechTranscriptLine(sentPlain);
  const raw = normalizeSpeechTranscriptLine(rawHint ?? "");
  if (!sent) {
    return pickLongerSpeechBaseline(base, raw);
  }
  if (!base) {
    return pickLongerSpeechBaseline(sent, raw);
  }

  const baseCmp = stripSpeechCompareNoise(base);
  const sentCmp = stripSpeechCompareNoise(sent);
  const rawCmp = stripSpeechCompareNoise(raw);

  if (baseCmp.endsWith(sentCmp)) {
    return pickLongerSpeechBaseline(base, raw);
  }
  if (rawCmp && rawCmp.startsWith(baseCmp) && rawCmp.length >= baseCmp.length) {
    return raw;
  }
  if (sentCmp.startsWith(baseCmp)) {
    return pickLongerSpeechBaseline(sent, raw);
  }

  const sep = /[。！？!?…]$/.test(base) ? " " : "。";
  const merged = normalizeSpeechTranscriptLine(`${base}${sep}${sent}`);
  const mergedCmp = stripSpeechCompareNoise(merged);

  if (rawCmp.startsWith(mergedCmp)) {
    return raw;
  }
  if (rawCmp.startsWith(baseCmp) && rawCmp.length > baseCmp.length) {
    return raw;
  }
  return merged;
}

/** 发送后提交 baseline：优先 cumulative raw，否则追加 sentPlain，且 baseline 只增不减。 */
export function commitComposerSpeechTranscriptBaselineForSend(
  baseline: string,
  rawTranscript: string,
  sentPlain: string,
): string {
  const base = normalizeSpeechTranscriptLine(baseline);
  const raw = normalizeSpeechTranscriptLine(rawTranscript);
  const sent = normalizeSpeechTranscriptLine(sentPlain);
  const appended = sent ? appendSpeechBaselineSegment(base, sent, raw) : base;
  return pickLongerSpeechBaseline(base, raw, appended);
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
  if (!baseCmp) return raw;
  if (rawCmp === baseCmp) return "";
  if (rawCmp.startsWith(baseCmp)) {
    return sliceRawTranscriptAfterComparePrefix(raw, baseCmp.length);
  }
  if (baseCmp.startsWith(rawCmp)) return "";

  // baseline 可能嵌在 cumulative raw 中间（baseline 曾被 sentPlain 截断过）。
  const embedIdx = rawCmp.lastIndexOf(baseCmp);
  if (embedIdx >= 0) {
    const afterEmbed = sliceRawTranscriptAfterCompareSubstring(raw, embedIdx, baseCmp.length);
    if (afterEmbed) {
      return afterEmbed;
    }
    return "";
  }

  let shared = 0;
  while (shared < rawCmp.length && shared < baseCmp.length && rawCmp[shared] === baseCmp[shared]) {
    shared += 1;
  }
  if (shared > 0) {
    return sliceRawTranscriptAfterComparePrefix(raw, shared);
  }

  return raw;
}

/** 发送后推进 baseline，使后续 delta 不再包含已发送片段。 */
export function advanceComposerSpeechTranscriptBaseline(
  baseline: string,
  rawTranscript: string,
  sentPlain?: string,
): string {
  return commitComposerSpeechTranscriptBaselineForSend(
    baseline,
    rawTranscript,
    sentPlain ?? "",
  );
}

function sliceComparePrefix(raw: string, compareLen: number): string {
  if (compareLen <= 0) return "";
  let cmpLen = 0;
  let rawIdx = 0;
  while (rawIdx < raw.length && cmpLen < compareLen) {
    if (!isSpeechCompareSeparator(raw[rawIdx]!)) {
      cmpLen += 1;
    }
    rawIdx += 1;
  }
  return raw.slice(0, rawIdx).trimEnd();
}

/** 从 delta 中剥离刚发送过的正文（引擎 raw 滞后时兜底）。 */
export function stripComposerSpeechDeltaOverlap(
  delta: string,
  lastSentPlain: string,
): string {
  const chunk = normalizeSpeechTranscriptLine(delta);
  const sent = normalizeSpeechTranscriptLine(lastSentPlain);
  if (!chunk || !sent) return chunk;
  if (chunk === sent) return "";

  const chunkCmp = stripSpeechCompareNoise(chunk);
  const sentCmp = stripSpeechCompareNoise(sent);
  if (chunkCmp === sentCmp) return "";
  if (chunkCmp.startsWith(sentCmp)) {
    return sliceRawTranscriptAfterComparePrefix(chunk, sentCmp.length);
  }

  const embedIdx = chunkCmp.indexOf(sentCmp);
  if (embedIdx >= 0) {
    const before = embedIdx > 0 ? sliceComparePrefix(chunk, embedIdx) : "";
    const after = sliceRawTranscriptAfterCompareSubstring(chunk, embedIdx, sentCmp.length);
    if (before && after) {
      return normalizeSpeechTranscriptLine(
        `${before.replace(/[，,]\s*$/u, "")}，${after.replace(/^[，,]\s*/u, "")}`,
      );
    }
    return normalizeSpeechTranscriptLine(`${before}${after}`);
  }

  return chunk;
}

/** 连续听写：输入框仅展示相对 baseline 的 delta（整段替换，不在 anchor 上叠加）。 */
export function resolveComposerSpeechDisplayText(delta: string): { plain: string; cursor: number } {
  const plain = normalizeSpeechTranscriptLine(delta).replace(/^[，。,.!?；;:：\s]+/u, "");
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
