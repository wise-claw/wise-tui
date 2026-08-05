import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  applyDiskTranscriptTail,
  diskTranscriptLooksMidTurnTruncated,
  latestTurnHasInFlightToolUse,
  latestTurnHasVisibleAssistantContent,
  ONESHOT_DEFERRED_COMPLETE_FORCE_MS,
  reloadFullDiskTranscriptByKey,
  resolveDiskTranscriptCandidates,
  resolveDiskTranscriptKeyCandidates,
  resolveTerminalWorkerMessagesAfterDiskLoad,
  shouldDeferOneshotTurnComplete,
  shouldForceFinalizeDeferredOneshotComplete,
  shouldPreserveMemoryTranscriptOverDisk,
  shouldRequestDiskTranscriptHydration,
  shouldSkipFullDiskReloadForRunningSession,
  shouldUpgradeDiskTailToFullTranscript,
  transcriptHasDisplayUser,
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

  test("preserves idle session when disk tail lost the user echo", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "idle",
      messages: [
        { role: "user", content: "分析项目有哪些功能", timestamp: 1 },
        { role: "assistant", content: "完整回复", timestamp: 2 },
      ],
    });
    expect(
      shouldPreserveMemoryTranscriptOverDisk(session, [
        { role: "assistant", content: "）- 系统能力：macOS", timestamp: 9 },
      ]),
    ).toBe(true);
  });

  test("preserves idle session when disk tail starts mid-assistant even if a later user exists", () => {
    const session = terminalWorker({
      repositoryName: "demo",
      status: "idle",
      messages: [
        { role: "user", content: "第一轮", timestamp: 1 },
        { role: "assistant", content: "完整回复", timestamp: 2 },
        { role: "user", content: "第二轮", timestamp: 3 },
      ],
    });
    expect(
      shouldPreserveMemoryTranscriptOverDisk(session, [
        { role: "assistant", content: "）中段碎片", timestamp: 8 },
        { role: "user", content: "第二轮", timestamp: 9 },
      ]),
    ).toBe(true);
  });
});

