import { sessionUsesStreamingConnection, type ClaudeSessionConnectionKind } from "../constants/claudeConnection";
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

/** `assistant.tool_use` 的 id（如 toolu_）通常不是 stdin `control_response` 的 request_id。 */
export function isToolUseQuestionRequestId(requestId: string): boolean {
  const id = requestId.trim().toLowerCase();
  return id.startsWith("toolu_") || id.startsWith("tool_");
}

/**
 * 第三方 API 模型（如 Qwen3.7 / 百炼）：Claude Code 壳仍可能流出 AskUserQuestion，但 stdin `control_response` 常被忽略并卡住；
 * 应优先写 stream-json 用户消息续跑，而不是 `control_response`。
 */
export function shouldPreferStreamUserMessageForQuestion(model: string | undefined | null): boolean {
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return false;
  return /qwen|deepseek|bailian|glm|moonshot|kimi|doubao|minimax/.test(m);
}

/** 标签 `model` 或仓库/全局 `settings.json` 任一命中代理模型即可。 */
export function shouldUseProxyQuestionResumeDelivery(
  sessionModel: string | undefined | null,
  configModel: string | undefined | null,
): boolean {
  return (
    shouldPreferStreamUserMessageForQuestion(sessionModel) ||
    shouldPreferStreamUserMessageForQuestion(configModel)
  );
}

/** 长驻 streaming 子进程仍存活时，AskUserQuestion 须写 stdin control_response，不能改发 resume 用户消息。 */
export function hasLiveStreamingClaudeProcess(input: {
  session: ClaudeSession | undefined;
  defaultConnectionKind?: ClaudeSessionConnectionKind;
  /** 该标签是否仍登记了长驻 spawn（init 前 `claudeSessionId` 可能仍为 null）。 */
  streamingTabTracked?: boolean;
  streamingProcessClaudeSessionId?: string | null;
}): boolean {
  const { session, defaultConnectionKind, streamingTabTracked, streamingProcessClaudeSessionId } = input;
  if (!session || !sessionUsesStreamingConnection(session, defaultConnectionKind)) return false;
  if (!streamingTabTracked) return false;
  const liveSid = session.claudeSessionId?.trim();
  if (!liveSid) return false;
  const trackedSid = streamingProcessClaudeSessionId?.trim();
  if (!trackedSid) return true;
  return trackedSid === liveSid;
}

/**
 * 选择题答案应经 resume 续跑而非 stdin control_response：
 * - lifecycle 已 expired / failed（含首次 stdin 失败后重试）
 * - 会话已不在 running/connecting（complete 后 Dock 仍可见）
 * 长驻 streaming 且子进程仍存活时除外（单轮 result 后 UI 为 idle/expired，但 stdin 仍等待 control_response）。
 */
export function shouldDeliverQuestionViaResume(
  lifecycle: ControlRequestLifecycle | null | undefined,
  session: ClaudeSession | undefined,
  options?: { preferStdinControlResponse?: boolean },
): boolean {
  if (options?.preferStdinControlResponse) return false;
  const status = lifecycle?.status;
  if (status === "expired" || status === "failed") return true;
  if (!session) return false;
  return session.status !== "running" && session.status !== "connecting";
}
