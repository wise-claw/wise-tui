import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  getMessageSenderGroupKey,
  hasRenderableChatMessageBody,
  indexOfPreviousRenderableMessage,
  isToolOnlyUserMessage,
} from "./claudeChatMessageDisplay";

export type ChatMessageListMessageRow = {
  kind: "message";
  key: string;
  originalIndex: number;
  msg: ClaudeMessage;
  streamingThisBubble: boolean;
  mergedWithPrevious: boolean;
  toolUser: boolean;
};

export type ChatMessageListThinkingRow = {
  kind: "thinking-hint";
  key: "thinking-hint";
};

export type ChatMessageListRow = ChatMessageListMessageRow | ChatMessageListThinkingRow;

export function shouldShowListEndThinkingHint(
  messages: readonly ClaudeMessage[],
  status: ClaudeSession["status"],
): boolean {
  if (messages.length === 0) return false;
  const last = messages[messages.length - 1]!;
  return status === "running" && (last.role === "user" || last.role === "assistant");
}

export function buildChatMessageListRows(
  messages: readonly ClaudeMessage[],
  options: {
    sessionStatus: ClaudeSession["status"];
    showListEndThinkingHint: boolean;
  },
): ChatMessageListRow[] {
  const rows: ChatMessageListRow[] = [];
  const lastIndex = messages.length - 1;

  for (let originalIndex = 0; originalIndex < messages.length; originalIndex += 1) {
    const msg = messages[originalIndex]!;
    if (!hasRenderableChatMessageBody(msg)) continue;

    const streamingThisBubble =
      options.sessionStatus === "running" &&
      msg.role === "assistant" &&
      originalIndex === lastIndex;
    const toolUser = isToolOnlyUserMessage(msg);
    const prevRenderableIndex = indexOfPreviousRenderableMessage(messages, originalIndex);
    const prevInSession = prevRenderableIndex >= 0 ? messages[prevRenderableIndex] : undefined;
    const shouldMergeSystemMessages = msg.role !== "system" && prevInSession?.role !== "system";
    const mergedWithPrevious =
      shouldMergeSystemMessages &&
      prevInSession !== undefined &&
      getMessageSenderGroupKey(prevInSession) === getMessageSenderGroupKey(msg);

    rows.push({
      kind: "message",
      key: `${String(msg.id)}:${originalIndex}`,
      originalIndex,
      msg,
      streamingThisBubble,
      mergedWithPrevious,
      toolUser,
    });
  }

  if (options.showListEndThinkingHint) {
    rows.push({ kind: "thinking-hint", key: "thinking-hint" });
  }

  return rows;
}
