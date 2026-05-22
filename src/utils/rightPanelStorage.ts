export const RIGHT_PANEL_DEFAULT_COLLAPSED_KEY = "wise.rightPanel.defaultCollapsed";

/** `false` = 启动时默认展开右侧面板。 */
export const RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK = false;

export function readRightPanelDefaultCollapsedFromStorage(
  fallback: boolean = RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK,
): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY);
  if (raw === null) return fallback;
  return raw === "1" || raw === "true";
}

export function writeRightPanelDefaultCollapsedToStorage(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_PANEL_DEFAULT_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}
