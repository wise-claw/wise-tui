import { describe, expect, test } from "bun:test";
import {
  computeMinLogicalCenterWidthForPaneCount,
  computeRestoreMultiPaneLogicalWidth,
  MAIN_LAYOUT_MULTI_PANE_RESTORE_SIDE_GUTTER_PX,
  MAIN_LAYOUT_MULTI_PANE_UNIT_PX,
} from "./mainLayoutWidths";

describe("computeRestoreMultiPaneLogicalWidth", () => {
  test("returns null for single pane", () => {
    expect(computeRestoreMultiPaneLogicalWidth(1, 800)).toBeNull();
  });

  test("returns null when inner width already fits grid minimum", () => {
    const minCenter = computeMinLogicalCenterWidthForPaneCount(4);
    const wideEnough = minCenter + MAIN_LAYOUT_MULTI_PANE_RESTORE_SIDE_GUTTER_PX;
    expect(computeRestoreMultiPaneLogicalWidth(4, wideEnough)).toBeNull();
    expect(computeRestoreMultiPaneLogicalWidth(4, wideEnough + 200)).toBeNull();
  });

  test("expands narrow window to at least needed width for 2-pane", () => {
    const target = computeRestoreMultiPaneLogicalWidth(2, 900);
    expect(target).not.toBeNull();
    const minCenter = computeMinLogicalCenterWidthForPaneCount(2);
    const needed = minCenter + MAIN_LAYOUT_MULTI_PANE_RESTORE_SIDE_GUTTER_PX;
    expect(target!).toBeGreaterThanOrEqual(needed);
    expect(target!).toBeGreaterThanOrEqual(900 + MAIN_LAYOUT_MULTI_PANE_UNIT_PX);
  });

  test("8-pane narrow window gets larger target width than 4-pane", () => {
    const inner = 1000;
    const w4 = computeRestoreMultiPaneLogicalWidth(4, inner);
    const w8 = computeRestoreMultiPaneLogicalWidth(8, inner);
    expect(w4).not.toBeNull();
    expect(w8).not.toBeNull();
    expect(w8!).toBeGreaterThan(w4!);
  });
});
