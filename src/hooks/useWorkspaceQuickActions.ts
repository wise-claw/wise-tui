import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
  WorkspaceQuickActionDisplayItem,
  WorkspaceQuickActionItem,
  WorkspaceQuickActionScope,
} from "../types/workspaceQuickActions";
import {
  getWorkspaceQuickActionsRuntimeSnapshot,
  getWorkspaceQuickActionsScopeItems,
  isWorkspaceQuickActionsScopeLoading,
  persistWorkspaceQuickActionsScopeItems,
  releaseWorkspaceQuickActionsScope,
  retainWorkspaceQuickActionsScope,
  setWorkspaceQuickActionsScopeItems,
  subscribeWorkspaceQuickActionsRuntime,
} from "../stores/workspaceQuickActionsRuntimeStore";

const PERSIST_DEBOUNCE_MS = 400;

export interface UseWorkspaceQuickActionsInput {
  projectId: string | null;
  repositoryId: number | null;
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
  const persistTimersRef = useRef<{
    project: ReturnType<typeof setTimeout> | null;
    repository: ReturnType<typeof setTimeout> | null;
  }>({
    project: null,
    repository: null,
  });

  useEffect(() => {
    retainWorkspaceQuickActionsScope("project", projectId);
    retainWorkspaceQuickActionsScope("repository", repositoryId);
    return () => {
      releaseWorkspaceQuickActionsScope("project", projectId);
      releaseWorkspaceQuickActionsScope("repository", repositoryId);
    };
  }, [projectId, repositoryId]);

  useEffect(
    () => () => {
      const timers = persistTimersRef.current;
      if (timers.project) clearTimeout(timers.project);
      if (timers.repository) clearTimeout(timers.repository);
    },
    [],
  );

  const projectItems = getWorkspaceQuickActionsScopeItems("project", projectId);
  const repositoryItems = getWorkspaceQuickActionsScopeItems("repository", repositoryId);
  projectItemsRef.current = projectItems;
  repositoryItemsRef.current = repositoryItems;

  const flushPersist = useCallback(
    async (scope: WorkspaceQuickActionScope, items: WorkspaceQuickActionItem[]) => {
      const timers = persistTimersRef.current;
      if (scope === "project") {
        if (timers.project) clearTimeout(timers.project);
        timers.project = null;
        return persistWorkspaceQuickActionsScopeItems("project", projectId, items);
      }
      if (timers.repository) clearTimeout(timers.repository);
      timers.repository = null;
      return persistWorkspaceQuickActionsScopeItems("repository", repositoryId, items);
    },
    [projectId, repositoryId],
  );

  const schedulePersist = useCallback(
    (scope: WorkspaceQuickActionScope, items: WorkspaceQuickActionItem[]) => {
      const timers = persistTimersRef.current;
      const run = () => {
        void flushPersist(scope, items);
      };
      if (scope === "project") {
        if (timers.project) clearTimeout(timers.project);
        timers.project = setTimeout(() => {
          timers.project = null;
          run();
        }, PERSIST_DEBOUNCE_MS);
        return;
      }
      if (timers.repository) clearTimeout(timers.repository);
      timers.repository = setTimeout(() => {
        timers.repository = null;
        run();
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  const setItemsForScope = useCallback(
    (scope: WorkspaceQuickActionScope, items: WorkspaceQuickActionItem[]) => {
      if (scope === "project") {
        setWorkspaceQuickActionsScopeItems("project", projectId, items);
        schedulePersist("project", items);
        return;
      }
      setWorkspaceQuickActionsScopeItems("repository", repositoryId, items);
      schedulePersist("repository", items);
    },
    [projectId, repositoryId, schedulePersist],
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
    projectItemsRef,
    repositoryItemsRef,
  };
}
