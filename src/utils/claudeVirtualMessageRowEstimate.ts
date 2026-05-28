import type { ChatMessageListRow } from "./claudeChatMessageListRows";

export const VIRTUAL_ROW_ESTIMATE_CHAT = 72;
export const VIRTUAL_ROW_ESTIMATE_MONITOR = 88;
export const VIRTUAL_ROW_ESTIMATE_THINKING = 36;
export const VIRTUAL_ROW_ESTIMATE_TOOL = 140;
export const VIRTUAL_ROW_ESTIMATE_LONG_TEXT = 200;

/** 虚拟列表行高初估（仅用于未测量前占位；实测由 ResizeObserver 覆盖）。 */
export function estimateVirtualChatRowSize(
  row: ChatMessageListRow,
  listVariant: "chat" | "monitor",
): number {
  if (row.kind === "thinking-hint") {
    return VIRTUAL_ROW_ESTIMATE_THINKING;
  }
  const base = listVariant === "monitor" ? VIRTUAL_ROW_ESTIMATE_MONITOR : VIRTUAL_ROW_ESTIMATE_CHAT;
  const parts = row.msg.parts;
  if (parts && parts.length > 0) {
    let toolCount = 0;
    let textLen = 0;
    for (const part of parts) {
      if (part.type === "tool_use") toolCount += 1;
      if (part.type === "text" || part.type === "reasoning") textLen += part.text.length;
    }
    if (toolCount > 0) {
      return Math.min(520, VIRTUAL_ROW_ESTIMATE_TOOL + (toolCount - 1) * 80);
    }
    if (textLen > 500) {
      return Math.min(400, VIRTUAL_ROW_ESTIMATE_LONG_TEXT + Math.floor(textLen / 12));
    }
    return base;
  }
  const contentLen = row.msg.content?.length ?? 0;
  if (contentLen > 400) {
    return Math.min(360, VIRTUAL_ROW_ESTIMATE_LONG_TEXT + Math.floor(contentLen / 14));
  }
  return base;
}

/** 列表结构变化时全量重测（行增删、key 变化）；流式正文增长不重测。 */
export function buildVirtualMessageListStructureFingerprint(
  rows: readonly ChatMessageListRow[],
  showListEndThinkingHint: boolean,
): string {
  const keys = rows.map((row) => row.key).join("\u001f");
  return `${rows.length}\u001e${showListEndThinkingHint ? 1 : 0}\u001e${keys}`;
}
