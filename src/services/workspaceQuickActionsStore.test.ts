import { describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => ({ version: 1, items: [] }));

mock.module("@tauri-apps/api/core", () => ({
  invoke,
}));

import {
  loadProjectWorkspaceQuickActions,
  loadRepositoryWorkspaceQuickActions,
  saveProjectWorkspaceQuickActions,
} from "./workspaceQuickActionsStore";

describe("workspaceQuickActionsStore", () => {
  test("load returns empty payload when unset", async () => {
    invoke.mockImplementation(async () => ({ version: 1, items: [] }));
    const payload = await loadProjectWorkspaceQuickActions("proj-1");
    expect(payload).toEqual({ version: 1, items: [] });
    expect(invoke).toHaveBeenCalledWith("list_project_workspace_quick_actions", {
      projectId: "proj-1",
    });
  });

  test("save and load round-trip project items", async () => {
    const saved: { items: unknown[] } = { items: [] };
    invoke.mockImplementation(async (cmd: string, args?: { items?: unknown[] }) => {
      if (cmd === "save_project_workspace_quick_actions") {
        saved.items = args?.items ?? [];
        return undefined;
      }
      if (cmd === "list_project_workspace_quick_actions") {
        return { version: 1, items: saved.items };
      }
      return { version: 1, items: [] };
    });
    await saveProjectWorkspaceQuickActions("proj-1", [
      {
        id: "a1",
        kind: "link",
        label: "Docs",
        target: "https://example.com",
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    const loaded = await loadProjectWorkspaceQuickActions("proj-1");
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]?.label).toBe("Docs");
  });

  test("parse rejects invalid items", async () => {
    invoke.mockImplementation(async () => ({
      version: 1,
      items: [{ id: "", kind: "link", label: "x", target: "https://x.com" }],
    }));
    const loaded = await loadRepositoryWorkspaceQuickActions(42);
    expect(loaded.items).toHaveLength(0);
  });
});
