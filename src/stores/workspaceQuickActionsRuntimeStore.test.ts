import { afterEach, describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => ({ version: 1, items: [] }));

mock.module("@tauri-apps/api/core", () => ({
  invoke,
}));

mock.module("antd", () => ({
  message: { error: () => undefined },
}));

const {
  getWorkspaceQuickActionsRuntimeSnapshot,
  getWorkspaceQuickActionsScopeItems,
  persistWorkspaceQuickActionsScopeItems,
  retainWorkspaceQuickActionsScope,
  releaseWorkspaceQuickActionsScope,
  scheduleWorkspaceQuickActionsPersist,
  setWorkspaceQuickActionsScopeItems,
  subscribeWorkspaceQuickActionsRuntime,
} = await import("./workspaceQuickActionsRuntimeStore");

describe("workspaceQuickActionsRuntimeStore", () => {
  afterEach(() => {
    releaseWorkspaceQuickActionsScope("project", "proj-1");
    releaseWorkspaceQuickActionsScope("repository", 42);
    invoke.mockReset();
    invoke.mockImplementation(async () => ({ version: 1, items: [] }));
  });

  test("dedupes concurrent loads for the same scope", async () => {
    let resolveLoad: (value: { version: number; items: unknown[] }) => void = () => undefined;
    const pending = new Promise<{ version: number; items: unknown[] }>((resolve) => {
      resolveLoad = resolve;
    });
    invoke.mockImplementation(async () => pending);

    retainWorkspaceQuickActionsScope("project", "proj-1");
    retainWorkspaceQuickActionsScope("project", "proj-1");

    const first = getWorkspaceQuickActionsScopeItems("project", "proj-1");
    expect(first).toEqual([]);

    resolveLoad({
      version: 1,
      items: [
        {
          id: "a1",
          kind: "link",
          label: "Docs",
          target: "https://example.com",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(getWorkspaceQuickActionsScopeItems("project", "proj-1")).toHaveLength(1);
  });

  test("shares optimistic updates across subscribers without extra reload", async () => {
    invoke.mockImplementation(async () => ({
      version: 1,
      items: [
        {
          id: "seed",
          kind: "link",
          label: "Seed",
          target: "https://seed.example",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }));

    let notifications = 0;
    const unsub = subscribeWorkspaceQuickActionsRuntime(() => {
      notifications += 1;
    });

    retainWorkspaceQuickActionsScope("repository", 42);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const invokeCountAfterLoad = invoke.mock.calls.length;

    setWorkspaceQuickActionsScopeItems("repository", 42, [
      {
        id: "a1",
        kind: "link",
        label: "Pinned",
        target: "https://example.com",
        pinnedToTopbar: true,
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    expect(getWorkspaceQuickActionsScopeItems("repository", 42)[0]?.pinnedToTopbar).toBe(true);
    expect(notifications).toBeGreaterThan(0);
    expect(invoke.mock.calls.length).toBe(invokeCountAfterLoad);

    unsub();
  });

  test("ignores stale load results after scope entry is released", async () => {
    let resolveLoad: (value: { version: number; items: unknown[] }) => void = () => undefined;
    const pending = new Promise<{ version: number; items: unknown[] }>((resolve) => {
      resolveLoad = resolve;
    });
    invoke.mockImplementation(async () => pending);

    retainWorkspaceQuickActionsScope("project", "proj-stale");
    releaseWorkspaceQuickActionsScope("project", "proj-stale");

    resolveLoad({
      version: 1,
      items: [
        {
          id: "stale",
          kind: "link",
          label: "Stale",
          target: "https://stale.example",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    invoke.mockImplementation(async () => ({ version: 1, items: [] }));

    retainWorkspaceQuickActionsScope("project", "proj-stale");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getWorkspaceQuickActionsScopeItems("project", "proj-stale")).toEqual([]);
    releaseWorkspaceQuickActionsScope("project", "proj-stale");
  });

  test("drops superseded persist writes while a newer save is in flight", async () => {
    const firstGate = new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    const secondGate = new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    let saveCount = 0;
    invoke.mockImplementation(async (command: string) => {
      if (command === "save_project_workspace_quick_actions") {
        saveCount += 1;
        if (saveCount === 1) await firstGate;
        else await secondGate;
      }
      return { version: 1, items: [] };
    });

    retainWorkspaceQuickActionsScope("project", "proj-persist");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const olderItems = [
      {
        id: "old",
        kind: "link" as const,
        label: "Old",
        target: "https://old.example",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const newerItems = [
      {
        id: "new",
        kind: "link" as const,
        label: "New",
        target: "https://new.example",
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    const firstPersist = persistWorkspaceQuickActionsScopeItems("project", "proj-persist", olderItems);
    const secondPersist = persistWorkspaceQuickActionsScopeItems("project", "proj-persist", newerItems);

    const [, secondOk] = await Promise.all([firstPersist, secondPersist]);
    expect(secondOk).toBe(true);
    expect(getWorkspaceQuickActionsScopeItems("project", "proj-persist")[0]?.id).toBe("new");

    releaseWorkspaceQuickActionsScope("project", "proj-persist");
  });

  test("debounces persist writes for the same scope in the runtime store", async () => {
    invoke.mockImplementation(async () => ({ version: 1, items: [] }));

    retainWorkspaceQuickActionsScope("project", "proj-debounce");
    await new Promise((resolve) => setTimeout(resolve, 0));

    scheduleWorkspaceQuickActionsPersist("project", "proj-debounce", [
      {
        id: "a",
        kind: "link",
        label: "A",
        target: "https://a.example",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    scheduleWorkspaceQuickActionsPersist("project", "proj-debounce", [
      {
        id: "b",
        kind: "link",
        label: "B",
        target: "https://b.example",
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 450));

    const saveCalls = invoke.mock.calls.filter(
      ([command]) => command === "save_project_workspace_quick_actions",
    );
    expect(saveCalls).toHaveLength(1);
    expect(getWorkspaceQuickActionsScopeItems("project", "proj-debounce")[0]?.id).toBe("b");

    releaseWorkspaceQuickActionsScope("project", "proj-debounce");
  });

  test("flushes pending persist when the last consumer releases the scope", async () => {
    let resolveSave: () => void = () => undefined;
    const saveGate = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    invoke.mockImplementation(async (command: string) => {
      if (command === "save_project_workspace_quick_actions") {
        await saveGate;
      }
      return { version: 1, items: [] };
    });

    retainWorkspaceQuickActionsScope("project", "proj-release");
    await new Promise((resolve) => setTimeout(resolve, 0));

    scheduleWorkspaceQuickActionsPersist("project", "proj-release", [
      {
        id: "flush-me",
        kind: "link",
        label: "Flush",
        target: "https://flush.example",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    releaseWorkspaceQuickActionsScope("project", "proj-release");
    resolveSave();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const saveCalls = invoke.mock.calls.filter(
      ([command]) => command === "save_project_workspace_quick_actions",
    );
    expect(saveCalls).toHaveLength(1);
  });
});
