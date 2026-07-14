/** 左栏工作区树：单行高度（与 `--app-sidebar-list-row-min-height` 一致）。 */
export const WORKSPACE_LIST_ROW_HEIGHT_PX = 24;

export const WORKSPACE_LIST_VISIBLE_ROWS_MIN = 3;
export const WORKSPACE_LIST_VISIBLE_ROWS_MAX = 12;
export const WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT = 8;

export const WORKSPACE_LIST_VISIBLE_ROWS_OPTIONS = [4, 5, 6, 7, 8, 9, 10, 12] as const;

export type WorkspaceListVisibleRows = (typeof WORKSPACE_LIST_VISIBLE_ROWS_OPTIONS)[number];

export function clampWorkspaceListVisibleRows(value: number): number {
  return Math.max(
    WORKSPACE_LIST_VISIBLE_ROWS_MIN,
    Math.min(WORKSPACE_LIST_VISIBLE_ROWS_MAX, Math.floor(value)),
  );
}

export function normalizeWorkspaceListVisibleRows(raw: unknown): number {
  const fallback = WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed)) {
        return clampWorkspaceListVisibleRows(parsed);
      }
    }
    return fallback;
  }
  return clampWorkspaceListVisibleRows(raw);
}

export function workspaceListContentMaxHeightPx(visibleRows: number): number {
  return WORKSPACE_LIST_ROW_HEIGHT_PX * clampWorkspaceListVisibleRows(visibleRows);
}
