import { describe, expect, test } from "bun:test";
import {
  buildCodeReviewHoverMessage,
  findingMatchesCodeReviewFocus,
  groupCodeReviewFindingsByLine,
  monacoCodeReviewSeverityClassName,
} from "./monacoCodeReviewFindingDecorations";

describe("monacoCodeReviewFindingDecorations", () => {
  test("groups by line and skips null lines", () => {
    const grouped = groupCodeReviewFindingsByLine([
      {
        severity: "HIGH",
        confidence: "HIGH",
        path: "a.ts",
        line: 10,
        title: "a",
        detail: "a",
        fix: "",
      },
      {
        severity: "LOW",
        confidence: "LOW",
        path: "a.ts",
        line: null,
        title: "b",
        detail: "b",
        fix: "",
      },
      {
        severity: "MEDIUM",
        confidence: "MEDIUM",
        path: "a.ts",
        line: 10,
        title: "c",
        detail: "c",
        fix: "",
      },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get(10)).toHaveLength(2);
  });

  test("builds hover and class names", () => {
    expect(monacoCodeReviewSeverityClassName("HIGH")).toContain("high");
    expect(
      buildCodeReviewHoverMessage({
        severity: "HIGH",
        confidence: "HIGH",
        path: "a.ts",
        line: 1,
        title: "bug",
        detail: "why",
        fix: "do x",
      }),
    ).toContain("修复建议");
  });

  test("matches focus by path and line", () => {
    expect(
      findingMatchesCodeReviewFocus(
        { path: "src/a.ts", line: 12 },
        { path: "src/a.ts", line: 12 },
      ),
    ).toBe(true);
    expect(
      findingMatchesCodeReviewFocus(
        { path: "src/a.ts", line: 12 },
        { path: "src/a.ts", line: 13 },
      ),
    ).toBe(false);
    expect(
      findingMatchesCodeReviewFocus(
        { path: "src/a.ts", line: 12 },
        { path: "src/a.ts", line: null },
      ),
    ).toBe(true);
  });
});
