import { useCallback, useSyncExternalStore } from "react";
import {
  getWorkspaceTodoCountsSnapshot,
  subscribeWorkspaceTodoCounts,
} from "../stores/workspaceTodoCountsStore";

/** 全局待办未完成数；不区分工作区/仓库。 */
export function useWorkspaceTodoIncompleteCount(enabled = true): number {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => {};
      return subscribeWorkspaceTodoCounts(listener);
    },
    [enabled],
  );

  const getSnapshot = useCallback(
    () => (enabled ? getWorkspaceTodoCountsSnapshot() : 0),
    [enabled],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
