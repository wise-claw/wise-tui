import { useCallback, useSyncExternalStore } from "react";
import {
  getRepositoryRunCommandState,
  isRepositoryRunCommandActive,
  subscribeRepositoryRunCommandRuntimeForRepository,
} from "../stores/repositoryRunCommandRuntimeStore";

/** 订阅指定仓库的运行指令是否在跑（与顶栏运行按钮同源 store）。 */
export function useIsRepositoryRunCommandRunning(repositoryId: number | undefined): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (repositoryId == null) return () => {};
      return subscribeRepositoryRunCommandRuntimeForRepository(repositoryId, listener);
    },
    [repositoryId],
  );

  const getSnapshot = useCallback(() => {
    if (repositoryId == null) return false;
    return isRepositoryRunCommandActive(repositoryId);
  }, [repositoryId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 订阅指定仓库的运行指令 UI 状态切片（弹窗/顶栏 Popover 用）。 */
export function useRepositoryRunCommandRuntimeSlice(repositoryId: number | undefined) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (repositoryId == null) return () => {};
      return subscribeRepositoryRunCommandRuntimeForRepository(repositoryId, listener);
    },
    [repositoryId],
  );

  const getSnapshot = useCallback(() => {
    if (repositoryId == null) {
      return {
        status: "idle" as const,
        statusHint: "未运行",
        outputPreview: [],
        detectedUrl: null as string | null,
      };
    }
    return getRepositoryRunCommandState(repositoryId);
  }, [repositoryId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