describe("shouldUpgradeDiskTailToFullTranscript", () => {
  test("upgrades when user echo missing from saturated tail", () => {
    expect(
      shouldUpgradeDiskTailToFullTranscript({
        messages: [{ role: "assistant", content: "）中段", timestamp: 1 }],
        diskTranscriptPartial: true,
        linesLength: 320,
        tailLines: 320,
      }),
    ).toBe(true);
  });

  test("upgrades when saturated tail starts with assistant fragment", () => {
    expect(
      shouldUpgradeDiskTailToFullTranscript({
        messages: [
          { role: "assistant", content: "中段", timestamp: 1 },
          { role: "user", content: "下一轮", timestamp: 2 },
        ],
        diskTranscriptPartial: true,
        linesLength: 320,
        tailLines: 320,
      }),
    ).toBe(true);
  });

  test("does not upgrade complete short file that already includes user", () => {
    expect(
      shouldUpgradeDiskTailToFullTranscript({
        messages: [
          { role: "user", content: "你好", timestamp: 1 },
          { role: "assistant", content: "你好！", timestamp: 2 },
        ],
        diskTranscriptPartial: false,
        linesLength: 12,
        tailLines: 320,
      }),
    ).toBe(false);
  });

  test("transcript helpers detect display user and mid-turn truncation", () => {
    expect(transcriptHasDisplayUser([{ role: "assistant", content: "x", timestamp: 1 }])).toBe(
      false,
    );
    expect(
      transcriptHasDisplayUser([{ role: "user", content: "分析项目", timestamp: 1 }]),
    ).toBe(true);
    expect(
      diskTranscriptLooksMidTurnTruncated([
        { role: "assistant", content: "）碎片", timestamp: 1 },
        { role: "user", content: "下一轮", timestamp: 2 },
      ]),
    ).toBe(true);
    expect(
      diskTranscriptLooksMidTurnTruncated([
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
    expect(merged?.[3]?.timestamp).toBe(4);
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
  test("does not clobber stream assistant that arrived during disk load", async () => {
    const session = terminalWorker({
      status: "running",
      messages: [{ role: "user", content: "你好", timestamp: 1 }],
    });
    let nextSessions: ClaudeSession[] = [session];
    let resolveLoad!: (lines: string[]) => void;
    const loadPromise = new Promise<string[]>((resolve) => {
      resolveLoad = resolve;
    });
    const reloadPromise = reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions: [session],
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => loadPromise,
    });
    // await 期间流式已写入助手：合并必须对最新 row，禁止用启动快照抹掉增量。
    nextSessions = [
      {
        ...nextSessions[0]!,
        messages: [
          { role: "user", content: "你好", timestamp: 1 },
          {
            role: "assistant",
            content: "流式中",
            timestamp: 2,
            parts: [{ type: "text", text: "流式中" }],
          },
        ],
      },
    ];
    resolveLoad([
      JSON.stringify({ type: "user", message: { role: "user", content: "你好" } }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "磁盘回复" }] },
      }),
    ]);
    await reloadPromise;
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    expect(recovered?.messages.some((m) => m.role === "assistant" && String(m.content).includes("流式"))).toBe(
      true,
    );
    expect(recovered?.messages.some((m) => String(m.content).includes("磁盘回复"))).toBe(false);
  });

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
  test("claude engine uses claude session id only when tab id differs", () => {
    expect(
      resolveDiskTranscriptKeyCandidates(
        { id: "wise-tab-1", claudeSessionId: "claude-sid-1" },
        "claude",
      ),
    ).toEqual(["claude-sid-1"]);
  });

  test("claude engine keeps tab id when it equals disk session id", () => {
    expect(
      resolveDiskTranscriptKeyCandidates(
        { id: "claude-sid-1", claudeSessionId: "claude-sid-1" },
        "claude",
      ),
    ).toEqual(["claude-sid-1"]);
  });

  test("claude engine falls back to tab id when claudeSessionId missing", () => {
    expect(
      resolveDiskTranscriptKeyCandidates({ id: "wise-tab-1", claudeSessionId: null }, "claude"),
    ).toEqual(["wise-tab-1"]);
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

describe("resolveDiskTranscriptCandidates", () => {
  test("cursor engine falls back to codex_rpc then claude for cross-engine history", () => {
    expect(
      resolveDiskTranscriptCandidates(
        { id: "claude-sid-1", claudeSessionId: "claude-sid-1" },
        "cursor",
      ),
    ).toEqual([
      { source: "cursor", key: "claude-sid-1" },
      { source: "codex_rpc", key: "claude-sid-1" },
      { source: "claude", key: "claude-sid-1" },
    ]);
  });

  test("claude engine falls back to cursor and codex_rpc using wise tab id", () => {
    expect(
      resolveDiskTranscriptCandidates(
        { id: "session_1_abc", claudeSessionId: "agent-uuid-1" },
        "claude",
      ),
    ).toEqual([
      { source: "claude", key: "agent-uuid-1" },
      { source: "cursor", key: "session_1_abc" },
      { source: "cursor", key: "agent-uuid-1" },
      { source: "codex_rpc", key: "session_1_abc" },
      { source: "codex_rpc", key: "agent-uuid-1" },
    ]);
  });

  test("cursor engine can recover Codex RPC transcript written under wise tab id", () => {
    const candidates = resolveDiskTranscriptCandidates(
      { id: "session_1_abc", claudeSessionId: "019fba5c-thread" },
      "cursor",
    );
    expect(candidates).toContainEqual({ source: "codex_rpc", key: "session_1_abc" });
  });

  test("never probes claude directory with a wise tab id", () => {
    const candidates = resolveDiskTranscriptCandidates(
      { id: "session_1_abc", claudeSessionId: "agent-uuid-1" },
      "cursor",
    );
    expect(candidates.filter((item) => item.source === "claude")).toEqual([
      { source: "claude", key: "agent-uuid-1" },
    ]);
  });
});

describe("applyDiskTranscriptTail sidebar preview", () => {
  const diffFragmentLine = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: "LT_CHANGED,\n   WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED,",
    },
  });
  const assistantLine = JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "结论" }] },
  });

  function reviewSession(): ClaudeSession {
    return terminalWorker({
      repositoryName: "wise-tui",
      status: "completed",
      messages: [],
      diskPreview: "你是 Wise 内置的代码审查引擎（对标 Cursor Bugbot 的本地审查体验）。",
    });
  }

  test("keeps stream assistant that arrived while tail load was in flight", async () => {
    const session = terminalWorker({
      status: "running",
      messages: [{ role: "user", content: "你好", timestamp: 1 }],
      diskPreview: "你好",
    });
    let nextSessions: ClaudeSession[] = [session];
    let resolveLoad!: (lines: string[]) => void;
    const loadPromise = new Promise<string[]>((resolve) => {
      resolveLoad = resolve;
    });
    const applyPromise = applyDiskTranscriptTail({
      session,
      tailLines: 50,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => loadPromise,
    });
    nextSessions = [
      {
        ...nextSessions[0]!,
        messages: [
          { role: "user", content: "你好", timestamp: 1 },
          {
            role: "assistant",
            content: "流式中",
            timestamp: 2,
            parts: [{ type: "text", text: "流式中" }],
          },
        ],
      },
    ];
    resolveLoad([
      JSON.stringify({ type: "user", message: { role: "user", content: "你好" } }),
      assistantLine,
    ]);
    await applyPromise;
    const updated = nextSessions.find((item) => item.id === session.id);
    expect(updated?.messages.some((m) => m.role === "assistant" && String(m.content).includes("流式"))).toBe(
      true,
    );
    expect(updated?.messages.some((m) => String(m.content).includes("结论"))).toBe(false);
  });

  test("keeps existing preview when the tail window starts mid-transcript", async () => {
    const session = reviewSession();
    let nextSessions: ClaudeSession[] = [session];
    await applyDiskTranscriptTail({
      session,
      tailLines: 2,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [diffFragmentLine, assistantLine],
    });
    const updated = nextSessions.find((item) => item.id === session.id);
    expect(updated?.messages).toHaveLength(2);
    expect(updated?.diskPreview).toBe(session.diskPreview);
  });

  test("realigns preview once the whole transcript fits in the window", async () => {
    const session = reviewSession();
    let nextSessions: ClaudeSession[] = [session];
    await applyDiskTranscriptTail({
      session,
      tailLines: 200,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "你在干什么" } }),
        assistantLine,
      ],
    });
    const updated = nextSessions.find((item) => item.id === session.id);
    expect(updated?.diskPreview).toBe("你在干什么");
  });
});

