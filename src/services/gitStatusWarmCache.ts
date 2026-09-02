import type { GitStatusResponse } from "../types";
import { gitStatus } from "./git";

const TTL_MS = 45_000;
const MAX_WARM_ENTRIES = 24;

type WarmEntry = {
  at: number;
  promise: Promise<GitStatusResponse>;
};

function normalizePath(repositoryPath: string): string {
  return repositoryPath.trim();
}

export interface GitStatusWarmCache {
  prefetch(repositoryPath: string): void;
  consume(repositoryPath: string): Promise<GitStatusResponse> | null;
  clear(): void;
  /** @internal 仅用于回归测试与诊断。 */
  size(): number;
}

/**
 * Git status 预热缓存：
 * - 给被丢弃的预取 Promise 挂拒绝处理，避免 hover 后未切仓时产生 unhandled rejection；
 * - 失败回调仅删除自己对应的 entry，避免旧请求误删同路径的新预热；
 * - TTL + LRU 双界限，工作区长期切换大量仓库时内存不会只增不减。
 */
export function createGitStatusWarmCache(
  fetchStatus: (repositoryPath: string) => Promise<GitStatusResponse>,
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {},
): GitStatusWarmCache {
  const ttlMs = Math.max(0, options.ttlMs ?? TTL_MS);
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? MAX_WARM_ENTRIES));
  const now = options.now ?? Date.now;
  const entries = new Map<string, WarmEntry>();

  const removeExpired = (at: number) => {
    for (const [key, entry] of entries) {
      if (at - entry.at >= ttlMs) entries.delete(key);
    }
  };

  const trimToLimit = () => {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  };

  return {
    prefetch(repositoryPath) {
      const path = normalizePath(repositoryPath);
      if (!path) return;
      const at = now();
      removeExpired(at);
      const existing = entries.get(path);
      if (existing && at - existing.at < ttlMs) {
        // Map 的插入顺序同时作为 LRU 顺序；hover 命中也刷新热度。
        entries.delete(path);
        entries.set(path, existing);
        return;
      }

      // Promise.resolve().then 同时把同步 throw 归一化为 rejection。
      const promise = Promise.resolve().then(() => fetchStatus(path));
      const entry: WarmEntry = { at, promise };
      entries.set(path, entry);
      trimToLimit();
      // 预取允许无人消费；只观察失败并清理，不把 rethrow 后的新 Promise 留成悬空 rejection。
      void promise.catch(() => {
        if (entries.get(path) === entry) entries.delete(path);
      });
    },
    consume(repositoryPath) {
      const path = normalizePath(repositoryPath);
      if (!path) return null;
      const entry = entries.get(path);
      if (!entry || now() - entry.at >= ttlMs) {
        entries.delete(path);
        return null;
      }
      entries.delete(path);
      return entry.promise;
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

const warmCache = createGitStatusWarmCache(gitStatus);

/** 侧栏划过时预拉 git status，切换仓库时 Git 面板可复用进行中的 IPC。 */
export function prefetchGitStatus(repositoryPath: string): void {
  warmCache.prefetch(repositoryPath);
}

/** GitPanel 首屏加载时优先消费预热结果。 */
export function consumeWarmGitStatus(repositoryPath: string): Promise<GitStatusResponse> | null {
  return warmCache.consume(repositoryPath);
}

export function clearGitStatusWarmCache(): void {
  warmCache.clear();
}
