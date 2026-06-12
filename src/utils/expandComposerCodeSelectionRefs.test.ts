import { describe, expect, test } from "bun:test";
import { expandComposerCodeSelectionRefs } from "./expandComposerCodeSelectionRefs";

describe("expandComposerCodeSelectionRefs", () => {
  test("expands refs and keeps trailing user text", () => {
    const expanded = expandComposerCodeSelectionRefs("请解释这段代码", [
      {
        path: "src/mascot.tsx",
        language: "typescript",
        selectedText: 'import "./mascot.css";',
        startLine: 15,
        endLine: 15,
        startChar: 1,
        endChar: 24,
      },
    ]);
    expect(expanded).toContain("@src/mascot.tsx:15");
    expect(expanded).toContain('import "./mascot.css";');
    expect(expanded).toContain("请解释这段代码");
  });

  test("returns plain when no refs", () => {
    expect(expandComposerCodeSelectionRefs("hello", [])).toBe("hello");
  });
});
