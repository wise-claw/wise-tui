import { beforeEach, describe, expect, mock, test } from "bun:test";

// 真实 service + 真实 searchHistoryByRepo，只 mock 底层 appSettingsStore（与既有
// composerCommonPhrasesStore 测试同模式），避免跨文件替换 service 模块。
const stored = new Map<string, string>();
const getAppSetting = mock(async (key: string) => stored.get(key) ?? null);
const setAppSetting = mock(async (key: string, value: string) => {
  stored.set(key, value);
});

mock.module("../services/appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
  setAppSettingJson: async (key: string, value: unknown) => {
    stored.set(key, JSON.stringify(value));
  },
  deleteAppSetting: async (key: string) => {
    stored.delete(key);
  },
  getAppSettingJson: async (key: string) => {
    const raw = stored.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  getAppSettingsBatch: async (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, stored.get(k) ?? null])),
  WISE_CLAUDE_DEFAULT_SETTINGS_KEY: "wise.claudeDefaultSettings.v1",
  WISE_CODEX_DEFAULT_SETTINGS_KEY: "wise.codexDefaultSettings.v1",
  WISE_OPENCODE_DEFAULT_SETTINGS_KEY: "wise.opencodeDefaultSettings.v1",
}));

import { SEARCH_HISTORY_BY_REPO_KEY } from "../services/searchHistoryByRepo";
import { getSearchHistoryStore, resetSearchHistoryStoreForTests } from "./searchHistoryStore";

describe("searchHistoryStore", () => {
  beforeEach(() => {
    resetSearchHistoryStoreForTests();
    stored.clear();
    getAppSetting.mockReset();
    setAppSetting.mockReset();
    getAppSetting.mockImplementation(async (key: string) => stored.get(key) ?? null);
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      stored.set(key, value);
    });
  });

  test("same repositoryId returns cached api; null/0/undefined collapse to none scope", () => {
    const a1 = getSearchHistoryStore(7);
    const a2 = getSearchHistoryStore(7);
    expect(a1).toBe(a2);
    expect(a1.repositoryId).toBe(7);

    const b = getSearchHistoryStore(9);
    expect(b).not.toBe(a1);
    expect(b.repositoryId).toBe(9);

    const n1 = getSearchHistoryStore(null);
    const n2 = getSearchHistoryStore(0);
    const n3 = getSearchHistoryStore(undefined);
    expect(n1).toBe(n2);
    expect(n1).toBe(n3);
    expect(n1.repositoryId).toBeNull();
  });

  test("ensureLoaded loads both modes from per-repo service", async () => {
    stored.set(
      SEARCH_HISTORY_BY_REPO_KEY,
      JSON.stringify({
        7: {
          filename: [{ path: "f", timestamp: 1 }],
          content: [{ path: "c", timestamp: 2 }],
        },
      }),
    );
    const api = getSearchHistoryStore(7);
    await api.ensureLoaded();
    expect(api.getEntries("filename").map((e) => e.path)).toEqual(["f"]);
    expect(api.getEntries("content").map((e) => e.path)).toEqual(["c"]);
  });

  test("add updates snapshot and persists", async () => {
    const api = getSearchHistoryStore(7);
    await api.add("filename", "core/index");
    expect(api.getEntries("filename").map((e) => e.path)).toEqual(["core/index"]);
    expect(setAppSetting).toHaveBeenCalledWith(SEARCH_HISTORY_BY_REPO_KEY, expect.any(String));
  });

  test("add with line persists line on entry", async () => {
    const api = getSearchHistoryStore(7);
    await api.add("content", "src/a.ts", 12);
    const entries = api.getEntries("content");
    expect(entries[0].path).toBe("src/a.ts");
    expect(entries[0].line).toBe(12);
  });

  test("add is a no-op for null repositoryId", async () => {
    const api = getSearchHistoryStore(null);
    await api.add("filename", "anything");
    expect(setAppSetting).not.toHaveBeenCalled();
    expect(api.getEntries("filename")).toEqual([]);
  });

  test("remove updates snapshot", async () => {
    const api = getSearchHistoryStore(7);
    await api.add("filename", "a");
    await api.add("filename", "b");
    await api.remove("filename", "a");
    expect(api.getEntries("filename").map((e) => e.path)).toEqual(["b"]);
  });

  test("clear empties the mode snapshot but keeps the other", async () => {
    const api = getSearchHistoryStore(7);
    await api.add("filename", "a");
    await api.add("content", "c");
    await api.clear("filename");
    expect(api.getEntries("filename")).toEqual([]);
    expect(api.getEntries("content").map((e) => e.path)).toEqual(["c"]);
  });

  test("persisting one repo does not contaminate another repo scope", async () => {
    const repoA = getSearchHistoryStore(7);
    await repoA.add("filename", "alpha");
    const repoB = getSearchHistoryStore(9);
    await repoB.add("filename", "beta");
    expect(repoA.getEntries("filename").map((e) => e.path)).toEqual(["alpha"]);
    expect(repoB.getEntries("filename").map((e) => e.path)).toEqual(["beta"]);
    const raw = stored.get(SEARCH_HISTORY_BY_REPO_KEY);
    expect(raw).toContain('"7"');
    expect(raw).toContain('"9"');
  });

  test("subscribe reports generation bump on add", async () => {
    const api = getSearchHistoryStore(7);
    const snapshots: number[] = [];
    const unsubscribe = api.subscribe(() => snapshots.push(api.getSnapshot()));
    const before = api.getSnapshot();
    await api.add("filename", "x");
    expect(api.getSnapshot()).toBeGreaterThan(before);
    expect(snapshots.length).toBeGreaterThan(0);
    unsubscribe();
  });

  test("subscribe triggers initial load", async () => {
    stored.set(
      SEARCH_HISTORY_BY_REPO_KEY,
      JSON.stringify({
        7: { filename: [{ path: "preloaded", timestamp: 1 }], content: [] },
      }),
    );
    const api = getSearchHistoryStore(7);
    const unsubscribe = api.subscribe(() => {
      /* 触发 loadScope */
    });
    // subscribe 内 void loadScope 异步加载，ensureLoaded 等同一个 loadPromise
    await api.ensureLoaded();
    expect(api.getEntries("filename").map((e) => e.path)).toEqual(["preloaded"]);
    unsubscribe();
  });
});
