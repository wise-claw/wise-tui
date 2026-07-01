import { message } from "antd";
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
  if (repositoryId != null && Number.isFinite(repositoryId) && repositoryId > 0) {
    return String(repositoryId);
  }
  return null;
}

function normalizeScopeIdForRead(
  scope: WorkspaceQuickActionScope,
  overrideScopeId: string | null | undefined,
  fallbackScopeId: string | number | null,
): string | null {
  if (overrideScopeId != null) {
    const trimmed = String(overrideScopeId).trim();
    if (trimmed) return trimmed;
  }
  if (scope === "project") {
    return typeof fallbackScopeId === "string" ? fallbackScopeId.trim() || null : null;
  }
  if (typeof fallbackScopeId === "number" && Number.isFinite(fallbackScopeId) && fallbackScopeId > 0) {
    return String(fallbackScopeId);
  }
  if (typeof fallbackScopeId === "string") {
    const trimmed = fallbackScopeId.trim();
    if (trimmed && Number.isFinite(Number(trimmed)) && Number(trimmed) > 0) {
      return trimmed;
    }
  }
  return null;
}

function normalizeScopeIdForPersist(
  scope: WorkspaceQuickActionScope,
  overrideScopeId: string | null | undefined,
  projectId: string | null,
  repositoryId: number | null,
): string | null {
  if (overrideScopeId != null) {
    const trimmed = String(overrideScopeId).trim();
    if (trimmed) return trimmed;
  }
  return resolveWorkspaceQuickActionScopeId(scope, projectId, repositoryId);
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
    async (
      scope: WorkspaceQuickActionScope,
      items: WorkspaceQuickActionItem[],
      overrideScopeId?: string | null,
    ) => {
      const scopeId =
        normalizeScopeIdForPersist(scope, overrideScopeId, projectId, repositoryId);
      if (!scopeId) {
        message.error(scope === "project" ? "请先选择工作区" : "请先选择仓库");
        return false;
      }
      return flushWorkspaceQuickActionsPersist(scope, scopeId, items);
    },
    [projectId, repositoryId],
  );

  const readScopeItems = useCallback(
    (scope: WorkspaceQuickActionScope, overrideScopeId?: string | null): WorkspaceQuickActionItem[] => {
      const fallbackScopeId = scope === "project" ? projectId : repositoryId;
      const normalizedScopeId = normalizeScopeIdForRead(scope, overrideScopeId, fallbackScopeId);
      if (!normalizedScopeId) return [];
      return getWorkspaceQuickActionsScopeItems(scope, normalizedScopeId);
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
