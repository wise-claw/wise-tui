import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  latestTurnHasInFlightToolUse,
  latestTurnHasVisibleAssistantContent,
  ONESHOT_DEFERRED_COMPLETE_FORCE_MS,
  reloadFullDiskTranscriptByKey,
  resolveDiskTranscriptKeyCandidates,
  resolveTerminalWorkerMessagesAfterDiskLoad,
  shouldDeferOneshotTurnComplete,
  shouldForceFinalizeDeferredOneshotComplete,
  shouldPreserveMemoryTranscriptOverDisk,
  shouldSkipFullDiskReloadForRunningSession,
} from "./useClaudeSessions.transcript";
import { sessionHasVisibleStreamProgress } from "./useClaudeSessions.helpers";

function terminalWorker(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "wise-tab-1",
    claudeSessionId: "claude-1",
    repositoryPath: "/repo",
    repositoryName: "demo/员工:终端02",
    model: "sonnet",
    status: "cancelled",
    messages: [
      { role: "user", content: "你好", timestamp: 1 },
      {
        role: "system",
        content:
          "Claude 未成功完成本轮请求（未产出可见回复）。请检查 Hook 配置与 Claude CLI 权限。",
        timestamp: 2,
      },
    ],
    createdAt: 1,
    pendingPrompt: "",
    ...overrides,
  };
}

describe("latestTurnHasVisibleAssistantContent", () => {
  test("counts reasoning-only assistant output as visible progress", () => {
    expect(
      latestTurnHasVisibleAssistantContent([
        { role: "user", content: "你好", timestamp: 1 },
        {
          role: "assistant",
          content: "",
          timestamp: 2,
          parts: [{ type: "reasoning", text: "先查代码" }],
        },
      ]),
    ).toBe(true);
  });

  test("returns false when current turn has no assistant yet", () => {
    expect(latestTurnHasVisibleAssistantContent([{ role: "user", content: "你好", timestamp: 1 }])).toBe(
      false,
    );
  });
});

describe("shouldPreserveMemoryTranscriptOverDisk", () => {
  test("preserves running main session when memory has user bubble not yet on disk", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "running",
      messages: [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
        { role: "user", content: "刚发送", timestamp: 3 },
      ],
    });
    expect(
      shouldPreserveMemoryTranscriptOverDisk(session, [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
      ]),
    ).toBe(true);
  });

  test("allows reload when disk matches memory tail", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "running",
      messages: [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "你好！", timestamp: 2 },
      ],
    });
    expect(
      shouldPreserveMemoryTranscriptOverDisk(session, [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "你好！", timestamp: 2 },
      ]),
    ).toBe(false);
  });
});

describe("latestTurnHasInFlightToolUse", () => {
  test("detects tool_use without completed output", () => {
    expect(
      latestTurnHasInFlightToolUse([
        { role: "user", content: "查", timestamp: 1 },
        {
          role: "assistant",
          content: "",
          timestamp: 2,
          parts: [{ type: "tool_use", id: "t1", name: "grep", input: {}, status: "running" }],
        },
      ]),
    ).toBe(true);
  });
});

describe("shouldForceFinalizeDeferredOneshotComplete", () => {
  test("forces finalize after max defer window when reasoning exists", () => {
    expect(
      shouldForceFinalizeDeferredOneshotComplete(
        [
          { role: "user", content: "查", timestamp: 1 },
          {
            role: "assistant",
            content: "",
            timestamp: 2,
            parts: [{ type: "reasoning", text: "思考中" }],
          },
        ],
        ONESHOT_DEFERRED_COMPLETE_FORCE_MS,
      ),
    ).toBe(true);
  });
});

describe("sessionHasVisibleStreamProgress", () => {
  test("running session only checks current turn, not prior assistant bubbles", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "running",
      messages: [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "旧回复", timestamp: 2 },
        { role: "user", content: "第二轮", timestamp: 3 },
      ],
    });
    expect(sessionHasVisibleStreamProgress(session)).toBe(false);
  });
});

