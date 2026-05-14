/**
 * Cluster PRD slice + 锚点高亮分段工具。
 *
 * 拆分 subagent 看到的 PRD 是 cluster 切片渲染的 markdown（与用户原始 markdown 不同），
 * 因此 splitter 返回的 `taskAnchors.from/to` 偏移是相对**切片渲染稿**的。
 * Review 阶段要把锚点高亮回放，必须用同一份切片稿作为来源。
 */

import type { PrdDocument } from "../../types";
import { prdDocumentToSplitMarkdown } from "../prdDocumentMarkdown";
import type { RequirementsIndexV2 } from "./requirementsIndexVersion";

export function buildClusterPrdMarkdown(
  prd: PrdDocument,
  index: RequirementsIndexV2,
  clusterRequirementIds: string[],
): string {
  if (clusterRequirementIds.length === 0) {
    return prdDocumentToSplitMarkdown(prd);
  }
  const wantedTexts = new Set<string>();
  for (const entry of index.requirements) {
    if (clusterRequirementIds.includes(entry.id)) {
      wantedTexts.add(entry.content.trim());
    }
  }
  if (wantedTexts.size === 0) return prdDocumentToSplitMarkdown(prd);
  return prdDocumentToSplitMarkdown({
    ...prd,
    functional: prd.functional.filter((t) => wantedTexts.has(t.trim())),
    nonFunctional: prd.nonFunctional.filter((t) => wantedTexts.has(t.trim())),
    acceptance: prd.acceptance.filter((t) => wantedTexts.has(t.trim())),
  });
}

export interface HighlightRange {
  from: number;
  to: number;
  taskId: string;
}

export interface HighlightSegment {
  text: string;
  /** 命中的 taskId 数组（一字符可能落在多个 overlap 的锚点内，取所有）。 */
  taskIds: string[];
}

/**
 * 把 markdown 与 ranges 编译成顺序段落数组；overlap 区间合并 taskIds。
 * 输入 from/to 必须满足 from < to；越界自动夹紧到 [0, text.length]。
 */
export function buildHighlightSegments(text: string, ranges: HighlightRange[]): HighlightSegment[] {
  if (ranges.length === 0 || text.length === 0) {
    return text.length > 0 ? [{ text, taskIds: [] }] : [];
  }
  const breakpoints = new Set<number>([0, text.length]);
  for (const range of ranges) {
    const from = Math.max(0, Math.min(text.length, range.from));
    const to = Math.max(from, Math.min(text.length, range.to));
    if (to > from) {
      breakpoints.add(from);
      breakpoints.add(to);
    }
  }
  const sorted = [...breakpoints].sort((a, b) => a - b);
  const segments: HighlightSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start >= end) continue;
    const chunkText = text.slice(start, end);
    const hits = ranges
      .filter((r) => {
        const from = Math.max(0, Math.min(text.length, r.from));
        const to = Math.max(from, Math.min(text.length, r.to));
        return from <= start && to >= end;
      })
      .map((r) => r.taskId);
    segments.push({ text: chunkText, taskIds: [...new Set(hits)] });
  }
  return segments;
}
