import { message } from "antd";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
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
  /** 额外需要加载并合并进 displayItems 的仓库 id。
   *  左栏弹窗用它把「所有仓库」的快捷操作都展示出来（不只当前选中的仓库）。
   *  顶栏 strip / Inspector 不传，仅展示当前 project + repository。 */
  additionalRepositoryIds?: number[];
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
  additionalRepositoryIds: number[],
): WorkspaceQuickActionDisplayItem[] {
  const displayItems: WorkspaceQuickActionDisplayItem[] = [];
  if (projectId?.trim()) {
    const scopeId = projectId.trim();
    for (const item of projectItems) {
      displayItems.push({ ...item, scope: "project", scopeId });
    }
  }
  const seenRepositoryIds = new Set<number>();
  if (repositoryId != null && repositoryId > 0) {
    seenRepositoryIds.add(repositoryId);
    const scopeId = String(repositoryId);
    for (const item of repositoryItems) {
      displayItems.push({ ...item, scope: "repository", scopeId });
    }
  }
  for (const id of additionalRepositoryIds) {
    if (!Number.isFinite(id) || id <= 0) continue;
    if (seenRepositoryIds.has(id)) continue;
    seenRepositoryIds.add(id);
    const scopeId = String(id);
    const items = getWorkspaceQuickActionsScopeItems("repository", id);
    for (const item of items) {
      displayItems.push({ ...item, scope: "repository", scopeId });
    }
  }
  displayItems.sort((a, b) => b.updatedAt - a.updatedAt);
  return displayItems;
}

export function useWorkspaceQuickActions({
  projectId,
  repositoryId,
  additionalRepositoryIds,
}: UseWorkspaceQuickActionsInput) {
  useSyncExternalStore(
    subscribeWorkspaceQuickActionsRuntime,
    getWorkspaceQuickActionsRuntimeSnapshot,
    getWorkspaceQuickActionsRuntimeSnapshot,
  );

  const projectItemsRef = useRef<WorkspaceQuickActionItem[]>([]);
  const repositoryItemsRef = useRef<WorkspaceQuickActionItem[]>([]);

  // project 与 repository 各自独立 retain/release：避免切换仓库（repositoryId 变化、projectId 不变）
  // 时连带 release project scope，触发 flush + entries.delete 后重新 load，造成 load in-flight 期间
  // projectItems 闪空（弹窗只剩仓库 scope）以及 flush-save 与重新 load 的竞态（DB 有数据但内存空）。
  useEffect(() => {
    retainWorkspaceQuickActionsScope("project", projectId);
    return () => {
      releaseWorkspaceQuickActionsScope("project", projectId);
    };
  }, [projectId]);

  useEffect(() => {
    retainWorkspaceQuickActionsScope("repository", repositoryId);
    return () => {
      releaseWorkspaceQuickActionsScope("repository", repositoryId);
    };
  }, [repositoryId]);

  // 额外仓库（左栏弹窗展示所有仓库）：按排序后的 id 列表做 dep，避免每次 render 新数组引用触发抖动。
  const additionalRepositoryIdsKey = (additionalRepositoryIds ?? [])
    .slice()
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    const ids = additionalRepositoryIdsKey
      ? additionalRepositoryIdsKey
          .split(",")
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0)
      : [];
    for (const id of ids) {
      retainWorkspaceQuickActionsScope("repository", id);
    }
    return () => {
      for (const id of ids) {
        releaseWorkspaceQuickActionsScope("repository", id);
      }
    };
  }, [additionalRepositoryIdsKey]);

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

  const additionalRepositoryIdsList = additionalRepositoryIdsKey
    ? additionalRepositoryIdsKey
        .split(",")
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  // 不用 useMemo：额外仓库的 items 在 load 完成 / setItems 后才会更新，deps 无法稳定覆盖所有额外仓库的
  // items 引用变化，会导致额外仓库加载完成后 displayItems 不刷新（仍只显示当前仓库）。useSyncExternalStore
  // 已保证 store generation 变化时重新渲染，每次渲染重算 displayItems 即可拿到最新 items。
  const displayItems = buildDisplayItems(
    projectId,
    repositoryId,
    projectItems,
    repositoryItems,
    additionalRepositoryIdsList,
  );

  const loading =
    isWorkspaceQuickActionsScopeLoading("project", projectId) ||
    isWorkspaceQuickActionsScopeLoading("repository", repositoryId) ||
    additionalRepositoryIdsList.some((id) =>
      isWorkspaceQuickActionsScopeLoading("repository", id),
    );
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
