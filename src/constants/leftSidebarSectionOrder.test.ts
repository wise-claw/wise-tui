import { describe, expect, test } from "bun:test";
import {
  LEFT_SIDEBAR_SECTION_ORDER_DEFAULT,
  moveLeftSidebarSectionAfter,
  moveLeftSidebarSectionBefore,
  normalizeLeftSidebarSectionOrder,
  reorderLeftSidebarSectionByDrop,
} from "./leftSidebarSectionOrder";

describe("leftSidebarSectionOrder", () => {
  test("normalize fills missing and drops unknown", () => {
    expect(normalizeLeftSidebarSectionOrder(["requirements", "nope", "workspace"])).toEqual([
      "requirements",
      "workspace",
      "repoPanel",
      "monitor",
    ]);
  });

  test("normalize falls back to default", () => {
    expect(normalizeLeftSidebarSectionOrder(null)).toEqual([...LEFT_SIDEBAR_SECTION_ORDER_DEFAULT]);
  });

  test("move before / after", () => {
    const base = ["workspace", "requirements", "repoPanel", "monitor"] as const;
    expect(moveLeftSidebarSectionBefore(base, "repoPanel", "workspace")).toEqual([
      "repoPanel",
      "workspace",
      "requirements",
      "monitor",
    ]);
    expect(moveLeftSidebarSectionAfter(base, "workspace", "requirements")).toEqual([
      "requirements",
      "workspace",
      "repoPanel",
      "monitor",
    ]);
  });

  test("reorder by drop half", () => {
    const base = ["workspace", "requirements", "repoPanel", "monitor"] as const;
    expect(reorderLeftSidebarSectionByDrop(base, "workspace", "repoPanel", false)).toEqual([
      "requirements",
      "workspace",
      "repoPanel",
      "monitor",
    ]);
    expect(reorderLeftSidebarSectionByDrop(base, "workspace", "repoPanel", true)).toEqual([
      "requirements",
      "repoPanel",
      "workspace",
      "monitor",
    ]);
  });
});
