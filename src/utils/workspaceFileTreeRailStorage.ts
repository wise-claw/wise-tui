const WORKSPACE_FILE_TREE_RAIL_OPEN_KEY = "wise.mainLayout.workspaceFileTreeRailOpen";
const WORKSPACE_FILE_TREE_RAIL_WIDTH_KEY = "wise.mainLayout.workspaceFileTreeRailWidthPx.v1";

export const WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX = 260;
export const WORKSPACE_FILE_TREE_RAIL_MIN_WIDTH_PX = 180;
export const WORKSPACE_FILE_TREE_RAIL_MAX_WIDTH_PX = 480;

export function readWorkspaceFileTreeRailOpenFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WORKSPACE_FILE_TREE_RAIL_OPEN_KEY) === "1";
}

export function writeWorkspaceFileTreeRailOpenToStorage(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WORKSPACE_FILE_TREE_RAIL_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readWorkspaceFileTreeRailWidthFromStorage(): number {
  if (typeof window === "undefined") {
    return WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_FILE_TREE_RAIL_WIDTH_KEY);
    if (raw == null) return WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
    return clampWorkspaceFileTreeRailWidthPx(parsed);
  } catch {
    return WORKSPACE_FILE_TREE_RAIL_DEFAULT_WIDTH_PX;
  }
}

export function writeWorkspaceFileTreeRailWidthToStorage(widthPx: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      WORKSPACE_FILE_TREE_RAIL_WIDTH_KEY,
      String(clampWorkspaceFileTreeRailWidthPx(widthPx)),
    );
  } catch {
    /* ignore */
  }
}

export function clampWorkspaceFileTreeRailWidthPx(width: number): number {
  return Math.min(
    WORKSPACE_FILE_TREE_RAIL_MAX_WIDTH_PX,
    Math.max(WORKSPACE_FILE_TREE_RAIL_MIN_WIDTH_PX, Math.round(width)),
  );
}
