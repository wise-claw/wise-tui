import { describe, expect, test } from "bun:test";
import type { CodeReviewFinding, CodeReviewRun } from "../../types/codeReview";
import { buildCodeReviewToastContent } from "./codeReviewToastContent";

function run(findings: CodeReviewFinding[], summary = "摘要"): CodeReviewRun {
  return {
    id: "cr-1",
    repositoryPath: "/repo",
    scope: "uncommitted",
    baseRef: "HEAD",
    branch: "feat",
    createdAtMs: 1,
    recommendation: findings.length ? "REQUEST_CHANGES" : "APPROVE",
    summary,
    findings,
    openQuestions: [],
  };
}

function finding(severity: string): CodeReviewFinding {
  return {
    severity,
    confidence: "HIGH",
    path: "a.ts",
    line: 1,
    title: "t",
    detail: "d",
    fix: "f",
  };
}

describe("buildCodeReviewToastContent", () => {
  test("clean run is a non-actionable success", () => {
    const content = buildCodeReviewToastContent(run([]), { context: "pre-push" });
    expect(content.level).toBe("success");
    expect(content.title).toContain("推送前审查");
    expect(content.actionable).toBe(false);
  });

  test("high severity run warns and is actionable", () => {
    const content = buildCodeReviewToastContent(run([finding("HIGH"), finding("LOW")]));
    expect(content.level).toBe("warning");
    expect(content.title).toContain("1 项高危");
    expect(content.title).toContain("共 2 项");
    expect(content.actionable).toBe(true);
  });

  test("non-blocking findings use info level", () => {
    const content = buildCodeReviewToastContent(run([finding("LOW")], ""));
    expect(content.level).toBe("info");
    expect(content.title).toContain("1 项非阻断发现");
    expect(content.description).toContain("已在编辑器中标注");
  });
});
