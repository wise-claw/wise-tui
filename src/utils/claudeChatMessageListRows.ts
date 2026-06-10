import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  getMessageSenderGroupKey,
  hasRenderableChatMessageBody,
  indexOfPreviousRenderableMessage,
  isToolOnlyUserMessage,
} from "./claudeChatMessageDisplay";
import { sessionHadRecentClaudeTurnFailureNotice } from "./claudeSessionTurnFailure";

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
  if (status !== "running" && status !== "connecting") return false;
  // 长驻子进程仍 alive 但本轮已失败落盘时，勿再展示「正在思考」。
  if (sessionHadRecentClaudeTurnFailureNotice(messages)) return false;
  const last = messages[messages.length - 1]!;
  return last.role === "user" || last.role === "assistant";
}

export interface ChatMessageListRowsBuildOptions {
  sessionStatus: ClaudeSession["status"];
  showListEndThinkingHint: boolean;
}

function buildSingleChatMessageListRow(
  messages: readonly ClaudeMessage[],
  originalIndex: number,
  options: ChatMessageListRowsBuildOptions,
): ChatMessageListMessageRow | null {
  const msg = messages[originalIndex]!;
  if (!hasRenderableChatMessageBody(msg)) return null;

  const lastIndex = messages.length - 1;
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

  return {
    kind: "message",
    key: `${String(msg.id)}:${originalIndex}`,
    originalIndex,
    msg,
    streamingThisBubble,
    mergedWithPrevious,
    toolUser,
  };
}

export function buildChatMessageListRows(
  messages: readonly ClaudeMessage[],
  options: ChatMessageListRowsBuildOptions,
): ChatMessageListRow[] {
  const rows: ChatMessageListRow[] = [];

  for (let originalIndex = 0; originalIndex < messages.length; originalIndex += 1) {
    const row = buildSingleChatMessageListRow(messages, originalIndex, options);
    if (row) rows.push(row);
  }

  if (options.showListEndThinkingHint) {
    rows.push({ kind: "thinking-hint", key: "thinking-hint" });
  }

  return rows;
}

/**
 * 流式输出时仅最后一条消息变化：复用前缀 row 对象，避免 O(n) 全量重建与整表重渲染。
 */
export function tryPatchChatMessageListRowsTail(
  prevMessages: readonly ClaudeMessage[],
  nextMessages: readonly ClaudeMessage[],
  prevRows: readonly ChatMessageListRow[],
  options: ChatMessageListRowsBuildOptions,
): ChatMessageListRow[] | null {
  if (prevMessages === nextMessages) return [...prevRows];
  if (prevMessages.length === 0 || nextMessages.length === 0) return null;
  if (prevMessages.length !== nextMessages.length) return null;
  for (let i = 0; i < nextMessages.length - 1; i += 1) {
    if (prevMessages[i] !== nextMessages[i]) return null;
  }
  if (prevMessages[nextMessages.length - 1] === nextMessages[nextMessages.length - 1]) {
    return [...prevRows];
  }

  const lastMessageIndex = nextMessages.length - 1;
  const prefixRows: ChatMessageListMessageRow[] = [];
  for (const row of prevRows) {
    if (row.kind !== "message") continue;
    if (row.originalIndex === lastMessageIndex) continue;
    if (row.msg !== nextMessages[row.originalIndex]) return null;
    prefixRows.push(row);
  }

  let renderableBeforeLast = 0;
  for (let i = 0; i < lastMessageIndex; i += 1) {
    if (hasRenderableChatMessageBody(nextMessages[i]!)) renderableBeforeLast += 1;
  }
  if (prefixRows.length !== renderableBeforeLast) return null;

  const lastRow = buildSingleChatMessageListRow(nextMessages, lastMessageIndex, options);
  const nextRows: ChatMessageListRow[] = lastRow ? [...prefixRows, lastRow] : [...prefixRows];
  if (options.showListEndThinkingHint) {
    nextRows.push({ kind: "thinking-hint", key: "thinking-hint" });
  }
  return nextRows;
}
