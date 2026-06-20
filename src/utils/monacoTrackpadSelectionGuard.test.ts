import { describe, expect, test } from "bun:test";

/** 与 monacoTrackpadSelectionGuard.ts 保持同步 */
const ACCIDENTAL_MIN_LINE_SPAN = 2;
const ACCIDENTAL_MIN_CHAR_COUNT = 80;

function selectionLineSpan(startLine: number, endLine: number): number {
  return Math.abs(endLine - startLine) + 1;
}

function isAccidentalBlockSelectionHeuristic(
  startLine: number,
  endLine: number,
  textInRange: string,
  empty: boolean,
): boolean {
  if (empty) return false;
  if (selectionLineSpan(startLine, endLine) >= ACCIDENTAL_MIN_LINE_SPAN) return true;
  return textInRange.length >= ACCIDENTAL_MIN_CHAR_COUNT;
}

function isIntentionalDragDistance(
  start: { x: number; y: number } | null,
  end: { x: number; y: number },
  thresholdPx: number,
): boolean {
  if (!start) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) >= thresholdPx;
}

describe("monaco trackpad accidental selection heuristic", () => {
  test("treats two-line span as accidental", () => {
    expect(isAccidentalBlockSelectionHeuristic(1, 2, "ab", false)).toBe(true);
  });

  test("treats multi-line span as accidental", () => {
    expect(isAccidentalBlockSelectionHeuristic(1, 4, "", false)).toBe(true);
  });

  test("ignores single short line selection", () => {
    expect(isAccidentalBlockSelectionHeuristic(5, 5, "short", false)).toBe(false);
  });

  test("treats long single-line selection as accidental", () => {
    expect(isAccidentalBlockSelectionHeuristic(2, 2, "x".repeat(ACCIDENTAL_MIN_CHAR_COUNT), false)).toBe(
      true,
    );
  });
});

describe("monaco intentional drag distance", () => {
  test("ignores tiny jitter under threshold", () => {
    expect(isIntentionalDragDistance({ x: 10, y: 10 }, { x: 12, y: 11 }, 4)).toBe(false);
  });

  test("treats real drag as intentional", () => {
    expect(isIntentionalDragDistance({ x: 10, y: 10 }, { x: 20, y: 30 }, 4)).toBe(true);
  });

  test("requires drag start", () => {
    expect(isIntentionalDragDistance(null, { x: 20, y: 30 }, 4)).toBe(false);
  });
});
