/** 简易行级 diff 统计，供配置补丁审阅 UI 使用。 */
export interface PatchDiffStats {
  beforeLines: number;
  afterLines: number;
  addedLines: number;
  removedLines: number;
  unchangedLines: number;
}

export interface PatchDiffLine {
  kind: "add" | "remove" | "same";
  text: string;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** Myers 简化版：逐行 LCS 标记增删（足够审阅 Markdown 补丁）。 */
export function buildPatchDiffLines(before: string, after: string): PatchDiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: PatchDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "remove", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: "remove", text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: "add", text: b[j]! });
    j += 1;
  }
  return out;
}

export function computePatchDiffStats(before: string, after: string): PatchDiffStats {
  const lines = buildPatchDiffLines(before, after);
  let addedLines = 0;
  let removedLines = 0;
  let unchangedLines = 0;
  for (const line of lines) {
    if (line.kind === "add") addedLines += 1;
    else if (line.kind === "remove") removedLines += 1;
    else unchangedLines += 1;
  }
  const beforeLines = splitLines(before).length;
  const afterLines = splitLines(after).length;
  return { beforeLines, afterLines, addedLines, removedLines, unchangedLines };
}

/** 折叠 unchanged 行，仅展示变更附近上下文。 */
export function compactPatchDiffLines(
  lines: readonly PatchDiffLine[],
  context = 2,
): PatchDiffLine[] {
  const changeIndexes = lines
    .map((line, idx) => (line.kind === "same" ? -1 : idx))
    .filter((idx) => idx >= 0);
  if (changeIndexes.length === 0) return lines.slice(0, context * 2);

  const keep = new Set<number>();
  for (const idx of changeIndexes) {
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k += 1) {
      keep.add(k);
    }
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: PatchDiffLine[] = [];
  let prev = -1;
  for (const idx of sorted) {
    if (prev >= 0 && idx > prev + 1) {
      out.push({ kind: "same", text: "…" });
    }
    out.push(lines[idx]!);
    prev = idx;
  }
  return out;
}

export function formatPatchDiffStats(stats: PatchDiffStats): string {
  return `+${stats.addedLines} / -${stats.removedLines} 行（${stats.beforeLines} → ${stats.afterLines}）`;
}
