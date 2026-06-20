import { describe, expect, test } from "bun:test";
import {
  computeMainWindowMinLogicalWidth,
  computeMinLogicalCenterWidthForPaneCount,
  computeRestoreMultiPaneLogicalWidth,
  MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX,
  MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  MAIN_LAYOUT_MULTI_PANE_RESTORE_SIDE_GUTTER_PX,
  MAIN_LAYOUT_MULTI_PANE_UNIT_PX,
  MAIN_LAYOUT_RESIZE_HANDLE_PX,
  MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
} from "./mainLayoutWidths";

describe("computeMainWindowMinLogicalWidth", () => {
  test("single pane uses center resize minimum and persisted sider widths", () => {
    expect(
      computeMainWindowMinLogicalWidth({
        paneCount: 1,
        leftCollapsed: false,
        rightCollapsed: false,
        leftWidthPx: 280,
        rightWidthPx: 320,
      }),
    ).toBe(
      280 +
        MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX +
        320 +
        MAIN_LAYOUT_RESIZE_HANDLE_PX * 2,
    );
  });

  test("collapsed sidebars omit width and resize handles", () => {
    expect(
      computeMainWindowMinLogicalWidth({
        paneCount: 1,
        leftCollapsed: true,
        rightCollapsed: true,
      }),
    ).toBe(MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX);
  });

  test("multi-pane uses grid minimum center width", () => {
    const minCenter = computeMinLogicalCenterWidthForPaneCount(4);
    expect(
      computeMainWindowMinLogicalWidth({
        paneCount: 4,
        leftCollapsed: false,
        rightCollapsed: false,
        leftWidthPx: MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
        rightWidthPx: MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX,
      }),
    ).toBe(
      MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX +
        minCenter +
        MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX +
        MAIN_LAYOUT_RESIZE_HANDLE_PX * 2,
    );
  });
});

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
