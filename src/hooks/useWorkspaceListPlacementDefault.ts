import { useCallback, useEffect, useState } from "react";
import {
  loadWorkspaceListPlacementFromStore,
  type WorkspaceListPlacement,
  WISE_WORKSPACE_LIST_PLACEMENT_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏工作区树纵向位置（顶 / 底）。 */
export function useWorkspaceListPlacementDefault(): WorkspaceListPlacement {
  const [placement, setPlacement] = useState<WorkspaceListPlacement>("top");

  const apply = useCallback((next: WorkspaceListPlacement) => {
    setPlacement(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceListPlacementFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const next = (event as CustomEvent<{ workspaceListPlacement?: WorkspaceListPlacement }>).detail
        ?.workspaceListPlacement;
      if (next === "top" || next === "bottom") {
        apply(next);
      }
    };
    window.addEventListener(WISE_WORKSPACE_LIST_PLACEMENT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_WORKSPACE_LIST_PLACEMENT_CHANGED, onChanged);
    };
  }, [apply]);

  return placement;
}
