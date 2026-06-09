import { useSyncExternalStore } from "react";
import {
  getWorkspaceTodoIncompleteCount,
  subscribeWorkspaceTodoCounts,
} from "../stores/workspaceTodoCountsStore";

export function useWorkspaceTodoIncompleteCount(
  scope: "project" | "repository",
  projectId: string | null,
  repositoryId: number | null,
  enabled = true,
): number {
  return useSyncExternalStore(
    subscribeWorkspaceTodoCounts,
    () => (enabled ? getWorkspaceTodoIncompleteCount(scope, projectId, repositoryId) : 0),
    () => 0,
  );
}
