import type { Node as PMNode } from "@milkdown/kit/prose/model";
import type { AnchorRange, MilkdownTaskAnchor } from "./types";
import {
  collapseWs,
  expandNeedleCandidates,
  normalizeAnchorProbeText,
  textblockHayIncludesNeedle,
} from "./anchorText";

type RawChar = { abs: number; ch: string };

/** Match textblockHayIncludesNeedle by stripping visible list markers before indexOf(needle). */
function stripCollapsedListGlyphPrefix(
  collapsed: string,
  starts: number[],
): { collapsed: string; starts: number[] } {
  let i = 0;
  while (i < collapsed.length && collapsed[i] === " ") i++;
  if (i < collapsed.length && "•·▪".includes(collapsed[i]!)) {
    i += 1;
    while (i < collapsed.length && collapsed[i] === " ") i++;
    return { collapsed: collapsed.slice(i), starts: starts.slice(i) };
  }
  if (
    i + 1 < collapsed.length
    && "-*+".includes(collapsed[i]!)
    && collapsed[i + 1] === " "
  ) {
    i += 2;
    while (i < collapsed.length && collapsed[i] === " ") i++;
    return { collapsed: collapsed.slice(i), starts: starts.slice(i) };
  }
  if (i < collapsed.length && /\d/.test(collapsed[i]!)) {
    let j = i;
    while (j < collapsed.length && /\d/.test(collapsed[j]!)) j++;
    if (j < collapsed.length && collapsed[j] === "." && j + 1 < collapsed.length && collapsed[j + 1] === " ") {
      j += 2;
      while (j < collapsed.length && collapsed[j] === " ") j++;
      return { collapsed: collapsed.slice(j), starts: starts.slice(j) };
    }
  }
  return { collapsed, starts };
}

export function findTextblockStartForNeedle(doc: PMNode, searchText: string): number | null {
  for (const needle of expandNeedleCandidates(searchText)) {
    if (needle.length < 2) continue;
    let found: number | null = null;
    doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (!node.isTextblock) return true;
      if (node.type.spec.code) return true;
      if (textblockHayIncludesNeedle(node.textContent, needle)) {
        found = pos;
        return false;
      }
      return true;
    });
    if (found !== null) return found;
  }
  return null;
}

function walkInlineText(node: PMNode, pos: number, out: RawChar[]) {
  if (node.isText) {
    const t = node.text ?? "";
    for (let i = 0; i < t.length; i++) {
      out.push({ abs: pos + i, ch: t[i]! });
    }
    return;
  }
  node.forEach((child, offset) => {
    walkInlineText(child, pos + 1 + offset, out);
  });
}

function collectRawCharsInBlock(block: PMNode, blockPos: number): RawChar[] {
  const out: RawChar[] = [];
  block.forEach((child, offset) => {
    walkInlineText(child, blockPos + 1 + offset, out);
  });
  return out;
}

function collectRawCharsInDoc(doc: PMNode): RawChar[] {
  const out: RawChar[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? "";
    for (let i = 0; i < text.length; i += 1) {
      out.push({ abs: pos + i, ch: text[i]! });
    }
    return true;
  });
  return out;
}

export function resolveDocRangeFromVisibleOffsets(
  doc: PMNode,
  fromOffset: number,
  toOffset: number,
): AnchorRange | null {
  const chars = collectRawCharsInDoc(doc);
  if (chars.length === 0) return null;
  const from = Math.floor(Number(fromOffset));
  const to = Math.floor(Number(toOffset));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const fromIdx = Math.min(Math.max(0, from), chars.length - 1);
  const toIdxExclusive = Math.min(Math.max(fromIdx + 1, to), chars.length);
  const fromAbs = chars[fromIdx]!.abs;
  const toAbs = chars[toIdxExclusive - 1]!.abs + 1;
  if (toAbs <= fromAbs) return null;
  return { from: fromAbs, to: toAbs };
}

function trimOuterWsChars(chars: RawChar[]): RawChar[] {
  let a = 0;
  let b = chars.length - 1;
  while (a <= b && /\s/.test(chars[a]!.ch)) a++;
  while (b >= a && /\s/.test(chars[b]!.ch)) b--;
  if (a > b) return [];
  return chars.slice(a, b + 1);
}

