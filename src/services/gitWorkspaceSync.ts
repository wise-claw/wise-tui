import { refreshGitRepositoryStats } from "../stores/gitRepositoryStatsStore";
import { refreshGitRepositoryExplorerStatus } from "../stores/gitRepositoryExplorerStatusStore";
import {
  commitPullPushRepository,
  hasWorkingTreeChanges,
  needsGitSyncWork,
  needsGitSyncWorkFromSummary,
} from "./gitCommitPullPush";
import { gitStatusSummary } from "./git";

export interface GitWorkspaceRepositoryRef {
  path: string;
  name: string;
}

export interface GitWorkspaceRepoSyncResult {
  path: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
  pushedOnly?: boolean;
  error?: string;
}

export { hasWorkingTreeChanges, needsGitSyncWork, needsGitSyncWorkFromSummary };

/** @deprecated 使用 needsGitSyncWork */
export function hasGitWorkspaceChanges(
  status: Parameters<typeof hasWorkingTreeChanges>[0],
): boolean {
  return hasWorkingTreeChanges(status);
}

/** 统计需要 commit/push 的仓库数（含仅有 ahead 提交、无工作区改动的仓）。 */
export async function countGitWorkspaceSyncableRepositories(
  entries: readonly GitWorkspaceRepositoryRef[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const flags = await Promise.all(
    entries.map(async (entry) => {
      try {
        const summary = await gitStatusSummary(entry.path);
        return needsGitSyncWorkFromSummary(summary);
      } catch {
        return false;
      }
    }),
  );
  return flags.filter(Boolean).length;
}

/** @deprecated 使用 countGitWorkspaceSyncableRepositories */
export async function countGitWorkspaceDirtyRepositories(
  entries: readonly GitWorkspaceRepositoryRef[],
): Promise<number> {
  return countGitWorkspaceSyncableRepositories(entries);
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
      const outcome = await commitPullPushRepository(entry.path, trimmed, {
        onPhase: () => onProgress?.(entry, index + 1, total),
      });
      if (outcome === "noop") {
        results.push({ path: entry.path, name: entry.name, ok: true, skipped: true });
        continue;
      }
      refreshGitRepositoryStats(entry.path);
      refreshGitRepositoryExplorerStatus(entry.path);
      results.push({
        path: entry.path,
        name: entry.name,
        ok: true,
        pushedOnly: outcome === "pushed_only",
      });
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
  pushedOnlyCount: number;
  skippedCount: number;
  failed: GitWorkspaceRepoSyncResult[];
} {
  let committedCount = 0;
  let pushedOnlyCount = 0;
  let skippedCount = 0;
  const failed: GitWorkspaceRepoSyncResult[] = [];

  for (const result of results) {
    if (!result.ok) {
      failed.push(result);
      continue;
    }
    if (result.skipped) {
      skippedCount += 1;
    } else if (result.pushedOnly) {
      pushedOnlyCount += 1;
    } else {
      committedCount += 1;
    }
  }

  return { committedCount, pushedOnlyCount, skippedCount, failed };
}
