import { useCallback, useEffect, useState } from "react";
import {
  loadRepositoryIconBadgesVisibleInWorkspaceListFromStore,
  WISE_LEFT_SIDEBAR_REPOSITORY_ICON_BADGES_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏工作区列表中仓库圆形角标默认显隐（`wise.defaultConfig.v1`）。 */
export function useLeftSidebarRepositoryIconBadgesDefault() {
  const [visible, setVisible] = useState(false);

  const apply = useCallback((next: boolean) => {
    setVisible(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRepositoryIconBadgesVisibleInWorkspaceListFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onVisibilityChanged = (event: Event) => {
      const nextVisible = (
        event as CustomEvent<{ showRepositoryIconBadgesInWorkspaceList?: boolean }>
      ).detail?.showRepositoryIconBadgesInWorkspaceList;
      if (typeof nextVisible === "boolean") {
        setVisible(nextVisible);
      }
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_REPOSITORY_ICON_BADGES_CHANGED, onVisibilityChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(
        WISE_LEFT_SIDEBAR_REPOSITORY_ICON_BADGES_CHANGED,
        onVisibilityChanged,
      );
    };
  }, [apply]);

  return visible;
}
