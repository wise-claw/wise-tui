import { message } from "antd";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceTodoItem } from "../types/workspaceTodos";
import {
  dispatchWorkspaceTodosChanged,
  WISE_WORKSPACE_TODOS_CHANGED,
} from "../constants/workspaceTodosEvents";
import {
  loadGlobalWorkspaceTodos,
  saveGlobalWorkspaceTodos,
} from "../services/workspaceTodosStore";

const PERSIST_DEBOUNCE_MS = 480;

function persistErrorText(error: unknown): string {
  return error instanceof Error ? error.message : "待办事项保存失败";
}

export function shouldReloadWorkspaceTodosOnChanged(
  detail:
    | {
        incompleteCount?: number;
        reloadItems?: boolean;
      }
    | undefined,
): boolean {
  if (!detail) return false;
  if (detail.reloadItems === false) return false;
  if (detail.reloadItems === true) return true;
  if (typeof detail.incompleteCount === "number") return false;
  return true;
}

export interface UseWorkspaceTodosInput {
  /** 为 false 时不加载/持久化（编辑器已由父级注入 todos 时使用） */
  enabled?: boolean;
}

export function useWorkspaceTodos({ enabled = true }: UseWorkspaceTodosInput = {}) {
  const [items, setInternalItems] = useState<WorkspaceTodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistItemsRef = useRef<WorkspaceTodoItem[] | null>(null);

  const loadGenerationRef = useRef(0);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setInternalItems([]);
      setLoading(false);
      return;
    }
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setLoading(true);
    try {
      const payload = await loadGlobalWorkspaceTodos();
      if (generation !== loadGenerationRef.current) return;
      setInternalItems(payload.items);
    } catch (error) {
      if (generation === loadGenerationRef.current) message.error(persistErrorText(error));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const onChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          incompleteCount?: number;
          reloadItems?: boolean;
        }>
      ).detail;
      if (!shouldReloadWorkspaceTodosOnChanged(detail)) return;
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        refreshDebounceRef.current = null;
        void refresh();
      }, 200);
    };
    window.addEventListener(WISE_WORKSPACE_TODOS_CHANGED, onChanged);
    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = null;
      window.removeEventListener(WISE_WORKSPACE_TODOS_CHANGED, onChanged);
    };
  }, [enabled, refresh]);

  const flushPersist = useCallback(async (itemsToSave: WorkspaceTodoItem[]) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingPersistItemsRef.current = null;
    if (!enabled) return false;
    try {
      await saveGlobalWorkspaceTodos(itemsToSave);
      return true;
    } catch (error) {
      message.error(persistErrorText(error));
      return false;
    }
  }, [enabled]);

  const schedulePersist = useCallback((itemsToSave: WorkspaceTodoItem[]) => {
    pendingPersistItemsRef.current = itemsToSave;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      const pending = pendingPersistItemsRef.current;
      if (pending) void flushPersist(pending);
    }, PERSIST_DEBOUNCE_MS);
  }, [flushPersist]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
        if (pendingPersistItemsRef.current) {
          void flushPersist(pendingPersistItemsRef.current);
        }
      }
    };
  }, [enabled, flushPersist]);

  const setItems = useCallback(
    (next: WorkspaceTodoItem[]) => {
      if (!enabled) return;
      const incompleteCount = next.reduce((n, item) => (item.completed ? n : n + 1), 0);
      startTransition(() => {
        setInternalItems(next);
      });
      schedulePersist(next);
      dispatchWorkspaceTodosChanged({
        incompleteCount,
        reloadItems: false,
      });
    },
    [enabled, schedulePersist],
  );

  return useMemo(
    () => ({
      loading,
      hasScope: enabled,
      items,
      setItems,
      refresh,
    }),
    [loading, items, setItems, refresh],
  );
}
