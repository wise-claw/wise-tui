import {
  CHAT_MESSAGE_LIST_LOAD_STEP,
  CHAT_MESSAGE_LIST_WINDOW_THRESHOLD,
} from "../constants/claudeMessageList";
import type { ChatMessageListRow } from "./claudeChatMessageListRows";

export interface ChatMessageListWindowSlice {
  visibleRows: ChatMessageListRow[];
  hiddenRowCount: number;
  visibleStartIndex: number;
  windowActive: boolean;
}

export function sliceChatMessageListRows(
  rows: readonly ChatMessageListRow[],
  visibleCount: number,
  threshold: number = CHAT_MESSAGE_LIST_WINDOW_THRESHOLD,
): ChatMessageListWindowSlice {
  if (rows.length <= threshold) {
    return {
      visibleRows: [...rows],
      hiddenRowCount: 0,
      visibleStartIndex: 0,
      windowActive: false,
    };
  }
  const clampedVisible = Math.max(1, Math.min(visibleCount, rows.length));
  const hiddenRowCount = Math.max(0, rows.length - clampedVisible);
  return {
    visibleRows: rows.slice(hiddenRowCount),
    hiddenRowCount,
    visibleStartIndex: hiddenRowCount,
    windowActive: true,
  };
}

export function nextChatMessageVisibleCount(
  current: number,
  rowsLength: number,
  step: number = CHAT_MESSAGE_LIST_LOAD_STEP,
): number {
  if (rowsLength <= 0) return 0;
  return Math.min(rowsLength, Math.max(1, current + step));
}

/** 为定位到某行，计算至少需要展示的尾部条数 */
export function visibleCountToIncludeRowIndex(
  rowIndex: number,
  rowsLength: number,
  currentVisibleCount: number,
): number {
  if (rowIndex < 0 || rowsLength <= 0) return currentVisibleCount;
  const needVisible = rowsLength - rowIndex;
  return Math.max(currentVisibleCount, Math.min(rowsLength, needVisible));
}

export function findChatMessageRowIndexByMessageId(
  rows: readonly ChatMessageListRow[],
  messageId: string | number,
): number {
  const normalized = String(messageId);
  return rows.findIndex(
    (row) => row.kind === "message" && String(row.msg.id) === normalized,
  );
}
