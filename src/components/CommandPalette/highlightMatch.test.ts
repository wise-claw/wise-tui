import { describe, expect, test } from "bun:test";
import { highlightMatchSegments } from "./highlightMatch";

describe("highlightMatchSegments", () => {
  test("后端偏移命中：按 char 偏移拆三段", () => {
    // preview = "export const beta = 2;"，"beta" 位于 char 13..17
    const segs = highlightMatchSegments("export const beta = 2;", 13, 17, "beta");
    expect(segs).not.toBeNull();
    expect(segs).toEqual({
      before: "export const ",
      match: "beta",
      after: " = 2;",
    });
  });

  test("后端偏移含前导省略号时仍指向最终 preview 中的匹配", () => {
    // 匹配靠后，preview 开头补了 "…"；"…" 是 1 个 code point。
    const preview = "…padding target suffix";
    // Array.from(preview): '…'(0) 'padding'(1..8) ' '(8) 'target'(9..15) ...
    const segs = highlightMatchSegments(preview, 9, 15, "target");
    expect(segs).toEqual({
      before: "…padding ",
      match: "target",
      after: " suffix",
    });
  });

  test("后端偏移缺失时回退前端大小写不敏感查找", () => {
    const segs = highlightMatchSegments("Hello World", null, null, "world");
    expect(segs).toEqual({
      before: "Hello ",
      match: "World",
      after: "",
    });
  });

  test("query 为空时返回 null（无可高亮匹配）", () => {
    expect(highlightMatchSegments("some text", 0, 0, "")).toBeNull();
    expect(highlightMatchSegments("some text", null, null, "")).toBeNull();
    expect(highlightMatchSegments("some text", null, null, "   ")).toBeNull();
  });

  test("后端偏移越界时回退前端查找", () => {
    // matchEnd 超出 preview 长度，应忽略后端偏移并回退
    const segs = highlightMatchSegments("foo bar", 5, 99, "bar");
    expect(segs).toEqual({
      before: "foo ",
      match: "bar",
      after: "",
    });
  });

  test("preview 为空返回 null", () => {
    expect(highlightMatchSegments("", null, null, "x")).toBeNull();
  });

  test("emoji 等 astral 字符按 code point 切分，偏移不错位", () => {
    // "🚀" 是 1 个 code point（Rust 1 个 char，Array.from 1 个元素）
    const preview = "🚀target";
    // 后端偏移：🚀 占 1，target 占 1..7
    const segs = highlightMatchSegments(preview, 1, 7, "target");
    expect(segs).toEqual({
      before: "🚀",
      match: "target",
      after: "",
    });
  });

  test("前端回退也按 code point 切分 emoji", () => {
    const segs = highlightMatchSegments("🚀target", null, null, "target");
    expect(segs).toEqual({
      before: "🚀",
      match: "target",
      after: "",
    });
  });

  test("前端回退找不到匹配时返回 null", () => {
    expect(highlightMatchSegments("abc def", null, null, "xyz")).toBeNull();
  });
});
