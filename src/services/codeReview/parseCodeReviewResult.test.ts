import { describe, expect, test } from "bun:test";
import { parseCodeReviewResult, sortCodeReviewFindings } from "./parseCodeReviewResult";

describe("parseCodeReviewResult", () => {
  test("parses fenced json findings", () => {
    const text = `\`\`\`json
{
  "recommendation": "REQUEST_CHANGES",
  "summary": "1 high issue",
  "findings": [
    {
      "severity": "high",
      "confidence": "high",
      "path": "src/a.ts",
      "line": 12,
      "title": "null deref",
      "detail": "x may be null",
      "fix": "add guard"
    }
  ],
  "openQuestions": ["race?"]
}
\`\`\``;

    const parsed = parseCodeReviewResult(text);
    expect(parsed.recommendation).toBe("REQUEST_CHANGES");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.severity).toBe("HIGH");
    expect(parsed.findings[0]?.path).toBe("src/a.ts");
    expect(parsed.findings[0]?.line).toBe(12);
    expect(parsed.openQuestions).toEqual(["race?"]);
  });

  test("falls back when json missing", () => {
    const parsed = parseCodeReviewResult("looks fine overall");
    expect(parsed.recommendation).toBe("COMMENT");
    expect(parsed.findings).toEqual([]);
    expect(parsed.summary).toContain("looks fine");
  });

  test("sorts by severity then path", () => {
    const sorted = sortCodeReviewFindings([
      {
        severity: "LOW",
        confidence: "HIGH",
        path: "b.ts",
        line: 1,
        title: "b",
        detail: "b",
        fix: "",
      },
      {
        severity: "CRITICAL",
        confidence: "HIGH",
        path: "a.ts",
        line: 2,
        title: "a",
        detail: "a",
        fix: "",
      },
    ]);
    expect(sorted[0]?.severity).toBe("CRITICAL");
    expect(sorted[1]?.severity).toBe("LOW");
  });
});
