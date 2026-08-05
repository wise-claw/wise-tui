import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarRequirementsPanelVisibleFromStore,
  WISE_LEFT_SIDEBAR_REQUIREMENTS_PANEL_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏需求列表面板默认显隐（`wise.defaultConfig.v1`）。 */
export function useLeftSidebarRequirementsPanelDefault() {
  const [visible, setVisible] = useState(true);

  const apply = useCallback((next: boolean) => {
    setVisible(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLeftSidebarRequirementsPanelVisibleFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onVisibilityChanged = (event: Event) => {
      const nextVisible = (event as CustomEvent<{ showLeftSidebarRequirementsPanel?: boolean }>).detail
        ?.showLeftSidebarRequirementsPanel;
      if (typeof nextVisible === "boolean") {
        setVisible(nextVisible);
      }
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_REQUIREMENTS_PANEL_CHANGED, onVisibilityChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_LEFT_SIDEBAR_REQUIREMENTS_PANEL_CHANGED, onVisibilityChanged);
    };
  }, [apply]);

  return visible;
}
