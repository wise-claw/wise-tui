/** 左栏需求列表：单行高度（与 `--app-sidebar-list-row-min-height` 一致）。 */
export const REQUIREMENTS_PANEL_ROW_HEIGHT_PX = 24;

/** 需求列表面板标题栏占用高度（与统一左栏分区头 26px 一致）。 */
export const REQUIREMENTS_PANEL_HEAD_HEIGHT_PX = 26;

export const REQUIREMENTS_PANEL_VISIBLE_ROWS_MIN = 2;
export const REQUIREMENTS_PANEL_VISIBLE_ROWS_MAX = 12;
export const REQUIREMENTS_PANEL_VISIBLE_ROWS_DEFAULT = 6;

export const REQUIREMENTS_PANEL_VISIBLE_ROWS_OPTIONS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 12,
] as const;

export type RequirementsPanelVisibleRows =
  (typeof REQUIREMENTS_PANEL_VISIBLE_ROWS_OPTIONS)[number];

export function clampRequirementsPanelVisibleRows(value: number): number {
  return Math.max(
    REQUIREMENTS_PANEL_VISIBLE_ROWS_MIN,
    Math.min(REQUIREMENTS_PANEL_VISIBLE_ROWS_MAX, Math.floor(value)),
  );
}

export function normalizeRequirementsPanelVisibleRows(raw: unknown): number {
  const fallback = REQUIREMENTS_PANEL_VISIBLE_ROWS_DEFAULT;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed)) {
        return clampRequirementsPanelVisibleRows(parsed);
      }
    }
    return fallback;
  }
  return clampRequirementsPanelVisibleRows(Math.floor(raw));
}

export function requirementsPanelContentMaxHeightPx(visibleRows: number): number {
  return (
    REQUIREMENTS_PANEL_HEAD_HEIGHT_PX +
    REQUIREMENTS_PANEL_ROW_HEIGHT_PX * clampRequirementsPanelVisibleRows(visibleRows)
  );
}
