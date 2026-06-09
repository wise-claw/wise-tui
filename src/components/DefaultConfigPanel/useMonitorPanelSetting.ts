import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadMonitorPanelDefaultFromStore,
  saveMonitorPanelPlacementToStore,
  saveMonitorPanelVisibleRowsToStore,
  saveLeftSidebarMonitorPanelVisibleToStore,
  type MonitorPanelPlacement,
} from "../../services/wiseDefaultConfigStore";

export function useMonitorPanelSetting() {
  const [visible, setVisible] = useState(true);
  const [placement, setPlacement] = useState<MonitorPanelPlacement>("left");
  const [visibleRows, setVisibleRows] = useState(8);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadMonitorPanelDefaultFromStore();
      setVisible(loaded.visible);
      setPlacement(loaded.placement);
      setVisibleRows(loaded.visibleRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveVisible = useCallback(
    async (next: boolean) => {
      if (next === visible) return;
      setSaving(true);
      try {
        await saveLeftSidebarMonitorPanelVisibleToStore(next);
        setVisible(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [visible],
  );

  const savePlacement = useCallback(
    async (next: MonitorPanelPlacement) => {
      if (next === placement) return;
      setSaving(true);
      try {
        await saveMonitorPanelPlacementToStore(next);
        setPlacement(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [placement],
  );

  const saveVisibleRows = useCallback(
    async (next: number) => {
      if (next === visibleRows) return;
      setSaving(true);
      try {
        await saveMonitorPanelVisibleRowsToStore(next);
        setVisibleRows(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [visibleRows],
  );

  return {
    visible,
    placement,
    visibleRows,
    loading,
    saving,
    refresh,
    saveVisible,
    savePlacement,
    saveVisibleRows,
  };
}
