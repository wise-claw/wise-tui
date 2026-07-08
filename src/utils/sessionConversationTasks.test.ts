import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  buildBackgroundScriptConversationTasks,
  buildFeedbackLoopConversationTasks,
  buildSessionConversationTasks,
  buildConversationTaskDetailMessages,
  canStopSessionConversationTask,
  executionEnvironmentWorkerSessionsFingerprint,
  filterExecutionEnvironmentDispatchTaskItems,
  filterSessionDispatchTaskItems,
  markSessionToolUseStopped,
  resolveExecutionEnvironmentTaskFromDispatchMeta,
  resolveExecutionEnvironmentTaskFromTaskItems,
  resolveExecutionEnvironmentWorkerConversationTaskStatus,
  resolveWorkerDispatchTurnLastAssistantPreview,
  sessionsReactiveStructureKey,
} from "./sessionConversationTasks";
import type { SessionConversationTaskItem } from "../types";
import { parseDispatchRecord } from "./claudeChatMessageDisplay";

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

  test("uses dispatch prompt as execution environment task label", () => {
    const anchor = session({ id: "main-1" });
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "completed",
      messages: [{ id: 1, role: "user", content: "你好", timestamp: 1 }],
    });
    const items = buildSessionConversationTasks({
      session: anchor,
      allSessions: [anchor, worker],
      executionEnvironmentRecords: [
        {
          batchId: "batch-1",
          anchorSessionId: "main-1",
          repositoryPath: "/repo",
          executionEngine: "claude",
          createdAt: 1,
          items: [
            {
              key: "k1",
              batchId: "batch-1",
              anchorSessionId: "main-1",
              workerSessionId: "worker-1",
              label: "任务",
              previewText: "你好",
              batchIndex: 1,
              sessionCount: 1,
              updatedAt: 2,
            },
          ],
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("你好");
    expect(items[0]?.source).toBe("execution_environment");
    expect(items[0]?.updatedAt).toBe(2);
  });

  test("treats execution environment worker with assistant reply as completed when host status is error", () => {
    const anchor = session({ id: "main-1" });
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "error",
      messages: [
        { id: 1, role: "user", content: "@Claude Code 你好", timestamp: 1 },
        { id: 2, role: "system", content: "Claude Hook 启动中", timestamp: 2 },
        { id: 3, role: "assistant", content: "你好！有什么可以帮你的吗？", timestamp: 3 },
      ],
    });
    const items = buildSessionConversationTasks({
      session: anchor,
      allSessions: [anchor, worker],
      executionEnvironmentRecords: [
        {
          batchId: "batch-1",
          anchorSessionId: "main-1",
          repositoryPath: "/repo",
          executionEngine: "claude" as const,
          createdAt: 1,
          items: [
            {
              key: "k1",
              batchId: "batch-1",
              anchorSessionId: "main-1",
              workerSessionId: "worker-1",
              label: "任务",
              previewText: "你好",
              batchIndex: 1,
              sessionCount: 1,
              updatedAt: 2,
            },
          ],
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("completed");
  });

  test("keeps execution environment worker as failed when host error and no assistant reply", () => {
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "error",
      messages: [
        { id: 1, role: "user", content: "你好", timestamp: 1 },
        { id: 2, role: "system", content: "Claude Hook 启动中", timestamp: 2 },
      ],
    });
    expect(resolveExecutionEnvironmentWorkerConversationTaskStatus(worker)).toBe("failed");
  });

  test("uses last turn outcome when earlier turn succeeded but latest turn failed", () => {
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "completed",
      messages: [
        { id: 1, role: "user", content: "第一轮", timestamp: 1 },
        { id: 2, role: "assistant", content: "第一轮已完成", timestamp: 2 },
        { id: 3, role: "user", content: "第二轮", timestamp: 3 },
        { id: 4, role: "system", content: "Claude Hook 启动中", timestamp: 4 },
      ],
    });
    expect(resolveExecutionEnvironmentWorkerConversationTaskStatus(worker)).toBe("failed");
  });

  test("uses last turn success when earlier turn failed", () => {
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "error",
      messages: [
        { id: 1, role: "user", content: "第一轮", timestamp: 1 },
        { id: 2, role: "system", content: "Claude Hook 启动中", timestamp: 2 },
        { id: 3, role: "user", content: "第二轮", timestamp: 3 },
        { id: 4, role: "assistant", content: "第二轮已成功", timestamp: 4 },
      ],
    });
    expect(resolveExecutionEnvironmentWorkerConversationTaskStatus(worker)).toBe("completed");
  });

  test("uses last assistant reply as execution environment preview text", () => {
    const anchor = session({ id: "main-1" });
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "completed",
      messages: [
        { id: 1, role: "user", content: "你好 Claude", timestamp: 1 },
        { id: 2, role: "assistant", content: "全部完成。三个区域现在统一以 10px 左侧内边距对齐。", timestamp: 2 },
      ],
    });
    const items = buildSessionConversationTasks({
      session: anchor,
      allSessions: [anchor, worker],
      executionEnvironmentRecords: [
        {
          batchId: "batch-1",
          anchorSessionId: "main-1",
          repositoryPath: "/repo",
          executionEngine: "claude" as const,
          createdAt: 1,
          items: [
            {
              key: "k1",
              batchId: "batch-1",
              anchorSessionId: "main-1",
              workerSessionId: "worker-1",
              label: "任务",
              previewText: "你好 Claude",
              batchIndex: 1,
              sessionCount: 1,
              updatedAt: 2,
            },
          ],
        },
      ],
    });
    expect(items[0]?.previewText).toContain("全部完成");
    expect(items[0]?.previewText).not.toContain("你好 Claude");
  });
});

