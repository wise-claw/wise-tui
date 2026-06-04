import { describe, expect, test } from "bun:test";

const ACCIDENTAL_MIN_LINE_SPAN = 3;
const ACCIDENTAL_MIN_CHAR_COUNT = 120;

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

describe("monaco trackpad accidental selection heuristic", () => {
  test("treats multi-line span as accidental", () => {
    expect(isAccidentalBlockSelectionHeuristic(1, 4, "", false)).toBe(true);
  });

  test("ignores single short line selection", () => {
    expect(isAccidentalBlockSelectionHeuristic(5, 5, "short", false)).toBe(false);
  });

  test("treats long single-line selection as accidental", () => {
    expect(isAccidentalBlockSelectionHeuristic(2, 2, "x".repeat(150), false)).toBe(true);
  });
});
