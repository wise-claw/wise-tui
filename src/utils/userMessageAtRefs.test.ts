import { describe, expect, test } from "bun:test";
import { splitUserMessageAtRefs } from "./userMessageAtRefs";

function refs(text: string): string[] {
  return splitUserMessageAtRefs(text)
    .filter((token): token is { type: "at"; value: string } => token.type === "at")
    .map((token) => token.value);
}

function joinedText(text: string): string {
  return splitUserMessageAtRefs(text)
    .map((token) => token.value)
    .join("");
}

describe("splitUserMessageAtRefs", () => {
  test("splits a leading file reference out of the message body", () => {
    const text = "@phases/00-setup/docs/en.md 翻译为中文，并切换原文件";
    expect(refs(text)).toEqual(["@phases/00-setup/docs/en.md"]);
    expect(joinedText(text)).toBe(text);
  });

  test("recognizes absolute paths and multiple references", () => {
    const text = "对比 @/Users/sjl/repo/src/a.ts 与 @src/b.ts 的差异";
    expect(refs(text)).toEqual(["@/Users/sjl/repo/src/a.ts", "@src/b.ts"]);
    expect(joinedText(text)).toBe(text);
  });

  test("stops the reference at CJK and ASCII punctuation", () => {
    expect(refs("@a.md，然后继续")).toEqual(["@a.md"]);
    expect(refs("看 @a.md. 再说")).toEqual(["@a.md"]);
    expect(refs("(@a.md)")).toEqual(["@a.md"]);
  });

  test("keeps the surrounding text tokens intact", () => {
    const tokens = splitUserMessageAtRefs("请看 @a.md\n然后 @b.ts。");
    expect(tokens).toEqual([
      { type: "text", value: "请看 " },
      { type: "at", value: "@a.md" },
      { type: "text", value: "\n然后 " },
      { type: "at", value: "@b.ts" },
      { type: "text", value: "。" },
    ]);
  });

  test("ignores emails, urls and bare @ signs", () => {
    expect(refs("mailto:a@b.com")).toEqual([]);
    expect(refs("https://example.com/@user")).toEqual([]);
    expect(refs("user @ home")).toEqual([]);
    expect(refs("a@b")).toEqual([]);
  });

  test("returns a single text token when there is no reference", () => {
    expect(splitUserMessageAtRefs("普通文本")).toEqual([{ type: "text", value: "普通文本" }]);
    expect(splitUserMessageAtRefs("")).toEqual([]);
  });

  test("treats a full-width at sign at the start as a reference", () => {
    expect(refs("＠a.md 你好")).toEqual(["＠a.md"]);
  });
});
