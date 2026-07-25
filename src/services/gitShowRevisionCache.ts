/** `git show` 短 TTL 缓存：gutter / 连开 Diff 常重复拉同一 HEAD:path。 */

export interface GitShowRevisionCacheOptions {
  ttlMs: number;
  maxEntries: number;
}

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export function createGitShowRevisionCache(options: GitShowRevisionCacheOptions) {
  const entries = new Map<string, CacheEntry>();

  function cacheKey(repositoryPath: string, revisionPath: string): string {
    return `${repositoryPath}\0${revisionPath}`;
  }

  function get(repositoryPath: string, revisionPath: string, now = Date.now()): string | undefined {
    const key = cacheKey(repositoryPath, revisionPath);
    const hit = entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      entries.delete(key);
      return undefined;
    }
    // LRU：命中后挪到末尾
    entries.delete(key);
    entries.set(key, hit);
    return hit.value;
  }

  function set(
    repositoryPath: string,
    revisionPath: string,
    value: string,
    now = Date.now(),
  ): void {
    const key = cacheKey(repositoryPath, revisionPath);
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { value, expiresAt: now + options.ttlMs });
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  function clear(): void {
    entries.clear();
  }

  function size(): number {
    return entries.size;
  }

  return { get, set, clear, size };
}
