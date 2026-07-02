import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  CHAT_MESSAGE_LIST_COMPANION_INITIAL_VISIBLE,
  CHAT_MESSAGE_LIST_COMPANION_LOAD_STEP,
  CHAT_MESSAGE_LIST_COMPANION_MAX_VISIBLE,
  CHAT_MESSAGE_LIST_INITIAL_VISIBLE,
  CHAT_MESSAGE_LIST_LOAD_STEP,
  CHAT_MESSAGE_LIST_MAX_VISIBLE,
  CHAT_MESSAGE_LIST_SCROLL_LOAD_PX,
} from "../constants/claudeMessageList";
import type { ChatMessageListRow } from "../utils/claudeChatMessageListRows";
import {
  findChatMessageRowIndexByMessageId,
  nextChatMessageVisibleCount,
  shouldReclaimOnBottom,
  sliceChatMessageListRows,
  visibleCountToIncludeRowIndex,
} from "../utils/chatMessageListWindow";

interface Options {
  rows: readonly ChatMessageListRow[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** 切换会话时重置窗口 */
  listResetKey?: string;
  /** 主窗格 vs 多屏伴生窗格：伴生窗格使用更小的尾部窗口 */
  profile?: "primary" | "companion";
  /** 伴生窗格 profile 下按屏数覆盖尾部窗口大小 */
  companionMessageListWindow?: { initialVisible: number; loadStep: number };
  /** 内存窗口耗尽（已展示全部内存 rows）时回调，用于衔接磁盘全量重载拉取更早落盘内容；
   *  省略时（如 monitor 变体）耗尽后不再监听滚动，行为不变。 */
  onWindowExhausted?: () => void;
  /** 全量磁盘重载后（transcriptMemoryUnlimited）解除 maxVisible 封顶：内存已保留全部磁盘
   *  消息，让「加载更早消息」按钮在长会话下仍可逐段扩展窗口直至展示全部内存 rows；
   *  贴底回收仍回落到 initialVisible 保护 DOM。 */
  transcriptMemoryUnlimited?: boolean;
}

/**
 * 解析尾部窗口 sizing（纯函数，便于单测）。
 * `transcriptMemoryUnlimited` 为真时（全量磁盘重载后，内存已保留全部磁盘消息）解除
 * `maxVisible` 封顶，使「加载更早消息」按钮在长会话下仍可逐段扩展窗口直至展示全部内存
 * rows；贴底回收仍回落到 initialVisible 保护 DOM，不会无限膨胀。
 */
export function resolveWindowSizing(
  profile: Options["profile"],
  companionMessageListWindow?: Options["companionMessageListWindow"],
  transcriptMemoryUnlimited?: boolean,
) {
  const base =
    profile === "companion"
      ? {
          // 调用方传入的 companionMessageListWindow 仅含 initialVisible/loadStep（如 6/8 屏），
          // 始终补上 companion maxVisible，保证增量浏览封顶语义一致。
          initialVisible: CHAT_MESSAGE_LIST_COMPANION_INITIAL_VISIBLE,
          loadStep: CHAT_MESSAGE_LIST_COMPANION_LOAD_STEP,
          maxVisible: CHAT_MESSAGE_LIST_COMPANION_MAX_VISIBLE,
          ...companionMessageListWindow,
        }
      : {
          initialVisible: CHAT_MESSAGE_LIST_INITIAL_VISIBLE,
          loadStep: CHAT_MESSAGE_LIST_LOAD_STEP,
          maxVisible: CHAT_MESSAGE_LIST_MAX_VISIBLE,
        };
  if (transcriptMemoryUnlimited) {
    return { ...base, maxVisible: Number.POSITIVE_INFINITY };
  }
  return base;
}

export function useChatMessageListWindow({
  rows,
  scrollContainerRef,
  listResetKey,
  profile = "primary",
  companionMessageListWindow,
  onWindowExhausted,
  transcriptMemoryUnlimited,
}: Options) {
  const { initialVisible, loadStep, maxVisible } = resolveWindowSizing(
    profile,
    companionMessageListWindow,
    transcriptMemoryUnlimited,
  );
  const [visibleCount, setVisibleCount] = useState(initialVisible);
  const loadLockedRef = useRef(false);
  const prevRowsLengthRef = useRef(rows.length);

  useEffect(() => {
    setVisibleCount(initialVisible);
    loadLockedRef.current = false;
    prevRowsLengthRef.current = rows.length;
  }, [initialVisible, listResetKey]);

  const slice = sliceChatMessageListRows(rows, visibleCount);
  const rowsLengthRef = useRef(rows.length);
  rowsLengthRef.current = rows.length;
  // onScroll effect 依赖 slice.hiddenRowCount；当 visibleCount 与 rows.length 同步等量变化时
  // hiddenRowCount 不变 → effect 不重订阅 → 闭包里 visibleCount 陈旧。故回收判断读 ref。
  const visibleCountRef = useRef(visibleCount);
  visibleCountRef.current = visibleCount;
  // initialVisible 仅由 profile 决定，但 onScroll effect 不把它列入依赖（避免重订阅），
  // 用 ref 读取以反映 profile/companion 配置变化。
  const initialVisibleRef = useRef(initialVisible);
  initialVisibleRef.current = initialVisible;
  // onWindowExhausted 用 ref 持有：onScroll effect 不把它列入依赖，避免回调变更触发重订阅。
  const onWindowExhaustedRef = useRef<(() => void) | null>(onWindowExhausted ?? null);
  onWindowExhaustedRef.current = onWindowExhausted ?? null;
  // loadMoreOlder 视口保持会把 scrollTop 推到新位置，大视口下可能恰好贴底；
  // 此时属于「主动加载更早」而非「用户滚到底看最新」，抑制紧接着的一次贴底回收，
  // 否则刚扩展的窗口会被立即收回（表现为点击/滚动加载更早消息无效）。由 onScroll 消费。
  const suppressReclaimRef = useRef(false);
  const pendingTailExpandRafRef = useRef(0);
  const pendingTailExpandDeltaRef = useRef(0);

  useEffect(() => {
    const prevLength = prevRowsLengthRef.current;
    const delta = rows.length - prevLength;
    prevRowsLengthRef.current = rows.length;
    if (delta <= 0 || !slice.windowActive) return;
    // 尾部窗口已贴底展示时，新消息到达后扩展窗口以包含新行（每帧最多一次 setState）
    if (slice.hiddenRowCount === 0) {
      pendingTailExpandDeltaRef.current += delta;
      if (pendingTailExpandRafRef.current !== 0) return;
      pendingTailExpandRafRef.current = window.requestAnimationFrame(() => {
        pendingTailExpandRafRef.current = 0;
        const expandBy = pendingTailExpandDeltaRef.current;
        pendingTailExpandDeltaRef.current = 0;
        if (expandBy <= 0) return;
        setVisibleCount((current) =>
          // Math.max(current, ...) 防回缩：visibleCount 若已因定位豁免超过 cap，扩展时保持不缩。
          Math.max(current, Math.min(maxVisible, Math.min(rowsLengthRef.current, current + expandBy))),
        );
      });
    }
    return () => {
      if (pendingTailExpandRafRef.current !== 0) {
        window.cancelAnimationFrame(pendingTailExpandRafRef.current);
        pendingTailExpandRafRef.current = 0;
      }
    };
  }, [maxVisible, rows.length, slice.hiddenRowCount, slice.windowActive]);

  const loadMoreOlder = useCallback(() => {
    if (!slice.windowActive || slice.hiddenRowCount <= 0 || loadLockedRef.current) {
      return;
    }
    loadLockedRef.current = true;
    // 标记抑制下一次贴底回收：视口保持设置的 scrollTop 在大视口下可能贴底，
    // 不抑制则会把刚加载的更早消息立即收回。
    suppressReclaimRef.current = true;
    const sc = scrollContainerRef.current;
    const prevScrollHeight = sc?.scrollHeight ?? 0;
    const prevScrollTop = sc?.scrollTop ?? 0;

    setVisibleCount((current) => nextChatMessageVisibleCount(current, rows.length, loadStep, maxVisible));

    requestAnimationFrame(() => {
      if (sc) {
        sc.scrollTop = prevScrollTop + (sc.scrollHeight - prevScrollHeight);
      }
      loadLockedRef.current = false;
    });
  }, [loadStep, maxVisible, rows.length, scrollContainerRef, slice.hiddenRowCount, slice.windowActive]);

  useEffect(() => {
    // 窗口未激活（rows ≤ 阈值）时不监听；窗口激活但已耗尽时，仅当提供 onWindowExhausted
    // 才继续监听以衔接磁盘全量重载，否则不订阅（monitor 变体行为不变）。
    if (
      !slice.windowActive ||
      (slice.hiddenRowCount <= 0 && onWindowExhaustedRef.current === null)
    ) {
      return;
    }
    const sc = scrollContainerRef.current;
    if (!sc) return;

    let raf = 0;
    const onScroll = () => {
      if (raf !== 0) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (sc.scrollTop <= CHAT_MESSAGE_LIST_SCROLL_LOAD_PX) {
          if (slice.hiddenRowCount > 0) {
            loadMoreOlder();
          } else {
            // 内存窗口已耗尽：衔接磁盘全量重载，拉取更早落盘内容（统一触发点，避免与独立
            // scroll 监听器的 rAF 时序竞争导致「有时加载不了」）。
            onWindowExhaustedRef.current?.();
          }
        }
        // 贴底回收仅在窗口尚有隐藏行时执行（耗尽后无回收意义）。
        if (slice.hiddenRowCount > 0) {
          // 贴底回收：视口最新内容在 slice 尾部，回收顶部最旧行不影响可见区域，
          // 浏览器 clamp scrollTop 无跳动；读 ref 避免 hiddenRowCount 稳定时闭包陈旧。
          // loadMoreOlder 主动加载后视口保持可能把视口推到底部（大视口下），属「加载更早」
          // 而非「用户滚到底看最新」——抑制标志只在「本应回收」时消费并跳过，确保用在
          // loadMoreOlder 视口保持引起的那次 scroll，而非前置的不回收帧；之后用户主动贴底才回收。
          const reclaimable =
            !loadLockedRef.current &&
            shouldReclaimOnBottom(
              sc.scrollTop,
              sc.clientHeight,
              sc.scrollHeight,
              visibleCountRef.current,
              initialVisibleRef.current,
            );
          if (reclaimable && suppressReclaimRef.current) {
            suppressReclaimRef.current = false;
          } else if (reclaimable) {
            setVisibleCount(initialVisibleRef.current);
          }
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