describe("resolveWorkerDispatchTurnLastAssistantPreview", () => {
  test("returns last meaningful assistant text after latest user turn", () => {
    const worker = session({
      messages: [
        { id: 1, role: "user", content: "第一轮", timestamp: 1 },
        { id: 2, role: "assistant", content: "旧回复", timestamp: 2 },
        { id: 3, role: "user", content: "第二轮", timestamp: 3 },
        { id: 4, role: "assistant", content: "最终摘要", timestamp: 4 },
      ],
    });
    expect(resolveWorkerDispatchTurnLastAssistantPreview(worker)).toBe("最终摘要");
  });
});

describe("resolveExecutionEnvironmentTaskFromDispatchMeta", () => {
  test("matches dispatch record to execution environment task by batch id", () => {
    const anchor = session({ id: "main-1" });
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "completed",
      messages: [{ id: 1, role: "user", content: "你好", timestamp: 1 }],
    });
    const dispatchRecords = [
      {
        batchId: "batch-1",
        anchorSessionId: "main-1",
        repositoryPath: "/repo",
        executionEngine: "claude" as const,
        createdAt: 1,
        items: [
          {
            key: "k1",
            batchId: "batch-1",
            anchorSessionId: "main-1",
            workerSessionId: "worker-1",
            label: "任务",
            previewText: "你好",
            batchIndex: 1,
            sessionCount: 1,
            updatedAt: 2,
          },
        ],
      },
    ];
    const meta = parseDispatchRecord(
      [
        "任务分发记录",
        "- 类型：执行环境",
        "- 引擎：Claude Code",
        "- 批次：batch-1",
        "- 时间：2026/6/4 08:15:13",
        "- 正文：你好",
      ].join("\n"),
    )!;
    const hit = resolveExecutionEnvironmentTaskFromDispatchMeta(meta, {
      anchorSession: anchor,
      sessions: [anchor, worker],
      dispatchRecords,
    });
    expect(hit?.key).toBe("k1");
    expect(hit?.sessionId).toBe("worker-1");
  });

  test("falls back to content and time for legacy dispatch records without batch id", () => {
    const anchor = session({ id: "main-1" });
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "completed",
      messages: [{ id: 1, role: "user", content: "你好", timestamp: 1 }],
    });
    const dispatchedAt = new Date(2026, 5, 4, 8, 15, 13).getTime();
    const dispatchRecords = [
      {
        batchId: "batch-legacy",
        anchorSessionId: "main-1",
        repositoryPath: "/repo",
        executionEngine: "claude" as const,
        createdAt: dispatchedAt,
        items: [
          {
            key: "k1",
            batchId: "batch-legacy",
            anchorSessionId: "main-1",
            workerSessionId: "worker-1",
            label: "任务",
            previewText: "你好",
            batchIndex: 1,
            sessionCount: 1,
            updatedAt: dispatchedAt,
          },
        ],
      },
    ];
    const meta = parseDispatchRecord(
      [
        "任务分发记录",
        "- 类型：执行环境",
        "- 引擎：Claude Code",
        "- 时间：2026/6/4 08:15:13",
        "- 正文：你好",
      ].join("\n"),
    )!;
    const hit = resolveExecutionEnvironmentTaskFromDispatchMeta(meta, {
      anchorSession: anchor,
      sessions: [anchor, worker],
      dispatchRecords,
    });
    expect(hit?.key).toBe("k1");
  });

  test("resolveExecutionEnvironmentTaskFromTaskItems matches prebuilt task list", () => {
    const meta = parseDispatchRecord(
      [
        "任务分发记录",
        "- 类型：执行环境",
        "- 引擎：Claude Code",
        "- 批次：batch-1",
        "- 正文：你好",
      ].join("\n"),
    )!;
    const hit = resolveExecutionEnvironmentTaskFromTaskItems(meta, [
      {
        key: "k1",
        label: "你好",
        status: "completed",
        previewText: "你好",
        updatedAt: 1,
        source: "execution_environment",
        sessionId: "worker-1",
        dispatchBatchId: "batch-1",
        batchIndex: 1,
      },
    ]);
    expect(hit?.sessionId).toBe("worker-1");
  });
});

