import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadComposerFooterChromeDefaultsFromStore,
  saveComposerFooterChromeDefaultsToStore,
  type ComposerFooterChromeDefaults,
  type ComposerFooterTriggerDisplayMode,
} from "../../services/wiseDefaultConfigStore";

export function useComposerFooterChromeDefaultSetting() {
  const [footerChrome, setFooterChrome] = useState<ComposerFooterChromeDefaults>({
    showComposerFooterAttachButton: true,
    showComposerFooterScreenshotButton: true,
    showComposerFooterVoiceButton: true,
    showComposerFooterContextRing: true,
    showComposerFooterCommonPhrases: true,
    showComposerFooterRuntimeSettings: true,
    showComposerFooterModelPicker: true,
    composerFooterTriggerDisplayMode: "full",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFooterChrome(await loadComposerFooterChromeDefaultsFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveField = useCallback(
    async <K extends keyof ComposerFooterChromeDefaults>(key: K, visible: boolean) => {
      if (visible === footerChrome[key]) return;
      setSaving(true);
      try {
        await saveComposerFooterChromeDefaultsToStore({ [key]: visible } as Pick<
          ComposerFooterChromeDefaults,
          K
        >);
        setFooterChrome((prev) => ({ ...prev, [key]: visible }));
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [footerChrome],
  );

  return {
    ...footerChrome,
    loading,
    saving,
    refresh,
    saveAttachButton: (visible: boolean) =>
      saveField("showComposerFooterAttachButton", visible),
    saveScreenshotButton: (visible: boolean) =>
      saveField("showComposerFooterScreenshotButton", visible),
    saveVoiceButton: (visible: boolean) => saveField("showComposerFooterVoiceButton", visible),
    saveContextRing: (visible: boolean) => saveField("showComposerFooterContextRing", visible),
    saveCommonPhrases: (visible: boolean) =>
      saveField("showComposerFooterCommonPhrases", visible),
    saveRuntimeSettings: (visible: boolean) =>
      saveField("showComposerFooterRuntimeSettings", visible),
    saveModelPicker: (visible: boolean) => saveField("showComposerFooterModelPicker", visible),
    saveTriggerDisplayMode: (mode: ComposerFooterTriggerDisplayMode) => {
      if (mode === footerChrome.composerFooterTriggerDisplayMode) return;
      setSaving(true);
      return saveComposerFooterChromeDefaultsToStore({ composerFooterTriggerDisplayMode: mode })
        .then(() => {
          setFooterChrome((prev) => ({ ...prev, composerFooterTriggerDisplayMode: mode }));
        })
        .catch((err) => {
          message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
          throw err;
        })
        .finally(() => setSaving(false));
    },
  };
}
