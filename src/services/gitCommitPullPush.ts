import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";
import { executeClaudeCodeAndWait, getClaudeConfigModel } from "./claude";
import { gitCommit, gitPull, gitPush, gitStageAll, gitStatus } from "./git";
import { extractClaudeInvocationFinalText } from "../utils/claudeInvocationText";
import {
  buildConventionalCommitFallback,
  conventionalCommitPromptLines,
  normalizeConventionalCommitMessage,
} from "../utils/conventionalCommitMessage";

export function hasWorkingTreeChanges(status: GitStatusResponse): boolean {
  return status.staged.length > 0 || status.unstaged.length > 0;
}

export function hasUnpushedCommits(status: GitStatusResponse): boolean {
  return (status.ahead ?? 0) > 0;
}

/** 当前分支是否已配置 upstream（无上游时 ahead/behind 不可用，pull 也会失败）。 */
export function hasUpstreamTracking(status: Pick<GitStatusResponse, "upstream">): boolean {
  return Boolean(status.upstream?.trim());
}

/**
 * 本地已有分支名、但尚未关联远程跟踪分支：需要 `git push -u` 发布。
 * 常见于本机 `checkout -b` 新建分支后首次推送。
 */
export function needsPublishBranch(
  status: Pick<GitStatusResponse, "upstream" | "branch">,
): boolean {
  return Boolean(status.branch?.trim()) && !hasUpstreamTracking(status);
}

export function needsGitSyncWork(status: GitStatusResponse): boolean {
  return hasWorkingTreeChanges(status) || hasUnpushedCommits(status) || needsPublishBranch(status);
}

export function needsGitSyncWorkFromSummary(summary: GitStatusSummaryResponse): boolean {
  return summary.stagedCount > 0 || summary.unstagedCount > 0 || (summary.ahead ?? 0) > 0;
}

export type GitCommitPullPushOutcome = "committed_and_pushed" | "pushed_only" | "noop";

/** git pull/merge 冲突在错误信息中的典型标记（大小写不敏感）。 */
const GIT_MERGE_CONFLICT_MARKERS = [
  "conflict (",
  "merge conflict",
  "fix conflicts",
  "fix the conflicts",
  "automatic merge failed",
  "automatic cherry-pick failed",
];

/** 判定一次 git 提交/拉取/推送错误是否源于合并冲突（需人工解决，不应派发 AI 改代码）。 */
export function isGitMergeConflictError(errMsg: string): boolean {
  const lower = errMsg.toLowerCase();
  return GIT_MERGE_CONFLICT_MARKERS.some((marker) => lower.includes(marker));
}

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
  const publishBranch = needsPublishBranch(status);
  if (!hasChanges && !hasAhead && !publishBranch) {
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

  // 新本地分支尚无 upstream 时 `git pull` 会失败；此时无可拉取内容，直接进入 push -u。
  if (hasUpstreamTracking(status)) {
    hooks?.onPhase?.("拉取");
    await gitPull(path);
  }
  hooks?.onPhase?.("推送");
  await gitPush(path);
  return hasChanges ? "committed_and_pushed" : "pushed_only";
}

export interface AiCommitPullPushHooks {
  onPhase?: (phase: string) => void;
}

/**
 * 一体化推送：AI 生成提交信息（失败/超时回退规则生成，不阻断）→ 暂存 → 提交 → 拉取 → 推送。
 * 无弹窗、无手动确认，点击即执行完整流程。供会话快捷面板与 git 面板顶部推送共用，
 * 保证两处「推送」行为一致。
 *
 * @returns 与 {@link commitPullPushRepository} 相同的结局：committed_and_pushed / pushed_only / noop
 */
export async function aiCommitPullPushRepository(
  path: string,
  hooks?: AiCommitPullPushHooks,
): Promise<GitCommitPullPushOutcome> {
  const onPhase = hooks?.onPhase;

  onPhase?.("读取变更");
  const status = await gitStatus(path);
  const fallback = normalizeConventionalCommitMessage(buildConventionalCommitFallback(status));
  let commitMessage = fallback;

  const changedFiles = [...status.staged, ...status.unstaged];
  if (changedFiles.length > 0) {
    onPhase?.("AI 润色");
    const changedFileLines = changedFiles
      .map((item) => `- ${item.path} (${item.status}, +${item.additions}, -${item.deletions})`)
      .join("\n");
    const prompt = [
      ...conventionalCommitPromptLines(),
      "",
      `仓库路径: ${path}`,
      `分支: ${status.branch ?? "(unknown)"}`,
      `总计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
      `暂存文件数: ${status.staged.length}, 未暂存文件数: ${status.unstaged.length}`,
      "文件清单：",
      changedFileLines || "- 无",
    ].join("\n");
    const configuredModel = await getClaudeConfigModel(path);

    const result = await executeClaudeCodeAndWait({
      repositoryPath: path,
      prompt,
      model: configuredModel ?? undefined,
      timeoutMs: 20_000,
      connectionMode: "oneshot",
    });
    if (result.success) {
      const cleaned = extractClaudeInvocationFinalText(result.outputLines);
      commitMessage = normalizeConventionalCommitMessage(cleaned || fallback);
    }
    // AI 失败/超时：commitMessage 保持 fallback，流程继续
  }

  return commitPullPushRepository(path, commitMessage, { onPhase });
}
