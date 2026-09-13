import { beforeEach, describe, expect, mock, test } from "bun:test";

const memory = new Map<string, unknown>();

mock.module("./appSettingsStore", () => ({
  getAppSettingJson: async (key: string) => (memory.has(key) ? memory.get(key) : null),
  setAppSettingJson: async (key: string, payload: unknown) => {
    memory.set(key, payload);
  },
}));

const { resetCockpitConversationStoreForTests, getCockpitConversationSnapshot } = await import(
  "./cockpitConversationStore"
);
const { dispatchCockpitAssistantBrief, finalizeCockpitRunsFromSessions } = await import("./cockpitBriefDispatch");

beforeEach(() => {
  memory.clear();
  resetCockpitConversationStoreForTests();
});

describe("dispatchCockpitAssistantBrief", () => {
  test("refuses empty prompt or missing repository", async () => {
    const deps = {
      createSession: mock(async () => "s1"),
      executeSession: mock(() => true),
      closeSession: mock(() => undefined),
    };
    expect(await dispatchCockpitAssistantBrief(deps, {
      assistantId: "a",
      assistantName: "A",
      prompt: "  ",
      repositoryPath: "/repo",
    })).toEqual({ ok: false, reason: "empty_prompt" });
    expect(await dispatchCockpitAssistantBrief(deps, {
      assistantId: "a",
      assistantName: "A",
      prompt: "做一份路演",
    })).toEqual({ ok: false, reason: "no_repository" });
    expect(deps.createSession).not.toHaveBeenCalled();
  });

  test("creates a background session and keeps the cron-like skipActivate worker", async () => {
    const deps = {
      createSession: mock(async () => "sess-1"),
      executeSession: mock(() => true),
      closeSession: mock(() => undefined),
    };
    const result = await dispatchCockpitAssistantBrief(deps, {
      assistantId: "builtin:ppt-deck",
      assistantName: "PPT",
      prompt: "做一份融资路演",
      repositoryPath: "/repo/wise",
      repositoryName: "wise",
    });
    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe("sess-1");
    expect(deps.createSession.mock.calls[0]?.[2]).toEqual({
      skipActivate: true,
      connectionKind: "streaming",
    });
    expect(getCockpitConversationSnapshot().records[0]).toMatchObject({
      sessionId: "sess-1",
      status: "running",
      title: "做一份融资路演",
    });
  });

  test("busy execute does not consume a live session", async () => {
    const deps = {
      createSession: mock(async () => "sess-1"),
      executeSession: mock(() => false),
      closeSession: mock(() => undefined),
    };
    const result = await dispatchCockpitAssistantBrief(deps, {
      assistantId: "a",
      assistantName: "A",
      prompt: "hi",
      repositoryPath: "/repo",
    });
    expect(result).toMatchObject({ ok: false, reason: "busy" });
    expect(deps.closeSession).toHaveBeenCalledWith("sess-1");
    expect(getCockpitConversationSnapshot().records[0]?.status).toBe("failed");
    expect(getCockpitConversationSnapshot().records[0]?.sessionId).toBeNull();
  });
});

describe("finalizeCockpitRunsFromSessions", () => {
  test("hangs git working tree files on the completed run", async () => {
    const deps = {
      createSession: mock(async () => "sess-1"),
      executeSession: mock(() => true),
      closeSession: mock(() => undefined),
    };
    await dispatchCockpitAssistantBrief(deps, {
      assistantId: "a",
      assistantName: "A",
      prompt: "写文档",
      repositoryPath: "/repo",
      repositoryName: "wise",
    });
    await finalizeCockpitRunsFromSessions(
      [{ id: "sess-1", status: "completed", repositoryPath: "/repo" }],
      async () =>
        ({
          staged: [{ path: "docs/out.md", status: "A", additions: 4, deletions: 0 }],
          unstaged: [],
          branch: "main",
          additions: 4,
          deletions: 0,
          ahead: 0,
          behind: 0,
          upstream: null,
        }),
    );
    expect(getCockpitConversationSnapshot().records[0]).toMatchObject({
      status: "ok",
      artifactPaths: ["docs/out.md"],
    });
  });
});
