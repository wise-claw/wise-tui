import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadFeaturePanelChromeDefaultsFromStore,
  saveFeaturePanelChromeDefaultsToStore,
  type FeaturePanelChromeDefaults,
} from "../../services/wiseDefaultConfigStore";

export function useFeaturePanelChromeDefaultSetting() {
  const [featurePanel, setFeaturePanel] = useState<FeaturePanelChromeDefaults>({
    showFeaturePanelHistorySessions: true,
    showFeaturePanelHistoryMessages: true,
    showFeaturePanelScheduledTasks: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFeaturePanel(await loadFeaturePanelChromeDefaultsFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveField = useCallback(
    async <K extends keyof FeaturePanelChromeDefaults>(key: K, visible: boolean) => {
      if (visible === featurePanel[key]) return;
      setSaving(true);
      try {
        await saveFeaturePanelChromeDefaultsToStore({ [key]: visible } as Pick<
          FeaturePanelChromeDefaults,
          K
        >);
        setFeaturePanel((prev) => ({ ...prev, [key]: visible }));
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [featurePanel],
  );

  return {
    ...featurePanel,
    loading,
    saving,
    refresh,
    saveHistorySessions: (visible: boolean) =>
      saveField("showFeaturePanelHistorySessions", visible),
    saveHistoryMessages: (visible: boolean) =>
      saveField("showFeaturePanelHistoryMessages", visible),
    saveScheduledTasks: (visible: boolean) =>
      saveField("showFeaturePanelScheduledTasks", visible),
  };
}
