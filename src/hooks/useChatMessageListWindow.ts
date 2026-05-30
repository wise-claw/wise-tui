import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CHAT_MESSAGE_LIST_INITIAL_VISIBLE,
  CHAT_MESSAGE_LIST_LOAD_STEP,
  CHAT_MESSAGE_LIST_SCROLL_LOAD_PX,
} from "../constants/claudeMessageList";
import type { ChatMessageListRow } from "../utils/claudeChatMessageListRows";
import {
  findChatMessageRowIndexByMessageId,
  nextChatMessageVisibleCount,
  sliceChatMessageListRows,
  visibleCountToIncludeRowIndex,
} from "../utils/chatMessageListWindow";

interface Options {
  rows: readonly ChatMessageListRow[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** 切换会话时重置窗口 */
  listResetKey?: string;
}

export function useChatMessageListWindow({
  rows,
  scrollContainerRef,
  listResetKey,
}: Options) {
  const [visibleCount, setVisibleCount] = useState(CHAT_MESSAGE_LIST_INITIAL_VISIBLE);
  const loadLockedRef = useRef(false);
  const prevRowsLengthRef = useRef(rows.length);

  useEffect(() => {
    setVisibleCount(CHAT_MESSAGE_LIST_INITIAL_VISIBLE);
    loadLockedRef.current = false;
    prevRowsLengthRef.current = rows.length;
  }, [listResetKey]);

  const slice = sliceChatMessageListRows(rows, visibleCount);

  useEffect(() => {
    const prevLength = prevRowsLengthRef.current;
    const delta = rows.length - prevLength;
    prevRowsLengthRef.current = rows.length;
    if (delta <= 0 || !slice.windowActive) return;
    // 尾部窗口已贴底展示时，新消息到达后扩展窗口以包含新行
    if (slice.hiddenRowCount === 0) {
      setVisibleCount((current) => Math.min(rows.length, current + delta));
    }
  }, [rows.length, slice.hiddenRowCount, slice.windowActive]);

  const loadMoreOlder = useCallback(() => {
    if (!slice.windowActive || slice.hiddenRowCount <= 0 || loadLockedRef.current) {
      return;
    }
    loadLockedRef.current = true;
    const sc = scrollContainerRef.current;
    const prevScrollHeight = sc?.scrollHeight ?? 0;
    const prevScrollTop = sc?.scrollTop ?? 0;

    setVisibleCount((current) => nextChatMessageVisibleCount(current, rows.length, CHAT_MESSAGE_LIST_LOAD_STEP));

    requestAnimationFrame(() => {
      if (sc) {
        sc.scrollTop = prevScrollTop + (sc.scrollHeight - prevScrollHeight);
      }
      loadLockedRef.current = false;
    });
  }, [rows.length, scrollContainerRef, slice.hiddenRowCount, slice.windowActive]);

  useEffect(() => {
    if (!slice.windowActive || slice.hiddenRowCount <= 0) return;
    const sc = scrollContainerRef.current;
    if (!sc) return;

    let raf = 0;
    const onScroll = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (sc.scrollTop <= CHAT_MESSAGE_LIST_SCROLL_LOAD_PX) {
          loadMoreOlder();
        }
      });
    };

    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sc.removeEventListener("scroll", onScroll);
      if (raf !== 0) window.cancelAnimationFrame(raf);
    };
  }, [loadMoreOlder, scrollContainerRef, slice.hiddenRowCount, slice.windowActive]);

  const ensureMessageVisible = useCallback(
    (messageId: string | number): boolean => {
      const rowIndex = findChatMessageRowIndexByMessageId(rows, messageId);
      if (rowIndex < 0) return false;
      const nextCount = visibleCountToIncludeRowIndex(rowIndex, rows.length, visibleCount);
      if (nextCount > visibleCount) {
        setVisibleCount(nextCount);
        return true;
      }
      return false;
    },
    [rows, visibleCount],
  );

  const pendingScrollMessageIdRef = useRef<string | null>(null);
  const [scrollGeneration, setScrollGeneration] = useState(0);

  const queueScrollToMessageId = useCallback((messageId: string | number) => {
    pendingScrollMessageIdRef.current = String(messageId);
    setScrollGeneration((n) => n + 1);
  }, []);

  return {
    ...slice,
    loadMoreOlder,
    ensureMessageVisible,
    queueScrollToMessageId,
    pendingScrollMessageIdRef,
    scrollGeneration,
  };
}

/** 在窗口扩展并完成布局后执行滚动 */
export function useChatMessageListPendingScroll(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  pendingScrollMessageIdRef: RefObject<string | null>,
  scrollGeneration: number,
  onNavigate: (() => void) | undefined,
  scrollFn: (sc: HTMLDivElement, target: HTMLElement, behavior?: ScrollBehavior) => void,
) {
  useLayoutEffect(() => {
    const messageId = pendingScrollMessageIdRef.current;
    if (!messageId) return;
    pendingScrollMessageIdRef.current = null;
    const sc = scrollContainerRef.current;
    if (!sc) return;
    const target = sc.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!(target instanceof HTMLElement)) return;
    onNavigate?.();
    scrollFn(sc, target, "smooth");
  }, [scrollGeneration, onNavigate, pendingScrollMessageIdRef, scrollContainerRef, scrollFn]);
}
