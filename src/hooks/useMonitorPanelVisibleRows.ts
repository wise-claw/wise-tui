import { useCallback, useEffect, useState } from "react";
import { MONITOR_PANEL_VISIBLE_ROWS_DEFAULT } from "../constants/monitorPanelLayout";
import {
  loadMonitorPanelVisibleRowsFromStore,
  WISE_MONITOR_PANEL_VISIBLE_ROWS_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏运行面板内容区可见行数（终端 + 派发 + 工作流合计）。 */
export function useMonitorPanelVisibleRows(): number {
  const [visibleRows, setVisibleRows] = useState(MONITOR_PANEL_VISIBLE_ROWS_DEFAULT);

  const apply = useCallback((next: number) => {
    setVisibleRows(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMonitorPanelVisibleRowsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ monitorPanelVisibleRows?: number }>).detail
        ?.monitorPanelVisibleRows;
      if (typeof next === "number" && Number.isFinite(next)) {
        apply(next);
      }
    };
    window.addEventListener(WISE_MONITOR_PANEL_VISIBLE_ROWS_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_MONITOR_PANEL_VISIBLE_ROWS_CHANGED, onChanged);
    };
  }, [apply]);

  return visibleRows;
}
