import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  chatMessagePlainTextForCopy,
  enrichDispatchRecordMeta,
  formatDispatchRecordSentence,
  hasRenderableChatMessageBody,
  isAssistantDisplayNoiseText,
  isBlankDisplayText,
  isRenderableMessagePart,
  isSystemMessageDisplayNoiseText,
  parseDispatchRecord,
  resolveChatMessageCopyText,
  resolveChatMessageComposerInsertPayload,
  resolveChatMessageComposerInsertText,
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
      "终端01 执行 请检查天气接口。",
    );
  });

  test("parses execution environment dispatch with engine as display target", () => {
    const text = [
      "任务分发记录",
      "- 类型：执行环境",
      "- 引擎：Claude Code",
      "- 时间：2026/6/4 08:15:13",
      "- 正文：你好",
    ].join("\n");
    const meta = parseDispatchRecord(text);
    expect(meta?.engineName).toBe("Claude Code");
    expect(formatDispatchRecordSentence(meta!)).toBe(
      "Claude Code 执行 你好。",
    );
  });

  test("parses execution environment dispatch batch id", () => {
    const text = [
      "任务分发记录",
      "- 类型：执行环境",
      "- 引擎：Claude Code",
      "- 批次：exec-env-batch:123",
      "- 时间：2026/6/4 08:15:13",
      "- 正文：你好",
    ].join("\n");
    const meta = parseDispatchRecord(text);
    expect(meta?.dispatchBatchId).toBe("exec-env-batch:123");
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
      "终端01 执行 你好。",
    );
  });
});

describe("chatMessagePlainTextForCopy", () => {
  test("joins text, reasoning, and tool output", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "",
      parts: [
        { type: "reasoning", text: "先分析接口" },
        { type: "text", text: "结论如下" },
        {
          type: "tool_use",
          id: "tool-1",
          name: "Read",
          input: {},
          output: "file content",
          status: "completed",
        },
      ],
      timestamp: 0,
    };
    expect(chatMessagePlainTextForCopy(msg)).toBe(
      "[思考过程]\n先分析接口\n\n结论如下\n\n[Read]\nfile content",
    );
  });

  test("resolveChatMessageCopyText uses dispatch executable body for system records", () => {
    const msg: ClaudeMessage = {
      id: 2,
      role: "system",
      content: [
        "任务分发记录",
        "- 类型：终端独立会话",
        "- 目标：终端01",
        "- 时间：2026/6/3 17:58:06",
        "- 正文：/add-dir 你好",
      ].join("\n"),
      timestamp: 0,
    };
    expect(resolveChatMessageCopyText(msg)).toBe("/add-dir 你好");
    expect(resolveChatMessageComposerInsertText(msg)).toBe("/add-dir 你好");
  });
});

describe("resolveChatMessageComposerInsertPayload", () => {
  test("user message with 附图 splits main text and disk paths", () => {
    const path = "/Users/sjl/.wise/composer-images/wise/demo-image.png";
    const msg: ClaudeMessage = {
      id: 9,
      role: "user",
      content: `你好\n\n附图：@${path}`,
      timestamp: 0,
    };
    const payload = resolveChatMessageComposerInsertPayload(msg);
    expect(payload?.composerMain).toBe("你好");
    expect(payload?.attachmentPaths).toEqual([path]);
    expect(payload?.fullText).toContain(path);
  });

  test("inline space 附图 is stripped from composerMain for insert", () => {
    const path = "/Users/sjl/.wise/composer-images/wise/demo-image.png";
    const msg: ClaudeMessage = {
      id: 10,
      role: "user",
      content: `你好 附图：@${path}。`,
      timestamp: 0,
    };
    const payload = resolveChatMessageComposerInsertPayload(msg);
    expect(payload?.composerMain).toBe("你好");
    expect(payload?.attachmentPaths).toEqual([path]);
  });
});

describe("isBlankDisplayText", () => {
  test("treats whitespace and zero-width chars as blank", () => {
    expect(isBlankDisplayText("")).toBe(true);
    expect(isBlankDisplayText(" \n\t")).toBe(true);
    expect(isBlankDisplayText("\u200b\u200c")).toBe(true);
    expect(isBlankDisplayText("你好")).toBe(false);
  });
});

describe("isRenderableMessagePart", () => {
  test("skips empty tool_use stubs without name, input, or output", () => {
    expect(
      isRenderableMessagePart({
        type: "tool_use",
        id: "t1",
        name: "",
        input: {},
        status: "running",
      }),
    ).toBe(false);
    expect(
      isRenderableMessagePart({
        type: "tool_use",
        id: "t2",
        name: "Read",
        input: { file_path: "a.ts" },
        status: "running",
      }),
    ).toBe(true);
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

    const emptyAssistantShell: ClaudeMessage = {
      id: 4,
      role: "assistant",
      content: "",
      parts: [{ type: "text", text: "" }],
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(emptyAssistantShell)).toBe(false);
  });
});
