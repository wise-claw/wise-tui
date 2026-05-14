const LEFT_FILES_EXPLORER_COLLAPSED_KEY = "wise.leftPanel.filesExplorerCollapsed";

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
