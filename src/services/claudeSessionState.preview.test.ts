import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  appendAssistantPreviewTextMessage,
  assistantMessageVisiblePlainText,
  beginSessionTurnWithUserPrompt,
  resolveNoReplyFailureMessage,
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

describe("resolveNoReplyFailureMessage", () => {
  test("uses cursor-specific hint for cursor engine", () => {
    expect(resolveNoReplyFailureMessage("cursor", false)).toContain("Cursor SDK");
    expect(resolveNoReplyFailureMessage("claude", false)).toContain("Hook");
  });
});

describe("appendAssistantPreviewTextMessage", () => {
  test("appends assistant bubble when only user message exists", () => {
    const base = { ...session([{ role: "user", content: "你好", timestamp: 1 }]), status: "idle" as const };
    const next = appendAssistantPreviewTextMessage([base], "tab-1", "你好！");
    expect(next[0]?.messages.some((item) => item.role === "assistant")).toBe(true);
  });

  test("skips when session is still running (partial preview guard)", () => {
    // partial 守卫：流式状态时整轮 preview 仍是 partial 文本，不补气泡。
    const base = session([{ role: "user", content: "你好", timestamp: 1 }]); // status = running
    const next = appendAssistantPreviewTextMessage([base], "tab-1", "部分文本…");
    expect(next[0]).toBe(base);
    expect(next[0]?.messages.some((item) => item.role === "assistant")).toBe(false);
  });

  test("skips when session is still connecting (partial preview guard)", () => {
    const base = { ...session([{ role: "user", content: "你好", timestamp: 1 }]), status: "connecting" as const };
    const next = appendAssistantPreviewTextMessage([base], "tab-1", "部分文本…");
    expect(next[0]).toBe(base);
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
    const base = {
      ...session([
        { role: "user", content: "你好", timestamp: 1 },
        {
          role: "assistant",
          content: "已有回复",
          timestamp: 2,
          parts: [{ type: "text", text: "已有回复" }],
        },
      ]),
      status: "idle" as const,
    };
    const next = appendAssistantPreviewTextMessage([base], "tab-1", "新回复");
    expect(next[0]?.messages.filter((item) => item.role === "assistant")).toHaveLength(1);
    expect(next[0]?.messages[1]?.parts.some((p) => p.type === "text" && p.text === "已有回复")).toBe(true);
  });

  test("appends completion summary as text part on last tool-only assistant bubble", () => {
    const base = {
      ...session([
        { role: "user", content: "做任务", timestamp: 1 },
        {
          role: "assistant",
          content: "",
          timestamp: 2,
          parts: [{ type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" }],
        },
      ]),
      status: "completed" as const,
    };
    const summary = "已完成！\n\n## 改动总结";
    const next = appendAssistantPreviewTextMessage([base], "tab-1", summary);
    expect(next[0]?.messages).toHaveLength(2);
    const last = next[0]?.messages[1];
    expect(last?.role).toBe("assistant");
    expect(last?.parts.some((p) => p.type === "text" && p.text === summary)).toBe(true);
  });

  test("still appends post-tool summary when intro text exists before tools", () => {
    const base = {
      ...session([
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
      ]),
      status: "completed" as const,
    };
    const summary = "零错误。全部改动已就绪，以下是总结：\n\n## ✅ 完成";
    const next = appendAssistantPreviewTextMessage([base], "tab-1", summary);
    const last = next[0]?.messages[1];
    expect(last?.parts.some((p) => p.type === "text" && p.text === summary)).toBe(true);
  });

  test("does not overwrite existing post-tool summary with full-turn preview text", () => {
    // 回合 complete 时 previewRaw 取整轮流式缓冲（intro + 总结），比纯总结更长。
    // 末条 assistant 已有工具后总结 part 时，安全网不应再用整轮覆盖它，否则总结气泡
    // 会混入引导语并致其重复（流式乱、刷新后才规整的根因）。
    const intro = "我先分析一下现状";
    const summary = "## 改动总结\n已完成所有改动，零错误。";
    const base = {
      ...session([
        { role: "user", content: "做任务", timestamp: 1 },
        {
          role: "assistant",
          content: summary,
          timestamp: 2,
          parts: [
            { type: "text", text: intro },
            { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
            { type: "text", text: summary },
          ],
        },
      ]),
      status: "completed" as const,
    };
    const fullTurnPreview = `${intro}\n${summary}`;
    const next = appendAssistantPreviewTextMessage([base], "tab-1", fullTurnPreview);
    const last = next[0]?.messages[1];
    // 工具后总结 part 仍是纯总结，未被整轮覆盖
    expect(last?.parts.some((p) => p.type === "text" && p.text === summary)).toBe(true);
    // 不存在被整轮污染的 text part
    expect(last?.parts.some((p) => p.type === "text" && p.text === fullTurnPreview)).toBe(false);
    // content 不被改写为整轮
    expect(last?.content).toBe(summary);
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

describe("assistantMessageVisiblePlainText", () => {
  // partial 守卫：content 是磁盘快照的整段文本（可能含工具前分析 + 工具结果 + 总结），
  // 不应在 parts 还没收齐时退回 content，否则下游会过早判定"有可见正文"、
  // 把 partial 文本当作完成态使用（previewRaw / 通知 body / monitor bucket 等）。
  test("returns empty when parts has no text and only content is set (partial guard)", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "整段文本：分析 + 工具结果 + 总结",
      parts: [
        { type: "reasoning", text: "思考中…" },
        { type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" },
      ],
      timestamp: 1,
    };
    expect(assistantMessageVisiblePlainText(msg)).toBe("");
  });

  test("returns empty when parts has no text at all (partial guard)", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "整段文本",
      parts: [],
      timestamp: 1,
    };
    expect(assistantMessageVisiblePlainText(msg)).toBe("");
  });

  test("concatenates all text parts joined by double newline", () => {
    // 多 text part 时拼接全部（不再只取最后一个），符合用户场景：
    // 工具前 + 工具后 总结都收齐时，返回完整拼接文本。
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "intro\n\n总结",
      parts: [
        { type: "text", text: "intro" },
        { type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" },
        { type: "text", text: "总结" },
      ],
      timestamp: 1,
    };
    expect(assistantMessageVisiblePlainText(msg)).toBe("intro\n\n总结");
  });

  test("skips empty text parts when concatenating", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "",
      parts: [
        { type: "text", text: "   " },
        { type: "text", text: "可见" },
        { type: "text", text: "" },
      ],
      timestamp: 1,
    };
    expect(assistantMessageVisiblePlainText(msg)).toBe("可见");
  });

  test("returns empty for non-assistant role", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "user",
      content: "hi",
      parts: [{ type: "text", text: "hi" }],
      timestamp: 1,
    };
    expect(assistantMessageVisiblePlainText(msg)).toBe("");
  });
});
