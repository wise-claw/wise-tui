/**
 * 锚点编辑纯函数 + DOM selection 捕获工具。
 *
 * 纯部分（可单测）：deriveAnchorFromRange / shiftAnchorEdge / clampRange。
 * DOM 部分（依赖 window）：captureSelectionOffset — 浏览器 TreeWalker 把 selection
 * 区间换成 PRD 文本偏移；UI 调用，单测以集成测试承担。
 */

import type { TaskAnchorDescriptor } from "../../types";
import { fnv1a64Hex } from "../../services/prdSplit/requirementsIndexVersion";

const CONTEXT_RADIUS_CHARS = 80;

export interface RangeSpec {
  from: number;
  to: number;
}

export function clampRange(prdText: string, from: number, to: number): RangeSpec {
  const len = prdText.length;
  const f = Math.max(0, Math.min(len, Math.floor(from)));
  const t = Math.max(0, Math.min(len, Math.floor(to)));
  if (t <= f) {
    // 退化：扩到至少 1 个字符；无法时贴边返回 (0,0)。
    if (len === 0) return { from: 0, to: 0 };
    const start = Math.min(f, Math.max(0, len - 1));
    return { from: start, to: Math.min(len, start + 1) };
  }
  return { from: f, to: t };
}

export function deriveAnchorFromRange(prdText: string, from: number, to: number): TaskAnchorDescriptor {
  const range = clampRange(prdText, from, to);
  const contextBefore = prdText.slice(Math.max(0, range.from - CONTEXT_RADIUS_CHARS), range.from);
  const contextAfter = prdText.slice(range.to, Math.min(prdText.length, range.to + CONTEXT_RADIUS_CHARS));
  const text = prdText.slice(range.from, range.to);
  const textHash = fnv1a64Hex(text);
  return { from: range.from, to: range.to, textHash, contextBefore, contextAfter };
}

export function shiftAnchorEdge(
  anchor: TaskAnchorDescriptor,
  edge: "start" | "end",
  delta: number,
  prdText: string,
): TaskAnchorDescriptor {
  const nextFrom = edge === "start" ? anchor.from + delta : anchor.from;
  const nextTo = edge === "end" ? anchor.to + delta : anchor.to;
  return deriveAnchorFromRange(prdText, nextFrom, nextTo);
}

/**
 * 浏览器侧：把当前 selection 落在 `container` 内的部分换算成 PRD 文本偏移。
 * 失败（选区不在 container 内 / 折叠 / 跨边界）返回 null。
 *
 * 实现细节：DOM 渲染会把同一段连续字符拆到多个 `<mark>` / `<span>`，但 TreeWalker
 * 按文本节点顺序枚举，逐节点累加 `nodeValue.length` 后与 selection range 的端点比较，
 * 得到的 from/to 与原始 PRD 文本的 UTF-16 码元偏移一致（与 normalizer / splitter
 * 一致的偏移空间）。
 */
export function captureSelectionOffset(container: HTMLElement): RangeSpec | null {
  if (typeof window === "undefined") return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  let from = -1;
  let to = -1;
  let cursor = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    if (from < 0 && node === range.startContainer) {
      from = cursor + Math.min(range.startOffset, len);
    }
    if (to < 0 && node === range.endContainer) {
      to = cursor + Math.min(range.endOffset, len);
    }
    cursor += len;
    if (from >= 0 && to >= 0) break;
    node = walker.nextNode() as Text | null;
  }
  if (from < 0 || to < 0 || to <= from) return null;
  return { from, to };
}