describe("reloadFullDiskTranscriptByKey disk source fallback", () => {
  test("loads claude transcript for a session sitting in a cursor repository", async () => {
    const session = terminalWorker({
      id: "claude-sid-1",
      claudeSessionId: "claude-sid-1",
      repositoryName: "wise-tui",
      status: "completed",
      messages: [],
    });
    const sessions = [session];
    let nextSessions: ClaudeSession[] = sessions;
    const attempts: { source?: string; key: string }[] = [];
    await reloadFullDiskTranscriptByKey({
      sessionKey: "claude-sid-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "cursor",
      loadSessionTranscriptLines: async (_session, key, _tail, source) => {
        attempts.push({ source, key });
        // ~/.wise/cursor-runs 下没有该会话，只有 ~/.claude/projects 里有。
        if (source !== "claude") return [];
        return [
          JSON.stringify({ type: "user", message: { role: "user", content: "你在干什么" } }),
          JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "在读代码" }] },
          }),
        ];
      },
    });
    expect(attempts.map((item) => item.source)).toEqual(["cursor", "codex_rpc", "claude"]);
    const recovered = nextSessions.find((item) => item.id === "claude-sid-1");
    expect(recovered?.messages).toHaveLength(2);
    expect(recovered?.messages[1]?.content).toBe("在读代码");
  });

  test("loads codex_rpc transcript when repository engine is still cursor", async () => {
    const session = terminalWorker({
      id: "session_1_abc",
      claudeSessionId: "019fba5c-thread",
      repositoryName: "wise-tui",
      status: "completed",
      messages: [],
    });
    const sessions = [session];
    let nextSessions: ClaudeSession[] = sessions;
    const attempts: { source?: string; key: string }[] = [];
    await reloadFullDiskTranscriptByKey({
      sessionKey: "session_1_abc",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "cursor",
      loadSessionTranscriptLines: async (_session, key, _tail, source) => {
        attempts.push({ source, key });
        if (source !== "codex_rpc" || key !== "session_1_abc") return [];
        return [
          JSON.stringify({ type: "user", message: { role: "user", content: "你好" } }),
          JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "Codex RPC 回复" }] },
          }),
        ];
      },
    });
    expect(attempts.map((item) => item.source)).toEqual(["cursor", "cursor", "codex_rpc"]);
    const recovered = nextSessions.find((item) => item.id === "session_1_abc");
    expect(recovered?.messages).toHaveLength(2);
    expect(recovered?.messages[1]?.content).toBe("Codex RPC 回复");
  });

  test("keeps trying other sources when one loader rejects", async () => {
    const session = terminalWorker({
      id: "claude-sid-1",
      claudeSessionId: "claude-sid-1",
      repositoryName: "wise-tui",
      status: "completed",
      messages: [],
    });
    const sessions = [session];
    let nextSessions: ClaudeSession[] = sessions;
    await reloadFullDiskTranscriptByKey({
      sessionKey: "claude-sid-1",
      sessions,
      setSessions: (updater) => {
        nextSessions = updater(nextSessions);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "cursor",
      loadSessionTranscriptLines: async (_session, _key, _tail, source) => {
        if (source === "cursor") throw new Error("tabSessionId 含非法字符");
        return [
          JSON.stringify({ type: "user", message: { role: "user", content: "你在干什么" } }),
          JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "在读代码" }] },
          }),
        ];
      },
    });
    const recovered = nextSessions.find((item) => item.id === "claude-sid-1");
    expect(recovered?.messages).toHaveLength(2);
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

