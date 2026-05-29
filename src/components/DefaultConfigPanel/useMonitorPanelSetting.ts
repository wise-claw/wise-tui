import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadMonitorPanelDefaultFromStore,
  saveMonitorPanelPlacementToStore,
  saveLeftSidebarMonitorPanelVisibleToStore,
  type MonitorPanelPlacement,
} from "../../services/wiseDefaultConfigStore";

export function useMonitorPanelSetting() {
  const [visible, setVisible] = useState(true);
  const [placement, setPlacement] = useState<MonitorPanelPlacement>("left");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadMonitorPanelDefaultFromStore();
      setVisible(loaded.visible);
      setPlacement(loaded.placement);
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
        message.success(next ? "已保存：默认显示运行面板" : "已保存：默认隐藏运行面板");
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
        message.success(next === "left" ? "已保存：运行面板默认在左栏" : "已保存：运行面板默认在右栏");
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [placement],
  );

  return { visible, placement, loading, saving, refresh, saveVisible, savePlacement };
}
