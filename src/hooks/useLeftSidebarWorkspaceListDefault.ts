import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarWorkspaceListVisibleFromStore,
  WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏工作区 / 仓库树默认显隐（`wise.defaultConfig.v1`）。 */
export function useLeftSidebarWorkspaceListDefault() {
  const [visible, setVisible] = useState(true);

  const apply = useCallback((next: boolean) => {
    setVisible(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLeftSidebarWorkspaceListVisibleFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onVisibilityChanged = (event: Event) => {
      const nextVisible = (event as CustomEvent<{ showLeftSidebarWorkspaceList?: boolean }>).detail
        ?.showLeftSidebarWorkspaceList;
      if (typeof nextVisible === "boolean") {
        setVisible(nextVisible);
      }
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED, onVisibilityChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_LEFT_SIDEBAR_WORKSPACE_LIST_CHANGED, onVisibilityChanged);
    };
  }, [apply]);

  return visible;
}
