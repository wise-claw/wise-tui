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
  retainWorkspaceQuickActionsScope,
  releaseWorkspaceQuickActionsScope,
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
});
