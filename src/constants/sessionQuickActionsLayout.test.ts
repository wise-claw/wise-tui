import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  mergeSessionQuickActionsLayout,
  moveLayoutItem,
  partitionSessionQuickActions,
  updateLayoutItem,
} from "./sessionQuickActionsLayout";

describe("sessionQuickActionsLayout", () => {
  test("merge keeps user order and fills missing catalog ids", () => {
    const merged = mergeSessionQuickActionsLayout({
      version: 1,
      items: [
        { id: "compact-context", visible: true, zone: "primary" },
        { id: "push", visible: false, zone: "primary" },
      ],
    });
    expect(merged.items[0]?.id).toBe("compact-context");
    expect(merged.items.some((item) => item.id === "new-session")).toBe(true);
  });

  test("partition respects visibility zone and availability", () => {
    const layout = updateLayoutItem(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, "push", {
      zone: "overflow",
    });
    const { primary, overflow } = partitionSessionQuickActions(layout, {
      canNewSession: false,
      canCompactContext: true,
    });
    expect(overflow).toContain("push");
    expect(primary).not.toContain("new-session");
    expect(primary).not.toContain("push");
  });

  test("moveLayoutItem swaps neighbors", () => {
    const next = moveLayoutItem(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, "push", "down");
    const index = next.items.findIndex((item) => item.id === "push");
    expect(next.items[index]?.id).toBe("push");
    expect(next.items[index - 1]?.id).toBe("compact-context");
  });
});
