import { beforeEach, describe, expect, mock, test } from "bun:test";

const runCodeReviewMock = mock(async (_input: unknown) => ({
  ok: true as const,
  truncated: false,
  reused: false,
  incremental: null,
  run: {
    id: "cr-1",
    repositoryPath: "/repo",
    scope: "uncommitted",
    baseRef: "HEAD",
    branch: "feat",
    createdAtMs: 1,
    recommendation: "REQUEST_CHANGES",
    summary: "null deref",
    findings: [
      {
        severity: "HIGH",
        confidence: "HIGH",
        path: "a.ts",
        line: 1,
        title: "x",
        detail: "x",
        fix: "y",
      },
    ],
    openQuestions: [],
  },
}));

mock.module("./runCodeReview", () => ({
  runCodeReview: runCodeReviewMock,
}));

describe("evaluatePrePushCodeReview", () => {
  beforeEach(() => {
    runCodeReviewMock.mockClear();
  });

  test("off mode continues without review", async () => {
    const { evaluatePrePushCodeReview } = await import("./runPrePushCodeReview");
    const decision = await evaluatePrePushCodeReview({
      repositoryPath: "/repo",
      hasUncommittedChanges: true,
      prePushMode: "off",
    });
    expect(decision.action).toBe("continue");
    expect(runCodeReviewMock).not.toHaveBeenCalled();
  });

  test("warn mode asks confirm on blocking findings", async () => {
    const { evaluatePrePushCodeReview } = await import("./runPrePushCodeReview");
    const decision = await evaluatePrePushCodeReview({
      repositoryPath: "/repo",
      hasUncommittedChanges: true,
      prePushMode: "warn",
    });
    expect(decision.action).toBe("confirm");
    expect(runCodeReviewMock).toHaveBeenCalled();
  });

  test("block mode aborts on blocking findings", async () => {
    const { evaluatePrePushCodeReview } = await import("./runPrePushCodeReview");
    const decision = await evaluatePrePushCodeReview({
      repositoryPath: "/repo",
      hasUncommittedChanges: true,
      prePushMode: "block",
    });
    expect(decision.action).toBe("abort");
  });
});
