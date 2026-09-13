import { beforeEach, describe, expect, mock, test } from "bun:test";

const memory = new Map<string, unknown>();

mock.module("./appSettingsStore", () => ({
  getAppSettingJson: async (key: string) => (memory.has(key) ? memory.get(key) : null),
  setAppSettingJson: async (key: string, payload: unknown) => {
    memory.set(key, payload);
  },
}));

const {
  AUTOMATION_PAUSE_STORAGE_KEY,
  getAutomationPauseSnapshot,
  hydrateAutomationPause,
  isRepositoryAutomationPaused,
  parseAutomationPauseState,
  resetAutomationPauseStoreForTests,
  setGlobalAutomationPause,
  setRepositoryAutomationPause,
} = await import("./automationPauseStore");

beforeEach(() => {
  memory.clear();
  resetAutomationPauseStoreForTests();
});

describe("parseAutomationPauseState", () => {
  test("defaults and normalizes paths", () => {
    expect(parseAutomationPauseState(null)).toEqual({ global: false, repositoryPaths: [] });
    expect(parseAutomationPauseState({ global: "yes", repositoryPaths: [" /a ", "", "/a", 1] })).toEqual({
      global: false,
      repositoryPaths: ["/a"],
    });
    expect(parseAutomationPauseState({ global: true, repositoryPaths: ["/b", "/a"] })).toEqual({
      global: true,
      repositoryPaths: ["/a", "/b"],
    });
  });
});

describe("automationPauseStore", () => {
  test("hydrates persisted pause across restarts", async () => {
    memory.set(AUTOMATION_PAUSE_STORAGE_KEY, { global: true, repositoryPaths: ["/repo/a"] });
    await hydrateAutomationPause();
    expect(getAutomationPauseSnapshot()).toEqual({ global: true, repositoryPaths: ["/repo/a"] });
    expect(isRepositoryAutomationPaused("/repo/a")).toBe(true);
    expect(isRepositoryAutomationPaused("/repo/b")).toBe(true);
  });

  test("repository pause is independent of task enabled flags", async () => {
    await setRepositoryAutomationPause("/repo/a", true);
    expect(isRepositoryAutomationPaused("/repo/a")).toBe(true);
    expect(isRepositoryAutomationPaused("/repo/b")).toBe(false);
    expect(memory.get(AUTOMATION_PAUSE_STORAGE_KEY)).toEqual({
      global: false,
      repositoryPaths: ["/repo/a"],
    });
    await setRepositoryAutomationPause("/repo/a", false);
    expect(isRepositoryAutomationPaused("/repo/a")).toBe(false);
  });

  test("global pause covers every repository without clearing repo list", async () => {
    await setRepositoryAutomationPause("/repo/a", true);
    await setGlobalAutomationPause(true);
    expect(isRepositoryAutomationPaused("/repo/b")).toBe(true);
    expect(getAutomationPauseSnapshot().repositoryPaths).toEqual(["/repo/a"]);
    await setGlobalAutomationPause(false);
    expect(isRepositoryAutomationPaused("/repo/a")).toBe(true);
    expect(isRepositoryAutomationPaused("/repo/b")).toBe(false);
  });
});
