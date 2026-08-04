import { useCallback, useEffect, useState } from "react";
import {
  loadRepoPanelPlacementFromStore,
  loadRepoPanelSplitModeFromStore,
  type RepoPanelVisibility,
  WISE_REPO_PANEL_PLACEMENT_CHANGED,
  WISE_REPO_PANEL_SPLIT_MODE_CHANGED,
} from "../services/wiseDefaultConfigStore";

export interface RepoPanelPlacementDefault {
  gitPanelPlacement: RepoPanelVisibility;
  filesPanelPlacement: RepoPanelVisibility;
  repoPanelSplitMode: boolean;
}

/** Git / 文件树默认显示（`wise.defaultConfig.v1`）。 */
export function useRepoPanelPlacementDefault(): RepoPanelPlacementDefault {
  const [state, setState] = useState<RepoPanelPlacementDefault>({
    gitPanelPlacement: "visible",
    filesPanelPlacement: "visible",
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
          gitPanelPlacement?: RepoPanelVisibility;
          filesPanelPlacement?: RepoPanelVisibility;
        }>
      ).detail;
      if (detail?.gitPanelPlacement !== "visible" && detail?.gitPanelPlacement !== "hidden") {
        return;
      }
      if (detail?.filesPanelPlacement !== "visible" && detail?.filesPanelPlacement !== "hidden") {
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
