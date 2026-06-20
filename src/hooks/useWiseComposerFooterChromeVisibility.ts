import { useCallback, useEffect, useState } from "react";
import {
  loadComposerFooterChromeDefaultsFromStore,
  WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED,
  type ComposerFooterChromeDefaults,
} from "../services/wiseDefaultConfigStore";

/** 主会话输入框底栏按钮是否显示（`wise.defaultConfig.v1`）。 */
export function useWiseComposerFooterChromeVisibility(): ComposerFooterChromeDefaults {
  const [footerChrome, setFooterChrome] = useState<ComposerFooterChromeDefaults>({
    showComposerFooterAttachButton: true,
    showComposerFooterScreenshotButton: true,
    showComposerFooterVoiceButton: true,
    showComposerFooterContextRing: true,
    showComposerFooterCommonPhrases: true,
    showComposerFooterRuntimeSettings: true,
    showComposerFooterModelPicker: true,
  });

  const apply = useCallback((next: Partial<ComposerFooterChromeDefaults>) => {
    setFooterChrome((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadComposerFooterChromeDefaultsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ComposerFooterChromeDefaults>>).detail;
      if (detail) apply(detail);
    };
    window.addEventListener(WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_COMPOSER_FOOTER_CHROME_DEFAULT_CHANGED, onChanged);
    };
  }, [apply]);

  return footerChrome;
}
