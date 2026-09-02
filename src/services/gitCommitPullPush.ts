import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";
import {
  gitCommit,
  gitPull,
  gitPush,
  gitStageAll,
  gitStatus,
} from "./git";
import { generateGitCommitMessageByAi } from "./gitCommitMessageAi";
import type { executeSessionEngineAndWait } from "./sessionEngineInvocation";

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

/** 排除 detached HEAD（后端格式为 `(abc1234)`）与占位名。 */
export function isNamedLocalBranch(branch: string | null | undefined): boolean {
  const name = branch?.trim() ?? "";
  if (!name || name === "-" || name === "(detached)") return false;
  if (name.startsWith("(") && name.endsWith(")")) return false;
  return true;
}

/**
 * 本地已有分支名、但尚未关联远程跟踪分支：需要 `git push -u` 发布。
 * 常见于本机 `checkout -b` 新建分支后首次推送。
 */
export function needsPublishBranch(
  status: Pick<GitStatusResponse, "upstream" | "branch">,
): boolean {
  return isNamedLocalBranch(status.branch) && !hasUpstreamTracking(status);
}

export function needsGitSyncWork(status: GitStatusResponse): boolean {
  return hasWorkingTreeChanges(status) || hasUnpushedCommits(status) || needsPublishBranch(status);
}

export function needsGitSyncWorkFromSummary(summary: GitStatusSummaryResponse): boolean {
  return (
    summary.stagedCount > 0
    || summary.unstagedCount > 0
    || (summary.ahead ?? 0) > 0
    || needsPublishBranch(summary)
  );
}

export type GitCommitPullPushOutcome =
  | "committed_and_pushed"
  | "pushed_only"
  | "published"
  | "noop";

/** 推送成功后的用户可见文案；noop 返回 null。 */
export function gitCommitPullPushSuccessMessage(
  outcome: GitCommitPullPushOutcome,
): string | null {
  switch (outcome) {
    case "committed_and_pushed":
      return "已提交并推送";
    case "pushed_only":
      return "已推送待同步提交";
    case "published":
      return "已同步分支到远端";
    case "noop":
      return null;
  }
}

export function gitCommitPullPushNoopMessage(): string {
  return "当前没有可提交的改动，也没有待推送或待同步的分支";
}

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
  hooks?.onPhase?.("读取变更");
  const status = await gitStatus(path);
  const hasChanges = hasWorkingTreeChanges(status);
  const hasAhead = hasUnpushedCommits(status);
  const publishBranch = needsPublishBranch(status);
  if (!hasChanges && !hasAhead && !publishBranch) {
    return "noop";
  }

  if (hasChanges) {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error("提交信息不能为空");
    }
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
  if (hasChanges) return "committed_and_pushed";
  if (publishBranch && !hasAhead) return "published";
  return "pushed_only";
}

export interface AiCommitPullPushHooks {
  onPhase?: (phase: string) => void;
  /**
   * 当前仓库选中的执行引擎，作为默认执行环境失败后的回退。
   * Gemini 等不支持 oneshot 时会跳过，全部失败则改用规则生成（不阻断推送）。
   */
  executionEngine?: SessionExecutionEngine | null;
  /** 测试可注入默认执行环境；默认读工作台缓存。 */
  getDefaultEngine?: () => SessionExecutionEngine;
  /** 测试可注入；默认 `executeSessionEngineAndWait`。 */
  invokeEngine?: typeof executeSessionEngineAndWait;
  /** AI 全部失败、改用规则提交信息时通知调用方。 */
  onAiFallback?: (detail: { executionEngine: SessionExecutionEngine; reason: string }) => void;
}

/**
 * 一体化推送：AI 生成提交信息（先默认执行环境，失败再试仓库引擎；再失败回退规则生成）
 * → 暂存 → 提交 → 拉取 → 推送。
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
  const changedFiles = [...status.staged, ...status.unstaged];
  let commitMessage = "";

  if (changedFiles.length > 0) {
    onPhase?.("AI 润色");
    const generated = await generateGitCommitMessageByAi({
      repositoryPath: path,
      status,
      repositoryEngine: hooks?.executionEngine,
      getDefaultEngine: hooks?.getDefaultEngine,
      invokeEngine: hooks?.invokeEngine,
    });
    commitMessage = generated.message;
    if (generated.aiFailed) {
      hooks?.onAiFallback?.({
        executionEngine:
          generated.engineUsed ?? normalizeSessionExecutionEngine(hooks?.executionEngine),
        reason: generated.failureReason ?? "执行环境调用失败",
      });
    }
  }

  return commitPullPushRepository(path, commitMessage, { onPhase });
}
