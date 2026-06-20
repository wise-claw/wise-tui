import { useMemo, useSyncExternalStore } from "react";
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
 * （enabled 转 true）generation 会跳回真实值触发一次重渲染拿到最新着色。
 */
export function useGitRepositoryExplorerStatus(repositoryPath: string, enabled = true) {
  const trimmedPath = repositoryPath.trim();
  const subscribePath = enabled ? trimmedPath : "";
  const generation = useSyncExternalStore(
    (listener) => subscribeGitRepositoryExplorerStatus(subscribePath, listener),
    () => (enabled ? getGitRepositoryExplorerStatusGeneration(trimmedPath) : 0),
    () => 0,
  );
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
