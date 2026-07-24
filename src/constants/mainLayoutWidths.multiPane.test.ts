import { describe, expect, test } from "bun:test";
import {
  clampMinWindowWidthToMonitor,
  computeMainWindowMinLogicalWidth,
  computeMinLogicalCenterWidthForPaneCount,
  computeMultiPaneTargetWindowWidth,
  computeRestoreMultiPaneLogicalWidth,
  MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX,
  MAIN_LAYOUT_LEFT_SIDER_WIDTH_PX,
  MAIN_LAYOUT_MONITOR_WIDTH_MARGIN_PX,
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

  test("multi-pane keeps the same center minimum as single pane (no window grow on switch)", () => {
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
        MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX +
        MAIN_LAYOUT_RIGHT_SIDER_WIDTH_PX +
        MAIN_LAYOUT_RESIZE_HANDLE_PX * 2,
    );
    expect(
      computeMainWindowMinLogicalWidth({
        paneCount: 8,
        leftCollapsed: true,
        rightCollapsed: true,
      }),
    ).toBe(MAIN_LAYOUT_CENTER_MIN_WIDTH_WHILE_RESIZE_PX);
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

describe("computeMultiPaneTargetWindowWidth", () => {
  test("monitor 为 null 时不 clamp，按理想值扩展", () => {
    const r = computeMultiPaneTargetWindowWidth({
      currentInnerWidth: 1280,
      idealWidth: 1702,
      monitorLogicalWidth: null,
    });
    expect(r.targetWidth).toBe(1702);
    expect(r.clampedByMonitor).toBe(false);
  });

  test("屏幕够宽时按理想值扩展，clamped=false", () => {
    // idealWidth 1702，屏幕 1920 -> maxByMonitor = 1904，1702 ≤ 1904
    const r = computeMultiPaneTargetWindowWidth({
      currentInnerWidth: 1280,
      idealWidth: 1702,
      monitorLogicalWidth: 1920,
    });
    expect(r.targetWidth).toBe(1702);
    expect(r.clampedByMonitor).toBe(false);
  });

  test("屏幕不够时压到屏幕上限，clamped=true", () => {
    // idealWidth 1702，屏幕 1440 -> maxByMonitor = 1424，1702 > 1424
    const r = computeMultiPaneTargetWindowWidth({
      currentInnerWidth: 1280,
      idealWidth: 1702,
      monitorLogicalWidth: 1440,
    });
    expect(r.targetWidth).toBe(1424);
    expect(r.clampedByMonitor).toBe(true);
  });

  test("当前窗口已宽于理想值时不扩展，clamped=false", () => {
    // currentInnerWidth 1800 > idealWidth 1702，屏幕 1920 -> target = max(1800, 1702) = 1800
    const r = computeMultiPaneTargetWindowWidth({
      currentInnerWidth: 1800,
      idealWidth: 1702,
      monitorLogicalWidth: 1920,
    });
    expect(r.targetWidth).toBe(1800);
    expect(r.clampedByMonitor).toBe(false);
  });

  test("屏幕不够且当前窗口已宽于屏幕上限时保持当前宽度，clamped=true", () => {
    // currentInnerWidth 1500，maxByMonitor 1424 -> target = max(1500, 1424) = 1500
    const r = computeMultiPaneTargetWindowWidth({
      currentInnerWidth: 1500,
      idealWidth: 1702,
      monitorLogicalWidth: 1440,
    });
    expect(r.targetWidth).toBe(1500);
    expect(r.clampedByMonitor).toBe(true);
  });

  test("maxByMonitor 不低于 320 兜底", () => {
    // 屏幕 200 -> maxByMonitor = max(320, 200-16) = 320
    const r = computeMultiPaneTargetWindowWidth({
      currentInnerWidth: 300,
      idealWidth: 1000,
      monitorLogicalWidth: 200,
    });
    expect(r.targetWidth).toBe(320);
    expect(r.clampedByMonitor).toBe(true);
  });
});

describe("clampMinWindowWidthToMonitor", () => {
  test("monitor 为 null 时原样返回", () => {
    expect(clampMinWindowWidthToMonitor(1411, null)).toBe(1411);
  });

  test("minWidth 不超过屏幕上限时原样返回", () => {
    // 屏幕 1920 -> maxByMonitor 1904，minWidth 1411 ≤ 1904
    expect(clampMinWindowWidthToMonitor(1411, 1920)).toBe(1411);
  });

  test("minWidth 超过屏幕上限时压到屏幕上限", () => {
    // 8 屏理论最小 2253，屏幕 1440 -> maxByMonitor 1424
    expect(clampMinWindowWidthToMonitor(2253, 1440)).toBe(1424);
  });

  test("maxByMonitor 不低于 320 兜底", () => {
    expect(clampMinWindowWidthToMonitor(2253, 200)).toBe(320);
  });

  test("自定义 marginPx", () => {
    // minWidth 1411，屏幕 1440，margin 100 -> maxByMonitor 1340
    expect(clampMinWindowWidthToMonitor(1411, 1440, 100)).toBe(1340);
  });
});

describe("computeRestoreMultiPaneLogicalWidth (monitor clamp)", () => {
  test("传入 monitor 时目标宽度受屏幕上限约束", () => {
    const withoutMonitor = computeRestoreMultiPaneLogicalWidth(8, 1000);
    const withMonitor = computeRestoreMultiPaneLogicalWidth(8, 1000, undefined, 1440);
    expect(withoutMonitor).not.toBeNull();
    expect(withMonitor).not.toBeNull();
    expect(withMonitor!).toBeLessThanOrEqual(1440 - MAIN_LAYOUT_MONITOR_WIDTH_MARGIN_PX);
    expect(withMonitor!).toBeLessThan(withoutMonitor!);
  });

  test("monitor 为 null 时与不传行为一致", () => {
    expect(computeRestoreMultiPaneLogicalWidth(4, 900, undefined, null))
      .toBe(computeRestoreMultiPaneLogicalWidth(4, 900));
  });
});
