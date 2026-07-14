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
  /** 输出 token 总量；与 `totalTokens` 拆分展示，便于和"输入侧缓存命中率"分母区分。 */
  totalOutputTokens: number;
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

export interface ClaudeLineEditsDayBucket {
  date: string;
  linesEdited: number;
  diffCount: number;
  /** Edit/Write/MultiEdit 等工具调用产生的新增行数。 */
  linesAdded: number;
  /** Edit/Write/MultiEdit 等工具调用产生的删除行数。 */
  linesRemoved: number;
}

/** 固定时间窗口内的代码编辑量聚合。 */
export interface ClaudeLineEditsWindowSummary {
  linesEdited: number;
  linesAdded: number;
  linesRemoved: number;
  diffCount: number;
}

export interface ClaudeLineEditsSnapshotResponse {
  totalLinesEdited: number;
  /** 近一年汇总：新增行数。 */
  totalLinesAdded: number;
  /** 近一年汇总：删除行数。 */
  totalLinesRemoved: number;
  totalDiffCount: number;
  days: ClaudeLineEditsDayBucket[];
  /** 最近 7 天聚合；无数据时为 null。 */
  last7Days: ClaudeLineEditsWindowSummary | null;
  /** 最近 30 天聚合；无数据时为 null。 */
  last30Days: ClaudeLineEditsWindowSummary | null;
  mostActiveMonth: string | null;
  mostActiveDay: string | null;
  longestStreakDays: number;
  currentStreakDays: number;
  scannedFiles: number;
  dataRoots: string[];
  hint: string | null;
  eventsParsed: number;
}

export interface ClaudeCodeUsageSnapshotOptions {
  /** 限定仓库绝对路径；省略则统计本机全部 Claude / Cursor / OpenCode / Codex 落盘数据。 */
  projectPath?: string | null;
}

const USAGE_SNAPSHOT_CACHE_TTL_MS = 60_000;

type UsageSnapshotCacheEntry = {
  at: number;
  value: ClaudeUsageSnapshotResponse | null;
};

type LineEditsSnapshotCacheEntry = {
  at: number;
  value: ClaudeLineEditsSnapshotResponse | null;
};

const usageSnapshotCache = new Map<string, UsageSnapshotCacheEntry>();
const lineEditsSnapshotCache = new Map<string, LineEditsSnapshotCacheEntry>();

function usageSnapshotCacheKey(projectPath: string | null): string {
  return projectPath ?? "__all__";
}

/** 清除用量快照缓存；省略 projectPath 时清空全部。 */
export function invalidateClaudeCodeUsageSnapshotCache(projectPath?: string | null): void {
  if (projectPath === undefined) {
    usageSnapshotCache.clear();
    lineEditsSnapshotCache.clear();
    return;
  }
  const key = usageSnapshotCacheKey(projectPath?.trim() || null);
  usageSnapshotCache.delete(key);
  lineEditsSnapshotCache.delete(key);
}

/** 异步：在 Rust 侧 `spawn_blocking` 中扫描磁盘，一次返回日/周/月三套聚合，避免切换粒度时重复 IO。
 *  数据源：Claude Code JSONL + Codex sessions + OpenCode DB。 */
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

/** 异步：扫描 Claude / Cursor / OpenCode / Codex 编辑记录，返回近一年代码编辑量热力图数据。 */
export async function getClaudeCodeLineEditsSnapshot(
  options?: ClaudeCodeUsageSnapshotOptions,
): Promise<ClaudeLineEditsSnapshotResponse | null> {
  if (!isTauri()) {
    return null;
  }
  const projectPath = options?.projectPath?.trim() || null;
  const cacheKey = usageSnapshotCacheKey(projectPath);
  const cached = lineEditsSnapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.at < USAGE_SNAPSHOT_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await invoke<ClaudeLineEditsSnapshotResponse>("get_claude_code_line_edits_snapshot", {
    projectPath,
  });
  lineEditsSnapshotCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
