import { describe, expect, test } from "bun:test";
import { codeSelectionRefKey, isSameCodeSelectionRef } from "./codeSelectionRefKey";

describe("codeSelectionRefKey", () => {
  test("builds stable key from path and line range", () => {
    expect(
      codeSelectionRefKey({
        path: "src/mascot.tsx",
        startLine: 16,
        endLine: 17,
        startChar: 1,
        endChar: 20,
      }),
    ).toBe("src/mascot.tsx:16:1-17:20");
  });

  test("detects duplicate refs", () => {
    const left = {
      path: "a.ts",
      startLine: 1,
      endLine: 2,
      startChar: 1,
      endChar: 5,
    };
    const right = { ...left };
    expect(isSameCodeSelectionRef(left, right)).toBe(true);
  });
});
