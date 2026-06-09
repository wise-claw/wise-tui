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

  test("does not highlight plain text after @ mention", () => {
    expect(findComposerHighlightRanges("@Claude Code 你好")).toEqual([
      { start: 0, end: 12, kind: "at" },
    ]);
  });

  test("highlights single-word @ mention", () => {
    expect(findComposerHighlightRanges("@terminal1 继续")).toEqual([
      { start: 0, end: 10, kind: "at" },
    ]);
  });

  test("highlights CJK assignee as single token", () => {
    expect(findComposerHighlightRanges("@张三 继续")).toEqual([
      { start: 0, end: 3, kind: "at" },
    ]);
  });

  test("does not treat URL as slash command", () => {
    expect(findComposerHighlightRanges("see https://example.com")).toEqual([]);
    expect(findComposerHighlightRanges("http://example.com/foo")).toEqual([]);
    expect(findComposerHighlightRanges("visit http://a.com then /add-dir")).toEqual([
      { start: 24, end: 32, kind: "slash" },
    ]);
  });

  test("does not treat path segments as slash command", () => {
    expect(findComposerHighlightRanges("path/to/file")).toEqual([]);
    expect(findComposerHighlightRanges("example.com/foo")).toEqual([]);
  });

  test("highlights inline slash command after text", () => {
    expect(findComposerHighlightRanges("请执行 /compact 一下")).toEqual([
      { start: 4, end: 12, kind: "slash" },
    ]);
  });

  test("ignores zero-width chars around mention", () => {
    expect(findComposerHighlightRanges("\uFEFF@Claude Code \uFEFF你好")).toEqual([
      { start: 0, end: 12, kind: "at" },
    ]);
  });

  test("does not extend @ mention into trailing CJK body text", () => {
    expect(findComposerHighlightRanges("@Claude Code你好")).toEqual([
      { start: 0, end: 12, kind: "at" },
    ]);
  });
});
