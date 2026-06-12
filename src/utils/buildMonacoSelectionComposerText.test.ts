import { describe, expect, test } from "bun:test";
import { buildMonacoSelectionComposerText } from "./buildMonacoSelectionComposerText";

describe("buildMonacoSelectionComposerText", () => {
  test("formats single-line selection with language fence", () => {
    const text = buildMonacoSelectionComposerText({
      relativePath: "src/mascot.tsx",
      language: "typescript",
      selectedText: 'import "./mascot.css";',
      startLine: 15,
      endLine: 15,
    });
    expect(text).toBe(
      "@src/mascot.tsx:15\n```typescript\nimport \"./mascot.css\";\n```",
    );
  });

  test("formats multi-line range", () => {
    const text = buildMonacoSelectionComposerText({
      relativePath: "README.md",
      language: "markdown",
      selectedText: "line1\nline2",
      startLine: 3,
      endLine: 5,
    });
    expect(text).toBe("@README.md:3-5\n```markdown\nline1\nline2\n```");
  });

  test("returns empty for blank selection", () => {
    expect(
      buildMonacoSelectionComposerText({
        relativePath: "a.ts",
        language: "typescript",
        selectedText: "   ",
        startLine: 1,
        endLine: 1,
      }),
    ).toBe("");
  });
});