describe("shouldRequestDiskTranscriptHydration", () => {
  function plainSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
    return {
      id: "wise-tab-s",
      claudeSessionId: "claude-9",
      repositoryPath: "/repo",
      repositoryName: "demo",
      model: "sonnet",
      status: "idle",
      messages: [],
      createdAt: 1,
      pendingPrompt: "",
      ...overrides,
    };
  }

  test("running session with empty in-memory messages still hydrates (dropped while idle, resumed)", () => {
    // @派发/新建会话并行执行后切回：非活动标签正文被内存策略清空（diskTranscriptPartial），
    // 会话在后台被重新派发仍处于 running——此前 running 跳过导致整轮消息不可见。
    const session = plainSession({
      status: "running",
      diskTranscriptPartial: true,
      messages: [],
    });
    expect(shouldRequestDiskTranscriptHydration(session, "claude")).toBe(true);
  });

  test("connecting session with claudeSessionId hydrates", () => {
    expect(shouldRequestDiskTranscriptHydration(plainSession({ status: "connecting" }), "claude")).toBe(
      true,
    );
  });

  test("session that already has in-memory messages does not re-hydrate", () => {
    expect(
      shouldRequestDiskTranscriptHydration(
        plainSession({ status: "running", messages: [{ role: "user", content: "你好", timestamp: 1 }] }),
        "claude",
      ),
    ).toBe(false);
  });

  test("fresh session without disk evidence does not hydrate", () => {
    expect(
      shouldRequestDiskTranscriptHydration(
        plainSession({ claudeSessionId: null, diskTranscriptPartial: undefined }),
        "claude",
      ),
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

  test("keeps a user bubble appended during the disk read (latest-row re-check)", async () => {
    // 会话在磁盘读取期间被恢复执行：发送气泡已写入内存但尚未落盘。
    // 全量重载必须在 setSessions 时按最新 row 复判运行态保护，不得用略旧的磁盘快照覆盖。
    const sessions = [
      {
        id: "wise-tab-1",
        claudeSessionId: "claude-1",
        repositoryPath: "/repo",
        repositoryName: "demo",
        model: "sonnet",
        status: "idle",
        messages: [],
        createdAt: 1,
        pendingPrompt: "",
      } satisfies ClaudeSession,
    ];
    let nextSessions: ClaudeSession[] = sessions;
    const result = await reloadFullDiskTranscriptByKey({
      sessionKey: "wise-tab-1",
      sessions,
      setSessions: (updater) => {
        // 模拟读取期间会话被恢复：最新 row 是 running 且带刚发出的用户气泡（磁盘尚无）。
        nextSessions = updater([
          {
            id: "wise-tab-1",
            claudeSessionId: "claude-1",
            repositoryPath: "/repo",
            repositoryName: "demo",
            model: "sonnet",
            status: "running",
            messages: [{ role: "user", content: "刚发送的新任务", timestamp: 9 }],
            createdAt: 1,
            pendingPrompt: "",
          } satisfies ClaudeSession,
        ]);
      },
      diskTailLinesBySession: new Map(),
      resolveSessionExecutionEngine: () => "claude",
      loadSessionTranscriptLines: async () => [
        JSON.stringify({ type: "user", message: { role: "user", content: "磁盘旧任务" } }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "磁盘旧回复" }] },
        }),
      ],
    });
    expect(result).toBe(true);
    const recovered = nextSessions.find((item) => item.id === "wise-tab-1");
    // 最新 row 的内存回合领先磁盘：禁止覆盖，保留刚发送的气泡。
    expect(recovered?.messages).toEqual([{ role: "user", content: "刚发送的新任务", timestamp: 9 }]);
  });
});
