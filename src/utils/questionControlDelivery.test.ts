import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  isQuestionStdinUnavailableError,
  shouldDeliverQuestionViaResume,
} from "./questionControlDelivery";

function session(status: ClaudeSession["status"]): ClaudeSession {
  return {
    id: "tab-1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    status,
    messages: [],
    model: "",
    createdAt: 0,
  };
}

describe("isQuestionStdinUnavailableError", () => {
  test("matches Wise Rust 文案", () => {
    expect(isQuestionStdinUnavailableError("会话 abc 没有可写 stdin（可能已结束）")).toBe(true);
    expect(isQuestionStdinUnavailableError("未指定目标会话，且当前没有可响应会话")).toBe(true);
  });

  test("matches broken pipe / stream closed", () => {
    expect(isQuestionStdinUnavailableError("Broken pipe (os error 32)")).toBe(true);
    expect(isQuestionStdinUnavailableError("Tool permission request failed: Error: Stream closed")).toBe(
      true,
    );
  });

  test("ignores unrelated errors", () => {
    expect(isQuestionStdinUnavailableError("network timeout")).toBe(false);
  });
});

describe("shouldDeliverQuestionViaResume", () => {
  test("expired or failed lifecycle uses resume", () => {
    expect(shouldDeliverQuestionViaResume({ status: "expired" } as never, session("running"))).toBe(
      true,
    );
    expect(shouldDeliverQuestionViaResume({ status: "failed" } as never, session("running"))).toBe(
      true,
    );
  });

  test("pending while session still running uses stdin", () => {
    expect(shouldDeliverQuestionViaResume({ status: "pending" } as never, session("running"))).toBe(
      false,
    );
    expect(
      shouldDeliverQuestionViaResume({ status: "pending" } as never, session("connecting")),
    ).toBe(false);
  });

  test("pending after complete uses resume on first submit", () => {
    expect(
      shouldDeliverQuestionViaResume({ status: "pending" } as never, session("completed")),
    ).toBe(true);
    expect(shouldDeliverQuestionViaResume({ status: "pending" } as never, session("cancelled"))).toBe(
      true,
    );
  });
});
