import type { ClaudeMessage } from "../types";
import { isToolOnlyUserMessage } from "./claudeChatMessageDisplay";

export function formatTurnDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分${seconds % 60 ? `${seconds % 60}秒` : ""}`;
}

/** 完成事件已去重后调用；仅计算最近一条真实用户消息开始的回合。 */
export function appendTurnDuration(messages: ClaudeMessage[], completedAt: number): ClaudeMessage[] {
  let start = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "user" && !isToolOnlyUserMessage(message)) {
      start = i;
      break;
    }
  }
  if (start < 0) return messages;
  const startedAt = messages[start]!.timestamp;
  if (!Number.isFinite(startedAt) || completedAt < startedAt) return messages;
  if (messages.slice(start + 1).some((message) => message.role === "system" && /^用时 \d/.test(message.content))) return messages;
  const content = `用时 ${formatTurnDuration(completedAt - startedAt)}`;
  return [...messages, {
    id: messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), completedAt) + 1,
    role: "system", content, parts: [{ type: "text", text: content }], timestamp: completedAt,
  }];
}
