import type { RepositoryExplorerEntry } from "../../services/repositoryFiles";

const MAX_CACHED_REPOSITORIES = 8;
const cache = new Map<string, RepositoryExplorerEntry[]>();

export function getCachedRepositoryExplorerEntries(
  repositoryPath: string,
): RepositoryExplorerEntry[] | undefined {
  const key = repositoryPath.trim();
  if (!key) {
    return undefined;
  }
  return cache.get(key);
}

export function setCachedRepositoryExplorerEntries(
  repositoryPath: string,
  entries: RepositoryExplorerEntry[],
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
  cache.set(key, entries);
}
