import type { ClaudeSession } from "../types";
import type { ControlRequestLifecycle } from "../notifications";

/** Claude stdin 已关闭或目标会话不可写时，应改走 resume 用户消息续跑。 */
export const QUESTION_STDIN_UNAVAILABLE_RE =
  /没有可写 stdin|未指定目标会话|broken pipe|stream closed|连接已重置|连接被对方|已结束|os error 32/i;

export function isQuestionStdinUnavailableError(message: string): boolean {
  const msg = message.trim();
  if (!msg) return false;
  return QUESTION_STDIN_UNAVAILABLE_RE.test(msg);
}

/**
 * 选择题答案应经 resume 续跑而非 stdin control_response：
 * - lifecycle 已 expired / failed（含首次 stdin 失败后重试）
 * - 会话已不在 running/connecting（complete 后 Dock 仍可见）
 */
export function shouldDeliverQuestionViaResume(
  lifecycle: ControlRequestLifecycle | null | undefined,
  session: ClaudeSession | undefined,
): boolean {
  const status = lifecycle?.status;
  if (status === "expired" || status === "failed") return true;
  if (!session) return false;
  return session.status !== "running" && session.status !== "connecting";
}
