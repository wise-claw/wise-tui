import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  appendAssistantPreviewTextMessage,
  beginSessionTurnWithUserPrompt,
  setSessionRunningWithUserPrompt,
} from "./claudeSessionState";

function session(messages: ClaudeSession["messages"]): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: "claude-1",
    repositoryPath: "/repo",
    repositoryName: "demo/员工:终端02",
    model: "sonnet",
    status: "running",
    messages,
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("appendAssistantPreviewTextMessage", () => {
  test("appends assistant bubble when only user message exists", () => {
    const base = session([{ role: "user", content: "你好", timestamp: 1 }]);
    const next = appendAssistantPreviewTextMessage([base], "tab-1", "你好！");
    expect(next[0]?.messages.some((item) => item.role === "assistant")).toBe(true);
  });

  test("beginSessionTurnWithUserPrompt strips prior no-reply system noise on fresh turn", () => {
    const base = session([
      { role: "user", content: "你好", timestamp: 1 },
      {
        role: "system",
        content:
          "Claude 未成功完成本轮请求（未产出可见回复）。请检查 Hook 配置与 Claude CLI 权限。",
        timestamp: 2,
      },
    ]);
    const next = beginSessionTurnWithUserPrompt([base], "tab-1", "你好", {
      forceFreshClaudeSession: true,
    });
    expect(next[0]?.messages).toHaveLength(2);
    expect(next[0]?.messages[0]?.role).toBe("user");
    expect(next[0]?.messages[1]?.role).toBe("user");
    expect(next[0]?.messages.some((item) => item.role === "system")).toBe(false);
  });

  test("does not duplicate assistant when already present", () => {
    const base = session([
      { role: "user", content: "你好", timestamp: 1 },
      { role: "assistant", content: "已有回复", timestamp: 2 },
    ]);
    const next = appendAssistantPreviewTextMessage([base], "tab-1", "新回复");
    expect(next[0]?.messages.filter((item) => item.role === "assistant")).toHaveLength(1);
    expect(next[0]?.messages[1]?.content).toBe("已有回复");
  });

  test("appends completion summary as text part on last tool-only assistant bubble", () => {
    const base = session([
      { role: "user", content: "做任务", timestamp: 1 },
      {
        role: "assistant",
        content: "",
        timestamp: 2,
        parts: [{ type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" }],
      },
    ]);
    const summary = "已完成！\n\n## 改动总结";
    const next = appendAssistantPreviewTextMessage([base], "tab-1", summary);
    expect(next[0]?.messages).toHaveLength(2);
    const last = next[0]?.messages[1];
    expect(last?.role).toBe("assistant");
    expect(last?.parts.some((p) => p.type === "text" && p.text === summary)).toBe(true);
  });

  test("still appends post-tool summary when intro text exists before tools", () => {
    const base = session([
      { role: "user", content: "做任务", timestamp: 1 },
      {
        role: "assistant",
        content: "先说明一下",
        timestamp: 2,
        parts: [
          { type: "text", text: "先说明一下" },
          { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
        ],
      },
    ]);
    const summary = "零错误。全部改动已就绪，以下是总结：\n\n## ✅ 完成";
    const next = appendAssistantPreviewTextMessage([base], "tab-1", summary);
    const last = next[0]?.messages[1];
    expect(last?.parts.some((p) => p.type === "text" && p.text === summary)).toBe(true);
  });
});

describe("setSessionRunningWithUserPrompt", () => {
  test("matches session by claudeSessionId when tab ids migrated", () => {
    const sessions = [
      {
        id: "claude-uuid",
        claudeSessionId: "claude-uuid",
        repositoryPath: "/repo",
        repositoryName: "demo",
        model: "sonnet",
        status: "idle" as const,
        messages: [],
        createdAt: 1,
        pendingPrompt: "",
      },
    ];
    const next = setSessionRunningWithUserPrompt(sessions, "claude-uuid", "你好");
    expect(next[0]?.messages.some((item) => item.role === "user" && item.content === "你好")).toBe(true);
    expect(next[0]?.status).toBe("running");
  });
});
