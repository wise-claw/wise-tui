import { useCallback, useSyncExternalStore } from "react";
import {
  getWorkspaceTodoIncompleteCount,
  subscribeWorkspaceTodoCountsForScope,
} from "../stores/workspaceTodoCountsStore";

export function useWorkspaceTodoIncompleteCount(
  scope: "project" | "repository",
  projectId: string | null,
  repositoryId: number | null,
  enabled = true,
): number {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => {};
      return subscribeWorkspaceTodoCountsForScope(scope, projectId, repositoryId, listener);
    },
    [enabled, projectId, repositoryId, scope],
  );

  const getSnapshot = useCallback(
    () => (enabled ? getWorkspaceTodoIncompleteCount(scope, projectId, repositoryId) : 0),
    [enabled, projectId, repositoryId, scope],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
