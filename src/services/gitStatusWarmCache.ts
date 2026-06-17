import type { GitStatusResponse } from "../types";
import { gitStatus } from "./git";

const TTL_MS = 45_000;

type WarmEntry = {
  at: number;
  promise: Promise<GitStatusResponse>;
};

const warmByPath = new Map<string, WarmEntry>();

function normalizePath(repositoryPath: string): string {
  return repositoryPath.trim();
}

/** 侧栏划过时预拉 git status，切换仓库时 Git 面板可复用进行中的 IPC。 */
export function prefetchGitStatus(repositoryPath: string): void {
  const path = normalizePath(repositoryPath);
  if (!path) return;
  const existing = warmByPath.get(path);
  if (existing && Date.now() - existing.at < TTL_MS) {
    return;
  }
  warmByPath.set(path, {
    at: Date.now(),
    promise: gitStatus(path).catch((error) => {
      warmByPath.delete(path);
      throw error;
    }),
  });
}

/** GitPanel 首屏加载时优先消费预热结果。 */
export function consumeWarmGitStatus(repositoryPath: string): Promise<GitStatusResponse> | null {
  const path = normalizePath(repositoryPath);
  if (!path) return null;
  const entry = warmByPath.get(path);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    warmByPath.delete(path);
    return null;
  }
  warmByPath.delete(path);
  return entry.promise;
}

export function clearGitStatusWarmCache(): void {
  warmByPath.clear();
}
