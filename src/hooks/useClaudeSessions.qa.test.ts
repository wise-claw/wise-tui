import { describe, expect, test } from "bun:test";
import { submitQuestionViaStdin } from "./useClaudeSessions.qa";
import type { QuestionRequest } from "../types";

function makeQr(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: `q-${Math.random().toString(36).slice(2)}`,
    question: "choose one",
    options: [{ value: "a", label: "A" }],
    multiSelect: false,
    ...overrides,
  } as QuestionRequest;
}

describe("submitQuestionViaStdin targetSessionId plumbing", () => {
  // 关键回归：sub-agent oneshot 自动答时，控制台如果已轮询拿到真
  // claudeSid，submitClaudeStdinLine 必须用它写 stdin，绝不能再退化成
  // Wise tab id 去撞后端 map miss。
  test("forwards the resolved claudeSid to submitClaudeStdinLine as targetSessionId", async () => {
    const captured: { targetSessionId?: string | null } = {};
    const qr = makeQr();
    let appendedFor: string | null = null;

    await submitQuestionViaStdin({
      tabSessionId: "wise-tab-1",
      claudeSid: "claude-sid-99",
      targetSessionId: "claude-sid-99",
      nextTurnNonce: null,
      qr,
      answers: ["a"],
      customAnswer: undefined,
      userAnswerText: "[answered] a",
      preferStdinControlResponse: false,
      appendUserMessage: (sid) => {
        appendedFor = sid;
      },
      expectedTurnNonceByTabId: new Map(),
      setStreamingTargetId: () => undefined,
      markClaudeRegistryBootstrapWarmup: () => undefined,
      setStreamingProcessByTab: () => undefined,
      setSessionRunning: () => undefined,
      prepareStreamingControlResponseListener: async () => undefined,
      scheduleStreamStallTimer: () => undefined,
      submitClaudeStdinLine: async (_line, sid) => {
        captured.targetSessionId = sid ?? null;
      },
      buildQuestionStdinLine: () => "control_response_payload",
      isToolUseQuestionRequestId: () => false,
      sendStreamingUserMessage: async () => undefined,
    });

    expect(captured.targetSessionId).toBe("claude-sid-99");
    expect(appendedFor).toBe("wise-tab-1");
  });

  // oneshot sessionId 退化为 Wise tab id 时的旧路径：仍可被调用、但
  // caller 端应先轮询 resolvedClaudeSid 再传进来——本测试仅保证 helper 不
  // 因 null 自身抛错。
  test("tolerates null claudeSid and null targetSessionId without throwing", async () => {
    const qr = makeQr();
    let stdinCalled = false;
    await submitQuestionViaStdin({
      tabSessionId: "wise-tab-2",
      claudeSid: null,
      targetSessionId: null,
      nextTurnNonce: null,
      qr,
      answers: ["a"],
      userAnswerText: "[answered] a",
      preferStdinControlResponse: false,
      appendUserMessage: () => undefined,
      expectedTurnNonceByTabId: new Map(),
      setStreamingTargetId: () => undefined,
      markClaudeRegistryBootstrapWarmup: () => undefined,
      setStreamingProcessByTab: () => undefined,
      setSessionRunning: () => undefined,
      prepareStreamingControlResponseListener: async () => undefined,
      scheduleStreamStallTimer: () => undefined,
      submitClaudeStdinLine: async () => {
        stdinCalled = true;
      },
      buildQuestionStdinLine: () => "control_response_payload",
      isToolUseQuestionRequestId: () => false,
      sendStreamingUserMessage: async () => undefined,
    });
    expect(stdinCalled).toBe(true);
  });
});
