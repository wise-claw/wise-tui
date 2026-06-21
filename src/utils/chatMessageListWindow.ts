import {
  CHAT_MESSAGE_LIST_BOTTOM_RECLAIM_PX,
  CHAT_MESSAGE_LIST_LOAD_STEP,
  CHAT_MESSAGE_LIST_MAX_VISIBLE,
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
  maxVisible: number = CHAT_MESSAGE_LIST_MAX_VISIBLE,
): number {
  if (rowsLength <= 0) return 0;
  // 增量浏览封顶 maxVisible，防止长会话 DOM 无限膨胀（定位路径豁免，见 visibleCountToIncludeRowIndex）。
  return Math.min(
    maxVisible,
    Math.min(rowsLength, Math.max(1, current + step)),
  );
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

/**
 * 判断贴底时是否应回收到 initialVisible。
 * 仅当已贴底、且 visibleCount 因增量浏览/定位而扩张超过 initialVisible 时回收——
 * 视口最新内容在 slice 尾部，回收顶部最旧行不影响可见区域，浏览器 clamp scrollTop 无跳动。
 * @param scrollTop    滚动容器 scrollTop
 * @param clientHeight 滚动容器视口高度
 * @param scrollHeight 滚动容器内容总高度
 * @param visibleCount 当前可见条数
 * @param initialVisible 初始/回收目标条数
 * @param bottomPx     贴底判定阈值（px）
 */
export function shouldReclaimOnBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  visibleCount: number,
  initialVisible: number,
  bottomPx: number = CHAT_MESSAGE_LIST_BOTTOM_RECLAIM_PX,
): boolean {
  if (visibleCount <= initialVisible) return false;
  if (clientHeight <= 0 || scrollHeight <= 0) return false;
  return scrollTop + clientHeight >= scrollHeight - bottomPx;
}
