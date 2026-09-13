import { beforeEach, describe, expect, mock, test } from "bun:test";

const memory = new Map<string, unknown>();

mock.module("./appSettingsStore", () => ({
  getAppSettingJson: async (key: string) => (memory.has(key) ? memory.get(key) : null),
  setAppSettingJson: async (key: string, payload: unknown) => {
    memory.set(key, payload);
  },
}));

const {
  COCKPIT_CONVERSATION_STORAGE_KEY,
  getCockpitConversationSnapshot,
  hydrateCockpitConversations,
  listCockpitConversationsForRepository,
  patchCockpitConversation,
  recordCockpitConversation,
  resetCockpitConversationStoreForTests,
} = await import("./cockpitConversationStore");

beforeEach(() => {
  memory.clear();
  resetCockpitConversationStoreForTests();
});

describe("cockpitConversationStore", () => {
  test("records and hydrates recent conversations", async () => {
    const created = await recordCockpitConversation({
      assistantId: "builtin:ppt-deck",
      assistantName: "PPT",
      sessionId: "s1",
      repositoryPath: "/repo",
      repositoryName: "wise",
      projectId: null,
      projectName: null,
      title: "路演",
      promptPreview: "做一份",
      status: "running",
      artifactPaths: [],
    });
    expect(getCockpitConversationSnapshot().lastAssistantId).toBe("builtin:ppt-deck");
    expect(memory.get(COCKPIT_CONVERSATION_STORAGE_KEY)).toBeDefined();

    resetCockpitConversationStoreForTests();
    await hydrateCockpitConversations();
    expect(getCockpitConversationSnapshot().records[0]?.id).toBe(created.id);
    expect(getCockpitConversationSnapshot().records[0]?.title).toBe("路演");
  });

  test("patch attaches artifacts without dropping the run", async () => {
    const created = await recordCockpitConversation({
      assistantId: "a",
      assistantName: "A",
      sessionId: "s1",
      repositoryPath: "/repo",
      repositoryName: "wise",
      projectId: null,
      projectName: null,
      title: "x",
      promptPreview: "x",
      status: "running",
      artifactPaths: [],
    });
    await patchCockpitConversation(created.id, {
      status: "ok",
      artifactPaths: ["docs/out.md"],
    });
    expect(getCockpitConversationSnapshot().records[0]).toMatchObject({
      status: "ok",
      artifactPaths: ["docs/out.md"],
      sessionId: "s1",
    });
  });

  test("lists repository runs and never returns all records for an empty path", async () => {
    await recordCockpitConversation({
      assistantId: "a",
      assistantName: "A",
      sessionId: "s1",
      repositoryPath: "/repo/a",
      repositoryName: "a",
      projectId: null,
      projectName: null,
      title: "a",
      promptPreview: "a",
      status: "ok",
      artifactPaths: [],
    });
    await recordCockpitConversation({
      assistantId: "b",
      assistantName: "B",
      sessionId: "s2",
      repositoryPath: "/repo/b",
      repositoryName: "b",
      projectId: null,
      projectName: null,
      title: "b",
      promptPreview: "b",
      status: "ok",
      artifactPaths: [],
    });
    expect(listCockpitConversationsForRepository("").map((item) => item.repositoryPath)).toEqual([]);
    expect(listCockpitConversationsForRepository("   ").map((item) => item.repositoryPath)).toEqual([]);
    expect(listCockpitConversationsForRepository("/repo/b").map((item) => item.repositoryPath)).toEqual([
      "/repo/b",
    ]);
  });
});
