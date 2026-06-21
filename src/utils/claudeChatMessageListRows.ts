import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  foldToolResultUserMessagesIntoAssistant,
  isToolResultUpdatePart,
} from "../services/claudeStreamAssembler";
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

export interface ChatMessageListRowsBuildResult {
  rows: ChatMessageListRow[];
  /** fold 后的消息数组（已合并 tool_result），供 tail-patch 增量复用。 */
  folded: ClaudeMessage[];
}

export function buildChatMessageListRowsWithFolded(
  messages: readonly ClaudeMessage[],
  options: ChatMessageListRowsBuildOptions,
): ChatMessageListRowsBuildResult {
  const foldedMessages = foldToolResultUserMessagesIntoAssistant(messages);
  const rows: ChatMessageListRow[] = [];

  for (let originalIndex = 0; originalIndex < foldedMessages.length; originalIndex += 1) {
    const row = buildSingleChatMessageListRow(foldedMessages, originalIndex, options);
    if (row) rows.push(row);
  }

  if (options.showListEndThinkingHint) {
    rows.push({ kind: "thinking-hint", key: "thinking-hint" });
  }

  return { rows, folded: foldedMessages };
}

export function buildChatMessageListRows(
  messages: readonly ClaudeMessage[],
  options: ChatMessageListRowsBuildOptions,
): ChatMessageListRow[] {
  return buildChatMessageListRowsWithFolded(messages, options).rows;
}

/**
 * 流式输出时仅最后一条消息变化：复用前缀 row 对象，避免 O(n) 全量重建与整表重渲染。
 *
 * 增量 fold 快路径：tail-patch 前提（前缀引用全相同、仅末条变）下 fold 前缀结果不变。
 * 流式中末条恒为 assistant（fold 原样 push），故可复用缓存的 prevFolded 去尾作为前缀、
 * 直接换末条，省去每 tick 全量 fold（含对历史 K 轮 tool_result 的重复 apply）。
 * 仅当 prev/next 末条均被 fold 原样 push 时启用；末条为 tool-only-with-updates
 * （合并/orphan，理论场景，流式中不发生）时回退全量 fold。
 */
export function tryPatchChatMessageListRowsTail(
  prevMessages: readonly ClaudeMessage[],
  nextMessages: readonly ClaudeMessage[],
  prevRows: readonly ChatMessageListRow[],
  options: ChatMessageListRowsBuildOptions,
  prevFolded?: readonly ClaudeMessage[],
): ChatMessageListRowsBuildResult | null {
  if (prevMessages === nextMessages) {
    return { rows: [...prevRows], folded: prevFolded ? [...prevFolded] : foldToolResultUserMessagesIntoAssistant(prevMessages) };
  }
  if (prevMessages.length === 0 || nextMessages.length === 0) return null;
  if (prevMessages.length !== nextMessages.length) return null;
  for (let i = 0; i < nextMessages.length - 1; i += 1) {
    if (prevMessages[i] !== nextMessages[i]) return null;
  }
  const prevLast = prevMessages[prevMessages.length - 1]!;
  const nextLast = nextMessages[nextMessages.length - 1]!;
  if (prevLast === nextLast) {
    return { rows: [...prevRows], folded: prevFolded ? [...prevFolded] : foldToolResultUserMessagesIntoAssistant(prevMessages) };
  }

  // 增量 fold：prev 末条被原样 push（prevFolded 末 === prevLast，精确判别 fold CASE A/B）且
  // next 末条也会被原样 push（非 tool-only，或 tool-only 无 tool_use result updates）时，
  // nextFolded = [...foldPrefix, nextLast]，foldPrefix = prevFolded.slice(0,-1) = fold(前缀)。
  // 否则回退全量 fold（末条 tool-only 有 updates 的合并/orphan 场景）。
  const prevLastPushedAsIs =
    prevFolded !== undefined &&
    prevFolded.length > 0 &&
    prevFolded[prevFolded.length - 1] === prevLast;
  const nextLastPushedAsIs =
    !isToolOnlyUserMessage(nextLast) ||
    !(nextLast.parts ?? []).some((part) => part.type === "tool_use" && isToolResultUpdatePart(part));
  let nextFolded: ClaudeMessage[];
  if (prevLastPushedAsIs && nextLastPushedAsIs && prevFolded !== undefined) {
    nextFolded = prevFolded.slice(0, -1);
    nextFolded.push(nextLast);
  } else {
    nextFolded = foldToolResultUserMessagesIntoAssistant(nextMessages);
  }

  const lastMessageIndex = nextFolded.length - 1;
  const prefixRows: ChatMessageListMessageRow[] = [];
  for (const row of prevRows) {
    if (row.kind !== "message") continue;
    if (row.originalIndex === lastMessageIndex) continue;
    if (row.msg !== nextFolded[row.originalIndex]) return null;
    prefixRows.push(row);
  }

  let renderableBeforeLast = 0;
  for (let i = 0; i < lastMessageIndex; i += 1) {
    if (hasRenderableChatMessageBody(nextFolded[i]!)) renderableBeforeLast += 1;
  }
  if (prefixRows.length !== renderableBeforeLast) return null;

  const lastRow = buildSingleChatMessageListRow(nextFolded, lastMessageIndex, options);
  const nextRows: ChatMessageListRow[] = lastRow ? [...prefixRows, lastRow] : [...prefixRows];
  if (options.showListEndThinkingHint) {
    nextRows.push({ kind: "thinking-hint", key: "thinking-hint" });
  }
  return { rows: nextRows, folded: nextFolded };
}
