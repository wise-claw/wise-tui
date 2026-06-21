import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualListVisibleRange } from "../../hooks/useVirtualListVisibleRange";

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
  const listOffsetRef = useRef(0);
  const metricsRafRef = useRef(0);
  const [remeasureKey, setRemeasureKey] = useState(0);

  const refreshMetrics = useCallback(() => {
    const scrollRoot = scrollRootRef.current;
    const anchor = anchorRef.current;
    if (!scrollRoot || !anchor) {
      if (listOffsetRef.current !== 0) {
        listOffsetRef.current = 0;
        setRemeasureKey((key) => key + 1);
      }
      return;
    }
    const nextOffset = anchor.offsetTop;
    if (listOffsetRef.current !== nextOffset) {
      listOffsetRef.current = nextOffset;
      setRemeasureKey((key) => key + 1);
    }
  }, [anchorRef, scrollRootRef]);

  const range = useVirtualListVisibleRange({
    scrollRootRef,
    rowCount: rows.length,
    rowHeight,
    overscanRows: OVERSCAN_ROWS,
    initialVisibleEnd: 32,
    getScrollOffset: () => listOffsetRef.current,
    remeasureKey,
    preferSyncRangeUpdates: true,
  });

  useEffect(() => {
    refreshMetrics();
    const scrollRoot = scrollRootRef.current;
    if (!scrollRoot) return;

    const scheduleMetricsRefresh = () => {
      if (metricsRafRef.current) return;
      metricsRafRef.current = requestAnimationFrame(() => {
        metricsRafRef.current = 0;
        refreshMetrics();
      });
    };

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleMetricsRefresh) : null;
    ro?.observe(scrollRoot);
    const anchor = anchorRef.current;
    if (anchor) ro?.observe(anchor);

    return () => {
      ro?.disconnect();
      if (metricsRafRef.current) cancelAnimationFrame(metricsRafRef.current);
      metricsRafRef.current = 0;
    };
  }, [anchorRef, refreshMetrics, scrollRootRef]);

  useEffect(() => {
    refreshMetrics();
  }, [rows, refreshMetrics]);

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
