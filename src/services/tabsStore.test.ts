import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { normalizeSessionRepositoryPath } from "../utils/sessionHistoryScope";

const invoke = mock(async () => undefined);
mock.module("@tauri-apps/api/core", () => ({
  invoke,
  isTauri: () => true,
}));
mock.module("../utils/tauriEnv", () => ({
  isTauriIpcAlive: () => true,
}));
mock.module("./mainWindow", () => ({
  PRIMARY_MAIN_WINDOW_LABEL: "main",
  getCurrentMainWorkspaceWindowLabel: () => "main",
  isPrimaryMainWorkspaceWindowLabel: (label: string | null | undefined) =>
    (label ?? "main") === "main",
}));

const {
  buildPersistedTabsState,
  getSessionTabsPersistStatsForTests,
  LEGACY_TABS_BACKUP_STORAGE_KEY,
  normalizePersistedSession,
  resetSessionTabsPersistForTests,
  saveSessionTabsState,
  tabsBackupStorageKey,
  takeLocalTabsBackupRaw,
  toPersistedTabsSessions,
  writeLocalTabsBackupRaw,
} = await import("./tabsStore");

function installLocalStorageStub(): Storage {
  const map = new Map<string, string>();
  const stub = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
  return stub;
}

describe("tabsStore path normalization contract", () => {
  it("matches normalizeSessionRepositoryPath used when loading tabs", () => {
    expect(normalizeSessionRepositoryPath("/work/repo/")).toBe("/work/repo");
    expect(normalizeSessionRepositoryPath("C:\\work\\repo\\")).toBe("C:/work/repo");
  });
});

describe("normalizePersistedSession ultracodeEnabled coercion", () => {
  it("保留合法 boolean", () => {
    const out = normalizePersistedSession({
      id: "s1",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      ultracodeEnabled: true,
    });
    expect(out.ultracodeEnabled).toBe(true);
    const out2 = normalizePersistedSession({
      id: "s2",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      ultracodeEnabled: false,
    });
    expect(out2.ultracodeEnabled).toBe(false);
  });

  it("非 boolean 字段被静默剥除（tabs.json 脏数据兜底）", () => {
    for (const dirty of ["true", 1, null, { enabled: true }, [true]]) {
      const out = normalizePersistedSession({
        id: "s3",
        repositoryPath: "/work/repo",
        repositoryName: "repo",
        ultracodeEnabled: dirty,
      });
      expect(out.ultracodeEnabled).toBeUndefined();
    }
  });

  it("undefined / 未设置时不存在字段", () => {
    const out = normalizePersistedSession({
      id: "s4",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
    });
    expect("ultracodeEnabled" in out).toBe(false);
  });
});

describe("normalizePersistedSession codexReasoningEffort coercion", () => {
  it("保留合法 effort", () => {
    const out = normalizePersistedSession({
      id: "s1",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      codexReasoningEffort: "xhigh",
    });
    expect(out.codexReasoningEffort).toBe("xhigh");
  });

  it("非法值被剥除", () => {
    for (const dirty of ["max", "", 1, null, true]) {
      const out = normalizePersistedSession({
        id: "s2",
        repositoryPath: "/work/repo",
        repositoryName: "repo",
        codexReasoningEffort: dirty,
      });
      expect(out.codexReasoningEffort).toBeUndefined();
    }
  });
});

describe("normalizePersistedSession claudeReasoningEffort coercion", () => {
  it("保留合法 effort", () => {
    const out = normalizePersistedSession({
      id: "s1",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      claudeReasoningEffort: "xhigh",
    });
    expect(out.claudeReasoningEffort).toBe("xhigh");
  });

  it("非法值被剥除", () => {
    for (const dirty of ["minimal", "ultra", "", 1, null, true]) {
      const out = normalizePersistedSession({
        id: "s2",
        repositoryPath: "/work/repo",
        repositoryName: "repo",
        claudeReasoningEffort: dirty,
      });
      expect(out.claudeReasoningEffort).toBeUndefined();
    }
  });

  it("保留 ultracode", () => {
    const out = normalizePersistedSession({
      id: "s3",
      repositoryPath: "/work/repo",
      repositoryName: "repo",
      claudeReasoningEffort: "ultracode",
    });
    expect(out.claudeReasoningEffort).toBe("ultracode");
  });
});

