import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  hasRenderableChatMessageBody,
  isAssistantDisplayNoiseText,
  isRenderableMessagePart,
  isSystemMessageDisplayNoiseText,
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
