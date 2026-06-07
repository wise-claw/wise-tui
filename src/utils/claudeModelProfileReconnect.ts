import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  indexOfLastRenderableUserMessage,
  userMessagePlainTextForDisplay,
} from "./claudeChatMessageDisplay";

/** 模型切换后 resume 续跑：优先使用进行中的 turn prompt，否则取最后一条用户消息。 */
export function resolveClaudeResumePromptAfterModelSwitch(input: {
  session: ClaudeSession;
  pendingTurnPrompt?: string | null;
}): string | null {
  const pending = input.pendingTurnPrompt?.trim();
  if (pending) return pending;

  const idx = indexOfLastRenderableUserMessage(input.session.messages);
  if (idx < 0) return null;
  const msg = input.session.messages[idx] as ClaudeMessage | undefined;
  if (!msg) return null;
  const text = userMessagePlainTextForDisplay(msg).trim();
  return text || null;
}

export interface ClaudeModelSwitchReconnectPlan {
  /** 需要断开旧子进程 / streaming 缓存。 */
  shouldTeardownHost: boolean;
  /** 切换后自动 resume 当前轮次（仅运行中且可解析 prompt 时）。 */
  shouldAutoResume: boolean;
  resumePrompt: string | null;
  /** 需写入 session.model 的新模型；相同时为空。 */
  updateModel: string | null;
  /** 需展示的系统提示；无需打扰用户时为 null。 */
  notifyMessage: string | null;
}

export function buildClaudeModelSwitchReconnectPlan(input: {
  session: ClaudeSession;
  effectiveModel?: string | null;
  pendingTurnPrompt?: string | null;
  hasStreamingProcess: boolean;
  hasInflightInvocation: boolean;
  isTerminalWorker: boolean;
  isFailoverInProgress: boolean;
}): ClaudeModelSwitchReconnectPlan {
  const session = input.session;
  const newModel = input.effectiveModel?.trim() || null;
  const previousModel = session.model?.trim() || "";
  const modelChanged = Boolean(newModel && newModel !== previousModel);
  const wasActive = session.status === "running" || session.status === "connecting";
  const shouldTeardownHost =
    wasActive || input.hasStreamingProcess || input.hasInflightInvocation;

  const resumePrompt = resolveClaudeResumePromptAfterModelSwitch({
    session,
    pendingTurnPrompt: input.pendingTurnPrompt,
  });

  const shouldAutoResume =
    wasActive &&
    Boolean(resumePrompt) &&
    !input.isTerminalWorker &&
    !input.isFailoverInProgress;

  let notifyMessage: string | null = null;
  if (shouldAutoResume) {
    notifyMessage = "模型已切换，正在使用新模型继续当前会话…";
  } else if (wasActive) {
    notifyMessage = "模型已切换。当前轮次已停止，请重新发送以使用新模型继续会话。";
  } else if (modelChanged || input.hasStreamingProcess) {
    notifyMessage = "模型已切换，下次发送将使用新模型继续本会话。";
  }

  return {
    shouldTeardownHost,
    shouldAutoResume,
    resumePrompt,
    updateModel: modelChanged ? newModel : null,
    notifyMessage,
  };
}
