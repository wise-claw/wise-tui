export const LEFT_SIDEBAR_SECTION_DND_MIME = "application/x-wise-left-sidebar-section";

export const LEFT_SIDEBAR_SECTION_DRAG_HANDLE_SELECTOR = [
  ":scope > .app-repository-header",
  ":scope > .app-left-sidebar-workspace-list-collapsed-row",
  ":scope > .app-left-sidebar-requirements-panel > .app-repository-header",
  ":scope > .app-left-sidebar-monitor-panel .app-monitor-panel__head",
  ":scope > .app-left-sidebar-bottom-tabs .app-left-sidebar-repo-panel-header",
  ":scope > .app-left-sidebar-bottom-tabs .git-panel-header",
  ":scope > .app-left-sidebar-bottom-tabs .git-files-explorer-bar",
].join(", ");

/** 标题栏里的真实控件：按下时不要开启 HTML5 分区拖拽，避免 WKWebView 把 click 吃成 drag。 */
export const LEFT_SIDEBAR_SECTION_DRAG_INTERACTIVE_CLOSEST = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "option",
  "summary",
  "[role='button']",
  "[role='textbox']",
  "[role='combobox']",
  "[role='slider']",
  "[contenteditable='true']",
  ".app-repository-header-btn",
  ".ant-btn",
  ".ant-input",
  ".ant-select",
  ".ant-dropdown-trigger",
  ".git-commit-card",
  ".app-monitor-panel__head-actions",
  ".app-monitor-panel__head-end",
].join(", ");

export function isInteractiveLeftSidebarSectionDragTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest(LEFT_SIDEBAR_SECTION_DRAG_INTERACTIVE_CLOSEST));
}

export function hasLeftSidebarSectionDragPayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(LEFT_SIDEBAR_SECTION_DND_MIME);
}

export function queryLeftSidebarSectionDragHandles(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(LEFT_SIDEBAR_SECTION_DRAG_HANDLE_SELECTOR));
}

export function sameDragHandleSet(prev: readonly HTMLElement[], next: readonly HTMLElement[]): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((el, index) => el === next[index]);
}
