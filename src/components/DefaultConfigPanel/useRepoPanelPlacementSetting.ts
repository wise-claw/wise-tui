import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadRepoPanelPlacementFromStore,
  saveRepoPanelPlacementToStore,
  type MonitorPanelPlacement,
} from "../../services/wiseDefaultConfigStore";

export function useRepoPanelPlacementSetting() {
  const [gitPanelPlacement, setGitPanelPlacement] = useState<MonitorPanelPlacement>("left");
  const [filesPanelPlacement, setFilesPanelPlacement] = useState<MonitorPanelPlacement>("left");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadRepoPanelPlacementFromStore();
      setGitPanelPlacement(loaded.gitPanelPlacement);
      setFilesPanelPlacement(loaded.filesPanelPlacement);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveGitPlacement = useCallback(
    async (next: MonitorPanelPlacement) => {
      if (next === gitPanelPlacement) return;
      setSaving(true);
      try {
        await saveRepoPanelPlacementToStore({ gitPanelPlacement: next });
        setGitPanelPlacement(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [gitPanelPlacement],
  );

  const saveFilesPlacement = useCallback(
    async (next: MonitorPanelPlacement) => {
      if (next === filesPanelPlacement) return;
      setSaving(true);
      try {
        await saveRepoPanelPlacementToStore({ filesPanelPlacement: next });
        setFilesPanelPlacement(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [filesPanelPlacement],
  );

  return {
    gitPanelPlacement,
    filesPanelPlacement,
    loading,
    saving,
    refresh,
    saveGitPlacement,
    saveFilesPlacement,
  };
}
