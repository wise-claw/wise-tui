import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT,
  ensurePrdSplitQuickActionPrimary,
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

  test("merge prefers primary when legacy ids collapse to builtin:prd-split", () => {
    const merged = parseSessionQuickActionsLayout(
      JSON.stringify({
        version: 1,
        items: [
          { id: "requirement-split", visible: true, zone: "primary" },
          { id: "builtin:prd-split", visible: true, zone: "overflow" },
        ],
      }),
    );
    const prd = merged.items.find((item) => item.id === "builtin:prd-split");
    expect(prd?.zone).toBe("primary");
  });

  test("ensurePrdSplitQuickActionPrimary promotes 需求 to primary zone", () => {
    const layout = mergeSessionQuickActionsLayout({
      version: 1,
      items: [{ id: "builtin:prd-split", visible: true, zone: "overflow" }],
    });
    const promoted = ensurePrdSplitQuickActionPrimary(layout);
    const { primary } = partitionSessionQuickActions(promoted, {
      canNewSession: true,
      canCompactContext: false,
    });
    expect(primary).toContain("builtin:prd-split");
  });

  test("default layout shows 需求 on primary bar", () => {
    const { primary, overflow } = partitionSessionQuickActions(DEFAULT_SESSION_QUICK_ACTIONS_LAYOUT, {
      canNewSession: true,
      canCompactContext: true,
    });
    expect(primary).toContain("builtin:prd-split");
    expect(primary.indexOf("builtin:prd-split")).toBeGreaterThan(primary.indexOf("new-session"));
    expect(primary.indexOf("push")).toBeGreaterThan(primary.indexOf("builtin:prd-split"));
    expect(overflow).not.toContain("builtin:prd-split");
    expect(primary).not.toContain("compact-context");
    expect(primary).toContain("new-session");
    expect(primary).toContain("push");
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
    const promoted = ensurePrdSplitQuickActionPrimary(merged);
    expect(promoted.items.find((item) => item.id === "builtin:prd-split")?.zone).toBe("primary");
  });
});
