const LEFT_FILES_EXPLORER_COLLAPSED_KEY = "wise.leftPanel.filesExplorerCollapsed";
const LEFT_BOTTOM_TAB_KEY = "wise.leftPanel.bottomTab";

export function readLeftFilesExplorerCollapsedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(LEFT_FILES_EXPLORER_COLLAPSED_KEY) === "1";
}

export function writeLeftFilesExplorerCollapsedToStorage(collapsed: boolean): void {
  try {
    window.localStorage.setItem(LEFT_FILES_EXPLORER_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export type LeftBottomTab = "git" | "files";

export function readLeftBottomTabFromStorage(): LeftBottomTab {
  if (typeof window === "undefined") return "git";
  const stored = window.localStorage.getItem(LEFT_BOTTOM_TAB_KEY);
  if (stored === "files") return "files";
  return "git";
}

export function writeLeftBottomTabToStorage(tab: LeftBottomTab): void {
  try {
    window.localStorage.setItem(LEFT_BOTTOM_TAB_KEY, tab);
  } catch {
    /* ignore quota / private mode */
  }
}