describe("buildFeedbackLoopConversationTasks", () => {
  test("builds neural network dispatch rows for anchor session", () => {
    const anchor = session({ id: "main-1", repositoryPath: "/repo" });
    const worker = session({
      id: "worker-1",
      repositoryName: "wise/神经网:优化-1",
      repositoryPath: "/repo",
      status: "idle",
      messages: [
        { id: 1, role: "user", content: "优化请求", parts: [{ type: "text", text: "优化请求" }], timestamp: 1 },
        { id: 2, role: "assistant", content: "建议合并 Grep", parts: [{ type: "text", text: "建议合并 Grep" }], timestamp: 2 },
      ],
    });
    const items = buildSessionConversationTasks({
      session: anchor,
      feedbackLoopRecords: [
        {
          dispatchId: "fl-1",
          anchorSessionId: "main-1",
          workerSessionId: "worker-1",
          repositoryPath: "/repo",
          kind: "optimization",
          cycleIndex: 1,
          previewText: "优化请求",
          status: "completed",
          createdAt: 100,
          completedAt: 200,
        },
      ],
      allSessions: [anchor, worker],
    });
    expect(items.some((item) => item.source === "feedback_loop")).toBe(true);
    const row = items.find((item) => item.key === "feedback-loop:fl-1");
    expect(row?.subtitle).toBe("神经网 · 优化 #1");
    expect(row?.status).toBe("completed");
    expect(row?.previewText).toContain("建议合并 Grep");
  });

  test("includes comparison score in subtitle when present", () => {
    const anchor = session({ id: "main-1", repositoryPath: "/repo" });
    const items = buildFeedbackLoopConversationTasks({
      anchorSession: anchor,
      sessions: [anchor],
      dispatchRecords: [
        {
          dispatchId: "fl-2",
          anchorSessionId: "main-1",
          workerSessionId: "worker-2",
          repositoryPath: "/repo",
          kind: "optimization",
          cycleIndex: 2,
          previewText: "第二轮优化",
          status: "completed",
          createdAt: 100,
          completedAt: 200,
          comparisonOverallScore: 12.5,
        },
      ],
    });
    const row = items.find((item) => item.key === "feedback-loop:fl-2");
    expect(row?.subtitle).toContain("得分 +12.5");
    expect(row?.feedbackLoopComparisonScore).toBe(12.5);
  });
});

describe("filterSessionDispatchTaskItems", () => {
  const execItem = (updatedAt: number): SessionConversationTaskItem => ({
    key: `exec-${updatedAt}`,
    label: "任务",
    status: "completed",
    previewText: "",
    updatedAt,
    source: "execution_environment",
  });
  const feedbackItem = (updatedAt: number): SessionConversationTaskItem => ({
    key: `fl-${updatedAt}`,
    label: "神经网",
    status: "completed",
    previewText: "",
    updatedAt,
    source: "feedback_loop",
  });

  test("includes execution environment and feedback loop sources", () => {
    const items = [
      execItem(100),
      feedbackItem(300),
      { ...execItem(500), source: "message_tool" as const },
    ];
    const filtered = filterSessionDispatchTaskItems(items, 200);
    expect(filtered.map((row) => row.updatedAt)).toEqual([300]);
  });
});