function buildCollapsedWithStarts(chars: RawChar[]): { collapsed: string; starts: number[] } {
  const starts: number[] = [];
  let collapsed = "";
  let i = 0;
  while (i < chars.length) {
    const { abs, ch } = chars[i]!;
    if (/\s/.test(ch)) {
      let j = i;
      while (j < chars.length && /\s/.test(chars[j]!.ch)) j++;
      collapsed += " ";
      starts.push(chars[i]!.abs);
      i = j;
      continue;
    }
    collapsed += ch;
    starts.push(abs);
    i += 1;
  }
  return { collapsed, starts };
}

export function findRequirementHighlightRange(
  doc: PMNode,
  searchText: string,
  preferredFrom?: number,
): AnchorRange | null {
  const candidates = findRequirementHighlightCandidates(doc, searchText, preferredFrom);
  if (candidates.length === 0) return null;
  return { from: candidates[0]!.from, to: candidates[0]!.to };
}

function collectNeedleOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle || needle.length < 2) return out;
  let fromIndex = 0;
  while (fromIndex < haystack.length) {
    const idx = haystack.indexOf(needle, fromIndex);
    if (idx < 0) break;
    out.push(idx);
    fromIndex = idx + 1;
  }
  return out;
}

function findRequirementHighlightCandidates(
  doc: PMNode,
  searchText: string,
  preferredFrom?: number,
): Array<{ from: number; to: number; distance: number; needle: string }> {
  const preferred = Number.isFinite(preferredFrom) ? Math.max(1, Math.floor(Number(preferredFrom))) : null;
  const candidates: Array<{ from: number; to: number; distance: number; needle: string }> = [];
  for (const needle of expandNeedleCandidates(searchText)) {
    if (needle.length < 2) continue;
    doc.descendants((node, pos) => {
      if (!node.isTextblock || node.type.spec.code) return true;
      if (!textblockHayIncludesNeedle(node.textContent, needle)) return true;
      const chars = trimOuterWsChars(collectRawCharsInBlock(node, pos));
      if (chars.length === 0) return true;
      const built = buildCollapsedWithStarts(chars);
      const stripped = stripCollapsedListGlyphPrefix(built.collapsed, built.starts);
      const starts = collectNeedleOccurrences(stripped.collapsed, needle);
      for (const start of starts) {
        const end = start + needle.length;
        if (end > stripped.starts.length) continue;
        const from = stripped.starts[start]!;
        const to = stripped.starts[end - 1]! + 1;
        const distance = preferred == null ? 0 : Math.abs(from - preferred);
        candidates.push({ from, to, distance, needle });
      }
      return true;
    });
  }
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.needle.length - a.needle.length;
  });
  return candidates;
}

/**
 * If the current range ends inside a contextAfter hit, extend it to the end of
 * that hit so sentence-level anchors do not truncate the highlighted text.
 */
function extendAnchorRangeEndToCloseContextAfter(
  doc: PMNode,
  range: AnchorRange,
  contextAfterRaw: string,
): AnchorRange {
  const docSize = doc.content.size;
  if (!contextAfterRaw.trim()) return range;
  const fromF = Math.floor(range.from);
  const toF = Math.floor(range.to);
  if (fromF < 0 || toF <= fromF || toF > docSize) return range;
  const candidates = findRequirementHighlightCandidates(doc, contextAfterRaw, toF).slice(0, 48);
  let maxTo = toF;
  for (const c of candidates) {
    if (c.to <= toF) continue;
    if (c.from > toF) continue;
    if (c.from <= toF && toF < c.to) {
      const ct = Math.min(Math.floor(c.to), docSize);
      if (ct > maxTo) maxTo = ct;
    }
  }
  if (maxTo > toF && maxTo <= docSize) return { from: fromF, to: maxTo };
  return range;
}

export function finalizeAnchorRangeWithContextAfter(
  doc: PMNode,
  descriptor: MilkdownTaskAnchor["descriptor"] | undefined,
  range: AnchorRange | null,
): AnchorRange | null {
  if (!range || !descriptor?.contextAfter?.trim()) return range;
  return extendAnchorRangeEndToCloseContextAfter(doc, range, descriptor.contextAfter);
}

