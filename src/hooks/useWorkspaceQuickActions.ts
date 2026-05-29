import { message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  WorkspaceQuickActionDisplayItem,
  WorkspaceQuickActionItem,
  WorkspaceQuickActionScope,
} from "../types/workspaceQuickActions";
import {
  loadProjectWorkspaceQuickActions,
  loadRepositoryWorkspaceQuickActions,
  saveProjectWorkspaceQuickActions,
  saveRepositoryWorkspaceQuickActions,
} from "../services/workspaceQuickActionsStore";

const PERSIST_DEBOUNCE_MS = 400;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "快捷操作保存失败";
}

export interface UseWorkspaceQuickActionsInput {
  projectId: string | null;
  repositoryId: number | null;
}

export function useWorkspaceQuickActions({ projectId, repositoryId }: UseWorkspaceQuickActionsInput) {
  const [projectItems, setProjectItems] = useState<WorkspaceQuickActionItem[]>([]);
  const [repositoryItems, setRepositoryItems] = useState<WorkspaceQuickActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const projectItemsRef = useRef(projectItems);
  const repositoryItemsRef = useRef(repositoryItems);
  const persistTimersRef = useRef<{ project: ReturnType<typeof setTimeout> | null; repository: ReturnType<typeof setTimeout> | null }>({
    project: null,
    repository: null,
  });

  projectItemsRef.current = projectItems;
  repositoryItemsRef.current = repositoryItems;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [projectPayload, repositoryPayload] = await Promise.all([
        projectId?.trim()
          ? loadProjectWorkspaceQuickActions(projectId)
          : Promise.resolve({ version: 1 as const, items: [] }),
        repositoryId != null
          ? loadRepositoryWorkspaceQuickActions(repositoryId)
          : Promise.resolve({ version: 1 as const, items: [] }),
      ]);
      setProjectItems(projectPayload.items);
      setRepositoryItems(repositoryPayload.items);
    } catch (error) {
      message.error(persistErrorText(error));
    } finally {
      setLoading(false);
    }
  }, [projectId, repositoryId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      const timers = persistTimersRef.current;
      if (timers.project) clearTimeout(timers.project);
      if (timers.repository) clearTimeout(timers.repository);
    },
    [],
  );

  const flushPersist = useCallback(
    async (scope: WorkspaceQuickActionScope, items: WorkspaceQuickActionItem[]) => {
      const timers = persistTimersRef.current;
      if (scope === "project") {
        if (timers.project) clearTimeout(timers.project);
        timers.project = null;
        const pid = projectId?.trim();
        if (!pid) return false;
        try {
          await saveProjectWorkspaceQuickActions(pid, items);
          return true;
        } catch (error) {
          message.error(persistErrorText(error));
          return false;
        }
      }
      if (timers.repository) clearTimeout(timers.repository);
      timers.repository = null;
      if (repositoryId == null) return false;
      try {
        await saveRepositoryWorkspaceQuickActions(repositoryId, items);
        return true;
      } catch (error) {
        message.error(persistErrorText(error));
        return false;
      }
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
        setProjectItems(items);
        schedulePersist("project", items);
        return;
      }
      setRepositoryItems(items);
      schedulePersist("repository", items);
    },
    [schedulePersist],
  );

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

  const hasScope = Boolean(projectId?.trim()) || repositoryId != null;

  return {
    loading,
    hasScope,
    displayItems,
    projectItems,
    repositoryItems,
    refresh,
    setItemsForScope,
    flushPersist,
    projectItemsRef,
    repositoryItemsRef,
  };
}
