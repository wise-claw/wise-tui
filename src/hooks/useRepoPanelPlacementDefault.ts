import { useCallback, useEffect, useState } from "react";
import {
  loadRepoPanelPlacementFromStore,
  type MonitorPanelPlacement,
  WISE_REPO_PANEL_PLACEMENT_CHANGED,
} from "../services/wiseDefaultConfigStore";

export interface RepoPanelPlacementDefault {
  gitPanelPlacement: MonitorPanelPlacement;
  filesPanelPlacement: MonitorPanelPlacement;
}

/** Git / 文件树默认栏位（`wise.defaultConfig.v1`）。 */
export function useRepoPanelPlacementDefault(): RepoPanelPlacementDefault {
  const [state, setState] = useState<RepoPanelPlacementDefault>({
    gitPanelPlacement: "left",
    filesPanelPlacement: "left",
  });

  const apply = useCallback((next: RepoPanelPlacementDefault) => {
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRepoPanelPlacementFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          gitPanelPlacement?: MonitorPanelPlacement;
          filesPanelPlacement?: MonitorPanelPlacement;
        }>
      ).detail;
      if (detail?.gitPanelPlacement !== "left" && detail?.gitPanelPlacement !== "right") return;
      if (detail?.filesPanelPlacement !== "left" && detail?.filesPanelPlacement !== "right") {
        return;
      }
      setState({
        gitPanelPlacement: detail.gitPanelPlacement,
        filesPanelPlacement: detail.filesPanelPlacement,
      });
    };
    window.addEventListener(WISE_REPO_PANEL_PLACEMENT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_REPO_PANEL_PLACEMENT_CHANGED, onChanged);
    };
  }, [apply]);

  return state;
}