export function findBestAnchorRange(
  doc: PMNode,
  descriptor: MilkdownTaskAnchor["descriptor"] | undefined,
  searchText: string,
): AnchorRange | null {
  if (!descriptor) return null;
  const baseFrom = Math.floor(Number(descriptor.from));
  const baseTo = Math.floor(Number(descriptor.to));
  if (!Number.isFinite(baseFrom) || !Number.isFinite(baseTo) || baseTo <= baseFrom) return null;

  const docSize = doc.content.size;
  const beforeNeedles = expandNeedleCandidates(descriptor.contextBefore ?? "");
  const afterNeedles = expandNeedleCandidates(descriptor.contextAfter ?? "");
  const primaryNeedles = [
    searchText,
    descriptor.contextBefore ?? "",
  ].filter((x) => x.trim().length > 0);

  const rawCandidates: Array<{ from: number; to: number; distance: number; needle: string }> = [];
  for (const source of primaryNeedles) {
    rawCandidates.push(...findRequirementHighlightCandidates(doc, source, baseFrom).slice(0, 60));
  }

  // Pair contextBefore with contextAfter so the range includes the full contextAfter hit.
  const beforeContextCandidates = (descriptor.contextBefore?.trim().length ?? 0) > 0
    ? findRequirementHighlightCandidates(doc, descriptor.contextBefore, baseFrom).slice(0, 24)
    : [];
  const afterContextCandidates = (descriptor.contextAfter?.trim().length ?? 0) > 0
    ? findRequirementHighlightCandidates(doc, descriptor.contextAfter, baseFrom).slice(0, 24)
    : [];
  if (beforeContextCandidates.length > 0 && afterContextCandidates.length > 0) {
    let bestPair: { from: number; to: number; distance: number; spanLen: number } | null = null;
    for (const before of beforeContextCandidates) {
      for (const after of afterContextCandidates) {
        if (after.from <= before.to) continue;
        const spanFrom = before.from;
        const spanTo = after.to;
        const spanLen = spanTo - spanFrom;
        if (spanLen <= 0 || spanLen > 2600) continue;
        const distance = Math.abs(spanFrom - baseFrom);
        const current = { from: spanFrom, to: spanTo, distance, spanLen };
        if (!bestPair) {
          bestPair = current;
          continue;
        }
        if (current.distance !== bestPair.distance) {
          if (current.distance < bestPair.distance) bestPair = current;
          continue;
        }
        if (current.spanLen > bestPair.spanLen) bestPair = current;
      }
    }
    // When a same-order pair is reliable, highlight [before.from, after.to).
    if (bestPair) {
      return finalizeAnchorRangeWithContextAfter(doc, descriptor, { from: bestPair.from, to: bestPair.to });
    }
  }
  if (beforeContextCandidates.length > 0 && afterContextCandidates.length > 0) {
    for (const before of beforeContextCandidates) {
      for (const after of afterContextCandidates) {
        if (after.from <= before.to) continue;
        const spanFrom = before.from;
        const spanTo = after.to;
        const spanLen = spanTo - spanFrom;
        // Very large spans are usually repeated-word mismatches, so cap the window.
        if (spanLen <= 0 || spanLen > 2600) continue;
        rawCandidates.push({
          from: spanFrom,
          to: spanTo,
          distance: Math.abs(spanFrom - baseFrom),
          needle: "context-pair-span",
        });
      }
    }
  }

  const variantCandidates = [
    { from: baseFrom, to: baseTo },
    { from: baseFrom + 1, to: baseTo + 1 },
    { from: baseFrom - 1, to: baseTo - 1 },
  ].map((range) => ({
    from: range.from,
    to: range.to,
    distance: Math.abs(range.from - baseFrom),
    needle: "offset",
  }));
  rawCandidates.push(...variantCandidates);

  const scored: Array<{ from: number; to: number; score: number; distance: number }> = [];
  for (const candidate of rawCandidates) {
    if (!Number.isFinite(candidate.from) || !Number.isFinite(candidate.to)) continue;
    if (candidate.from < 0 || candidate.to <= candidate.from || candidate.to > docSize) continue;
    const range = { from: Math.floor(candidate.from), to: Math.floor(candidate.to) };
    const aroundBefore = normalizeAnchorProbeText(
      doc.textBetween(Math.max(0, range.from - 260), range.from, " ", " "),
    );
    const aroundAfter = normalizeAnchorProbeText(
      doc.textBetween(range.to, Math.min(docSize, range.to + 220), " ", " "),
    );
    const body = normalizeAnchorProbeText(doc.textBetween(range.from, range.to, " ", " "));
    const beforeHit = beforeNeedles.some((needle) => aroundBefore.includes(needle) || needle.includes(aroundBefore));
    const afterHitInBody = afterNeedles.some((needle) => body.includes(needle) || needle.includes(body));
    const afterHitInWindow = afterNeedles.some((needle) => aroundAfter.includes(needle) || needle.includes(aroundAfter));
    const afterHit = afterHitInBody || afterHitInWindow;
    const selfHit = expandNeedleCandidates(searchText).some((needle) => body.includes(needle) || needle.includes(body));
    const offsetHit = rangeLooksLikeAnchorMatch(
      doc,
      range,
      descriptor.contextAfter || descriptor.contextBefore || searchText,
    );
    const isContextSpan = candidate.needle === "context-pair-span";
    const pairBonus = beforeHit && afterHit ? 12 : 0;
    const spanBonus = isContextSpan && beforeHit && afterHit ? 8 : 0;
    const score = pairBonus + spanBonus + (afterHit ? 6 : 0) + (beforeHit ? 4 : 0) + (selfHit ? 3 : 0) + (offsetHit ? 2 : 0);
    scored.push({ ...range, score, distance: Math.abs(range.from - baseFrom) });
  }

  if (scored.length === 0) return null;
  const winner = scored.reduce((best, current) => {
    if (current.score !== best.score) return current.score > best.score ? current : best;
    if (current.distance !== best.distance) return current.distance < best.distance ? current : best;
    const lenCur = current.to - current.from;
    const lenBest = best.to - best.from;
    return lenCur > lenBest ? current : best;
  });
  if (winner.score <= 0) return null;
  return finalizeAnchorRangeWithContextAfter(doc, descriptor, { from: winner.from, to: winner.to });
}

