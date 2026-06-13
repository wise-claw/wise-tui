import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  WorkspaceQuickActionDisplayItem,
  WorkspaceQuickActionItem,
  WorkspaceQuickActionScope,
} from "../types/workspaceQuickActions";
import {
  flushWorkspaceQuickActionsPersist,
  getWorkspaceQuickActionsRuntimeSnapshot,
  getWorkspaceQuickActionsScopeItems,
  isWorkspaceQuickActionsScopeLoading,
  releaseWorkspaceQuickActionsScope,
  retainWorkspaceQuickActionsScope,
  scheduleWorkspaceQuickActionsPersist,
  subscribeWorkspaceQuickActionsRuntime,
} from "../stores/workspaceQuickActionsRuntimeStore";

export interface UseWorkspaceQuickActionsInput {
  projectId: string | null;
  repositoryId: number | null;
}

function resolveWorkspaceQuickActionScopeId(
  scope: WorkspaceQuickActionScope,
  projectId: string | null,
  repositoryId: number | null,
): string | null {
  if (scope === "project") {
    const id = projectId?.trim() ?? "";
    return id || null;
  }
  if (repositoryId == null || !Number.isFinite(repositoryId)) return null;
  return String(repositoryId);
}

function buildDisplayItems(
  projectId: string | null,
  repositoryId: number | null,
  projectItems: WorkspaceQuickActionItem[],
  repositoryItems: WorkspaceQuickActionItem[],
): WorkspaceQuickActionDisplayItem[] {
  const displayItems: WorkspaceQuickActionDisplayItem[] = [];
  if (projectId?.trim()) {
    for (const item of projectItems) {
      displayItems.push({ ...item, scope: "project" });
    }
  }
  if (repositoryId != null) {
    for (const item of repositoryItems) {
      displayItems.push({ ...item, scope: "repository" });
    }
  }
  displayItems.sort((a, b) => b.updatedAt - a.updatedAt);
  return displayItems;
}

export function useWorkspaceQuickActions({ projectId, repositoryId }: UseWorkspaceQuickActionsInput) {
  useSyncExternalStore(
    subscribeWorkspaceQuickActionsRuntime,
    getWorkspaceQuickActionsRuntimeSnapshot,
    getWorkspaceQuickActionsRuntimeSnapshot,
  );

  const projectItemsRef = useRef<WorkspaceQuickActionItem[]>([]);
  const repositoryItemsRef = useRef<WorkspaceQuickActionItem[]>([]);

  useEffect(() => {
    retainWorkspaceQuickActionsScope("project", projectId);
    retainWorkspaceQuickActionsScope("repository", repositoryId);
    return () => {
      releaseWorkspaceQuickActionsScope("project", projectId);
      releaseWorkspaceQuickActionsScope("repository", repositoryId);
    };
  }, [projectId, repositoryId]);

  const projectItems = getWorkspaceQuickActionsScopeItems("project", projectId);
  const repositoryItems = getWorkspaceQuickActionsScopeItems("repository", repositoryId);
  projectItemsRef.current = projectItems;
  repositoryItemsRef.current = repositoryItems;

  const flushPersist = useCallback(
    async (scope: WorkspaceQuickActionScope, items: WorkspaceQuickActionItem[]) => {
      const scopeId = resolveWorkspaceQuickActionScopeId(scope, projectId, repositoryId);
      if (!scopeId) return false;
      return flushWorkspaceQuickActionsPersist(scope, scopeId, items);
    },
    [projectId, repositoryId],
  );

  const readScopeItems = useCallback(
    (scope: WorkspaceQuickActionScope): WorkspaceQuickActionItem[] => {
      return getWorkspaceQuickActionsScopeItems(
        scope,
        scope === "project" ? projectId : repositoryId,
      );
    },
    [projectId, repositoryId],
  );

  const setItemsForScope = useCallback(
    (scope: WorkspaceQuickActionScope, items: WorkspaceQuickActionItem[]) => {
      const scopeId = resolveWorkspaceQuickActionScopeId(scope, projectId, repositoryId);
      if (!scopeId) return;
      scheduleWorkspaceQuickActionsPersist(scope, scopeId, items);
    },
    [projectId, repositoryId],
  );

  const displayItems = useMemo(
    () => buildDisplayItems(projectId, repositoryId, projectItems, repositoryItems),
    [projectId, repositoryId, projectItems, repositoryItems],
  );

  const loading =
    isWorkspaceQuickActionsScopeLoading("project", projectId) ||
    isWorkspaceQuickActionsScopeLoading("repository", repositoryId);
  const hasScope = Boolean(projectId?.trim()) || repositoryId != null;

  return {
    loading,
    hasScope,
    displayItems,
    projectItems,
    repositoryItems,
    setItemsForScope,
    flushPersist,
    readScopeItems,
    projectItemsRef,
    repositoryItemsRef,
  };
}
