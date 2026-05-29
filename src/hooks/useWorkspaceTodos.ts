import { message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceTodoDisplayItem,
  WorkspaceTodoItem,
  WorkspaceTodoScope,
} from "../types/workspaceTodos";
import { dispatchWorkspaceTodosChanged } from "../constants/workspaceTodosEvents";
import {
  loadProjectWorkspaceTodos,
  loadRepositoryWorkspaceTodos,
  saveProjectWorkspaceTodos,
  saveRepositoryWorkspaceTodos,
} from "../services/workspaceTodosStore";

const PERSIST_DEBOUNCE_MS = 480;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "提醒事项保存失败";
}

export interface UseWorkspaceTodosInput {
  projectId: string | null;
  repositoryId: number | null;
}

export function useWorkspaceTodos({ projectId, repositoryId }: UseWorkspaceTodosInput) {
  const [projectItems, setProjectItems] = useState<WorkspaceTodoItem[]>([]);
  const [repositoryItems, setRepositoryItems] = useState<WorkspaceTodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const projectItemsRef = useRef(projectItems);
  const repositoryItemsRef = useRef(repositoryItems);
  const persistTimersRef = useRef<{
    project: ReturnType<typeof setTimeout> | null;
    repository: ReturnType<typeof setTimeout> | null;
  }>({ project: null, repository: null });

  projectItemsRef.current = projectItems;
  repositoryItemsRef.current = repositoryItems;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [projectPayload, repositoryPayload] = await Promise.all([
        projectId?.trim()
          ? loadProjectWorkspaceTodos(projectId)
          : Promise.resolve({ version: 1 as const, items: [] }),
        repositoryId != null
          ? loadRepositoryWorkspaceTodos(repositoryId)
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

  const displayItems = useMemo(() => {
    const rows: WorkspaceTodoDisplayItem[] = [];
    if (projectId?.trim()) {
      for (const item of projectItems) {
        rows.push({ ...item, scope: "project" });
      }
    }
    if (repositoryId != null) {
      for (const item of repositoryItems) {
        rows.push({ ...item, scope: "repository" });
      }
    }
    rows.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return b.updatedAt - a.updatedAt;
    });
    return rows;
  }, [projectId, repositoryId, projectItems, repositoryItems]);

  const flushPersist = useCallback(
    async (scope: WorkspaceTodoScope, items: WorkspaceTodoItem[]) => {
      const timers = persistTimersRef.current;
      if (scope === "project") {
        if (timers.project) clearTimeout(timers.project);
        timers.project = null;
        const pid = projectId?.trim();
        if (!pid) return false;
        try {
          await saveProjectWorkspaceTodos(pid, items);
          dispatchWorkspaceTodosChanged({ projectId: pid, repositoryId: null });
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
        await saveRepositoryWorkspaceTodos(repositoryId, items);
        dispatchWorkspaceTodosChanged({ projectId: null, repositoryId });
        return true;
      } catch (error) {
        message.error(persistErrorText(error));
        return false;
      }
    },
    [projectId, repositoryId],
  );

  const schedulePersist = useCallback(
    (scope: WorkspaceTodoScope, items: WorkspaceTodoItem[]) => {
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
    (scope: WorkspaceTodoScope, items: WorkspaceTodoItem[]) => {
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

  const hasScope = Boolean(projectId?.trim()) || repositoryId != null;

  return {
    loading,
    hasScope,
    displayItems,
    setItemsForScope,
    refresh,
  };
}
