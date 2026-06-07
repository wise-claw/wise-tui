import { startTransition, useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type VirtualListVisibleRange = Readonly<{ start: number; end: number }>;

type UseVirtualListVisibleRangeOptions = {
  scrollRootRef: RefObject<HTMLElement | null>;
  rowCount: number;
  rowHeight: number;
  overscanRows: number;
  initialVisibleEnd?: number;
  /** 嵌套在 scrollRoot 内时减去列表顶部偏移（px）。 */
  getScrollOffset?: () => number;
  enabled?: boolean;
  /** 列表在 scrollRoot 内的布局变化（如 anchor 位移）时递增以重算 range。 */
  remeasureKey?: number;
};

/** RAF + startTransition：快速滑动时虚拟列表 range 更新不阻塞主线程绘制。 */
export function useVirtualListVisibleRange({
  scrollRootRef,
  rowCount,
  rowHeight,
  overscanRows,
  initialVisibleEnd = 40,
  getScrollOffset,
  enabled = true,
  remeasureKey = 0,
}: UseVirtualListVisibleRangeOptions): VirtualListVisibleRange {
  const [range, setRange] = useState({ start: 0, end: initialVisibleEnd });
  const rafRef = useRef(0);
  const getScrollOffsetRef = useRef(getScrollOffset);
  getScrollOffsetRef.current = getScrollOffset;

  const updateRange = useCallback(() => {
    if (!enabled) return;
    const el = scrollRootRef.current;
    if (!el || rowCount === 0) return;
    const height = Math.max(el.clientHeight, rowHeight);
    const offset = getScrollOffsetRef.current?.() ?? 0;
    const relativeScroll = Math.max(0, el.scrollTop - offset);
    const start = Math.max(0, Math.floor(relativeScroll / rowHeight) - overscanRows);
    const visibleRows = Math.ceil(height / rowHeight) + overscanRows * 2;
    const end = Math.min(rowCount, start + visibleRows);
    startTransition(() => {
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    });
  }, [enabled, overscanRows, rowCount, rowHeight, scrollRootRef]);

  useEffect(() => {
    if (!enabled) return;
    updateRange();
    const el = scrollRootRef.current;
    if (!el) return;

    const scheduleUpdate = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        updateRange();
      });
    };

    el.addEventListener("scroll", scheduleUpdate, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleUpdate) : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", scheduleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [enabled, scrollRootRef, updateRange]);

  useEffect(() => {
    if (!enabled) return;
    updateRange();
  }, [enabled, remeasureKey, rowCount, updateRange]);

  return range;
}
