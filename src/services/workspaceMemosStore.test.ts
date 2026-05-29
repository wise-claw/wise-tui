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

import { parseWorkspaceMemoTabKey, workspaceMemoTabKey } from "../types/workspaceMemos";
import {
  loadProjectWorkspaceMemos,
  saveProjectWorkspaceMemos,
} from "./workspaceMemosStore";

describe("workspaceMemosStore", () => {
  test("memo tab key round-trip", () => {
    const key = workspaceMemoTabKey("project", "abc");
    expect(parseWorkspaceMemoTabKey(key)).toEqual({ scope: "project", id: "abc" });
  });

  test("round-trip project memos", async () => {
    const store = new Map<string, string>();
    getAppSetting.mockImplementation(async (key: string) => store.get(key) ?? null);
    setAppSetting.mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
    });
    await saveProjectWorkspaceMemos(
      "proj-a",
      [
        {
          id: "m1",
          title: "需求",
          bodyMarkdown: "# 需求\n\n正文",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      "m1",
    );
    const loaded = await loadProjectWorkspaceMemos("proj-a");
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]?.title).toBe("需求");
    expect(loaded.lastSelectedId).toBe("m1");
  });
});
