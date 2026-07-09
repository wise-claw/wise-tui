import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  MAIN_SESSION_CONTEXT_MARKER,
  buildMainSessionContextSeedMessages,
  buildTerminalDispatchWithMainContext,
  formatMainSessionContextForCli,
  isMainSessionContextSeedMessage,
  selectMessagesForTerminalContext,
} from "./terminalDispatchContext";

function mainSession(messages: ClaudeSession["messages"]): ClaudeSession {
  return {
    id: "main-1",
    claudeSessionId: "claude-main",
    repositoryPath: "/repo",
    repositoryName: "wise",
    model: "sonnet",
    status: "idle",
    messages,
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("terminalDispatchContext", () => {
  test("selectMessagesForTerminalContext keeps user and assistant turns", () => {
    const selected = selectMessagesForTerminalContext([
      { role: "user", content: "问题一", timestamp: 1 },
      { role: "assistant", content: "回答一", timestamp: 2 },
      {
        role: "system",
        content: "任务分发记录\n- 类型：终端独立会话\n- 正文：你好",
        timestamp: 3,
      },
    ]);
    expect(selected).toHaveLength(2);
    expect(selected[0]?.content).toBe("问题一");
    expect(selected[1]?.content).toBe("回答一");
  });

  test("formatMainSessionContextForCli renders labeled transcript", () => {
    const text = formatMainSessionContextForCli([
      { role: "user", content: "问题一", timestamp: 1 },
      {
        role: "assistant",
        content: "回答一",
        timestamp: 2,
        parts: [{ type: "text", text: "回答一" }],
      },
    ]);
    expect(text).toContain("用户：问题一");
    expect(text).toContain("助手：回答一");
  });

  test("buildTerminalDispatchWithMainContext passes through task only", () => {
    const built = buildTerminalDispatchWithMainContext(
      mainSession([
        { role: "user", content: "问题一", timestamp: 1 },
        {
          role: "assistant",
          content: "回答一",
          timestamp: 2,
          parts: [{ type: "text", text: "回答一" }],
        },
      ]),
      "我上面提了几个问题",
    );
    expect(built.outboundPrompt).toBe("我上面提了几个问题");
    expect(built.outboundPrompt).not.toContain("用户：问题一");
    expect(built.contextSeedMessages).toEqual([]);
  });

  test("buildMainSessionContextSeedMessages mirrors main session turns for worker UI", () => {
    const seed = buildMainSessionContextSeedMessages([
      { role: "user", content: "你好", timestamp: 1 },
      {
        role: "assistant",
        content: "你好！",
        timestamp: 2,
        parts: [{ type: "text", text: "你好！" }],
      },
    ]);
    expect(seed[0]?.content).toContain(MAIN_SESSION_CONTEXT_MARKER);
    expect(seed[1]?.role).toBe("user");
    expect(seed[2]?.role).toBe("assistant");
  });
});
