import type { CodeReviewRun } from "../../types/codeReview";
import { countCodeReviewFindingSeverities } from "../../stores/codeReviewFindingsStore";

export type CodeReviewToastContext = "pre-push" | "background";

export type CodeReviewToastLevel = "success" | "info" | "warning";

export type CodeReviewToastContent = {
  level: CodeReviewToastLevel;
  title: string;
  description: string;
  /** 只有存在可查看的 findings 时才值得引导用户打开抽屉。 */
  actionable: boolean;
};

/**
 * 后台完成的审查（推送门闸放行、提交后自动审查）没有 Drawer 上下文，
 * 用一条中文气泡说明结论，避免结果“静默消失”。
 */
export function buildCodeReviewToastContent(
  run: CodeReviewRun,
  options?: { context?: CodeReviewToastContext },
): CodeReviewToastContent {
  const counts = countCodeReviewFindingSeverities(run.findings);
  const context = options?.context ?? "background";
  const prefix = context === "pre-push" ? "推送前审查" : "代码审查";
  const summary = run.summary.trim();

  if (counts.total === 0) {
    return {
      level: "success",
      title: `${prefix}：未发现问题`,
      description: summary || "本次变更未发现需要处理的问题。",
      actionable: false,
    };
  }

  if (counts.highOrCritical > 0) {
    return {
      level: "warning",
      title: `${prefix}：${counts.highOrCritical} 项高危 / 共 ${counts.total} 项`,
      description: summary || "已在编辑器中标注，建议先处理高危问题。",
      actionable: true,
    };
  }

  return {
    level: "info",
    title: `${prefix}：${counts.total} 项非阻断发现`,
    description: summary || "已在编辑器中标注，可稍后处理。",
    actionable: true,
  };
}
