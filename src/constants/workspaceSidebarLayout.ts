/** 工作区展开子树：默认展示行数（终端/派发/工作流 + 会话合计，不含 More）。 */
export const WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_MIN = 2;
export const WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_MAX = 10;
export const WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT = 3;

export const WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_OPTIONS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10,
] as const;

export type WorkspaceSidebarRowPreviewLimit =
  (typeof WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_OPTIONS)[number];

export function clampWorkspaceSidebarRowPreviewLimit(value: number): number {
  return Math.max(
    WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_MIN,
    Math.min(WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_MAX, Math.floor(value)),
  );
}

export function normalizeWorkspaceSidebarRowPreviewLimit(raw: unknown): number {
  const fallback = WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isFinite(parsed)) {
        return clampWorkspaceSidebarRowPreviewLimit(parsed);
      }
    }
    return fallback;
  }
  return clampWorkspaceSidebarRowPreviewLimit(raw);
}
