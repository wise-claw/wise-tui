import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  chatMessagePlainTextForCopy,
  enrichDispatchRecordMeta,
  formatDispatchRecordSentence,
  hasRenderableChatMessageBody,
  isAskUserQuestionToolName,
  isAssistantDisplayNoiseText,
  isBlankDisplayText,
  isCompactNoticeSystemText,
  isDisplayNoiseUserMessageText,
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

  test("treats hook startup progress as display noise", () => {
    expect(isSystemMessageDisplayNoiseText("Claude Hook 启动中")).toBe(true);
    expect(
      isSystemMessageDisplayNoiseText(
        "Claude Hook 启动中: SessionStart:startup（完成后会继续生成回复）",
      ),
    ).toBe(true);
  });

  test("keeps meaningful system messages visible", () => {
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

describe("isAskUserQuestionToolName", () => {
  test("matches AskUserQuestion tool name variants", () => {
    expect(isAskUserQuestionToolName("AskUserQuestion")).toBe(true);
    expect(isAskUserQuestionToolName("mcp__AskUserQuestion")).toBe(true);
    expect(isAskUserQuestionToolName("AskUser")).toBe(true);
  });

  test("ignores other tool names and non-string input", () => {
    expect(isAskUserQuestionToolName("Read")).toBe(false);
    expect(isAskUserQuestionToolName("Bash")).toBe(false);
    expect(isAskUserQuestionToolName("ExitPlanMode")).toBe(false);
    expect(isAskUserQuestionToolName(undefined)).toBe(false);
    expect(isAskUserQuestionToolName(123)).toBe(false);
  });
});

describe("isCompactNoticeSystemText", () => {
  test("matches compact / overflow notice sysmsg variants", () => {
    expect(
      isCompactNoticeSystemText("上下文约 75%（约 90,000 tokens），发送前自动 /compact 压缩历史…"),
    ).toBe(true);
    expect(
      isCompactNoticeSystemText(
        "上下文约 75%（约 90,000 tokens），当前消息照常发送，本轮回复后会在后台自动 /compact 压缩历史。",
      ),
    ).toBe(true);
    expect(
      isCompactNoticeSystemText("上下文约 92%（约 184,000 tokens），检测到溢出，压缩历史后重试发送…"),
    ).toBe(true);
    expect(
      isCompactNoticeSystemText("正在执行 /compact 压缩会话历史…（上下文约 75%（约 90,000 tokens））"),
    ).toBe(true);
    expect(isCompactNoticeSystemText("检测到上下文溢出，正在压缩历史后重试发送…")).toBe(true);
    expect(
      isCompactNoticeSystemText("上下文仍超出模型限制，请发送 /compact 并附带聚焦说明，或 /clear 开新会话。"),
    ).toBe(true);
  });

  test("keeps dispatch records and ordinary system messages visible", () => {
    expect(isCompactNoticeSystemText("任务分发记录\n- 类型：终端独立会话")).toBe(false);
    expect(isCompactNoticeSystemText("Claude 系统错误: rate limit exceeded")).toBe(false);
    expect(isCompactNoticeSystemText("")).toBe(false);
  });
});

describe("filtering AskUserQuestion and compact notices out of the list", () => {
  test("AskUserQuestion tool_use part is not renderable even with payload", () => {
    expect(
      isRenderableMessagePart({
        type: "tool_use",
        id: "t1",
        name: "AskUserQuestion",
        input: { question: "用哪个？", options: ["A", "B"] },
        output: "已选：A",
        status: "completed",
      }),
    ).toBe(false);
  });

  test("assistant message with text + AskUserQuestion keeps text, drops tool card", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "好的，我需要确认一下",
      parts: [
        { type: "text", text: "好的，我需要确认一下" },
        {
          type: "tool_use",
          id: "t1",
          name: "AskUserQuestion",
          input: { question: "用哪个？", options: ["A", "B"] },
          output: "已选：A",
          status: "completed",
        },
      ],
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(msg)).toBe(true);
  });

  test("assistant message with only AskUserQuestion tool_use is skipped", () => {
    const msg: ClaudeMessage = {
      id: 2,
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_use",
          id: "t1",
          name: "AskUserQuestion",
          input: { question: "用哪个？", options: ["A", "B"] },
          status: "running",
        },
      ],
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(msg)).toBe(false);
  });

  test("compact notice system messages are skipped", () => {
    const notices = [
      "上下文约 75%（约 90,000 tokens），发送前自动 /compact 压缩历史…",
      "上下文约 92%（约 184,000 tokens），检测到溢出，压缩历史后重试发送…",
      "正在执行 /compact 压缩会话历史…（上下文约 75%（约 90,000 tokens））",
      "上下文仍超出模型限制，请发送 /compact 并附带聚焦说明，或 /clear 开新会话。",
    ];
    for (const text of notices) {
      expect(
        hasRenderableChatMessageBody({ id: 1, role: "system", content: text, timestamp: 0 }),
      ).toBe(false);
    }
  });

  test("ordinary system messages and ExitPlanMode tool remain visible", () => {
    expect(
      hasRenderableChatMessageBody({
        id: 1,
        role: "system",
        content: "任务分发记录\n- 类型：终端独立会话",
        timestamp: 0,
      }),
    ).toBe(true);
    const exitPlan: ClaudeMessage = {
      id: 3,
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool_use",
          id: "t1",
          name: "ExitPlanMode",
          input: { plan: "步骤一：先做 A；步骤二：再做 B。" },
          status: "running",
        },
      ],
      timestamp: 0,
    };
    expect(hasRenderableChatMessageBody(exitPlan)).toBe(true);
  });
});

describe("isDisplayNoiseUserMessageText", () => {
  test("AskUserQuestion 已作答标记消息判为噪声", () => {
    const text = [
      "【AskUserQuestion 已作答】",
      "题目：OMC is already configured (v4.13.2, setup 2026-04-22).",
      "我的选择：（跳过）",
      "请根据上述选择继续完成原先任务，不要再次调用 AskUserQuestion 重复询问同一题。",
    ].join("\n");
    expect(isDisplayNoiseUserMessageText(text)).toBe(true);
  });

  test("Claude CLI 本地命令块（caveat / stdout / stderr）判为噪声", () => {
    expect(
      isDisplayNoiseUserMessageText(
        "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages.",
      ),
    ).toBe(true);
    expect(
      isDisplayNoiseUserMessageText(
        "<local-command-stdout>Compacted PreCompact [node \"$CLAUDE_PLUGIN_ROOT\"/scripts/run.cjs] completed successfully.",
      ),
    ).toBe(true);
    expect(isDisplayNoiseUserMessageText("<local-command-stderr>some error</local-command-stderr>")).toBe(true);
  });

  test("压缩恢复 summary（session continued）判为噪声", () => {
    expect(
      isDisplayNoiseUserMessageText(
        "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
      ),
    ).toBe(true);
  });

  test("用户真实输入不判为噪声", () => {
    expect(isDisplayNoiseUserMessageText("帮我把这个按钮改成蓝色")).toBe(false);
    expect(isDisplayNoiseUserMessageText(" /help  ")).toBe(false);
    expect(isDisplayNoiseUserMessageText("")).toBe(false);
    expect(isDisplayNoiseUserMessageText("   ")).toBe(false);
  });
});
