import { invoke, isTauri } from "@tauri-apps/api/core";

export type ClaudeUsageGranularity = "day" | "week" | "month";

export interface ClaudeUsageBucket {
  sortKey: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  /** `cacheRead / (input + cacheCreation + cacheRead)`，无输入侧 token 时为 null */
  cacheHitRate: number | null;
  costUsd: number;
  costEntries: number;
}

export interface ClaudeUsageSeriesPayload {
  buckets: ClaudeUsageBucket[];
  totalTokens: number;
  totalInputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  cacheHitRate: number | null;
  totalCostUsd: number;
  totalCostEntries: number;
  periodCaption: string;
}

export interface ClaudeUsageSnapshotResponse {
  day: ClaudeUsageSeriesPayload;
  week: ClaudeUsageSeriesPayload;
  month: ClaudeUsageSeriesPayload;
  scannedFiles: number;
  dataRoots: string[];
  hint: string | null;
  eventsParsed: number;
}

export interface ClaudeCodeUsageSnapshotOptions {
  /** 限定仓库绝对路径；省略则统计本机全部 Claude Code JSONL。 */
  projectPath?: string | null;
}

const USAGE_SNAPSHOT_CACHE_TTL_MS = 60_000;

type UsageSnapshotCacheEntry = {
  at: number;
  value: ClaudeUsageSnapshotResponse | null;
};

const usageSnapshotCache = new Map<string, UsageSnapshotCacheEntry>();

function usageSnapshotCacheKey(projectPath: string | null): string {
  return projectPath ?? "__all__";
}

/** 清除用量快照缓存；省略 projectPath 时清空全部。 */
export function invalidateClaudeCodeUsageSnapshotCache(projectPath?: string | null): void {
  if (projectPath === undefined) {
    usageSnapshotCache.clear();
    return;
  }
  usageSnapshotCache.delete(usageSnapshotCacheKey(projectPath?.trim() || null));
}

/** 异步：在 Rust 侧 `spawn_blocking` 中扫描磁盘，一次返回日/周/月三套聚合，避免切换粒度时重复 IO。 */
export async function getClaudeCodeUsageSnapshot(
  options?: ClaudeCodeUsageSnapshotOptions,
): Promise<ClaudeUsageSnapshotResponse | null> {
  if (!isTauri()) {
    return null;
  }
  const projectPath = options?.projectPath?.trim() || null;
  const cacheKey = usageSnapshotCacheKey(projectPath);
  const cached = usageSnapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.at < USAGE_SNAPSHOT_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await invoke<ClaudeUsageSnapshotResponse>("get_claude_code_usage_snapshot", {
    projectPath,
  });
  usageSnapshotCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
