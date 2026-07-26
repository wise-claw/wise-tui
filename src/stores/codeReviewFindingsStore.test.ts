import { describe, expect, test } from "bun:test";
import type { CodeReviewRun } from "../types/codeReview";
import {
  clearCodeReviewFindings,
  countCodeReviewFindingSeverities,
  getCodeReviewFindingsForFile,
  getCodeReviewFindingsSnapshot,
  publishCodeReviewFindings,
  syncCodeReviewFindingsFreshness,
} from "./codeReviewFindingsStore";

function sampleRun(overrides?: Partial<CodeReviewRun>): CodeReviewRun {
  return {
    id: "cr-test",
    repositoryPath: "/tmp/demo",
    scope: "uncommitted",
    baseRef: "HEAD",
    branch: "feat",
    createdAtMs: 1,
    recommendation: "REQUEST_CHANGES",
    summary: "issues",
    findings: [
      {
        severity: "HIGH",
        confidence: "HIGH",
        path: "src/a.ts",
        line: 12,
        title: "bug",
        detail: "detail",
        fix: "fix",
      },
      {
        severity: "LOW",
        confidence: "MEDIUM",
        path: "src/b.ts",
        line: null,
        title: "nit",
        detail: "nit",
        fix: "",
      },
    ],
    openQuestions: [],
    diffFingerprint: "crfp1:abc",
    ...overrides,
  };
}

describe("codeReviewFindingsStore", () => {
  test("publishes and filters by file", () => {
    publishCodeReviewFindings(sampleRun());
    expect(getCodeReviewFindingsForFile("/tmp/demo", "src/a.ts")).toHaveLength(1);
    expect(getCodeReviewFindingsForFile("/tmp/demo/", "src/b.ts")).toHaveLength(1);
    expect(getCodeReviewFindingsForFile("/tmp/demo", "src/missing.ts")).toHaveLength(0);
    expect(getCodeReviewFindingsSnapshot("/tmp/demo")?.run.id).toBe("cr-test");
    expect(getCodeReviewFindingsSnapshot("/tmp/demo")?.stale).toBe(false);
    expect(countCodeReviewFindingSeverities(sampleRun().findings).highOrCritical).toBe(1);
    clearCodeReviewFindings("/tmp/demo");
    expect(getCodeReviewFindingsForFile("/tmp/demo", "src/a.ts")).toHaveLength(0);
  });

  test("marks stale when fingerprint diverges", () => {
    publishCodeReviewFindings(sampleRun({ diffFingerprint: "crfp1:old" }));
    syncCodeReviewFindingsFreshness("/tmp/demo", "crfp1:new");
    expect(getCodeReviewFindingsSnapshot("/tmp/demo")?.stale).toBe(true);
    syncCodeReviewFindingsFreshness("/tmp/demo", "crfp1:old");
    expect(getCodeReviewFindingsSnapshot("/tmp/demo")?.stale).toBe(false);
    clearCodeReviewFindings("/tmp/demo");
  });
});
