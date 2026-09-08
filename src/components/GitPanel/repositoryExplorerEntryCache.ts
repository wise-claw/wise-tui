import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";
import { listRepositoryExplorerChildren } from "../../services/repositoryFiles";
import { normalizeExplorerEntries } from "./repositoryExplorerDirKey";

const MAX_CACHED_REPOSITORIES = 16;

/** 切仓命中缓存后，延后刷新根目录，避免与 git_status / transcript 抢 IPC。 */
export const EXPLORER_ROOT_BACKGROUND_REFRESH_MS = 1500;

/** 切仓后延后恢复展开目录的子 listing，先让 git_status / 会话正文占满首屏 IPC。 */
export const EXPLORER_EXPANDED_RESTORE_DEFER_MS = 1000;

interface CachedExplorerSnapshot {
  rootChildren: RepositoryExplorerEntry[];
  fetchedAt: number;
}

const cache = new Map<string, CachedExplorerSnapshot>();
const inflight = new Map<string, Promise<RepositoryExplorerEntry[]>>();

let listRootChildren: (
  repositoryPath: string,
  parentDir: string,
) => Promise<RepositoryExplorerEntry[]> = listRepositoryExplorerChildren;

export function getCachedRepositoryExplorerRootChildren(
  repositoryPath: string,
): RepositoryExplorerEntry[] | undefined {
  const key = repositoryPath.trim();
  if (!key) {
    return undefined;
  }
  return cache.get(key)?.rootChildren;
}

export function setCachedRepositoryExplorerRootChildren(
  repositoryPath: string,
  rootChildren: RepositoryExplorerEntry[],
): void {
  const key = repositoryPath.trim();
  if (!key) {
    return;
  }
  if (!cache.has(key) && cache.size >= MAX_CACHED_REPOSITORIES) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { rootChildren, fetchedAt: Date.now() });
}

function listAndCacheRootChildren(key: string): Promise<RepositoryExplorerEntry[]> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = listRootChildren(key, "")
    .then((children) => {
      const normalized = normalizeExplorerEntries(children);
      setCachedRepositoryExplorerRootChildren(key, normalized);
      return normalized;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** 悬停预取与切仓 listing 共用同一 Promise，避免重复 IPC。 */
export function ensureRepositoryExplorerRootChildren(
  repositoryPath: string,
): Promise<RepositoryExplorerEntry[]> {
  const key = repositoryPath.trim();
  if (!key) return Promise.resolve([]);
  const cached = cache.get(key)?.rootChildren;
  if (cached) return Promise.resolve(cached);
  return listAndCacheRootChildren(key);
}

/** 跳过已落地缓存，仍与进行中的 listing 共用。 */
export function refreshRepositoryExplorerRootChildren(
  repositoryPath: string,
): Promise<RepositoryExplorerEntry[]> {
  const key = repositoryPath.trim();
  if (!key) return Promise.resolve([]);
  return listAndCacheRootChildren(key);
}

/** 侧栏划过时预拉文件树根目录，切仓时可同步画出上次 listing。 */
export function prefetchRepositoryExplorer(repositoryPath: string): void {
  void ensureRepositoryExplorerRootChildren(repositoryPath).catch(() => {
    /* hover 预取失败时切仓再走正式加载 */
  });
}

/** @internal */
export function setRepositoryExplorerListImplForTests(
  impl: typeof listRepositoryExplorerChildren | null,
): void {
  listRootChildren = impl ?? listRepositoryExplorerChildren;
}

/** @internal */
export function peekRepositoryExplorerRootChildrenInflight(
  repositoryPath: string,
): Promise<RepositoryExplorerEntry[]> | undefined {
  return inflight.get(repositoryPath.trim());
}

/** @internal */
export function clearRepositoryExplorerRootChildrenCacheForTests(): void {
  cache.clear();
  inflight.clear();
}

/** @deprecated Use root children cache; kept for search / legacy callers. */
export function getCachedRepositoryExplorerEntries(
  repositoryPath: string,
): RepositoryExplorerEntry[] | undefined {
  return getCachedRepositoryExplorerRootChildren(repositoryPath);
}

export function setCachedRepositoryExplorerEntries(
  repositoryPath: string,
  entries: RepositoryExplorerEntry[],
): void {
  setCachedRepositoryExplorerRootChildren(repositoryPath, entries);
}
