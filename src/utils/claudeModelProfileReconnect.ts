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
