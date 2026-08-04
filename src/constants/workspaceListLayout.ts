/** 左栏工作区树：单行高度（与 `--app-sidebar-list-row-min-height` 一致）。 */
export const WORKSPACE_LIST_ROW_HEIGHT_PX = 28;

/** `0` = 不限制高度（与文件树并存时也不封顶）。 */
export const WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED = 0;
export const WORKSPACE_LIST_VISIBLE_ROWS_MIN = 2;
export const WORKSPACE_LIST_VISIBLE_ROWS_MAX = 12;
export const WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT = 8;

export const WORKSPACE_LIST_VISIBLE_ROWS_OPTIONS = [
  WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  12,
] as const;

export type WorkspaceListVisibleRows = (typeof WORKSPACE_LIST_VISIBLE_ROWS_OPTIONS)[number];

export function isWorkspaceListVisibleRowsUnlimited(value: number): boolean {
  return value === WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED;
}

export function clampWorkspaceListVisibleRows(value: number): number {
  if (isWorkspaceListVisibleRowsUnlimited(value)) {
    return WORKSPACE_LIST_VISIBLE_ROWS_UNLIMITED;
  }
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

/** 有限行数时的内容区最大高度；不限时返回 `null`。 */
export function workspaceListContentMaxHeightPx(visibleRows: number): number | null {
  if (isWorkspaceListVisibleRowsUnlimited(visibleRows)) {
    return null;
  }
  return WORKSPACE_LIST_ROW_HEIGHT_PX * clampWorkspaceListVisibleRows(visibleRows);
}

export function formatWorkspaceListVisibleRowsLabel(rows: number): string {
  return isWorkspaceListVisibleRowsUnlimited(rows) ? "不限" : `${rows}`;
}
