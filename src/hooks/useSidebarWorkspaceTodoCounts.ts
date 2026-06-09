import { useSyncExternalStore } from "react";
import type { ProjectItem, Repository } from "../types";
import { useWorkspaceTodoCountsBootstrap } from "./useWorkspaceTodoCountsBootstrap";
import {
  getWorkspaceTodoCountsSnapshot,
  subscribeWorkspaceTodoCounts,
} from "../stores/workspaceTodoCountsStore";

export interface SidebarWorkspaceTodoCounts {
  byProjectId: Record<string, number>;
  byRepositoryId: Record<number, number>;
  loading: boolean;
}

/** @deprecated 侧栏请用 `useWorkspaceTodoCountsBootstrap` + `useWorkspaceTodoIncompleteCount`。 */
export function useSidebarWorkspaceTodoCounts(
  projects: ProjectItem[],
  floatingRepositories: Repository[],
  enabled = true,
): SidebarWorkspaceTodoCounts {
  useWorkspaceTodoCountsBootstrap(projects, floatingRepositories, enabled);
  const snapshot = useSyncExternalStore(
    subscribeWorkspaceTodoCounts,
    getWorkspaceTodoCountsSnapshot,
    getWorkspaceTodoCountsSnapshot,
  );
  return {
    byProjectId: snapshot.byProjectId,
    byRepositoryId: snapshot.byRepositoryId,
    loading: false,
  };
}
