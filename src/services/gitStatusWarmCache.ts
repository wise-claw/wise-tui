import type { GitStatusResponse } from "../types";
import { gitStatus } from "./git";

const TTL_MS = 45_000;
const MAX_WARM_ENTRIES = 24;

type WarmEntry = {
  at: number;
  promise: Promise<GitStatusResponse>;
  value?: GitStatusResponse;
};

function normalizePath(repositoryPath: string): string {
  return repositoryPath.trim();
}

export interface GitStatusWarmCache {
  prefetch(repositoryPath: string): void;
  /** 复用进行中的预热，不驱逐条目；Git 面板与文件树可共享同一次 IPC。 */
  peek(repositoryPath: string): Promise<GitStatusResponse> | null;
  /** 仅返回尚未落地的预热 Promise，供后台静默刷新避免重复打已完成的缓存。 */
  peekInFlight(repositoryPath: string): Promise<GitStatusResponse> | null;
  /** 已完成的预热结果，切仓时可同步画出上一次 status。 */
  getResolved(repositoryPath: string): GitStatusResponse | null;
  remember(repositoryPath: string, value: GitStatusResponse): void;
  invalidate(repositoryPath: string): void;
  clear(): void;
  /** @internal 仅用于回归测试与诊断。 */
  size(): number;
}

/**
 * Git status 预热缓存：
 * - 给被丢弃的预取 Promise 挂拒绝处理，避免 hover 后未切仓时产生 unhandled rejection；
 * - 失败回调仅删除自己对应的 entry，避免旧请求误删同路径的新预热；
 * - 命中后不删除，Git 面板 / 文件树 / 切回同一仓共享同一次结果；
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

  const touch = (path: string, entry: WarmEntry) => {
    entries.delete(path);
    entries.set(path, entry);
  };

  const readFresh = (repositoryPath: string): WarmEntry | null => {
    const path = normalizePath(repositoryPath);
    if (!path) return null;
    const at = now();
    removeExpired(at);
    const entry = entries.get(path);
    if (!entry || at - entry.at >= ttlMs) {
      entries.delete(path);
      return null;
    }
    touch(path, entry);
    return entry;
  };

  return {
    prefetch(repositoryPath) {
      const path = normalizePath(repositoryPath);
      if (!path) return;
      const at = now();
      removeExpired(at);
      const existing = entries.get(path);
      if (existing && at - existing.at < ttlMs) {
        touch(path, existing);
        return;
      }

      const promise = Promise.resolve()
        .then(() => fetchStatus(path))
        .then((value) => {
          if (entries.get(path) === entry) entry.value = value;
          return value;
        });
      const entry: WarmEntry = { at, promise };
      entries.set(path, entry);
      trimToLimit();
      void promise.catch(() => {
        if (entries.get(path) === entry) entries.delete(path);
      });
    },
    peek(repositoryPath) {
      return readFresh(repositoryPath)?.promise ?? null;
    },
    peekInFlight(repositoryPath) {
      const entry = readFresh(repositoryPath);
      if (!entry || entry.value !== undefined) return null;
      return entry.promise;
    },
    getResolved(repositoryPath) {
      return readFresh(repositoryPath)?.value ?? null;
    },
    remember(repositoryPath, value) {
      const path = normalizePath(repositoryPath);
      if (!path) return;
      const at = now();
      removeExpired(at);
      const entry: WarmEntry = { at, promise: Promise.resolve(value), value };
      entries.set(path, entry);
      trimToLimit();
    },
    invalidate(repositoryPath) {
      const path = normalizePath(repositoryPath);
      if (!path) return;
      entries.delete(path);
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

/** Git 面板 / 文件树共享预热 Promise，不因第一次读取而丢掉。 */
export function peekWarmGitStatus(repositoryPath: string): Promise<GitStatusResponse> | null {
  return warmCache.peek(repositoryPath);
}

/** 后台静默刷新：只接还未完成的预热，避免把刚画出的缓存再当「新结果」吞掉真实 git_status。 */
export function peekInFlightWarmGitStatus(repositoryPath: string): Promise<GitStatusResponse> | null {
  return warmCache.peekInFlight(repositoryPath);
}

/** @deprecated 使用 peekWarmGitStatus；保留以免旧调用方一次消费后迫使二次 git_status。 */
export function consumeWarmGitStatus(repositoryPath: string): Promise<GitStatusResponse> | null {
  return warmCache.peek(repositoryPath);
}

/** 切仓时同步套用最近一次成功的 git status，避免先清空再等 IPC。 */
export function getResolvedGitStatus(repositoryPath: string): GitStatusResponse | null {
  return warmCache.getResolved(repositoryPath);
}

export function rememberGitStatus(repositoryPath: string, value: GitStatusResponse): void {
  warmCache.remember(repositoryPath, value);
}

/** 本地文件变更后丢弃该仓库的旧状态，下一次显式刷新必须重新读取 Git。 */
export function invalidateGitStatus(repositoryPath: string): void {
  warmCache.invalidate(repositoryPath);
}

export function clearGitStatusWarmCache(): void {
  warmCache.clear();
}
