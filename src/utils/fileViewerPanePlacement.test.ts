import { describe, expect, test } from "bun:test";
import type { PaneSlot } from "../constants/mainLayoutWidths";
import { planFileViewerPaneIndex } from "./fileViewerPanePlacement";

function slot(sessionId: string | null = null): PaneSlot {
  return { slotId: `s-${sessionId ?? "empty"}`, sessionId, repositoryId: null };
}

describe("planFileViewerPaneIndex", () => {
  test("single pane expands to dual with target on extra pane", () => {
    expect(
      planFileViewerPaneIndex({
        paneCount: 1,
        extraPanes: [],
        createSlot: () => slot(),
      }),
    ).toEqual({ targetPaneIndex: 1, nextPaneCount: 2 });
  });

  test("reuses first empty extra pane", () => {
    expect(
      planFileViewerPaneIndex({
        paneCount: 4,
        extraPanes: [slot("a"), slot(), slot("c")],
        createSlot: () => slot(),
      }),
    ).toEqual({ targetPaneIndex: 2, nextPaneCount: 4 });
  });

  test("expands when all extra panes occupied", () => {
    const result = planFileViewerPaneIndex({
      paneCount: 2,
      extraPanes: [slot("only")],
      createSlot: () => slot(),
    });
    expect(result.nextPaneCount).toBeGreaterThan(2);
    expect(result.targetPaneIndex).toBeGreaterThanOrEqual(1);
  });
});