describe("filterExecutionEnvironmentDispatchTaskItems", () => {
  const execItem = (updatedAt: number): SessionConversationTaskItem => ({
    key: `exec-${updatedAt}`,
    label: "任务",
    status: "completed",
    previewText: "",
    updatedAt,
    source: "execution_environment",
  });

  test("filters by sinceMs without re-querying store", () => {
    const items = [
      execItem(100),
      execItem(500),
      { ...execItem(900), source: "tool" as const },
    ];
    const filtered = filterExecutionEnvironmentDispatchTaskItems(items, 400);
    expect(filtered.map((row) => row.updatedAt)).toEqual([500]);
  });
});

describe("sessionsReactiveStructureKey", () => {
  test("ignores streaming growth on the same assistant message", () => {
    const short = session({
      id: "main",
      status: "running",
      messages: [{ id: "a1", role: "assistant", content: "x".repeat(40), timestamp: 1 }],
    });
    const longer = session({
      id: "main",
      status: "running",
      messages: [{ id: "a1", role: "assistant", content: "x".repeat(4000), timestamp: 1 }],
    });
    expect(sessionsReactiveStructureKey([short])).toBe(sessionsReactiveStructureKey([longer]));
  });
});

describe("executionEnvironmentWorkerSessionsFingerprint", () => {
  test("ignores worker streaming content growth", () => {
    const short = session({
      id: "worker",
      repositoryName: "Cursor · repo",
      status: "running",
      messages: [{ id: "a1", role: "assistant", content: "x".repeat(40), timestamp: 1 }],
    });
    const longer = session({
      id: "worker",
      repositoryName: "Cursor · repo",
      status: "running",
      messages: [{ id: "a1", role: "assistant", content: "x".repeat(4000), timestamp: 1 }],
    });
    expect(executionEnvironmentWorkerSessionsFingerprint([short])).toBe(
      executionEnvironmentWorkerSessionsFingerprint([longer]),
    );
  });
});

describe("buildBackgroundScriptConversationTasks", () => {
  function anchorSession() {
    return session({ id: "main-bg", repositoryPath: "/repo/a" });
  }

  function bgRecord(itemOverrides: Partial<{
    label: string;
    previewText: string;
    workspaceId: string;
    terminalId: string;
    pid: number;
    exitCode: number | undefined;
    killedByUser: boolean | undefined;
  }> = {}) {
    return {
      batchId: "bg-script:aid",
      anchorSessionId: "main-bg",
      repositoryPath: "/repo/a",
      executionEngine: "claude" as const,
      createdAt: 100,
      items: [
        {
          key: "exec-env:bg-script:aid:assistant-script:aid:1",
          batchId: "bg-script:aid",
          anchorSessionId: "main-bg",
          workerSessionId: "assistant-script:aid:1",
          label: itemOverrides.label ?? "执行脚本·测试",
          previewText: itemOverrides.previewText ?? "echo hi",
          batchIndex: 1,
          sessionCount: 1,
          updatedAt: 200,
          workspaceId: itemOverrides.workspaceId ?? "/repo/a",
          terminalId: itemOverrides.terminalId ?? "assistant-script:aid:1",
          cwd: itemOverrides.workspaceId ?? "/repo/a",
          pid: itemOverrides.pid ?? 4242,
          exitCode: itemOverrides.exitCode,
          killedByUser: itemOverrides.killedByUser,
        },
      ],
    };
  }

  test("terminalId+workspaceId 齐备 → source=background_script / running / cancellable=true", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [bgRecord()],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("background_script");
    expect(items[0]?.status).toBe("running");
    expect(items[0]?.cancellable).toBe(true);
    expect(items[0]?.cancelMode).toBe("session");
    expect(items[0]?.terminalId).toBe("assistant-script:aid:1");
    expect(items[0]?.workspaceId).toBe("/repo/a");
    expect(items[0]?.pid).toBe(4242);
    expect(items[0]?.subtitle).toBe("pid 4242");
  });

  test("terminalId 缺失 → 丢弃", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [bgRecord({ terminalId: "" })],
    });
    expect(items).toHaveLength(0);
  });

  test("workspaceId 缺失 → 丢弃", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [bgRecord({ workspaceId: "" })],
    });
    expect(items).toHaveLength(0);
  });

  test("exitCode=0 → status=completed / cancellable=false", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [bgRecord({ exitCode: 0 })],
    });
    expect(items[0]?.status).toBe("completed");
    expect(items[0]?.cancellable).toBe(false);
    expect(items[0]?.cancelMode).toBeUndefined();
  });

  test("exitCode=137 → status=failed / cancellable=false", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [bgRecord({ exitCode: 137 })],
    });
    expect(items[0]?.status).toBe("failed");
    expect(items[0]?.cancellable).toBe(false);
  });

  test("killedByUser:true → status=failed", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [bgRecord({ killedByUser: true, exitCode: 0 })],
    });
    expect(items[0]?.status).toBe("failed");
  });

  test("anchor 不匹配 → 全部丢弃", () => {
    const items = buildBackgroundScriptConversationTasks({
      anchorSession: anchorSession(),
      dispatchRecords: [
        {
          ...bgRecord(),
          anchorSessionId: "another-anchor",
        },
      ],
    });
    expect(items).toHaveLength(0);
  });

  test("buildSessionConversationTasks 合并 background_script + execution_environment", () => {
    const anchor = anchorSession();
    const worker = session({
      id: "worker-1",
      repositoryName: "demo/执行环境:claude:任务",
      status: "running",
      messages: [{ id: 1, role: "user", content: "你好", timestamp: 1 }],
    });
    const items = buildSessionConversationTasks({
      session: anchor,
      allSessions: [anchor, worker],
      executionEnvironmentRecords: [
        {
          batchId: "ee-1",
          anchorSessionId: "main-bg",
          repositoryPath: "/repo/a",
          executionEngine: "claude" as const,
          createdAt: 100,
          items: [
            {
              key: "exec-env:ee-1:worker-1",
              batchId: "ee-1",
              anchorSessionId: "main-bg",
              workerSessionId: "worker-1",
              label: "任务",
              previewText: "你好",
              batchIndex: 1,
              sessionCount: 1,
              updatedAt: 300,
            },
          ],
        },
        bgRecord({ previewText: "echo hi", pid: 99 }),
      ],
    });
    const sources = items.map((it) => it.source).sort();
    expect(sources.includes("background_script")).toBe(true);
    expect(sources.includes("execution_environment")).toBe(true);
  });
});

