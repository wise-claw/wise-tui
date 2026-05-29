import { useCallback, useEffect, useState } from "react";
import {
  loadMonitorPanelDefaultFromStore,
  type MonitorPanelPlacement,
  WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED,
  WISE_MONITOR_PANEL_PLACEMENT_CHANGED,
} from "../services/wiseDefaultConfigStore";

export interface MonitorPanelDefault {
  visible: boolean;
  placement: MonitorPanelPlacement;
}

/** 运行面板默认显示与栏位（`wise.defaultConfig.v1`）。 */
export function useMonitorPanelDefault(): MonitorPanelDefault {
  const [state, setState] = useState<MonitorPanelDefault>({
    visible: true,
    placement: "left",
  });

  const apply = useCallback((next: MonitorPanelDefault) => {
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMonitorPanelDefaultFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onVisibilityChanged = (event: Event) => {
      const visible = (event as CustomEvent<{ showLeftSidebarMonitorPanel?: boolean }>).detail
        ?.showLeftSidebarMonitorPanel;
      if (typeof visible === "boolean") {
        setState((prev) => ({ ...prev, visible }));
      }
    };
    const onPlacementChanged = (event: Event) => {
      const placement = (event as CustomEvent<{ monitorPanelPlacement?: MonitorPanelPlacement }>)
        .detail?.monitorPanelPlacement;
      if (placement === "left" || placement === "right") {
        setState((prev) => ({ ...prev, placement }));
      }
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, onVisibilityChanged);
    window.addEventListener(WISE_MONITOR_PANEL_PLACEMENT_CHANGED, onPlacementChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_LEFT_SIDEBAR_MONITOR_PANEL_CHANGED, onVisibilityChanged);
      window.removeEventListener(WISE_MONITOR_PANEL_PLACEMENT_CHANGED, onPlacementChanged);
    };
  }, [apply]);

  return state;
}
