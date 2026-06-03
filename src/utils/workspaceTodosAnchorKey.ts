/** 侧栏「更多」按钮与待办 Popover 锚点共用的 data-workspace-todos-anchor 值。 */
export function workspaceTodosAnchorKey(
  projectId: string | null,
  repositoryId: number | null,
): string | null {
  if (repositoryId != null) return `repo:${repositoryId}`;
  const pid = projectId?.trim();
  if (pid) return `project:${pid}`;
  return null;
}

export function queryWorkspaceTodosAnchorEl(anchorKey: string | null | undefined): HTMLElement | null {
  if (!anchorKey?.trim()) return null;
  return document.querySelector<HTMLElement>(`[data-workspace-todos-anchor="${anchorKey}"]`);
}
