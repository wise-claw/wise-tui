import { prefetchRepositoryExplorer } from "../components/GitPanel/repositoryExplorerEntryCache";
import { scheduleDeferredTask } from "./diskSessionIndexSchedule";
import { prefetchGitStatus } from "./gitStatusWarmCache";
import { neighborRepositoryPaths } from "./neighborRepositoryPaths";
import { prefetchRepositorySession } from "./repositorySessionPrefetch";

/** 切仓首屏结束后再预热两侧邻仓，方便下一次点击直接走缓存。 */
export const NEIGHBOR_WORKSPACE_PREFETCH_DEFER_MS = 2000;

/** 侧栏划过 / 点击仓库时并行预热 Git、会话正文、文件树，切仓首帧尽量走缓存。 */
export function prefetchRepositoryWorkspace(repositoryPath: string): void {
  const path = repositoryPath.trim();
  if (!path) return;
  prefetchGitStatus(path);
  prefetchRepositorySession(path);
  prefetchRepositoryExplorer(path);
}

/** 延后预热邻仓；调用方可在切走时取消未触发的预热。 */
export function prefetchNeighborRepositoryWorkspaces(
  repositoryPath: string,
  allPaths: readonly string[],
  delayMs = NEIGHBOR_WORKSPACE_PREFETCH_DEFER_MS,
): () => void {
  const cleanups = neighborRepositoryPaths(repositoryPath, allPaths).map((neighbor) =>
    scheduleDeferredTask(() => prefetchRepositoryWorkspace(neighbor), delayMs),
  );
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
