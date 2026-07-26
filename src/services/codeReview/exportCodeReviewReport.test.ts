import { describe, expect, test } from "bun:test";
import type { CodeReviewRun } from "../../types/codeReview";
import {
  buildCodeReviewJsonReport,
  buildCodeReviewMarkdownReport,
  codeReviewReportBasename,
  filterCodeReviewFindingsForExport,
} from "./exportCodeReviewReport";

const sampleRun: CodeReviewRun = {
  id: "cr-1",
  repositoryPath: "/tmp/demo",
  scope: "branch",
  baseRef: "main",
  branch: "feat/x",
  createdAtMs: Date.parse("2026-07-26T01:02:03.000Z"),
  recommendation: "REQUEST_CHANGES",
  summary: "found issues",
  findings: [
    {
      severity: "HIGH",
      confidence: "HIGH",
      path: "src/a.ts",
      line: 12,
      title: "null check",
      detail: "maybe null",
      fix: "guard it",
    },
    {
      severity: "LOW",
      confidence: "MEDIUM",
      path: "src/b.ts",
      line: 3,
      title: "typo",
      detail: "naming",
      fix: "rename",
    },
  ],
  openQuestions: ["confirm timeout?"],
};

describe("exportCodeReviewReport", () => {
  test("builds markdown and json", () => {
    const md = buildCodeReviewMarkdownReport(sampleRun);
    expect(md).toContain("# 代码审查报告");
    expect(md).toContain("null check");
    expect(md).toContain("confirm timeout?");

    const json = buildCodeReviewJsonReport(sampleRun);
    const parsed = JSON.parse(json) as { findings: unknown[]; exportFilter: string };
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.exportFilter).toBe("all");
    expect(codeReviewReportBasename(sampleRun, "md")).toContain("wise-code-review-feat");
  });

  test("filters high-or-critical findings for export", () => {
    expect(filterCodeReviewFindingsForExport(sampleRun.findings, "highOrCritical")).toHaveLength(1);

    const md = buildCodeReviewMarkdownReport(sampleRun, { filter: "highOrCritical" });
    expect(md).toContain("仅高危");
    expect(md).toContain("null check");
    expect(md).not.toContain("typo");
    expect(md).not.toContain("confirm timeout?");

    const json = buildCodeReviewJsonReport(sampleRun, { filter: "highOrCritical" });
    const parsed = JSON.parse(json) as {
      findings: Array<{ title: string }>;
      exportFilter: string;
      openQuestions: unknown[];
    };
    expect(parsed.exportFilter).toBe("highOrCritical");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.title).toBe("null check");
    expect(parsed.openQuestions).toEqual([]);
    expect(codeReviewReportBasename(sampleRun, "md", { filter: "highOrCritical" })).toContain(
      "-high-",
    );
  });
});
