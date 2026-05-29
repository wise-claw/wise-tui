export const WISE_WORKSPACE_TODOS_CHANGED = "wise:workspace-todos-changed";

export function dispatchWorkspaceTodosChanged(detail?: {
  projectId?: string | null;
  repositoryId?: number | null;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISE_WORKSPACE_TODOS_CHANGED, { detail }));
}
