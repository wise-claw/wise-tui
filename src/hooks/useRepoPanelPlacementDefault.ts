import { useCallback, useEffect, useState } from "react";
import {
  loadRepoPanelPlacementFromStore,
  loadRepoPanelSplitModeFromStore,
  type MonitorPanelPlacement,
  WISE_REPO_PANEL_PLACEMENT_CHANGED,
  WISE_REPO_PANEL_SPLIT_MODE_CHANGED,
} from "../services/wiseDefaultConfigStore";

export interface RepoPanelPlacementDefault {
  gitPanelPlacement: MonitorPanelPlacement;
  filesPanelPlacement: MonitorPanelPlacement;
  repoPanelSplitMode: boolean;
}

/** Git / 文件树默认栏位（`wise.defaultConfig.v1`）。 */
export function useRepoPanelPlacementDefault(): RepoPanelPlacementDefault {
  const [state, setState] = useState<RepoPanelPlacementDefault>({
    gitPanelPlacement: "left",
    filesPanelPlacement: "left",
    repoPanelSplitMode: false,
  });

  const apply = useCallback((next: RepoPanelPlacementDefault) => {
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadRepoPanelPlacementFromStore(),
      loadRepoPanelSplitModeFromStore(),
    ]).then(([placement, splitMode]) => {
      if (!cancelled) apply({ ...placement, repoPanelSplitMode: splitMode });
    });
    const onPlacementChanged = (event: Event) => {
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
      setState((prev) => ({
        ...prev,
        gitPanelPlacement: detail.gitPanelPlacement!,
        filesPanelPlacement: detail.filesPanelPlacement!,
      }));
    };
    const onSplitModeChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{ repoPanelSplitMode?: boolean }>
      ).detail;
      if (typeof detail?.repoPanelSplitMode !== "boolean") return;
      setState((prev) => ({ ...prev, repoPanelSplitMode: detail.repoPanelSplitMode! }));
    };
    window.addEventListener(WISE_REPO_PANEL_PLACEMENT_CHANGED, onPlacementChanged);
    window.addEventListener(WISE_REPO_PANEL_SPLIT_MODE_CHANGED, onSplitModeChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_REPO_PANEL_PLACEMENT_CHANGED, onPlacementChanged);
      window.removeEventListener(WISE_REPO_PANEL_SPLIT_MODE_CHANGED, onSplitModeChanged);
    };
  }, [apply]);

  return state;
}
