import { message } from "antd";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceTodoDisplayItem,
  WorkspaceTodoItem,
  WorkspaceTodoScope,
} from "../types/workspaceTodos";
import { dispatchWorkspaceTodosChanged } from "../constants/workspaceTodosEvents";
import { reconcileWorkspaceTodoDisplayItems } from "../utils/workspaceTodoDisplayItems";
import {
  loadProjectWorkspaceTodos,
  loadRepositoryWorkspaceTodos,
  saveProjectWorkspaceTodos,
  saveRepositoryWorkspaceTodos,
} from "../services/workspaceTodosStore";

const PERSIST_DEBOUNCE_MS = 480;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "待办事项保存失败";
}

export interface UseWorkspaceTodosInput {
  projectId: string | null;
  repositoryId: number | null;
  /** 为 false 时不加载/持久化（编辑器已由父级注入 todos 时使用） */
  enabled?: boolean;
}

export function useWorkspaceTodos({
  projectId,
  repositoryId,
  enabled = true,
}: UseWorkspaceTodosInput) {
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

  const loadGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setProjectItems([]);
      setRepositoryItems([]);
      setLoading(false);
      return;
    }
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
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
      if (generation !== loadGenerationRef.current) return;
      setProjectItems(projectPayload.items);
      setRepositoryItems(repositoryPayload.items);
    } catch (error) {
      if (generation === loadGenerationRef.current) message.error(persistErrorText(error));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [enabled, projectId, repositoryId]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      const timers = persistTimersRef.current;
      if (timers.project) clearTimeout(timers.project);
      if (timers.repository) clearTimeout(timers.repository);
      persistTimersRef.current = { project: null, repository: null };
    };
  }, [enabled]);

  const displayItemsPrevRef = useRef<WorkspaceTodoDisplayItem[]>([]);

  const displayItems = useMemo(() => {
    const next = reconcileWorkspaceTodoDisplayItems(
      displayItemsPrevRef.current,
      projectId,
      repositoryId,
      projectItems,
      repositoryItems,
    );
    displayItemsPrevRef.current = next;
    return next;
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
      if (!enabled) return;
      const incompleteCount = items.reduce((n, item) => (item.completed ? n : n + 1), 0);
      if (scope === "project") {
        startTransition(() => {
          setProjectItems(items);
        });
        schedulePersist("project", items);
        const pid = projectId?.trim();
        if (pid) {
          dispatchWorkspaceTodosChanged({ projectId: pid, repositoryId: null, incompleteCount });
        }
        return;
      }
      startTransition(() => {
        setRepositoryItems(items);
      });
      schedulePersist("repository", items);
      if (repositoryId != null) {
        dispatchWorkspaceTodosChanged({ projectId: null, repositoryId, incompleteCount });
      }
    },
    [enabled, projectId, repositoryId, schedulePersist],
  );

  const hasScope =
    enabled && (Boolean(projectId?.trim()) || repositoryId != null);

  return useMemo(
    () => ({
      loading,
      hasScope,
      displayItems,
      setItemsForScope,
      refresh,
    }),
    [loading, hasScope, displayItems, setItemsForScope, refresh],
  );
}
