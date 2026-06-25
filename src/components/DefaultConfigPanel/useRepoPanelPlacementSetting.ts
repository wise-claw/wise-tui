import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadRepoPanelPlacementFromStore,
  loadRepoPanelSplitModeFromStore,
  saveRepoPanelPlacementToStore,
  saveRepoPanelSplitModeToStore,
  type MonitorPanelPlacement,
} from "../../services/wiseDefaultConfigStore";

export function useRepoPanelPlacementSetting() {
  const [gitPanelPlacement, setGitPanelPlacement] = useState<MonitorPanelPlacement>("left");
  const [filesPanelPlacement, setFilesPanelPlacement] = useState<MonitorPanelPlacement>("left");
  const [repoPanelSplitMode, setRepoPanelSplitMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [placement, splitMode] = await Promise.all([
        loadRepoPanelPlacementFromStore(),
        loadRepoPanelSplitModeFromStore(),
      ]);
      setGitPanelPlacement(placement.gitPanelPlacement);
      setFilesPanelPlacement(placement.filesPanelPlacement);
      setRepoPanelSplitMode(splitMode);
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

  const saveSplitMode = useCallback(async (next: boolean) => {
    setSaving(true);
    try {
      await saveRepoPanelSplitModeToStore(next);
      setRepoPanelSplitMode(next);
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    gitPanelPlacement,
    filesPanelPlacement,
    repoPanelSplitMode,
    loading,
    saving,
    refresh,
    saveGitPlacement,
    saveFilesPlacement,
    saveSplitMode,
  };
}
