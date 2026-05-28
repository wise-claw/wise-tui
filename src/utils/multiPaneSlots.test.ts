import { describe, expect, test } from "bun:test";
import type { PaneSlot } from "../constants/mainLayoutWidths";
import {
  findFirstEmptyExtraPaneIndex,
  minPaneCountForOccupiedExtras,
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
});
