import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  buildQuestionFallbackUserPrompt,
  buildQuestionResumeUserPrompt,
  hasLiveStreamingClaudeProcess,
  isQuestionStdinUnavailableError,
  shouldDeliverQuestionViaResume,
  shouldPreferStreamUserMessageForQuestion,
  shouldUseProxyQuestionResumeDelivery,
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

describe("buildQuestionResumeUserPrompt", () => {
  test("includes stem, choice, and no-repeat instruction", () => {
    const qr = {
      question: "你想测试哪种场景？",
      options: [{ value: "a", label: "单选题" }],
    };
    const text = buildQuestionResumeUserPrompt(qr, ["a"]);
    expect(text).toContain("AskUserQuestion 已作答");
    expect(text).toContain("你想测试哪种场景？");
    expect(text).toContain("单选题");
    expect(text).toContain("不要再次调用 AskUserQuestion");
  });
});

describe("shouldPreferStreamUserMessageForQuestion", () => {
  test("matches Qwen family model ids", () => {
    expect(shouldPreferStreamUserMessageForQuestion("qwen3.7")).toBe(true);
    expect(shouldPreferStreamUserMessageForQuestion("Qwen3.7")).toBe(true);
    expect(shouldPreferStreamUserMessageForQuestion("bailian_coding_plan/qwen")).toBe(true);
  });

  test("ignores native Claude model ids", () => {
    expect(shouldPreferStreamUserMessageForQuestion("sonnet")).toBe(false);
    expect(shouldPreferStreamUserMessageForQuestion("claude-opus-4")).toBe(false);
  });

  test("detects proxy from config model when session model is still sonnet", () => {
    expect(shouldUseProxyQuestionResumeDelivery("sonnet", "qwen3.7-plus")).toBe(true);
    expect(shouldUseProxyQuestionResumeDelivery("sonnet", null)).toBe(false);
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

  test("expired lifecycle on idle streaming tab still prefers stdin when child process is live", () => {
    const idleStreaming = {
      ...session("idle"),
      connectionKind: "streaming" as const,
      claudeSessionId: "claude-sid-1",
    };
    expect(
      hasLiveStreamingClaudeProcess({
        session: idleStreaming,
        streamingTabTracked: true,
        streamingProcessClaudeSessionId: "claude-sid-1",
      }),
    ).toBe(true);
    expect(
      hasLiveStreamingClaudeProcess({
        session: idleStreaming,
        streamingTabTracked: true,
        streamingProcessClaudeSessionId: null,
      }),
    ).toBe(true);
    expect(
      hasLiveStreamingClaudeProcess({
        session: idleStreaming,
        streamingTabTracked: false,
        streamingProcessClaudeSessionId: "claude-sid-1",
      }),
    ).toBe(false);
    expect(
      shouldDeliverQuestionViaResume({ status: "expired" } as never, idleStreaming, {
        preferStdinControlResponse: true,
      }),
    ).toBe(false);
  });
});
