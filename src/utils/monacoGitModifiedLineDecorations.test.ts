import { describe, expect, it } from "bun:test";
import { computeLineNumbersDifferentFromBase } from "./monacoGitModifiedLineDecorations";

describe("computeLineNumbersDifferentFromBase", () => {
  it("returns 1-based line numbers that differ", () => {
    expect(
      computeLineNumbersDifferentFromBase("a\nb\nc", "a\nx\nc"),
    ).toEqual([2]);
  });

  it("includes trailing added lines", () => {
    expect(computeLineNumbersDifferentFromBase("a", "a\nb")).toEqual([2]);
  });
});
