import type { GitStatusResponse } from "../types";
import { refreshGitRepositoryStats } from "../stores/gitRepositoryStatsStore";
import { gitCommit, gitPull, gitPush, gitStageAll, gitStatus } from "./git";

export interface GitWorkspaceRepositoryRef {
  path: string;
  name: string;
}

export interface GitWorkspaceRepoStatus {
  path: string;
  name: string;
  status: GitStatusResponse;
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

export async function loadGitWorkspaceRepoStatuses(
  entries: readonly GitWorkspaceRepositoryRef[],
): Promise<GitWorkspaceRepoStatus[]> {
  const results = await Promise.all(
    entries.map(async (entry) => {
      const status = await gitStatus(entry.path);
      return { path: entry.path, name: entry.name, status };
    }),
  );
  return results;
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
