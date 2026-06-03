export type InspectorSectionId = "quickActions" | "memos" | "todos";

const STORAGE_KEYS: Record<InspectorSectionId, string> = {
  quickActions: "wise.rightPanel.quickActionsCollapsed",
  memos: "wise.rightPanel.memosCollapsed",
  todos: "wise.rightPanel.todosCollapsed",
};

export function readInspectorSectionCollapsedFromStorage(sectionId: InspectorSectionId): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEYS[sectionId]) === "1";
}

export function writeInspectorSectionCollapsedToStorage(
  sectionId: InspectorSectionId,
  collapsed: boolean,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEYS[sectionId], collapsed ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}
