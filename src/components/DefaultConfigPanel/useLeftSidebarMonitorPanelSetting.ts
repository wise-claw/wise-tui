import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarMonitorPanelVisibleFromStore,
  saveLeftSidebarMonitorPanelVisibleToStore,
} from "../../services/wiseDefaultConfigStore";

export function useLeftSidebarMonitorPanelSetting() {
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVisible(await loadLeftSidebarMonitorPanelVisibleFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
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

  return { visible, loading, saving, refresh, save };
}
