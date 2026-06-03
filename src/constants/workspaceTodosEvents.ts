export const WISE_WORKSPACE_TODOS_CHANGED = "wise:workspace-todos-changed";
export const WISE_WORKSPACE_TODOS_OPEN = "wise:workspace-todos-open";

export type WorkspaceTodosOpenSurface = "popover" | "modal";

export interface WorkspaceTodosOpenDetail {
  projectId: string | null;
  repositoryId: number | null;
  focusAdd?: boolean;
  /** 侧栏「更多」菜单用 modal；待办徽章用 popover */
  surface?: WorkspaceTodosOpenSurface;
  /** 优先用 data-workspace-todos-anchor 解析锚点（菜单打开待办） */
  anchorKey?: string | null;
  anchorEl?: HTMLElement | null;
}

export function dispatchWorkspaceTodosChanged(detail?: {
  projectId?: string | null;
  repositoryId?: number | null;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_WORKSPACE_TODOS_CHANGED, { detail }));
}

export function dispatchWorkspaceTodosOpen(detail: WorkspaceTodosOpenDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkspaceTodosOpenDetail>(WISE_WORKSPACE_TODOS_OPEN, { detail }));
}