describe("shouldDeferOneshotTurnComplete", () => {
  test("defers while tool_use is still in flight", () => {
    expect(
      shouldDeferOneshotTurnComplete(
        [
          { role: "user", content: "查", timestamp: 1 },
          {
            role: "assistant",
            content: "",
            timestamp: 2,
            parts: [{ type: "tool_use", id: "t1", name: "read", input: {} }],
          },
        ],
        true,
      ),
    ).toBe(true);
  });

  test("defers success complete when only reasoning is visible", () => {
    expect(
      shouldDeferOneshotTurnComplete(
        [
          { role: "user", content: "查一下", timestamp: 1 },
          {
            role: "assistant",
            content: "",
            timestamp: 2,
            parts: [{ type: "reasoning", text: "先 grep" }],
          },
        ],
        true,
      ),
    ).toBe(true);
  });

  test("defers stale cancel when reasoning already streamed", () => {
    expect(
      shouldDeferOneshotTurnComplete(
        [
          { role: "user", content: "查一下", timestamp: 1 },
          {
            role: "assistant",
            content: "",
            timestamp: 2,
            parts: [{ type: "reasoning", text: "先 grep" }],
          },
        ],
        false,
      ),
    ).toBe(true);
  });

  test("does not defer when completed tools exist without text", () => {
    expect(
      shouldDeferOneshotTurnComplete(
        [
          { role: "user", content: "查一下", timestamp: 1 },
          {
            role: "assistant",
            content: "",
            timestamp: 2,
            parts: [
              {
                type: "tool_use",
                id: "t1",
                name: "bash",
                input: {},
                status: "completed",
                output: "ok",
              },
            ],
          },
        ],
        true,
      ),
    ).toBe(false);
  });
});

describe("resolveTerminalWorkerMessagesAfterDiskLoad", () => {
  test("keeps multi-turn memory when disk only has current turn", () => {
    const session = terminalWorker({
      status: "completed",
      messages: [
        { role: "user", content: "第一轮", timestamp: 1 },
        {
          role: "assistant",
          content: "回复一",
          timestamp: 2,
          parts: [{ type: "text", text: "回复一" }],
        },
        { role: "user", content: "你好", timestamp: 3 },
      ],
    });
    const merged = resolveTerminalWorkerMessagesAfterDiskLoad(session, [
      { role: "user", content: "你好", timestamp: 3 },
      {
        role: "assistant",
        content: "你好！",
        timestamp: 4,
        parts: [{ type: "text", text: "你好！" }],
      },
    ]);
    expect(merged).toHaveLength(4);
    expect(merged?.[0]?.content).toBe("第一轮");
    expect(merged?.[2]?.content).toBe("你好");
    expect(merged?.[3]?.content).toBe("你好！");
  });

  test("does not clobber multi-turn memory when disk lacks assistant", () => {
    const session = terminalWorker({
      messages: [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "回复一", timestamp: 2 },
        { role: "user", content: "你好", timestamp: 3 },
      ],
    });
    const merged = resolveTerminalWorkerMessagesAfterDiskLoad(session, [
      { role: "user", content: "你好", timestamp: 3 },
    ]);
    expect(merged).toBeNull();
  });

  test("does not replace in-memory assistant when disk transcript length differs", () => {
    const session = terminalWorker({
      status: "completed",
      messages: [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "你好！有什么我可以帮你的？", timestamp: 2 },
      ],
    });
    const merged = resolveTerminalWorkerMessagesAfterDiskLoad(session, [
      { role: "user", content: "旧内容", timestamp: 1 },
      { role: "assistant", content: "磁盘回复", timestamp: 2 },
      { role: "user", content: "追加", timestamp: 3 },
    ]);
    expect(merged).toBeNull();
  });
});

describe("reloadFullDiskTranscriptByKey terminal recovery", () => {
  test("does not clobber in-memory messages when disk lacks assistant", async () => {
    const sessions = [terminalWorker()];
    let nextSessions: ClaudeSession[] = sessions;
    await reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "旧内容" } }),
      ],
    });
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    expect(recovered?.messages).toHaveLength(2);
    expect(recovered?.messages[0]?.content).toBe("你好");
  });

  test("merges assistant into multi-turn memory instead of replacing history", async () => {
    const sessions = [
      terminalWorker({
        status: "running",
        messages: [
          { role: "user", content: "第一轮", timestamp: 1 },
          { role: "assistant", content: "回复一", timestamp: 2 },
          { role: "user", content: "你好", timestamp: 3 },
        ],
      }),
    ];
    let nextSessions: ClaudeSession[] = sessions;
    await reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "你好" } }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "你好！" }] },
        }),
      ],
    });
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    expect(recovered?.messages).toHaveLength(4);
    expect(recovered?.messages[0]?.content).toBe("第一轮");
    expect(recovered?.messages[3]?.content).toBe("你好！");
  });

  test("recovers cancelled terminal worker when disk transcript has assistant", async () => {
    const sessions = [terminalWorker()];
    let nextSessions: ClaudeSession[] = sessions;
    await reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "你好" } }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "你好！" }] },
        }),
      ],
    });
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    expect(recovered?.status).toBe("completed");
    expect(recovered?.messages.some((item) => item.role === "assistant")).toBe(true);
    expect(
      recovered?.messages.some(
        (item) =>
          item.role === "system" &&
          typeof item.content === "string" &&
          item.content.includes("未产出可见回复"),
      ),
    ).toBe(false);
  });
});

