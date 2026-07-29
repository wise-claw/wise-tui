import { describe, expect, test } from "bun:test";
import {
  collectWorkspaceQuickActionCategories,
  filterWorkspaceQuickActionsForTopbar,
  groupWorkspaceQuickActionsByCategory,
  normalizeWorkspaceQuickActionCategory,
  parseWorkspaceQuickActionsPayload,
  resolveWorkspaceQuickActionCategoryLabel,
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
        scopeId: "1",
      },
      {
        id: "b",
        kind: "directory",
        label: "Local",
        target: "/tmp",
        createdAt: 1,
        updatedAt: 2,
        scope: "project",
        scopeId: "ws-1",
      },
    ];
    const pinned = filterWorkspaceQuickActionsForTopbar(items);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]?.label).toBe("Pinned");
  });
});

describe("workspaceQuickActions category", () => {
  test("parse preserves and trims category", () => {
    const payload = parseWorkspaceQuickActionsPayload(
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "a1",
            kind: "link",
            label: "Docs",
            target: "https://example.com",
            category: "  文档  ",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    expect(payload.items[0]?.category).toBe("文档");
  });

  test("parse omits empty category", () => {
    const payload = parseWorkspaceQuickActionsPayload(
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "a1",
            kind: "link",
            label: "Docs",
            target: "https://example.com",
            category: "   ",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      }),
    );
    expect(payload.items[0]?.category).toBeUndefined();
  });

  test("normalizeWorkspaceQuickActionCategory clamps length", () => {
    expect(normalizeWorkspaceQuickActionCategory("a".repeat(50))).toHaveLength(40);
  });

  test("resolveWorkspaceQuickActionCategoryLabel falls back to 未分类", () => {
    expect(resolveWorkspaceQuickActionCategoryLabel({})).toBe("未分类");
    expect(resolveWorkspaceQuickActionCategoryLabel({ category: "工具" })).toBe("工具");
  });

  test("groupWorkspaceQuickActionsByCategory groups and puts uncategorized last", () => {
    const items: WorkspaceQuickActionDisplayItem[] = [
      {
        id: "u1",
        kind: "link",
        label: "No cat",
        target: "https://u.com",
        createdAt: 4,
        updatedAt: 40,
        scope: "repository",
        scopeId: "10",
      },
      {
        id: "t1",
        kind: "link",
        label: "Tool A",
        target: "https://a.com",
        category: "工具",
        createdAt: 3,
        updatedAt: 30,
        scope: "repository",
        scopeId: "10",
      },
      {
        id: "d1",
        kind: "link",
        label: "Doc",
        target: "https://d.com",
        category: "文档",
        createdAt: 2,
        updatedAt: 20,
        scope: "project",
        scopeId: "ws-1",
      },
      {
        id: "t2",
        kind: "directory",
        label: "Tool B",
        target: "/tmp",
        category: " 工具 ",
        createdAt: 1,
        updatedAt: 10,
        scope: "repository",
        scopeId: "20",
      },
    ];
    const groups = groupWorkspaceQuickActionsByCategory(items);
    expect(groups.map((g) => g.label)).toEqual(["工具", "文档", "未分类"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["t1", "t2"]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(["d1"]);
    expect(groups[2]?.items.map((i) => i.id)).toEqual(["u1"]);
  });

  test("collectWorkspaceQuickActionCategories dedupes and sorts", () => {
    expect(
      collectWorkspaceQuickActionCategories([
        { category: "文档" },
        { category: "工具" },
        { category: " 文档 " },
        { category: "" },
        {},
      ]),
    ).toEqual(["工具", "文档"]);
  });
});
