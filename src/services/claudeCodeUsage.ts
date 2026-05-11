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
  costUsd: number;
  costEntries: number;
}

export interface ClaudeUsageSeriesPayload {
  buckets: ClaudeUsageBucket[];
  totalTokens: number;
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

/** 异步：在 Rust 侧 `spawn_blocking` 中扫描磁盘，一次返回日/周/月三套聚合，避免切换粒度时重复 IO。 */
export async function getClaudeCodeUsageSnapshot(): Promise<ClaudeUsageSnapshotResponse | null> {
  if (!isTauri()) {
    return null;
  }
  return invoke<ClaudeUsageSnapshotResponse>("get_claude_code_usage_snapshot");
}
