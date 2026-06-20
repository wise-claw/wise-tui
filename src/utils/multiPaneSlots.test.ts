import { describe, expect, test } from "bun:test";
import type { PaneSlot } from "../constants/mainLayoutWidths";
import {
  assignSessionToNormalizedExtraPanes,
  findFirstEmptyExtraPaneIndex,
  isSessionBoundInPanes,
  minPaneCountForOccupiedExtras,
  normalizeExtraPanesToPaneCount,
  planNextPaneSlotPlacement,
} from "./multiPaneSlots";

function slot(partial: Partial<PaneSlot> & { slotId: string }): PaneSlot {
  return {
    sessionId: null,
    repositoryId: null,
    ...partial,
  };
}

describe("multiPaneSlots", () => {
  test("minPaneCountForOccupiedExtras follows 1/2/4/6/8 grid tiers", () => {
    expect(minPaneCountForOccupiedExtras(0)).toBe(1);
    expect(minPaneCountForOccupiedExtras(1)).toBe(2);
    expect(minPaneCountForOccupiedExtras(2)).toBe(4);
    expect(minPaneCountForOccupiedExtras(3)).toBe(4);
    expect(minPaneCountForOccupiedExtras(5)).toBe(6);
    expect(minPaneCountForOccupiedExtras(7)).toBe(8);
  });

  test("third pane in 4-grid targets bottom-left extra slot (index 1)", () => {
    const extraPanes: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1", repositoryId: 1 }),
      slot({ slotId: "b" }),
      slot({ slotId: "c" }),
    ];
    expect(findFirstEmptyExtraPaneIndex(extraPanes)).toBe(1);
    const plan = planNextPaneSlotPlacement({
      paneCount: 4,
      extraPanes,
      createSlot: () => slot({ slotId: "new" }),
    });
    expect(plan.nextPaneCount).toBe(4);
    expect(plan.slotIndex).toBe(1);
  });

  test("normalizeExtraPanesToPaneCount pads and truncates slots", () => {
    const slots: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1" }),
      slot({ slotId: "b" }),
      slot({ slotId: "c" }),
    ];
    const padded = normalizeExtraPanesToPaneCount(4, slots.slice(0, 1), () => slot({ slotId: "new" }));
    expect(padded).toHaveLength(3);
    expect(padded[0]?.sessionId).toBe("s1");
    expect(padded[1]?.slotId).toBe("new");

    const truncated = normalizeExtraPanesToPaneCount(2, slots, () => slot({ slotId: "x" }));
    expect(truncated).toHaveLength(1);
    expect(truncated[0]?.sessionId).toBe("s1");
  });

  test("isSessionBoundInPanes detects active and extra pane collisions", () => {
    const extras: PaneSlot[] = [slot({ slotId: "a", sessionId: "s-extra" })];
    expect(isSessionBoundInPanes("s-main", "s-main", extras)).toBe(true);
    expect(isSessionBoundInPanes("s-extra", "s-main", extras)).toBe(true);
    expect(isSessionBoundInPanes("s-extra", "s-main", extras, 0)).toBe(false);
    expect(isSessionBoundInPanes("s-free", "s-main", extras)).toBe(false);
  });

  test("assignSessionToNormalizedExtraPanes prefers first empty slot in row-major grid", () => {
    const extraPanes: PaneSlot[] = [
      slot({ slotId: "a", sessionId: "s1", repositoryId: 1 }),
      slot({ slotId: "b" }),
      slot({ slotId: "c" }),
    ];
    const next = assignSessionToNormalizedExtraPanes(4, extraPanes, "s-new", () => slot({ slotId: "x" }), 2);
    expect(next).toHaveLength(3);
    expect(next[1]?.sessionId).toBe("s-new");
    expect(next[1]?.executionEngine).toBeUndefined();
    expect(next[2]?.sessionId).toBeNull();
  });

  test("assignSessionToNormalizedExtraPanes clears stale slot runtime when primary unset", () => {
    const extraPanes: PaneSlot[] = [
      slot({ slotId: "a", executionEngine: "codex", claudeProxyRoute: undefined }),
    ];
    const next = assignSessionToNormalizedExtraPanes(
      2,
      extraPanes,
      "s-new",
      () => slot({ slotId: "x" }),
      0,
      null,
    );
    expect(next[0]?.executionEngine).toBeUndefined();
    expect(next[0]?.claudeProxyRoute).toBeUndefined();
  });

  test("assignSessionToNormalizedExtraPanes inherits primary pane runtime", () => {
    const extraPanes: PaneSlot[] = [slot({ slotId: "a" }), slot({ slotId: "b" })];
    const next = assignSessionToNormalizedExtraPanes(
      2,
      extraPanes,
      "s-new",
      () => slot({ slotId: "x" }),
      0,
      { executionEngine: "codex" },
    );
    expect(next[0]?.executionEngine).toBe("codex");
  });

  test("assignSessionToNormalizedExtraPanes pads slots when paneCount increases", () => {
    const next = assignSessionToNormalizedExtraPanes(
      4,
      [slot({ slotId: "a", sessionId: "s1" })],
      "s2",
      () => slot({ slotId: "new" }),
      0,
    );
    expect(next).toHaveLength(3);
    expect(next.filter((row) => row.sessionId === "s2")).toHaveLength(1);
  });
});
