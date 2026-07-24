import { describe, expect, test } from "bun:test";
import {
  buildFeedbackLoopWorkerRepositoryName,
  buildFeedbackLoopWorkerUserBubble,
  isFeedbackLoopWorkerRepositoryName,
  isSessionFeedbackLoopHistorySession,
  isSessionFeedbackLoopPromptText,
  parseFeedbackLoopWorkerRepositoryName,
} from "./sessionFeedbackLoopDispatch";

describe("sessionFeedbackLoopDispatch", () => {
  test("buildFeedbackLoopWorkerRepositoryName", () => {
    expect(buildFeedbackLoopWorkerRepositoryName("wise", "optimization", 2)).toBe(
      "wise/神经网:优化-2",
    );
    expect(buildFeedbackLoopWorkerRepositoryName("wise", "config_patch")).toBe(
      "wise/神经网:配置补丁",
    );
  });

  test("parseFeedbackLoopWorkerRepositoryName", () => {
    expect(parseFeedbackLoopWorkerRepositoryName("wise/神经网:优化-1")).toEqual({
      displayBase: "wise",
      label: "优化-1",
    });
    expect(parseFeedbackLoopWorkerRepositoryName("demo")).toBeNull();
  });

  test("isFeedbackLoopWorkerRepositoryName", () => {
    expect(isFeedbackLoopWorkerRepositoryName("wise/神经网:总结")).toBe(true);
    expect(isFeedbackLoopWorkerRepositoryName("wise/执行环境:claude:任务")).toBe(false);
  });

  test("buildFeedbackLoopWorkerUserBubble truncates long prompt", () => {
    const long = "你是 Wise **会话反馈神经网** 的优化节点。\n\n" + "x".repeat(200);
    const bubble = buildFeedbackLoopWorkerUserBubble(long);
    expect(bubble.length).toBeLessThanOrEqual(96);
    expect(bubble.startsWith("你是 Wise")).toBe(true);
  });

  test("isSessionFeedbackLoopHistorySession matches marker / prompt / preview", () => {
    expect(
      isSessionFeedbackLoopHistorySession({
        repositoryName: "wise/神经网:习惯",
        messages: [],
      }),
    ).toBe(true);
    expect(
      isSessionFeedbackLoopPromptText("你是 Wise **会话反馈神经网** 的优化节点。"),
    ).toBe(true);
    expect(
      isSessionFeedbackLoopHistorySession({
        repositoryName: "wise",
        messages: [
          {
            role: "user",
            content: "你是 Wise **会话反馈神经网** 的总结节点。",
          },
        ],
      }),
    ).toBe(true);
    expect(
      isSessionFeedbackLoopHistorySession({
        repositoryName: "wise",
        messages: [],
        diskPreview: "你是 Wise **会话反馈神经网** 的习惯沉淀节点。",
      }),
    ).toBe(true);
    expect(
      isSessionFeedbackLoopHistorySession({
        repositoryName: "wise",
        messages: [{ role: "user", content: "正常聊天" }],
      }),
    ).toBe(false);
  });
});