describe("resolveDiskTranscriptKeyCandidates", () => {
  test("includes claude session id and tab id for claude engine", () => {
    expect(
      resolveDiskTranscriptKeyCandidates(
        { id: "wise-tab-1", claudeSessionId: "claude-sid-1" },
        "claude",
      ),
    ).toEqual(["claude-sid-1", "wise-tab-1"]);
  });

  test("uses tab id for cursor engine", () => {
    expect(
      resolveDiskTranscriptKeyCandidates(
        { id: "wise-tab-1", claudeSessionId: "claude-sid-1" },
        "cursor",
      ),
    ).toEqual(["wise-tab-1", "claude-sid-1"]);
  });
});

describe("shouldSkipFullDiskReloadForRunningSession", () => {
  test("skips reload when running memory leads disk (user bubble not yet on disk)", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "running",
      messages: [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
        { role: "user", content: "刚发送", timestamp: 3 },
      ],
    });
    expect(
      shouldSkipFullDiskReloadForRunningSession(session, [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
      ]),
    ).toBe(true);
  });

  test("skips reload when running turn has visible assistant content not yet on disk", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "running",
      messages: [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "正在思考", timestamp: 2 },
      ],
    });
    // 磁盘尚无助手内容(仅 user)→ 当前轮未落盘,跳过全量覆盖
    expect(
      shouldSkipFullDiskReloadForRunningSession(session, [
        { role: "user", content: "你好", timestamp: 1 },
      ]),
    ).toBe(true);
  });

  test("allows reload when running but disk already has the assistant content", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "running",
      messages: [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
      ],
    });
    expect(
      shouldSkipFullDiskReloadForRunningSession(session, [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
      ]),
    ).toBe(false);
  });

  test("allows reload when idle (not running/connecting)", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "idle",
      messages: [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
      ],
    });
    expect(
      shouldSkipFullDiskReloadForRunningSession(session, [
        { role: "user", content: "你好", timestamp: 1 },
      ]),
    ).toBe(false);
  });

  test("terminal worker always allows reload (dedicated merge path)", () => {
    // terminal worker 默认 repositoryName 含「终端」,走专用合并逻辑,不跳过
    const session = terminalWorker({
      status: "running",
      messages: [
        { role: "user", content: "你好", timestamp: 1 },
        { role: "assistant", content: "回复", timestamp: 2 },
      ],
    });
    expect(
      shouldSkipFullDiskReloadForRunningSession(session, [
        { role: "user", content: "你好", timestamp: 1 },
      ]),
    ).toBe(false);
  });
});

describe("reloadFullDiskTranscriptByKey running protection", () => {
  test("running main session keeps in-memory turn when disk lacks assistant content", async () => {
    const sessions = [
      terminalWorker({
        repositoryName: "demo",
        status: "running",
        messages: [
          { role: "user", content: "你好", timestamp: 1 },
          { role: "assistant", content: "正在思考", timestamp: 2 },
        ],
      }),
    ];
    let nextSessions: ClaudeSession[] = sessions;
    const result = await reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      // 磁盘仅含 user,缺当前轮助手内容 → 触发运行态保护,跳过全量覆盖
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "你好" } }),
      ],
    });
    expect(result).toBe(false);
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    expect(recovered?.messages).toHaveLength(2);
    expect(recovered?.messages[1]?.content).toBe("正在思考");
  });

  test("idle main session reloads full disk transcript over memory", async () => {
    const sessions = [
      terminalWorker({
        repositoryName: "demo",
        status: "idle",
        messages: [{ role: "user", content: "旧内存", timestamp: 1 }],
      }),
    ];
    let nextSessions: ClaudeSession[] = sessions;
    const result = await reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "磁盘第一轮" } }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "磁盘回复" }] },
        }),
      ],
    });
    expect(result).toBe(true);
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    expect(recovered?.messages).toHaveLength(2);
    expect(recovered?.messages[0]?.content).toBe("磁盘第一轮");
  });
});
