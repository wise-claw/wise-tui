export const WISE_WORKSPACE_REPOSITORY_SYNC_REQUESTED = "wise:workspace-repository-sync-requested";

export function requestWorkspaceRepositorySync(projectId: string): void {
  // Defer until parent effects have installed their listeners on initial mount.
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(WISE_WORKSPACE_REPOSITORY_SYNC_REQUESTED, {
      detail: { projectId },
    }));
  }, 0);
}
