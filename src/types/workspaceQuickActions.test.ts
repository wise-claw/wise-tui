import { describe, expect, test } from "bun:test";
import {
  filterWorkspaceQuickActionsForTopbar,
  parseWorkspaceQuickActionsPayload,
  resolveWorkspaceQuickActionPinnedToTopbar,
  type WorkspaceQuickActionDisplayItem,
} from "./workspaceQuickActions";

describe("workspaceQuickActions pinnedToTopbar", () => {
  test("resolveWorkspaceQuickActionPinnedToTopbar defaults to false", () => {
    expect(resolveWorkspaceQuickActionPinnedToTopbar({})).toBe(false);
    expect(resolveWorkspaceQuickActionPinnedToTopbar({ pinnedToTopbar: true })).toBe(true);
  });

  test("parse preserves pinnedToTopbar when true", () => {
    const payload = parseWorkspaceQuickActionsPayload(
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "a1",
            kind: "link",
            label: "Docs",
            target: "https://example.com",
            pinnedToTopbar: true,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    expect(payload.items[0]?.pinnedToTopbar).toBe(true);
  });

  test("filterWorkspaceQuickActionsForTopbar keeps pinned items only", () => {
    const items: WorkspaceQuickActionDisplayItem[] = [
      {
        id: "a",
        kind: "link",
        label: "Pinned",
        target: "https://a.com",
        pinnedToTopbar: true,
        createdAt: 1,
        updatedAt: 2,
        scope: "repository",
      },
      {
        id: "b",
        kind: "directory",
        label: "Local",
        target: "/tmp",
        createdAt: 1,
        updatedAt: 2,
        scope: "project",
      },
    ];
    const pinned = filterWorkspaceQuickActionsForTopbar(items);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]?.label).toBe("Pinned");
  });
});
