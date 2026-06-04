import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export const MONITOR_COMPACT_ROW_HEIGHT_PX = 22;
/** 左栏 compact 模式：项达到此数量即启用虚拟列表（行高固定、可滚动）。 */
export const MONITOR_VIRTUALIZE_MIN_ROWS = 8;

const OVERSCAN_ROWS = 8;

export type MonitorPanelVirtualRowsProps<TRow> = {
  scrollRootRef: RefObject<HTMLElement | null>;
  anchorRef: RefObject<HTMLElement | null>;
  rows: readonly TRow[];
  rowHeight?: number;
  getRowKey: (row: TRow, index: number) => string;
  renderRow: (row: TRow, index: number) => ReactNode;
};

function MonitorPanelVirtualRowsInner<TRow>({
  scrollRootRef,
  anchorRef,
  rows,
  rowHeight = MONITOR_COMPACT_ROW_HEIGHT_PX,
  getRowKey,
  renderRow,
}: MonitorPanelVirtualRowsProps<TRow>) {
  const [range, setRange] = useState({ start: 0, end: 32 });
  const listOffsetRef = useRef(0);
  const rafRef = useRef(0);
  const metricsRafRef = useRef(0);

  const refreshMetrics = useCallback(() => {
    const scrollRoot = scrollRootRef.current;
    const anchor = anchorRef.current;
    if (!scrollRoot || !anchor) {
      listOffsetRef.current = 0;
      return;
    }
    listOffsetRef.current = anchor.offsetTop;
  }, [anchorRef, scrollRootRef]);

  const updateRange = useCallback(() => {
    const scrollRoot = scrollRootRef.current;
    if (!scrollRoot || rows.length === 0) {
      return;
    }
    const height = Math.max(scrollRoot.clientHeight, rowHeight);
    const relativeScroll = Math.max(0, scrollRoot.scrollTop - listOffsetRef.current);
    const start = Math.max(0, Math.floor(relativeScroll / rowHeight) - OVERSCAN_ROWS);
    const visibleRows = Math.ceil(height / rowHeight) + OVERSCAN_ROWS * 2;
    const end = Math.min(rows.length, start + visibleRows);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [rowHeight, rows.length, scrollRootRef]);

  useEffect(() => {
    refreshMetrics();
    updateRange();
    const scrollRoot = scrollRootRef.current;
    if (!scrollRoot) {
      return;
    }

    const scheduleRangeUpdate = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        updateRange();
      });
    };

    const scheduleMetricsRefresh = () => {
      if (metricsRafRef.current) return;
      metricsRafRef.current = requestAnimationFrame(() => {
        metricsRafRef.current = 0;
        refreshMetrics();
        updateRange();
      });
    };

    scrollRoot.addEventListener("scroll", scheduleRangeUpdate, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMetricsRefresh) : null;
    ro?.observe(scrollRoot);
    const anchor = anchorRef.current;
    if (anchor) ro?.observe(anchor);

    return () => {
      ro?.disconnect();
      scrollRoot.removeEventListener("scroll", scheduleRangeUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (metricsRafRef.current) cancelAnimationFrame(metricsRafRef.current);
      rafRef.current = 0;
      metricsRafRef.current = 0;
    };
  }, [anchorRef, refreshMetrics, scrollRootRef, updateRange]);

  useEffect(() => {
    refreshMetrics();
    updateRange();
  }, [rows, refreshMetrics, updateRange]);

  const totalHeight = rows.length * rowHeight;
  const slice = rows.slice(range.start, range.end);

  return (
    <div className="app-monitor-panel__virtual-list" aria-rowcount={rows.length}>
      <div className="app-monitor-panel__virtual-list__spacer" style={{ height: totalHeight }}>
        {slice.map((row, index) => {
          const absoluteIndex = range.start + index;
          const top = absoluteIndex * rowHeight;
          return (
            <div
              key={getRowKey(row, absoluteIndex)}
              className="app-monitor-panel__virtual-list__row"
              style={{ top, height: rowHeight }}
            >
              {renderRow(row, absoluteIndex)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const MonitorPanelVirtualRows = memo(
  MonitorPanelVirtualRowsInner,
) as typeof MonitorPanelVirtualRowsInner;