describe("saveSessionTabsState coalesce", () => {
  beforeEach(() => {
    resetSessionTabsPersistForTests();
    invoke.mockReset();
  });

  afterEach(() => {
    resetSessionTabsPersistForTests();
  });

  it("coalesces concurrent saves to the latest snapshot", async () => {
    const writes: Array<{ activeSessionId: string | null }> = [];
    invoke.mockImplementation(async (_cmd: string, args: { state: { activeSessionId: string | null } }) => {
      writes.push({ activeSessionId: args.state.activeSessionId });
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const first = buildPersistedTabsState("a", [
      {
        id: "a",
        title: "A",
        status: "idle",
        repositoryPath: "/r",
        repositoryName: "r",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      } as never,
    ]);
    const second = buildPersistedTabsState("b", [
      {
        id: "b",
        title: "B",
        status: "idle",
        repositoryPath: "/r",
        repositoryName: "r",
        messages: [],
        createdAt: 2,
        updatedAt: 2,
      } as never,
    ]);

    const p1 = saveSessionTabsState(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const p2 = saveSessionTabsState(second);
    expect(getSessionTabsPersistStatsForTests().generation).toBe(2);

    await Promise.all([p1, p2]);
    expect(writes.length).toBeGreaterThanOrEqual(1);
    expect(writes.at(-1)?.activeSessionId).toBe("b");
  });

  it("toPersistedTabsSessions strips runtime-only fields", () => {
    const out = toPersistedTabsSessions([
      {
        id: "s1",
        title: "S",
        status: "idle",
        repositoryPath: "/work/repo/",
        repositoryName: "repo",
        messages: [],
        createdAt: 1,
        updatedAt: 1,
        diskTranscriptPartial: true,
        transcriptMemoryUnlimited: true,
      } as never,
    ]);
    expect(out[0]?.repositoryPath).toBe("/work/repo");
    expect("diskTranscriptPartial" in (out[0] as object)).toBe(false);
    expect("transcriptMemoryUnlimited" in (out[0] as object)).toBe(false);
  });
});

describe("tabs localStorage backup isolation", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installLocalStorageStub();
    storage.clear();
  });

  afterEach(() => {
    storage.clear();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("scopes backup keys per window label", () => {
    expect(tabsBackupStorageKey("main")).toBe("wise.tabs.backup.v1:main");
    expect(tabsBackupStorageKey("main-dock-9")).toBe("wise.tabs.backup.v1:main-dock-9");
    expect(tabsBackupStorageKey("main")).not.toBe(tabsBackupStorageKey("main-dock-9"));
  });

  it("does not let dock backup overwrite main, and primary migrates legacy key", () => {
    writeLocalTabsBackupRaw(JSON.stringify({ version: 1, sessions: [{ id: "dock" }] }), "main-dock-1");
    writeLocalTabsBackupRaw(JSON.stringify({ version: 1, sessions: [{ id: "main" }] }), "main");

    expect(takeLocalTabsBackupRaw("main-dock-1")).toContain("dock");
    expect(takeLocalTabsBackupRaw("main")).toContain("main");
    expect(storage.getItem(tabsBackupStorageKey("main-dock-1"))).toBeNull();
    expect(storage.getItem(tabsBackupStorageKey("main"))).toBeNull();

    storage.setItem(
      LEGACY_TABS_BACKUP_STORAGE_KEY,
      JSON.stringify({ version: 1, sessions: [{ id: "legacy" }] }),
    );
    expect(takeLocalTabsBackupRaw("main")).toContain("legacy");
    expect(storage.getItem(LEGACY_TABS_BACKUP_STORAGE_KEY)).toBeNull();

    storage.setItem(
      LEGACY_TABS_BACKUP_STORAGE_KEY,
      JSON.stringify({ version: 1, sessions: [{ id: "legacy2" }] }),
    );
    expect(takeLocalTabsBackupRaw("main-dock-2")).toBeNull();
    expect(storage.getItem(LEGACY_TABS_BACKUP_STORAGE_KEY)).not.toBeNull();
  });
});
