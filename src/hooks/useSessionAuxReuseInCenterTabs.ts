import { useCallback, useEffect, useState } from "react";
import {
  loadSessionAuxReuseInCenterTabsFromStore,
  WISE_SESSION_AUX_REUSE_IN_CENTER_TABS_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 会话右栏是否复用到消息区顶部 Tab（`wise.defaultConfig.v1`）。 */
export function useSessionAuxReuseInCenterTabs(): boolean {
  const [enabled, setEnabled] = useState(false);

  const apply = useCallback((next: boolean) => {
    setEnabled(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSessionAuxReuseInCenterTabsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === "boolean") {
        apply(detail.enabled);
      }
    };
    window.addEventListener(WISE_SESSION_AUX_REUSE_IN_CENTER_TABS_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_SESSION_AUX_REUSE_IN_CENTER_TABS_CHANGED, onChanged);
    };
  }, [apply]);

  return enabled;
}
