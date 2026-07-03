import { describe, expect, it } from "bun:test";
import {
  classifyLineChanges,
  computeLineNumbersDifferentFromBase,
  monacoLineChangeGutterClassName,
} from "./monacoGitModifiedLineDecorations";

describe("computeLineNumbersDifferentFromBase", () => {
  it("returns 1-based line numbers that differ", () => {
    expect(computeLineNumbersDifferentFromBase("a\nb\nc", "a\nx\nc")).toEqual([2]);
  });

  it("includes trailing added lines", () => {
    expect(computeLineNumbersDifferentFromBase("a", "a\nb")).toEqual([1, 2]);
  });
});

describe("classifyLineChanges", () => {
  it("detects trailing newline differences as modified+added", () => {
    expect(classifyLineChanges("a\nb", "a\nb\n\n")).toEqual([
      { lineNumber: 2, kind: "modified" },
      { lineNumber: 3, kind: "added" },
    ]);
  });

  it("marks replaced lines as modified", () => {
    expect(classifyLineChanges("a\nb\nc", "a\nx\nc")).toEqual([{ lineNumber: 2, kind: "modified" }]);
  });

  it("marks inserted lines as added", () => {
    expect(classifyLineChanges("a\nb\nc", "a\nx\ny\nb\nc")).toEqual([
      { lineNumber: 2, kind: "added" },
      { lineNumber: 3, kind: "added" },
    ]);
  });

  it("produces no markers for deletions", () => {
    expect(classifyLineChanges("a\nb\nc\nd", "a\nc\nd")).toEqual([]);
  });

  it("maps gutter classes by change kind", () => {
    expect(monacoLineChangeGutterClassName("added")).toBe("wise-monaco-edit-added-gutter");
    expect(monacoLineChangeGutterClassName("modified")).toBe("wise-monaco-edit-modified-gutter");
  });
});
