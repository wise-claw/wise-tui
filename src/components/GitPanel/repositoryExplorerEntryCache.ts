import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";

const MAX_CACHED_REPOSITORIES = 8;

interface CachedExplorerSnapshot {
  rootChildren: RepositoryExplorerEntry[];
  fetchedAt: number;
}

const cache = new Map<string, CachedExplorerSnapshot>();

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
