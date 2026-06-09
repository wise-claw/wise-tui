import { describe, expect, test } from "bun:test";
import { findComposerHighlightRanges } from "./composerTokenHighlight";

describe("findComposerHighlightRanges", () => {
  test("highlights @ assignee and / command separately", () => {
    const ranges = findComposerHighlightRanges("@Claude Code /add-dir 你好");
    expect(ranges).toEqual([
      { start: 0, end: 12, kind: "at" },
      { start: 13, end: 21, kind: "slash" },
    ]);
  });

  test("highlights single-word @ mention", () => {
    expect(findComposerHighlightRanges("@terminal1 继续")).toEqual([
      { start: 0, end: 10, kind: "at" },
    ]);
  });

  test("does not treat URL scheme as slash command", () => {
    expect(findComposerHighlightRanges("see https://example.com")).toEqual([]);
  });

  test("highlights inline slash command after text", () => {
    expect(findComposerHighlightRanges("请执行 /compact 一下")).toEqual([
      { start: 4, end: 12, kind: "slash" },
    ]);
  });
});
