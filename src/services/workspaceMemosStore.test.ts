import { describe, expect, mock, test } from "bun:test";

const invoke = mock(async () => ({ version: 1, items: [], lastSelectedId: null }));

mock.module("@tauri-apps/api/core", () => ({
  invoke,
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
    const saved: { items: unknown[]; lastSelectedId: string | null } = {
      items: [],
      lastSelectedId: null,
    };
    invoke.mockImplementation(
      async (
        cmd: string,
        args?: { items?: unknown[]; lastSelectedId?: string | null },
      ) => {
        if (cmd === "save_project_workspace_memos") {
          saved.items = args?.items ?? [];
          saved.lastSelectedId = args?.lastSelectedId ?? null;
          return undefined;
        }
        if (cmd === "list_project_workspace_memos") {
          return { version: 1, items: saved.items, lastSelectedId: saved.lastSelectedId };
        }
        return { version: 1, items: [], lastSelectedId: null };
      },
    );
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
