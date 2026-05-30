import type { GitStatusResponse } from "../types";
import { refreshGitRepositoryStats } from "../stores/gitRepositoryStatsStore";
import { gitCommit, gitPull, gitPush, gitStageAll, gitStatus, gitStatusSummary } from "./git";

export interface GitWorkspaceRepositoryRef {
  path: string;
  name: string;
}

export interface GitWorkspaceRepoSyncResult {
  path: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export function hasGitWorkspaceChanges(status: GitStatusResponse): boolean {
  return status.staged.length > 0 || status.unstaged.length > 0;
}

/** 轻量统计：有改动的仓库数量（不含文件列表）。 */
export async function countGitWorkspaceDirtyRepositories(
  entries: readonly GitWorkspaceRepositoryRef[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const flags = await Promise.all(
    entries.map(async (entry) => {
      try {
        const summary = await gitStatusSummary(entry.path);
        return summary.stagedCount > 0 || summary.unstagedCount > 0;
      } catch {
        return false;
      }
    }),
  );
  return flags.filter(Boolean).length;
}

export async function commitAndPushWorkspaceRepositories(
  entries: readonly GitWorkspaceRepositoryRef[],
  message: string,
  onProgress?: (current: GitWorkspaceRepositoryRef, index: number, total: number) => void,
): Promise<GitWorkspaceRepoSyncResult[]> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("提交信息不能为空");
  }

  const results: GitWorkspaceRepoSyncResult[] = [];
  const total = entries.length;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    onProgress?.(entry, index + 1, total);
    try {
      const status = await gitStatus(entry.path);
      if (!hasGitWorkspaceChanges(status)) {
        results.push({ path: entry.path, name: entry.name, ok: true, skipped: true });
        continue;
      }
      if (status.unstaged.length > 0) {
        await gitStageAll(entry.path);
      }
      await gitCommit(entry.path, trimmed);
      await gitPull(entry.path);
      await gitPush(entry.path);
      refreshGitRepositoryStats(entry.path);
      results.push({ path: entry.path, name: entry.name, ok: true });
    } catch (error) {
      results.push({
        path: entry.path,
        name: entry.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function summarizeGitWorkspaceSyncResults(results: readonly GitWorkspaceRepoSyncResult[]): {
  committedCount: number;
  skippedCount: number;
  failed: GitWorkspaceRepoSyncResult[];
} {
  let committedCount = 0;
  let skippedCount = 0;
  const failed: GitWorkspaceRepoSyncResult[] = [];

  for (const result of results) {
    if (!result.ok) {
      failed.push(result);
      continue;
    }
    if (result.skipped) {
      skippedCount += 1;
    } else {
      committedCount += 1;
    }
  }

  return { committedCount, skippedCount, failed };
}
