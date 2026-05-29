import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarMonitorPanelVisibleFromStore,
  WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏运行面板是否显示（`wise.defaultConfig.v1`）。 */
export function useLeftSidebarMonitorPanelVisible(): { visible: boolean } {
  const [visible, setVisible] = useState(true);

  const apply = useCallback((next: boolean) => {
    setVisible(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLeftSidebarMonitorPanelVisibleFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ showLeftSidebarMonitorPanel?: boolean }>).detail;
      if (typeof detail?.showLeftSidebarMonitorPanel === "boolean") {
        apply(detail.showLeftSidebarMonitorPanel);
      }
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, onChanged);
    };
  }, [apply]);

  return { visible };
}
