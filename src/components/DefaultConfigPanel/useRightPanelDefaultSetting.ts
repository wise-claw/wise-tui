import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadRightPanelDefaultCollapsed,
  saveRightPanelDefaultCollapsed,
} from "../../services/rightPanelDefaultStore";

export function useRightPanelDefaultSetting() {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCollapsed(await loadRightPanelDefaultCollapsed());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: boolean) => {
    if (next === collapsed) return;
    setSaving(true);
    try {
      await saveRightPanelDefaultCollapsed(next);
      setCollapsed(next);
      message.success(next ? "已保存：默认收起右侧面板" : "已保存：默认展开右侧面板");
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [collapsed]);

  return { collapsed, loading, saving, refresh, save };
}
