import { describe, expect, test } from "bun:test";
import {
  clampMonitorPanelVisibleRows,
  monitorPanelContentMaxHeightPx,
  MONITOR_PANEL_VISIBLE_ROWS_DEFAULT,
  normalizeMonitorPanelVisibleRows,
} from "./monitorPanelLayout";

describe("monitorPanelLayout", () => {
  test("normalizeMonitorPanelVisibleRows clamps out-of-range values", () => {
    expect(normalizeMonitorPanelVisibleRows(99)).toBe(12);
    expect(normalizeMonitorPanelVisibleRows(1)).toBe(3);
    expect(normalizeMonitorPanelVisibleRows("8")).toBe(8);
    expect(normalizeMonitorPanelVisibleRows(undefined)).toBe(MONITOR_PANEL_VISIBLE_ROWS_DEFAULT);
  });

  test("monitorPanelContentMaxHeightPx uses row and head constants", () => {
    expect(monitorPanelContentMaxHeightPx(8)).toBe(24 + 22 * 8);
    expect(clampMonitorPanelVisibleRows(8)).toBe(8);
  });
});
