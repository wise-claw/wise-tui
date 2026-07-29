import { EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES } from "./executionEnvironmentDispatch";
import type { SessionExecutionEngine } from "./sessionExecutionEngine";

/** 将需求派发到 pane 0 主会话的当前执行环境（开 worker，不占主会话队列）。 */
export const WISE_UI_EVENT_DISPATCH_REQUIREMENT_TO_EXEC_ENV =
  "wise:dispatch-requirement-to-execution-environment";

export interface DispatchRequirementToExecutionEnvironmentDetail {
  /** 已组装的图文正文（可含 `附图：@/path`），不含 @执行引擎 前缀 */
  promptText: string;
  /** 写入 worker 气泡的正文；默认与 promptText 相同 */
  userBubblePrompt?: string;
  source?: "workspace-requirement";
  /**
   * 同步回调：ClaudeChat 已接收并开始派发时调用。
   * `dispatchEvent` 为同步，调用方可据此判断是否有监听方处理。
   */
  onAccepted?: () => void;
}

export function dispatchRequirementToExecutionEnvironment(
  detail: DispatchRequirementToExecutionEnvironmentDetail,
): boolean {
  const promptText = typeof detail.promptText === "string" ? detail.promptText.trim() : "";
  if (!promptText) return false;
  let accepted = false;
  window.dispatchEvent(
    new CustomEvent<DispatchRequirementToExecutionEnvironmentDetail>(
      WISE_UI_EVENT_DISPATCH_REQUIREMENT_TO_EXEC_ENV,
      {
        detail: {
          promptText,
          userBubblePrompt:
            typeof detail.userBubblePrompt === "string" && detail.userBubblePrompt.trim()
              ? detail.userBubblePrompt.trim()
              : promptText,
          source: detail.source,
          onAccepted: () => {
            accepted = true;
            detail.onAccepted?.();
          },
        },
      },
    ),
  );
  return accepted;
}

/** 为执行环境派发拼上当前引擎的 @mention（如 `@Claude Code`）。 */
export function prefixExecutionEnvironmentMention(
  promptText: string,
  engine: SessionExecutionEngine,
): string {
  const body = promptText.trim();
  if (!body) return body;
  const mention = EXECUTION_ENVIRONMENT_ENGINE_MENTION_NAMES[engine] ?? "Claude Code";
  if (body.startsWith(`@${mention}`) || body.startsWith(`＠${mention}`)) {
    return body;
  }
  return `@${mention}\n${body}`;
}

/** @deprecated 旧待执行队列入队事件；需求派发已改为执行环境 */
export const WISE_UI_EVENT_ENQUEUE_PENDING_TASK = "wise:enqueue-pending-task";

/** @deprecated */
export type EnqueuePendingTaskDetail = DispatchRequirementToExecutionEnvironmentDetail & {
  executorLabel?: string;
  onEnqueued?: () => void;
};

/** @deprecated 请用 dispatchRequirementToExecutionEnvironment */
export function dispatchEnqueuePendingTask(
  detail: EnqueuePendingTaskDetail,
): boolean {
  return dispatchRequirementToExecutionEnvironment({
    promptText: detail.promptText,
    userBubblePrompt: detail.userBubblePrompt,
    source: detail.source,
    onAccepted: detail.onAccepted ?? detail.onEnqueued,
  });
}
