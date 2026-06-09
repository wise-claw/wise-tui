import { startTransition, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { isFileTreeScrollActive, isSidePanelPriorityReliefActive } from "../stores/chromePanelHoverStore";

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
  /** 侧栏 busy 时 range 更新最小间隔（默认 36ms）。文件树可加大以减轻主线程压力。 */
  busyRangeMinMs?: number;
};

const DEFAULT_SIDE_PANEL_BUSY_RANGE_MIN_MS = 36;

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
  busyRangeMinMs = DEFAULT_SIDE_PANEL_BUSY_RANGE_MIN_MS,
}: UseVirtualListVisibleRangeOptions): VirtualListVisibleRange {
  const [range, setRange] = useState({ start: 0, end: initialVisibleEnd });
  const rafRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRangeUpdateAtRef = useRef(0);
  const getScrollOffsetRef = useRef(getScrollOffset);
  getScrollOffsetRef.current = getScrollOffset;

  const updateRange = useCallback(() => {
    if (!enabled) return;
    const el = scrollRootRef.current;
    if (!el || rowCount === 0) return;
    lastRangeUpdateAtRef.current = performance.now();
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

    const runUpdateRange = () => {
      if (isSidePanelPriorityReliefActive()) {
        const elapsed = performance.now() - lastRangeUpdateAtRef.current;
        if (elapsed < busyRangeMinMs) {
          if (trailingTimerRef.current) return;
          trailingTimerRef.current = setTimeout(() => {
            trailingTimerRef.current = null;
            runUpdateRange();
          }, busyRangeMinMs - elapsed);
          return;
        }
      }
      updateRange();
    };

    const scheduleUpdate = (fromResize = false) => {
      if (fromResize && isFileTreeScrollActive()) return;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        runUpdateRange();
      });
    };

    const onScroll = () => scheduleUpdate(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => scheduleUpdate(true)) : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
        trailingTimerRef.current = null;
      }
    };
  }, [busyRangeMinMs, enabled, scrollRootRef, updateRange]);

  useEffect(() => {
    if (!enabled) return;
    updateRange();
  }, [enabled, remeasureKey, rowCount, updateRange]);

  return range;
}
