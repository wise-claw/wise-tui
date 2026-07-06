import { useCallback, useEffect, useState } from "react";
import {
  loadFeaturePanelChromeDefaultsFromStore,
  WISE_FEATURE_PANEL_CHROME_DEFAULT_CHANGED,
  type FeaturePanelChromeDefaults,
} from "../services/wiseDefaultConfigStore";

/** 主会话功能面板按钮显隐（`wise.defaultConfig.v1`）。 */
export function useWiseFeaturePanelChromeVisibility(): FeaturePanelChromeDefaults {
  const [featurePanel, setFeaturePanel] = useState<FeaturePanelChromeDefaults>({
    showFeaturePanelHistorySessions: true,
    showFeaturePanelHistoryMessages: true,
    showFeaturePanelScheduledTasks: true,
  });

  const apply = useCallback((next: Partial<FeaturePanelChromeDefaults>) => {
    setFeaturePanel((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadFeaturePanelChromeDefaultsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<Partial<FeaturePanelChromeDefaults>>).detail;
      if (detail) apply(detail);
    };
    window.addEventListener(WISE_FEATURE_PANEL_CHROME_DEFAULT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_FEATURE_PANEL_CHROME_DEFAULT_CHANGED, onChanged);
    };
  }, [apply]);

  return featurePanel;
}
