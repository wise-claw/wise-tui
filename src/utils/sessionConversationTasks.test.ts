import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  buildSessionConversationTasks,
  buildConversationTaskDetailMessages,
  canStopSessionConversationTask,
  markSessionToolUseStopped,
} from "./sessionConversationTasks";

function session(partial: Partial<ClaudeSession>): ClaudeSession {
  return {
    id: "sess-1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "",
    status: "idle",
    createdAt: 1,
    pendingPrompt: "",
    messages: [],
    ...partial,
  };
}

describe("buildSessionConversationTasks", () => {
  test("collects running and completed Task tools from session messages", () => {
    const items = buildSessionConversationTasks({
      session: session({
        messages: [
          {
            id: 1,
            role: "assistant",
            content: "",
            timestamp: 100,
            parts: [
              {
                type: "tool_use",
                id: "tu-1",
                name: "Task",
                input: { description: "Trellis task researcher", subagent_type: "trellis-research" },
                status: "running",
              },
            ],
          },
          {
            id: 2,
            role: "assistant",
            content: "",
            timestamp: 200,
            parts: [
              {
                type: "tool_use",
                id: "tu-2",
                name: "Task",
                input: { description: "Workflow engine researcher" },
                status: "completed",
                output: "done",
              },
            ],
          },
        ],
      }),
    });
    expect(items).toHaveLength(2);
    expect(items[0]?.status).toBe("running");
    expect(items[0]?.label).toContain("trellis-research");
    expect(items[1]?.status).toBe("completed");
  });

  test("collects Claude Code Agent tool uses with description label", () => {
    const items = buildSessionConversationTasks({
      session: session({
        messages: [
          {
            id: 1,
            role: "assistant",
            content: "",
            timestamp: 100,
            parts: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: { description: "子代理问候测试" },
                status: "completed",
              },
            ],
          },
          {
            id: 2,
            role: "user",
            content: "",
            timestamp: 150,
            parts: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "",
                input: {},
                output: "子代理执行成功！",
                status: "completed",
              },
            ],
          },
        ],
      }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("子代理问候测试");
    expect(items[0]?.status).toBe("completed");
    expect(items[0]?.previewText).toContain("子代理执行成功");
  });

  test("only keeps subagents from the latest user turn", () => {
    const items = buildSessionConversationTasks({
      session: session({
        messages: [
          {
            id: 1,
            role: "user",
            content: "第一轮",
            timestamp: 50,
            parts: [{ type: "text", text: "第一轮" }],
          },
          {
            id: 2,
            role: "assistant",
            content: "",
            timestamp: 100,
            parts: [
              {
                type: "tool_use",
                id: "agent-old",
                name: "Agent",
                input: { description: "子代理问候测试" },
                status: "completed",
              },
            ],
          },
          {
            id: 3,
            role: "assistant",
            content: "第一轮完成",
            timestamp: 120,
            parts: [{ type: "text", text: "第一轮完成" }],
          },
          {
            id: 4,
            role: "user",
            content: "第二轮",
            timestamp: 200,
            parts: [{ type: "text", text: "第二轮" }],
          },
          {
            id: 5,
            role: "assistant",
            content: "",
            timestamp: 250,
            parts: [
              {
                type: "tool_use",
                id: "agent-new",
                name: "Agent",
                input: { description: "子代理问候测试" },
                status: "running",
              },
            ],
          },
        ],
      }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.toolUseId).toBe("agent-new");
    expect(items[0]?.status).toBe("running");
  });

  test("marks Agent tool completed when parent assistant replies after subagent", () => {
    const items = buildSessionConversationTasks({
      session: session({
        messages: [
          {
            id: 1,
            role: "assistant",
            content: "",
            timestamp: 100,
            parts: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: { description: "子代理问候测试" },
                status: "running",
              },
            ],
          },
          {
            id: 2,
            role: "assistant",
            content: "子代理执行成功！它返回了中文问候「你好」。",
            timestamp: 200,
            parts: [
              {
                type: "text",
                text: "子代理执行成功！它返回了中文问候「你好」。",
              },
            ],
          },
        ],
      }),
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("子代理问候测试");
    expect(items[0]?.status).toBe("completed");
  });

  test("builds detail transcript for a tool_use in session messages", () => {
    const messages = [
      {
        id: 1,
        role: "user" as const,
        content: "test",
        timestamp: 50,
        parts: [{ type: "text" as const, text: "test" }],
      },
      {
        id: 2,
        role: "assistant" as const,
        content: "",
        timestamp: 100,
        parts: [
          {
            type: "tool_use" as const,
            id: "agent-1",
            name: "Agent",
            input: { description: "子代理问候测试" },
            status: "running" as const,
          },
        ],
      },
      {
        id: 3,
        role: "assistant" as const,
        content: "done",
        timestamp: 200,
        parts: [{ type: "text" as const, text: "子代理执行成功" }],
      },
    ];
    expect(buildConversationTaskDetailMessages(messages, "agent-1")).toHaveLength(2);
  });

  test("marks subagent completed when user tool_result merged while session idle", () => {
    const items = buildSessionConversationTasks({
      session: session({
        status: "idle",
        messages: [
          {
            id: 1,
            role: "user",
            content: "go",
            timestamp: 50,
            parts: [{ type: "text", text: "go" }],
          },
          {
            id: 2,
            role: "assistant",
            content: "",
            timestamp: 100,
            parts: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Task",
                input: { description: "子代理" },
                status: "running",
              },
            ],
          },
          {
            id: 3,
            role: "user",
            content: "done",
            timestamp: 200,
            parts: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "",
                input: {},
                output: "子代理返回",
                status: "completed",
              },
            ],
          },
        ],
      }),
    });
    expect(items[0]?.status).toBe("completed");
    expect(items[0]?.cancellable).toBe(false);
  });

  test("marks running message tool as stoppable even when session host is idle", () => {
    const items = buildSessionConversationTasks({
      session: session({
        status: "idle",
        messages: [
          {
            id: 1,
            role: "user",
            content: "test",
            timestamp: 50,
            parts: [{ type: "text", text: "test" }],
          },
          {
            id: 2,
            role: "assistant",
            content: "",
            timestamp: 100,
            parts: [
              {
                type: "tool_use",
                id: "agent-1",
                name: "Agent",
                input: { description: "子代理问候测试" },
                status: "running",
              },
            ],
          },
        ],
      }),
    });
    expect(items[0]?.cancellable).toBe(true);
    expect(
      canStopSessionConversationTask(items[0]!, {
        onCancelSession: () => {},
      }),
    ).toBe(true);
  });

  test("markSessionToolUseStopped marks running tool as error", () => {
    const base = session({
      messages: [
        {
          id: 1,
          role: "assistant",
          content: "",
          timestamp: 100,
          parts: [
            {
              type: "tool_use",
              id: "agent-1",
              name: "Agent",
              input: { description: "子代理问候测试" },
              status: "running",
            },
          ],
        },
      ],
    });
    const next = markSessionToolUseStopped(base, "agent-1");
    const part = next.messages[0]?.parts[0];
    expect(part?.type).toBe("tool_use");
    if (part?.type === "tool_use") {
      expect(part.status).toBe("error");
      expect(part.error).toBe("已手动结束");
    }
    const items = buildSessionConversationTasks({ session: { ...next, status: "cancelled" } });
    expect(items[0]?.status).toBe("failed");
  });

  test("clears tasks when a new session has no messages yet", () => {
    const items = buildSessionConversationTasks({
      session: session({ id: "sess-new", messages: [] }),
      directBatchInvocations: [
        {
          phase: "complete",
          invocationKey: "ik-old",
          sessionId: "sess-old",
          repositoryPath: "/repo",
          success: true,
          subagentType: "trellis-implement",
        },
      ],
    });
    expect(items).toHaveLength(0);
  });

  test("filters invocations to active session only", () => {
    const base = session({});
    const items = buildSessionConversationTasks({
      session: base,
      directBatchInvocations: [
        {
          phase: "progress",
          invocationKey: "ik-1",
          sessionId: "sess-1",
          repositoryPath: "/repo",
          subagentType: "trellis-implement",
          previewLine: "running task",
        },
        {
          phase: "complete",
          invocationKey: "ik-2",
          sessionId: "other-session",
          repositoryPath: "/repo",
          success: true,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.invocationKey).toBe("ik-1");
    expect(items[0]?.status).toBe("running");
  });
});