export function rangeLooksLikeAnchorMatch(doc: PMNode, range: AnchorRange, searchText: string): boolean {
  const docSize = doc.content.size;
  if (range.from < 0 || range.to <= range.from || range.to > docSize) return false;
  const actual = normalizeAnchorProbeText(doc.textBetween(range.from, range.to, " ", " "));
  if (actual.length < 2) return false;
  for (const needle of expandNeedleCandidates(searchText)) {
    if (needle.length < 2) continue;
    if (actual.includes(needle) || needle.includes(actual)) return true;
  }
  return false;
}

export function buildContextHitReport(
  doc: PMNode,
  range: AnchorRange,
  contextBeforeRaw: string,
  contextAfterRaw: string,
): {
  beforeHit: boolean;
  afterHit: boolean;
  beforeNeedles: string[];
  afterNeedles: string[];
  beforeWindow: string;
  afterWindow: string;
} {
  const docSize = doc.content.size;
  const beforeNeedles = expandNeedleCandidates(contextBeforeRaw);
  const afterNeedles = expandNeedleCandidates(contextAfterRaw);
  const beforeWindow = normalizeAnchorProbeText(
    doc.textBetween(Math.max(0, range.from - 520), range.from, " ", " "),
  );
  const afterWindow = normalizeAnchorProbeText(
    doc.textBetween(range.to, Math.min(docSize, range.to + 360), " ", " "),
  );
  const beforeHit = beforeNeedles.some((needle) => beforeWindow.includes(needle) || needle.includes(beforeWindow));
  const afterHit = afterNeedles.some((needle) => afterWindow.includes(needle) || needle.includes(afterWindow));
  return {
    beforeHit,
    afterHit,
    beforeNeedles,
    afterNeedles,
    beforeWindow,
    afterWindow,
  };
}

export function findRangeByDescriptor(
  doc: PMNode,
  descriptor: MilkdownTaskAnchor["descriptor"] | undefined,
  searchText: string,
): AnchorRange | null {
  return findBestAnchorRange(doc, descriptor, searchText);
}

export function buildSelectedAnchorDraft(
  doc: PMNode,
  from: number,
  to: number,
): {
  from: number;
  to: number;
  text: string;
  contextBefore: string;
  contextAfter: string;
} | null {
  if (from === to) return null;
  const text = collapseWs(doc.textBetween(from, to, " ", " ")).trim();
  if (!text) return null;
  const contextWindow = 64;
  const beforeStart = Math.max(0, from - contextWindow);
  const afterEnd = Math.min(doc.content.size, to + contextWindow);
  const contextBefore = collapseWs(doc.textBetween(beforeStart, from, " ", " ")).trim();
  const contextAfter = collapseWs(doc.textBetween(to, afterEnd, " ", " ")).trim();
  return {
    from: Math.floor(from),
    to: Math.floor(to),
    text,
    contextBefore,
    contextAfter,
  };
}
