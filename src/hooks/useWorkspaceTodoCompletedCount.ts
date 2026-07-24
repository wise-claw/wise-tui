import { useCallback, useSyncExternalStore } from "react";
import {
  getWorkspaceTodoCompletedCountSnapshot,
  subscribeWorkspaceTodoCounts,
} from "../stores/workspaceTodoCountsStore";

/** 全局待办已完成数；与 incompleteCount 共享同一次数据加载。 */
export function useWorkspaceTodoCompletedCount(enabled = true): number {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => {};
      return subscribeWorkspaceTodoCounts(listener);
    },
    [enabled],
  );

  const getSnapshot = useCallback(
    () => (enabled ? getWorkspaceTodoCompletedCountSnapshot() : 0),
    [enabled],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
