import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";
import { gitCommit, gitPull, gitPush, gitStageAll, gitStatus } from "./git";

export function hasWorkingTreeChanges(status: GitStatusResponse): boolean {
  return status.staged.length > 0 || status.unstaged.length > 0;
}

export function hasUnpushedCommits(status: GitStatusResponse): boolean {
  return (status.ahead ?? 0) > 0;
}

export function needsGitSyncWork(status: GitStatusResponse): boolean {
  return hasWorkingTreeChanges(status) || hasUnpushedCommits(status);
}

export function needsGitSyncWorkFromSummary(summary: GitStatusSummaryResponse): boolean {
  return summary.stagedCount > 0 || summary.unstagedCount > 0 || (summary.ahead ?? 0) > 0;
}

export type GitCommitPullPushOutcome = "committed_and_pushed" | "pushed_only" | "noop";

export async function commitPullPushRepository(
  path: string,
  message: string,
  hooks?: { onPhase?: (phase: string) => void },
): Promise<GitCommitPullPushOutcome> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("提交信息不能为空");
  }

  hooks?.onPhase?.("读取变更");
  const status = await gitStatus(path);
  const hasChanges = hasWorkingTreeChanges(status);
  const hasAhead = hasUnpushedCommits(status);
  if (!hasChanges && !hasAhead) {
    return "noop";
  }

  if (hasChanges) {
    if (status.unstaged.length > 0) {
      hooks?.onPhase?.("暂存改动");
      await gitStageAll(path);
    }
    hooks?.onPhase?.("提交");
    await gitCommit(path, trimmed);
  }

  hooks?.onPhase?.("拉取");
  await gitPull(path);
  hooks?.onPhase?.("推送");
  await gitPush(path);
  return hasChanges ? "committed_and_pushed" : "pushed_only";
}
