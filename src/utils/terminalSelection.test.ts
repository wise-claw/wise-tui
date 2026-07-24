import { describe, expect, test } from "bun:test";
import type { TerminalFrame } from "../types/terminal";
import {
  expandTerminalSelectionToAll,
  expandTerminalSelectionToLine,
  expandTerminalSelectionToWord,
  extractTerminalSelectionText,
  normalizeTerminalSelection,
  terminalPointFromOffset,
  terminalSelectionIsEmpty,
} from "./terminalSelection";

function frameFromLines(lines: string[], cols = 20, rows = 5): TerminalFrame {
  return {
    cols,
    rows,
    cursor: { col: 0, row: 0, visible: false },
    lines: lines.map((text) => [{ text, fg: "#fff", bg: "#000" }]),
  };
}

describe("terminalSelection", () => {
  test("normalize swaps inverted ranges", () => {
    expect(
      normalizeTerminalSelection({
        start: { col: 5, row: 2 },
        end: { col: 1, row: 1 },
      }),
    ).toEqual({
      start: { col: 1, row: 1 },
      end: { col: 5, row: 2 },
    });
  });

  test("terminalPointFromOffset clamps to grid", () => {
    expect(
      terminalPointFromOffset(25, 40, { cellWidth: 10, cellHeight: 20 }, { cols: 4, rows: 3 }),
    ).toEqual({ col: 2, row: 2 });
    expect(
      terminalPointFromOffset(-5, -5, { cellWidth: 10, cellHeight: 20 }, { cols: 4, rows: 3 }),
    ).toEqual({ col: 0, row: 0 });
  });

  test("extractTerminalSelectionText joins multi-line selection", () => {
    const frame = frameFromLines(["hello world", "foo bar", "zzz"]);
    const text = extractTerminalSelectionText(frame, {
      start: { col: 6, row: 0 },
      end: { col: 2, row: 1 },
    });
    expect(text).toBe("world\nfoo");
  });

  test("expandTerminalSelectionToWord expands around alphanumeric run", () => {
    const frame = frameFromLines(["ab cd-ef"]);
    expect(expandTerminalSelectionToWord(frame, { col: 1, row: 0 })).toEqual({
      start: { col: 0, row: 0 },
      end: { col: 1, row: 0 },
    });
    expect(expandTerminalSelectionToWord(frame, { col: 5, row: 0 })).toEqual({
      start: { col: 3, row: 0 },
      end: { col: 7, row: 0 },
    });
  });

  test("expandTerminalSelectionToLine and toAll", () => {
    const frame = frameFromLines(["abc  ", "de"]);
    expect(expandTerminalSelectionToLine(frame, { col: 1, row: 0 })).toEqual({
      start: { col: 0, row: 0 },
      end: { col: 2, row: 0 },
    });
    expect(expandTerminalSelectionToAll(frame)).toEqual({
      start: { col: 0, row: 0 },
      end: { col: 1, row: 1 },
    });
    expect(terminalSelectionIsEmpty(null)).toBe(true);
    expect(
      terminalSelectionIsEmpty({ start: { col: 1, row: 1 }, end: { col: 1, row: 1 } }),
    ).toBe(false);
  });
});