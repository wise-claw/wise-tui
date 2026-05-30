import {
  IN_MEMORY_SESSION_MESSAGES_MAX,
} from "../constants/claudeMessageListWindow";
import type { ClaudeMessage, ClaudeSession } from "../types";
import { parseClaudeSessionJsonlLines } from "./claudeSessionJsonl";

export function capSessionMessagesForMemory(
  messages: ClaudeMessage[],
  max: number = IN_MEMORY_SESSION_MESSAGES_MAX,
): ClaudeMessage[] {
  if (messages.length <= max) return messages;
  return messages.slice(-max);
}

export function applySessionMemoryCap(session: ClaudeSession): ClaudeSession {
  if (session.messages.length <= IN_MEMORY_SESSION_MESSAGES_MAX) return session;
  return {
    ...session,
    messages: capSessionMessagesForMemory(session.messages),
    diskTranscriptPartial: true,
  };
}

export function applySessionsMemoryCap(sessions: readonly ClaudeSession[]): ClaudeSession[] {
  let changed = false;
  const next = sessions.map((session) => {
    const capped = applySessionMemoryCap(session);
    if (capped !== session) changed = true;
    return capped;
  });
  return changed ? next : (sessions as ClaudeSession[]);
}

/** 将 jsonl 行解析为 UI 消息，并按内存上限截断；调用方传入 tail 请求行数用于判断是否 partial。 */
export function sessionMessagesFromJsonlLines(
  lines: readonly string[],
  options: {
    tailRequestLines: number;
    memoryMax?: number;
  },
): { messages: ClaudeMessage[]; diskTranscriptPartial: boolean } {
  const parsed = parseClaudeSessionJsonlLines([...lines]);
  const memoryMax = options.memoryMax ?? IN_MEMORY_SESSION_MESSAGES_MAX;
  const messages = capSessionMessagesForMemory(parsed, memoryMax);
  const tailSaturated = lines.length >= options.tailRequestLines;
  const memoryTruncated = parsed.length > messages.length;
  return {
    messages,
    diskTranscriptPartial: tailSaturated || memoryTruncated,
  };
}
