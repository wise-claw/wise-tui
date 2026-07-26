import { describe, expect, test } from "bun:test";
import { mergeCarriedCodeReviewFindings } from "./mergeIncrementalFindings";

describe("mergeCarriedCodeReviewFindings", () => {
  test("carries unchanged-file findings and keeps next for focus files", () => {
    const merged = mergeCarriedCodeReviewFindings({
      previousFindings: [
        {
          severity: "HIGH",
          confidence: "HIGH",
          path: "src/stable.ts",
          line: 1,
          title: "old-stable",
          detail: "d",
          fix: "",
        },
        {
          severity: "LOW",
          confidence: "LOW",
          path: "src/focus.ts",
          line: 2,
          title: "old-focus",
          detail: "d",
          fix: "",
        },
      ],
      nextFindings: [
        {
          severity: "CRITICAL",
          confidence: "HIGH",
          path: "src/focus.ts",
          line: 3,
          title: "new-focus",
          detail: "d",
          fix: "f",
        },
      ],
      unchangedFiles: ["src/stable.ts"],
      currentFiles: ["src/stable.ts", "src/focus.ts"],
    });
    expect(merged.map((finding) => finding.title)).toEqual(["new-focus", "old-stable"]);
  });
});
