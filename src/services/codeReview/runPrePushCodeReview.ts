import type { SessionExecutionEngine } from "../../constants/sessionExecutionEngine";
import type { CodeReviewRun } from "../../types/codeReview";
import { publishCodeReviewFindings } from "../../stores/codeReviewFindingsStore";
import { ingestCodeReviewNotification } from "./codeReviewNotification";
import {
  isBlockingCodeReviewRecommendation,
  loadCodeReviewSettings,
  type CodeReviewPrePushMode,
} from "./codeReviewSettings";
import { runCodeReview } from "./runCodeReview";

export type PrePushCodeReviewDecision =
  /** `run` 存在时表示审查跑过且未阻断，调用方可提示非阻断发现。 */
  | { action: "continue"; run?: CodeReviewRun }
  | { action: "abort"; reason: string; run?: CodeReviewRun }
  | { action: "confirm"; reason: string; run: CodeReviewRun };

/**
 * 推送前审查门闸。`off` 直接放行；`warn`/`block` 会跑一轮未提交优先、否则相对主干的审查。
 */
export async function evaluatePrePushCodeReview(input: {
  repositoryPath: string;
  hasUncommittedChanges: boolean;
  executionEngine?: SessionExecutionEngine | null;
  onInvocationKey?: (invocationKey: string) => void;
  /** 测试或调用方注入，跳过读盘 */
  prePushMode?: CodeReviewPrePushMode;
}): Promise<PrePushCodeReviewDecision> {
  const settings = input.prePushMode
    ? { prePushMode: input.prePushMode }
    : await loadCodeReviewSettings();
  if (settings.prePushMode === "off") {
    return { action: "continue" };
  }

  const scope = input.hasUncommittedChanges ? "uncommitted" : "branch";
  const result = await runCodeReview({
    repositoryPath: input.repositoryPath,
    scope,
    executionEngine: input.executionEngine,
    onInvocationKey: input.onInvocationKey,
  });

  if (!result.ok) {
    if (result.empty) {
      return { action: "continue" };
    }
    if (settings.prePushMode === "block") {
      return { action: "abort", reason: `推送前审查失败：${result.error}` };
    }
    return {
      action: "confirm",
      reason: `推送前审查失败：${result.error}。仍要继续推送吗？`,
      run: {
        id: "cr-failed",
        repositoryPath: input.repositoryPath,
        scope,
        baseRef: null,
        branch: null,
        createdAtMs: Date.now(),
        recommendation: "COMMENT",
        summary: result.error,
        findings: [],
        openQuestions: [],
      },
    };
  }

  // 门闸跑出的结果也要落到编辑器标注与通知中心，否则放行后用户看不到任何结论。
  publishCodeReviewFindings(result.run);
  void ingestCodeReviewNotification(result.run, { reused: result.reused });

  const blocking = isBlockingCodeReviewRecommendation(
    String(result.run.recommendation),
    result.run.findings,
  );
  if (!blocking) {
    return { action: "continue", run: result.run };
  }

  const reason = `审查建议修改（${result.run.findings.length} 项）：${result.run.summary}`;
  if (settings.prePushMode === "block") {
    return { action: "abort", reason, run: result.run };
  }
  return { action: "confirm", reason: `${reason}。仍要继续推送吗？`, run: result.run };
}
