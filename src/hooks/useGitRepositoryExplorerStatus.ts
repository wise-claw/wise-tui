import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  EMPTY_EXPLORER_GIT_STATUS_INDEX,
  type ExplorerGitStatusIndex,
} from "../components/GitPanel/repositoryExplorerGitStatus";
import {
  getGitRepositoryExplorerStatusGeneration,
  getGitRepositoryExplorerStatusSnapshot,
  subscribeGitRepositoryExplorerStatus,
} from "../stores/gitRepositoryExplorerStatusStore";

/**
 * 订阅仓库的 git explorer 状态。
 *
 * `enabled=false` 时不再 reactive 订阅（getSnapshot 固定为 0），用于隐藏态的
 * 多 panel 降级——同一仓库的多个 explorer 实例并存时，隐藏的那份不参与 git
 * 状态 publish 触发的重渲染，避免 N 倍渲染放大。快照回退为空索引，切回可见时
 * （enabled 转 true）subscribe 重新 acquire entry 并异步拉取最新着色。
 *
 * subscribe/getSnapshot 须为稳定引用（useCallback）：useSyncExternalStore 把
 * subscribe 作为订阅 effect 依赖，内联箭头每次渲染变引用会导致每次 commit
 * 重订阅——store 在单 consumer 时 releasePath 删除 entry，重订阅即重建空
 * entry（generation 归 0），generation 在 0/1 间振荡，文件树渲染频繁读到空
 * index，表现为 git 标记（M/A/D、目录圆点、文件名变色）完全不显示。
 */
export function useGitRepositoryExplorerStatus(repositoryPath: string, enabled = true) {
  const trimmedPath = repositoryPath.trim();
  const subscribePath = enabled ? trimmedPath : "";
  const subscribe = useCallback(
    (listener: () => void) => subscribeGitRepositoryExplorerStatus(subscribePath, listener),
    [subscribePath],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getGitRepositoryExplorerStatusGeneration(trimmedPath) : 0),
    [enabled, trimmedPath],
  );
  const generation = useSyncExternalStore(subscribe, getSnapshot, () => 0);
  const index: ExplorerGitStatusIndex = enabled
    ? getGitRepositoryExplorerStatusSnapshot(trimmedPath)
    : EMPTY_EXPLORER_GIT_STATUS_INDEX;

  return useMemo(
    () => ({
      generation,
      getFileStatus: (path: string) => index.fileStatusByPath.get(path) ?? null,
      getDirStatus: (path: string) => index.dirStatusByPath.get(path) ?? null,
      dirHasChanges: (path: string) => index.dirsWithChanges.has(path),
    }),
    [generation, index],
  );
}
