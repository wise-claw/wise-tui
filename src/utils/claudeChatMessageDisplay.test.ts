import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  enrichDispatchRecordMeta,
  formatDispatchRecordSentence,
  hasRenderableChatMessageBody,
  isAssistantDisplayNoiseText,
  isRenderableMessagePart,
  isSystemMessageDisplayNoiseText,
  parseDispatchRecord,
} from "./claudeChatMessageDisplay";

describe("isAssistantDisplayNoiseText", () => {
  test("matches Claude no-response placeholder", () => {
    expect(isAssistantDisplayNoiseText("No response requested.")).toBe(true);
    expect(isAssistantDisplayNoiseText("  no response requested  ")).toBe(true);
  });

  test("ignores normal assistant text", () => {
    expect(isAssistantDisplayNoiseText("你好！有什么可以帮你的吗？")).toBe(false);
    expect(isAssistantDisplayNoiseText("")).toBe(false);
  });
});

describe("isRenderableMessagePart", () => {
  test("drops blank text and empty reasoning", () => {
    expect(isRenderableMessagePart({ type: "text", text: "   " })).toBe(false);
    expect(isRenderableMessagePart({ type: "text", text: "No response requested." })).toBe(false);
    expect(isRenderableMessagePart({ type: "reasoning", text: "" })).toBe(false);
    expect(isRenderableMessagePart({ type: "text", text: "你好" })).toBe(true);
  });
});

describe("isSystemMessageDisplayNoiseText", () => {
  test("matches placeholder Claude system errors", () => {
    expect(isSystemMessageDisplayNoiseText("Claude 系统错误: unknown")).toBe(true);
    expect(isSystemMessageDisplayNoiseText("  Claude 系统错误: unknown  ")).toBe(true);
  });

  test("ignores meaningful system messages", () => {
    expect(isSystemMessageDisplayNoiseText("Claude Hook 启动中")).toBe(false);
    expect(isSystemMessageDisplayNoiseText("Claude 系统错误: rate limit exceeded")).toBe(false);
  });
});

describe("parseDispatchRecord", () => {
  test("parses terminal dispatch body and session id", () => {
    const text = [
      "任务分发记录",
      "- 类型：终端独立会话",
      "- 目标：终端01",
      "- 时间：2026/6/3 15:19:25",
      "- 正文：请检查天气接口",
      "- 分发会话：tab-worker-1",
    ].join("\n");
    const meta = parseDispatchRecord(text);
    expect(meta?.targetName).toBe("终端01");
    expect(meta?.dispatchContent).toBe("请检查天气接口");
    expect(meta?.targetSessionId).toBe("tab-worker-1");
    expect(formatDispatchRecordSentence(meta!)).toBe(
      "终端01在2026/6/3 15:19:25执行请检查天气接口。",
    );
  });

  test("enrichDispatchRecordMeta backfills body from worker session", () => {
    const legacy = parseDispatchRecord(
      [
        "任务分发记录",
        "- 类型：终端独立会话",
        "- 目标：终端01",
        "- 时间：2026/6/3 15:19:25",
        "- 分发会话：worker-tab-1",
      ].join("\n"),
    )!;
    const worker: ClaudeSession = {
      id: "worker-tab-1",
      repositoryName: "open-meteo/员工:终端01",
      repositoryPath: "/repo",
      messages: [
        { id: 1, role: "user", content: "你好", timestamp: 0 },
      ],
      status: "idle",
    } as ClaudeSession;
    const enriched = enrichDispatchRecordMeta(legacy, [worker]);
    expect(formatDispatchRecordSentence(enriched)).toBe(
      "终端01在2026/6/3 15:19:25执行你好。",
    );
  });
});

describe("hasRenderableChatMessageBody", () => {
  test("skips assistant rows with only noise or empty parts", () => {
    const noiseOnly: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "No response requested.",
      parts: [{ type: "text", text: "No response requested." }],
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(noiseOnly)).toBe(false);

    const withReply: ClaudeMessage = {
      id: 2,
      role: "assistant",
      content: "你好",
      parts: [
        { type: "reasoning", text: "嗯" },
        { type: "text", text: "你好！" },
      ],
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(withReply)).toBe(true);

    const unknownSystemError: ClaudeMessage = {
      id: 3,
      role: "system",
      content: "Claude 系统错误: unknown",
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(unknownSystemError)).toBe(false);
  });
});
