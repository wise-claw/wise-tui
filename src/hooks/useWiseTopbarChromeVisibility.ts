import { useCallback, useEffect, useState } from "react";
import {
  loadTopbarChromeDefaultsFromStore,
  WISE_TOPBAR_CHROME_DEFAULT_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 主会话顶栏工具图标是否显示（`wise.defaultConfig.v1`）。 */
export function useWiseTopbarChromeVisibility(): {
  showLlmProxyTopbar: boolean;
  showFccTopbar: boolean;
} {
  const [showLlmProxyTopbar, setShowLlmProxyTopbar] = useState(false);
  const [showFccTopbar, setShowFccTopbar] = useState(true);

  const apply = useCallback((next: { showLlmProxyTopbar?: boolean; showFccTopbar?: boolean }) => {
    if (typeof next.showLlmProxyTopbar === "boolean") {
      setShowLlmProxyTopbar(next.showLlmProxyTopbar);
    }
    if (typeof next.showFccTopbar === "boolean") {
      setShowFccTopbar(next.showFccTopbar);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTopbarChromeDefaultsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ showLlmProxyTopbar?: boolean; showFccTopbar?: boolean }>)
        .detail;
      if (detail) apply(detail);
    };
    window.addEventListener(WISE_TOPBAR_CHROME_DEFAULT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_TOPBAR_CHROME_DEFAULT_CHANGED, onChanged);
    };
  }, [apply]);

  return { showLlmProxyTopbar, showFccTopbar };
}
