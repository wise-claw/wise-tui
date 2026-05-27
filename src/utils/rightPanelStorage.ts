export const RIGHT_PANEL_DEFAULT_COLLAPSED_KEY = "wise.rightPanel.defaultCollapsed";

/** `true` = 启动时默认收起右侧面板；`false` = 默认展开。 */
export const RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK = true;

export function readRightPanelDefaultCollapsedFromStorage(
  fallback: boolean = RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

/** @deprecated 请使用 `saveRightPanelDefaultCollapsed`（`app_settings`）。保留供测试与一次性迁移读取。 */
export function writeRightPanelDefaultCollapsedToStorage(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}
