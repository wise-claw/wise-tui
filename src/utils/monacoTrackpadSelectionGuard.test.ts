import { describe, expect, test } from "bun:test";
import type { editor, ISelection } from "monaco-editor";

// 与 monacoTrackpadSelectionGuard 内阈值一致，仅测判定逻辑副本
const ACCIDENTAL_MIN_LINE_SPAN = 3;
const ACCIDENTAL_MIN_CHAR_COUNT = 120;

function selectionLineSpan(selection: ISelection): number {
  return Math.abs(selection.endLineNumber - selection.startLineNumber) + 1;
}

function isAccidentalBlockSelectionMock(
  selection: ISelection,
  textInRange: string,
): boolean {
  if (selection.isEmpty()) return false;
  if (selectionLineSpan(selection) >= ACCIDENTAL_MIN_LINE_SPAN) return true;
  return textInRange.length >= ACCIDENTAL_MIN_CHAR_COUNT;
}

function mockSelection(
  startLine: number,
  endLine: number,
  empty = false,
): ISelection {
  return {
    isEmpty: () => empty,
    startLineNumber: startLine,
    endLineNumber: endLine,
    startColumn: 1,
    endColumn: 1,
  } as ISelection;
}

describe("monaco trackpad accidental selection heuristic", () => {
  test("treats multi-line span as accidental", () => {
    expect(isAccidentalBlockSelectionMock(mockSelection(1, 4), "")).toBe(true);
  });

  test("ignores single short line selection", () => {
    expect(isAccidentalBlockSelectionMock(mockSelection(5, 5), "short")).toBe(false);
  });

  test("treats long single-line selection as accidental", () => {
    expect(isAccidentalBlockSelectionMock(mockSelection(2, 2), "x".repeat(150))).toBe(true);
  });
});
