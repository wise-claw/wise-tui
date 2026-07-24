import type { TerminalCellRun, TerminalFrame } from "../types/terminal";

export type TerminalCellPoint = {
  col: number;
  row: number;
};

/** 闭区间选区：start/end 均为包含的格子坐标。 */
export type TerminalSelectionRange = {
  start: TerminalCellPoint;
  end: TerminalCellPoint;
};

export function compareTerminalCellPoints(a: TerminalCellPoint, b: TerminalCellPoint): number {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

export function normalizeTerminalSelection(
  range: TerminalSelectionRange,
): TerminalSelectionRange {
  if (compareTerminalCellPoints(range.start, range.end) <= 0) {
    return { start: { ...range.start }, end: { ...range.end } };
  }
  return { start: { ...range.end }, end: { ...range.start } };
}

export function terminalSelectionIsEmpty(range: TerminalSelectionRange | null | undefined): boolean {
  return range == null;
}

/** 将指针坐标映射到单元格（相对 canvas 内容区左上角）。 */
export function terminalPointFromOffset(
  offsetX: number,
  offsetY: number,
  metrics: { cellWidth: number; cellHeight: number },
  bounds: { cols: number; rows: number },
): TerminalCellPoint {
  const col = Math.max(
    0,
    Math.min(bounds.cols - 1, Math.floor(offsetX / Math.max(1, metrics.cellWidth))),
  );
  const row = Math.max(
    0,
    Math.min(bounds.rows - 1, Math.floor(offsetY / Math.max(1, metrics.cellHeight))),
  );
  return { col, row };
}

export function isTerminalCellSelected(
  col: number,
  row: number,
  range: TerminalSelectionRange | null | undefined,
): boolean {
  if (!range || terminalSelectionIsEmpty(range)) return false;
  const norm = normalizeTerminalSelection(range);
  const point = { col, row };
  return (
    compareTerminalCellPoints(point, norm.start) >= 0 &&
    compareTerminalCellPoints(point, norm.end) <= 0
  );
}

export function flattenTerminalLine(runs: readonly TerminalCellRun[] | undefined): string {
  if (!runs || runs.length === 0) return "";
  let out = "";
  for (const run of runs) out += run.text;
  return out;
}

/**
 * 从 frame 提取选区文本。行末多余空白去掉；行间用 `\n`。
 * 单行选区不追加换行。
 */
export function extractTerminalSelectionText(
  frame: TerminalFrame,
  range: TerminalSelectionRange | null | undefined,
): string {
  if (!range || terminalSelectionIsEmpty(range)) return "";
  const norm = normalizeTerminalSelection(range);
  const lines: string[] = [];

  for (let row = norm.start.row; row <= norm.end.row; row += 1) {
    if (row < 0 || row >= frame.lines.length) continue;
    const full = flattenTerminalLine(frame.lines[row]);
    const startCol = row === norm.start.row ? norm.start.col : 0;
    const endColExclusive = row === norm.end.row ? norm.end.col + 1 : full.length;
    const slice = full.slice(
      Math.max(0, startCol),
      Math.max(0, Math.min(full.length, endColExclusive)),
    );
    lines.push(slice.replace(/\s+$/u, ""));
  }

  return lines.join("\n");
}

/** 双击：围绕点扩展到空白分隔的「词」。 */
export function expandTerminalSelectionToWord(
  frame: TerminalFrame,
  point: TerminalCellPoint,
): TerminalSelectionRange {
  const line = flattenTerminalLine(frame.lines[point.row]);
  if (!line) {
    return { start: { ...point }, end: { ...point } };
  }
  const col = Math.max(0, Math.min(line.length - 1, point.col));
  const isWord = (ch: string | undefined) => Boolean(ch && !/\s/u.test(ch));
  if (!isWord(line[col])) {
    return { start: { col, row: point.row }, end: { col, row: point.row } };
  }
  let start = col;
  let end = col;
  while (start > 0 && isWord(line[start - 1])) start -= 1;
  while (end + 1 < line.length && isWord(line[end + 1])) end += 1;
  return {
    start: { col: start, row: point.row },
    end: { col: end, row: point.row },
  };
}

/** 三击：整行（有内容的列范围）。 */
export function expandTerminalSelectionToLine(
  frame: TerminalFrame,
  point: TerminalCellPoint,
): TerminalSelectionRange {
  const line = flattenTerminalLine(frame.lines[point.row]);
  if (!line) {
    return { start: { col: 0, row: point.row }, end: { col: 0, row: point.row } };
  }
  const trimmedEnd = Math.max(0, line.replace(/\s+$/u, "").length - 1);
  return {
    start: { col: 0, row: point.row },
    end: { col: trimmedEnd, row: point.row },
  };
}

export function expandTerminalSelectionToAll(frame: TerminalFrame): TerminalSelectionRange | null {
  if (frame.rows <= 0 || frame.cols <= 0) return null;
  let lastRow = -1;
  let lastCol = 0;
  for (let row = 0; row < frame.lines.length; row += 1) {
    const text = flattenTerminalLine(frame.lines[row]).replace(/\s+$/u, "");
    if (text.length > 0) {
      lastRow = row;
      lastCol = text.length - 1;
    }
  }
  if (lastRow < 0) {
    return {
      start: { col: 0, row: 0 },
      end: { col: 0, row: 0 },
    };
  }
  return {
    start: { col: 0, row: 0 },
    end: { col: lastCol, row: lastRow },
  };
}
