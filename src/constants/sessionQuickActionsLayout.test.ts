import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  mergeSessionQuickActionsLayout,
  moveLayoutItem,
  parseSessionQuickActionsLayout,
  partitionSessionQuickActions,
  updateLayoutItem,
} from "./sessionQuickActionsLayout";

describe("sessionQuickActionsLayout", () => {
  test("merge keeps user order and fills missing catalog ids", () => {
    const merged = mergeSessionQuickActionsLayout({
      version: 1,
      items: [
        { id: "work-trajectory", visible: true, zone: "primary" },
        { id: "push", visible: false, zone: "primary" },
      ],
    });
    expect(merged.items[0]?.id).toBe("work-trajectory");
    expect(merged.items.some((item) => item.id === "new-session")).toBe(true);
  });

  test("partition respects visibility zone and availability", () => {
    const layout = updateLayoutItem(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, "builtin:word-doc", {
      zone: "primary",
    });
    const { primary, overflow } = partitionSessionQuickActions(layout, {
      canNewSession: false,
      canWorkTree: false,
    });
    expect(primary).toContain("builtin:word-doc");
    expect(primary).not.toContain("new-session");
    expect(overflow).toContain("work-trajectory");
  });

  test("moveLayoutItem swaps neighbors", () => {
    const next = moveLayoutItem(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, "push", "down");
    const index = next.items.findIndex((item) => item.id === "push");
    expect(next.items[index]?.id).toBe("push");
    expect(next.items[index + 1]?.id).toBe("builtin:ppt-deck");
  });

  test("merge migrates legacy requirement-split to builtin:prd-split", () => {
    const merged = parseSessionQuickActionsLayout(
      JSON.stringify({
        version: 1,
        items: [{ id: "requirement-split", visible: false, zone: "overflow" }],
      }),
    );
    const prd = merged.items.find((item) => item.id === "builtin:prd-split");
    expect(prd?.visible).toBe(false);
    expect(prd?.zone).toBe("overflow");
    expect(merged.items.some((item) => (item.id as string) === "requirement-split")).toBe(false);
  });
});