describe("filterSessionDispatchTaskItems background_script 支持", () => {
  test("sinceMs 内 background_script 保留；超出剔除；non-whitelist 剔除", () => {
    const items = [
      {
        key: "bg-old",
        label: "旧脚本",
        status: "completed",
        previewText: "",
        updatedAt: 100,
        source: "background_script",
      },
      {
        key: "bg-new",
        label: "新脚本",
        status: "running",
        previewText: "",
        updatedAt: 500,
        source: "background_script",
      },
      {
        key: "msg-new",
        label: "工具",
        status: "running",
        previewText: "",
        updatedAt: 600,
        source: "message_tool",
      },
    ];
    const filtered = filterSessionDispatchTaskItems(items, 200);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.key).toBe("bg-new");
  });
});

describe("canStopSessionConversationTask background_script 完备判断", () => {
  test("source=background_script + terminalId/workspaceId 齐备 → true（不依赖 onCancelSession）", () => {
    const ok = canStopSessionConversationTask(
      {
        key: "k",
        label: "",
        status: "running",
        previewText: "",
        updatedAt: 1,
        source: "background_script",
        cancellable: true,
        cancelMode: "session",
        terminalId: "assistant-script:aid:1",
        workspaceId: "/repo/a",
      },
      {},
    );
    expect(ok).toBe(true);
  });

  test("source=background_script 但 terminalId 缺失 → false", () => {
    const ok = canStopSessionConversationTask(
      {
        key: "k",
        label: "",
        status: "running",
        previewText: "",
        updatedAt: 1,
        source: "background_script",
        cancellable: true,
        cancelMode: "session",
        workspaceId: "/repo/a",
      },
      {},
    );
    expect(ok).toBe(false);
  });

  test("source=background_script 但 workspaceId 缺失 → false", () => {
    const ok = canStopSessionConversationTask(
      {
        key: "k",
        label: "",
        status: "running",
        previewText: "",
        updatedAt: 1,
        source: "background_script",
        cancellable: true,
        cancelMode: "session",
        terminalId: "assistant-script:aid:1",
      },
      {},
    );
    expect(ok).toBe(false);
  });
});
