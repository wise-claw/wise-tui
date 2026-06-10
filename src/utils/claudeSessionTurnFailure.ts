import type { ClaudeMessage } from "../types";
import { isToolOnlyUserMessage } from "./claudeChatMessageDisplay";

const TURN_FAILURE_NOTICE_PREFIX = "Claude 轮次失败";

/** 当前轮次是否已写入 CLI/工具失败系统消息（用于抑制「正在思考」与 idle→running 回弹）。 */
export function sessionHadRecentClaudeTurnFailureNotice(messages: readonly ClaudeMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content.trim() : "";
      if (text.startsWith(TURN_FAILURE_NOTICE_PREFIX)) return true;
    }
    if (m.role === "user" && !isToolOnlyUserMessage(m)) return false;
  }
  return false;
}

export { TURN_FAILURE_NOTICE_PREFIX };
