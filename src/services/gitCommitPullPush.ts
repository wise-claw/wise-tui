import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import type { GitStatusResponse, GitStatusSummaryResponse } from "../types";
import { extractClaudeInvocationFinalText } from "../utils/claudeInvocationText";
import { humanizeClaudeError } from "../utils/humanizeClaudeError";
import {
  buildConventionalCommitFallback,
  conventionalCommitPromptLines,
  normalizeConventionalCommitMessage,
  parseAiConventionalCommitMessage,
} from "../utils/conventionalCommitMessage";
import { getClaudeConfigModel } from "./claude";
import {
  gitCommit,
  gitCommitMessageContext,
  gitPull,
  gitPush,
  gitStageAll,
  gitStatus,
} from "./git";
import { executeSessionEngineAndWait } from "./sessionEngineInvocation";

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
   * 当前会话/仓库选中的执行引擎。AI 润色走该引擎 oneshot；
   * 未传或 Gemini 等不支持时回退规则生成（不阻断推送）。
   */
  executionEngine?: SessionExecutionEngine | null;
  /** 测试可注入；默认 `executeSessionEngineAndWait`。 */
  invokeEngine?: typeof executeSessionEngineAndWait;
  /** AI 不可用或输出不合格、改用规则提交信息时通知调用方。 */
  onAiFallback?: (detail: { executionEngine: SessionExecutionEngine; reason: string }) => void;
}

function compactAiFailureReason(lines: readonly string[], fallback: string): string {
  const text = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  const compact = text.length > 180 ? `${text.slice(0, 180)}…` : text;
  return humanizeClaudeError(compact);
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
  const executionEngine = normalizeSessionExecutionEngine(hooks?.executionEngine);

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
    let diffContext = "";
    try {
      diffContext = await gitCommitMessageContext(path);
    } catch {
      // diff 读取失败仍可基于文件清单生成；不阻断后续提交与推送。
    }
    const prompt = [
      ...conventionalCommitPromptLines(),
      "",
      `仓库路径: ${path}`,
      `分支: ${status.branch ?? "(unknown)"}`,
      `总计: +${Math.max(0, status.additions || 0)} / -${Math.max(0, status.deletions || 0)}`,
      `暂存文件数: ${status.staged.length}, 未暂存文件数: ${status.unstaged.length}`,
      "文件清单：",
      changedFileLines || "- 无",
      "",
      "实际变更 diff（可能截断；以此判断改动目的）：",
      diffContext || "（diff 不可用，请基于文件清单生成）",
    ].join("\n");
    // Claude 才读仓库配置模型；其它引擎交给各自 CLI 默认，避免把 ANTHROPIC_MODEL 误传给 Codex 等。
    let configuredModel: string | undefined;
    if (executionEngine === "claude") {
      try {
        configuredModel = (await getClaudeConfigModel(path)) ?? undefined;
      } catch {
        // 配置读取失败时仍让 Claude CLI 使用自身默认模型；不应因此中断推送。
      }
    }

    const invokeEngine = hooks?.invokeEngine ?? executeSessionEngineAndWait;
    try {
      const result = await invokeEngine({
        executionEngine,
        repositoryPath: path,
        prompt,
        model: configuredModel ?? undefined,
        timeoutMs: 45_000,
      });
      if (result.success) {
        const cleaned = extractClaudeInvocationFinalText(result.outputLines);
        const parsed = parseAiConventionalCommitMessage(cleaned);
        if (parsed) {
          commitMessage = parsed;
        } else {
          hooks?.onAiFallback?.({
            executionEngine,
            reason: "AI 返回内容不符合提交信息格式",
          });
        }
      } else {
        const outputReason = extractClaudeInvocationFinalText(result.outputLines);
        hooks?.onAiFallback?.({
          executionEngine,
          reason: compactAiFailureReason(
            [...result.errorLines, outputReason],
            "执行环境调用失败",
          ),
        });
      }
    } catch (error) {
      hooks?.onAiFallback?.({
        executionEngine,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    // AI 失败/超时/输出不合格：commitMessage 保持 fallback，流程继续
  }

  return commitPullPushRepository(path, commitMessage, { onPhase });
}
