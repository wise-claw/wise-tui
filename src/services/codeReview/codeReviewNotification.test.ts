import { describe, expect, test } from "bun:test";
import type { CodeReviewRun } from "../../types/codeReview";
import {
  buildCodeReviewNotificationBody,
  buildCodeReviewNotificationConversationId,
  isCodeReviewNotificationConversationId,
  parseCodeReviewNotificationPayload,
  parseCodeReviewNotificationRepositoryPath,
  shouldIngestCodeReviewNotification,
} from "./codeReviewNotification";

const sampleRun: CodeReviewRun = {
  id: "cr-9",
  repositoryPath: "/tmp/demo",
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
      detail: "d",
      fix: "f",
    },
  ],
  openQuestions: [],
};

describe("codeReviewNotification", () => {
  test("round-trips conversation id and body payload", () => {
    const conversationId = buildCodeReviewNotificationConversationId("/tmp/demo/");
    expect(isCodeReviewNotificationConversationId(conversationId)).toBe(true);
    expect(parseCodeReviewNotificationRepositoryPath(conversationId)).toBe("/tmp/demo");

    const body = buildCodeReviewNotificationBody(sampleRun);
    const payload = parseCodeReviewNotificationPayload(body);
    expect(payload?.runId).toBe("cr-9");
    expect(payload?.highOrCritical).toBe(1);
    expect(shouldIngestCodeReviewNotification(sampleRun)).toBe(true);
    expect(shouldIngestCodeReviewNotification(sampleRun, { reused: true })).toBe(false);
  });
});
