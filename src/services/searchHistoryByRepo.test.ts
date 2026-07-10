import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
}));

import {
  SEARCH_HISTORY_BY_REPO_KEY,
  WISE_SEARCH_HISTORY_BY_REPO_CHANGED,
  MAX_SEARCH_HISTORY,
  addSearchHistoryForRepo,
  clearAllSearchHistoryForRepo,
  clearSearchHistoryForRepo,
  loadSearchHistoryByRepoMap,
  loadSearchHistoryForRepo,
  normalizeSearchFilePath,
  removeSearchHistoryForRepo,
} from "./searchHistoryByRepo";

function installWindowStub() {
  const listeners = new Map<string, Set<EventListener>>();
  Object.defineProperty(globalThis, "window", {
    value: {
      dispatchEvent: (event: Event) => {
        listeners.get(event.type)?.forEach((handler) => handler(event));
        return true;
      },
      addEventListener: (type: string, handler: EventListener) => {
        const bucket = listeners.get(type) ?? new Set<EventListener>();
        bucket.add(handler);
        listeners.set(type, bucket);
      },
      removeEventListener: (type: string, handler: EventListener) => {
        listeners.get(type)?.delete(handler);
      },
    },
    configurable: true,
  });
}

describe("searchHistoryByRepo", () => {
  let storedJson: string | null = null;

  beforeEach(() => {
    installWindowStub();
    storedJson = null;
    getAppSetting.mockReset();
    getAppSetting.mockImplementation(async (key: string) => {
      if (key === SEARCH_HISTORY_BY_REPO_KEY) return storedJson;
      return null;
    });
    setAppSetting.mockReset();
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      if (key === SEARCH_HISTORY_BY_REPO_KEY) storedJson = value;
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  test("normalizeSearchFilePath trims and strips leading slashes", () => {
    expect(normalizeSearchFilePath("  /core/index  ")).toBe("core/index");
    expect(normalizeSearchFilePath("///core")).toBe("core");
    expect(normalizeSearchFilePath("   ")).toBe("");
    expect(normalizeSearchFilePath("/")).toBe("");
  });

  test("loadMap returns empty when unset", async () => {
    const map = await loadSearchHistoryByRepoMap();
    expect(map).toEqual({});
  });

  test("add records per-repo and isolates repositories", async () => {
    await addSearchHistoryForRepo(7, "filename", "core/index");
    await addSearchHistoryForRepo(9, "filename", "other");

    expect((await loadSearchHistoryForRepo(7, "filename")).map((e) => e.path)).toEqual([
      "core/index",
    ]);
    expect((await loadSearchHistoryForRepo(9, "filename")).map((e) => e.path)).toEqual(["other"]);
    expect(storedJson).toContain('"7"');
    expect(storedJson).toContain('"9"');
  });

  test("add dedupes by path and moves existing path to front", async () => {
    await addSearchHistoryForRepo(7, "filename", "a");
    await addSearchHistoryForRepo(7, "filename", "b");
    await addSearchHistoryForRepo(7, "filename", "a");

    const paths = (await loadSearchHistoryForRepo(7, "filename")).map((e) => e.path);
    expect(paths).toEqual(["a", "b"]);
  });

  test("add normalizes path (trim + leading slash) and skips empty", async () => {
    await addSearchHistoryForRepo(7, "filename", "  /src/foo  ");
    const paths = (await loadSearchHistoryForRepo(7, "filename")).map((e) => e.path);
    expect(paths).toEqual(["src/foo"]);

    // 纯空白 / 仅 `/` 规范化后为空，不记录也不写盘
    await addSearchHistoryForRepo(7, "filename", "   ");
    expect((await loadSearchHistoryForRepo(7, "filename")).length).toBe(1);
  });

  test("filename and content modes are independent", async () => {
    await addSearchHistoryForRepo(7, "filename", "src/file.ts");
    await addSearchHistoryForRepo(7, "content", "src/content.ts");

    expect((await loadSearchHistoryForRepo(7, "filename")).map((e) => e.path)).toEqual([
      "src/file.ts",
    ]);
    expect((await loadSearchHistoryForRepo(7, "content")).map((e) => e.path)).toEqual([
      "src/content.ts",
    ]);
  });

  test("add caps at MAX_SEARCH_HISTORY (most recent first, oldest dropped)", async () => {
    for (let i = 0; i < MAX_SEARCH_HISTORY + 5; i++) {
      await addSearchHistoryForRepo(7, "filename", `q${i}`);
    }
    const entries = await loadSearchHistoryForRepo(7, "filename");
    expect(entries.length).toBe(MAX_SEARCH_HISTORY);
    // 最新写入的在头部，最早 q0..q4 被裁掉
    expect(entries[0].path).toBe(`q${MAX_SEARCH_HISTORY + 4}`);
    expect(entries.at(-1)?.path).toBe("q5");
  });

  test("remove deletes a single entry by path", async () => {
    await addSearchHistoryForRepo(7, "filename", "a");
    await addSearchHistoryForRepo(7, "filename", "b");
    await removeSearchHistoryForRepo(7, "filename", "a");
    expect((await loadSearchHistoryForRepo(7, "filename")).map((e) => e.path)).toEqual(["b"]);
  });

  test("clear empties one mode but keeps the other", async () => {
    await addSearchHistoryForRepo(7, "filename", "f");
    await addSearchHistoryForRepo(7, "content", "c");
    await clearSearchHistoryForRepo(7, "filename");
    expect((await loadSearchHistoryForRepo(7, "filename")).length).toBe(0);
    expect((await loadSearchHistoryForRepo(7, "content")).map((e) => e.path)).toEqual(["c"]);
  });

  test("clearing the last non-empty mode removes the repo bucket", async () => {
    await addSearchHistoryForRepo(7, "filename", "f");
    await clearSearchHistoryForRepo(7, "filename");
    const map = await loadSearchHistoryByRepoMap();
    expect(map[7]).toBeUndefined();
    expect(storedJson).not.toContain('"7"');
  });

  test("clearAll removes the entire repo bucket", async () => {
    await addSearchHistoryForRepo(7, "filename", "f");
    await addSearchHistoryForRepo(7, "content", "c");
    await clearAllSearchHistoryForRepo(7);
    const map = await loadSearchHistoryByRepoMap();
    expect(map[7]).toBeUndefined();
  });

  test("clearAll is a no-op when repo has no entry (does not write)", async () => {
    await clearAllSearchHistoryForRepo(42);
    expect(setAppSetting).not.toHaveBeenCalled();
  });

  test("add dispatches changed event with next map", async () => {
    const events: Array<Record<number, unknown>> = [];
    window.addEventListener(WISE_SEARCH_HISTORY_BY_REPO_CHANGED, (event) => {
      events.push((event as CustomEvent<{ map: Record<number, unknown> }>).detail.map);
    });
    await addSearchHistoryForRepo(7, "filename", "hello");
    expect(events.at(-1)?.[7]).toBeTruthy();
  });

  test("parse tolerates malformed JSON", async () => {
    storedJson = "not-json";
    const map = await loadSearchHistoryByRepoMap();
    expect(map).toEqual({});
  });

  test("parse drops invalid repositoryId keys (<=0)", async () => {
    storedJson = JSON.stringify({ "0": { filename: [{ path: "x", timestamp: 1 }], content: [] } });
    const map = await loadSearchHistoryByRepoMap();
    expect(map).toEqual({});
  });

  test("parse drops entries with empty/whitespace path", async () => {
    storedJson = JSON.stringify({ 7: { filename: [{ path: "  ", timestamp: 1 }], content: [] } });
    const map = await loadSearchHistoryByRepoMap();
    expect(map[7]).toBeUndefined();
  });

  test("add records line for content mode", async () => {
    await addSearchHistoryForRepo(7, "content", "src/a.ts", 42);
    const entries = await loadSearchHistoryForRepo(7, "content");
    expect(entries[0].path).toBe("src/a.ts");
    expect(entries[0].line).toBe(42);
  });

  test("add updates line when same path reopened at a different line", async () => {
    await addSearchHistoryForRepo(7, "content", "src/a.ts", 10);
    await addSearchHistoryForRepo(7, "content", "src/a.ts", 99);
    const entries = await loadSearchHistoryForRepo(7, "content");
    expect(entries.length).toBe(1);
    expect(entries[0].line).toBe(99);
  });

  test("add without line stores path only (filename mode)", async () => {
    await addSearchHistoryForRepo(7, "filename", "src/index.ts");
    const entries = await loadSearchHistoryForRepo(7, "filename");
    expect(entries[0].path).toBe("src/index.ts");
    expect(entries[0].line).toBeUndefined();
  });

  test("parse restores path/line from persisted JSON", async () => {
    storedJson = JSON.stringify({
      7: {
        filename: [{ path: "src/x.ts", timestamp: 1 }],
        content: [{ path: "src/y.ts", timestamp: 2, line: 7 }],
      },
    });
    const map = await loadSearchHistoryByRepoMap();
    expect(map[7].filename[0].path).toBe("src/x.ts");
    expect(map[7].filename[0].line).toBeUndefined();
    expect(map[7].content[0].line).toBe(7);
  });

  test("parse tolerates entries without line (filename entries)", async () => {
    storedJson = JSON.stringify({
      7: { filename: [{ path: "legacy.ts", timestamp: 1 }], content: [] },
    });
    const map = await loadSearchHistoryByRepoMap();
    expect(map[7].filename[0].path).toBe("legacy.ts");
    expect(map[7].filename[0].line).toBeUndefined();
  });
});
