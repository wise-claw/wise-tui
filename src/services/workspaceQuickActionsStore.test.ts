import { describe, expect, mock, test } from "bun:test";

const getAppSetting = mock(async () => null as string | null);
const setAppSetting = mock(async () => undefined);

mock.module("./appSettingsStore", () => ({
  getAppSetting,
  setAppSetting,
  setAppSettingJson: async (key: string, payload: unknown) => {
    await setAppSetting(key, JSON.stringify(payload));
  },
  deleteAppSetting: async () => undefined,
}));

import {
  loadProjectWorkspaceQuickActions,
  loadRepositoryWorkspaceQuickActions,
  saveProjectWorkspaceQuickActions,
} from "./workspaceQuickActionsStore";

describe("workspaceQuickActionsStore", () => {
  test("load returns empty payload when unset", async () => {
    getAppSetting.mockImplementation(async () => null);
    const payload = await loadProjectWorkspaceQuickActions("proj-1");
    expect(payload).toEqual({ version: 1, items: [] });
  });

  test("save and load round-trip project items", async () => {
    const store = new Map<string, string>();
    getAppSetting.mockImplementation(async (key: string) => store.get(key) ?? null);
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
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
    getAppSetting.mockImplementation(async () =>
      JSON.stringify({
        version: 1,
        items: [{ id: "", kind: "link", label: "x", target: "https://x.com" }],
      }),
    );
    const loaded = await loadRepositoryWorkspaceQuickActions(42);
    expect(loaded.items).toHaveLength(0);
  });
});
