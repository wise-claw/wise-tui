export const WISE_WORKSPACE_TODOS_CHANGED = "wise:workspace-todos-changed";
export const WISE_WORKSPACE_TODOS_OPEN = "wise:workspace-todos-open";

export type WorkspaceTodosOpenSurface = "popover" | "modal";

export interface WorkspaceTodosOpenDetail {
  focusAdd?: boolean;
  /** 侧栏「更多」菜单用 modal；待办徽章用 popover */
  surface?: WorkspaceTodosOpenSurface;
  anchorEl?: HTMLElement | null;
}

export function dispatchWorkspaceTodosChanged(detail?: {
  /** 已知未完成条数时可直接更新角标，跳过 IPC 重载 */
  incompleteCount?: number;
  /** 为 false 时列表保持本地乐观状态；为 true 时从持久化层重载（如侧栏弹窗已写入）。 */
  reloadItems?: boolean;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_WORKSPACE_TODOS_CHANGED, { detail }));
}

export function dispatchWorkspaceTodosOpen(detail: WorkspaceTodosOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkspaceTodosOpenDetail>(WISE_WORKSPACE_TODOS_OPEN, { detail }));
}
