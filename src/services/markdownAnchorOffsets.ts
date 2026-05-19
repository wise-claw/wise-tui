import type { SplitResult } from "../types";

function buildMarkdownToVisibleOffsetMap(markdown: string): number[] {
  const map = new Array<number>(markdown.length + 1);
  let visible = 0;
  let i = 0;
  let lineStart = true;
  let inFence = false;
  map[0] = 0;
  while (i < markdown.length) {
    map[i] = visible;
    const ch = markdown[i]!;
    const next3 = markdown.slice(i, i + 3);
    if (next3 === "```") {
      inFence = !inFence;
      i += 3;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      lineStart = true;
      i += 1;
      continue;
    }
    if (!inFence && lineStart) {
      const rest = markdown.slice(i);
      const heading = rest.match(/^#{1,6}\s+/);
      if (heading) {
        i += heading[0].length;
        lineStart = false;
        continue;
      }
      const quote = rest.match(/^>\s*/);
      if (quote) {
        i += quote[0].length;
        lineStart = false;
        continue;
      }
      const list = rest.match(/^(?:[-*+]|\d+\.)\s+/);
      if (list) {
        i += list[0].length;
        lineStart = false;
        continue;
      }
    }
    lineStart = false;
    if (!inFence && "*_~`[]()!#>".includes(ch)) {
      i += 1;
      continue;
    }
    visible += 1;
    i += 1;
  }
  map[markdown.length] = visible;
  return map;
}

export function remapAnchorRangeFromMarkdownToVisible(
  markdown: string,
  anchor: {
    from: number;
    to: number;
    textHash: string;
    contextBefore: string;
    contextAfter: string;
    mdFrom?: number;
    mdTo?: number;
  } | undefined,
): ({
  from: number;
  to: number;
  textHash: string;
  contextBefore: string;
  contextAfter: string;
  mdFrom?: number;
  mdTo?: number;
}) | undefined {
  if (!anchor) return undefined;
  const rawFrom = Number.isFinite(Number(anchor.mdFrom)) ? Number(anchor.mdFrom) : Number(anchor.from);
  const rawTo = Number.isFinite(Number(anchor.mdTo)) ? Number(anchor.mdTo) : Number(anchor.to);
  const from = Math.floor(rawFrom);
  const to = Math.floor(rawTo);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return {
      ...anchor,
      mdFrom: Number.isFinite(from) ? from : undefined,
      mdTo: Number.isFinite(to) ? to : undefined,
    };
  }
  const map = buildMarkdownToVisibleOffsetMap(markdown);
  const safeFrom = Math.min(Math.max(0, from), map.length - 1);
  const safeTo = Math.min(Math.max(safeFrom + 1, to), map.length - 1);
  const mappedFrom = map[safeFrom] ?? 0;
  const mappedTo = map[safeTo] ?? mappedFrom + 1;
  return {
    ...anchor,
    mdFrom: from,
    mdTo: to,
    from: mappedFrom,
    to: Math.max(mappedFrom + 1, mappedTo),
  };
}

export function remapSplitResultAnchorOffsetsFromMarkdown(markdown: string, result: SplitResult): SplitResult {
  const remappedTasks = result.splitTasks.map((task) => {
    const remapped = remapAnchorRangeFromMarkdownToVisible(markdown, task.taskAnchors);
    if (!remapped) return task;
    return { ...task, taskAnchors: remapped };
  });
  const remappedDescriptors = result.taskAnchorDescriptors
    ? Object.fromEntries(
      Object.entries(result.taskAnchorDescriptors).map(([taskId, anchor]) => [
        taskId,
        remapAnchorRangeFromMarkdownToVisible(markdown, anchor) ?? anchor,
      ]),
    )
    : undefined;
  return {
    ...result,
    splitTasks: remappedTasks,
    taskAnchorDescriptors: remappedDescriptors,
  };
}
