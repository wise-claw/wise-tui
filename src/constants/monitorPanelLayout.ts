/** 左栏运行面板：单行内容区高度（与 `MONITOR_COMPACT_ROW_HEIGHT_PX` 一致）。 */
export const MONITOR_PANEL_ROW_HEIGHT_PX = 22;

/** 运行面板标题栏占用高度（用于计算可视区域 max-height）。 */
export const MONITOR_PANEL_HEAD_HEIGHT_PX = 24;

export const MONITOR_PANEL_VISIBLE_ROWS_MIN = 3;
export const MONITOR_PANEL_VISIBLE_ROWS_MAX = 12;
export const MONITOR_PANEL_VISIBLE_ROWS_DEFAULT = 8;

export const MONITOR_PANEL_VISIBLE_ROWS_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 12] as const;

export type MonitorPanelVisibleRows = (typeof MONITOR_PANEL_VISIBLE_ROWS_OPTIONS)[number];

export function normalizeMonitorPanelVisibleRows(raw: unknown): number {
  const fallback = MONITOR_PANEL_VISIBLE_ROWS_DEFAULT;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed)) {
        return clampMonitorPanelVisibleRows(parsed);
      }
    }
    return fallback;
  }
  return clampMonitorPanelVisibleRows(Math.floor(raw));
}

export function clampMonitorPanelVisibleRows(value: number): number {
  return Math.max(
    MONITOR_PANEL_VISIBLE_ROWS_MIN,
    Math.min(MONITOR_PANEL_VISIBLE_ROWS_MAX, Math.floor(value)),
  );
}

export function monitorPanelContentMaxHeightPx(visibleRows: number): number {
  return (
    MONITOR_PANEL_HEAD_HEIGHT_PX +
    MONITOR_PANEL_ROW_HEIGHT_PX * clampMonitorPanelVisibleRows(visibleRows)
  );
}
