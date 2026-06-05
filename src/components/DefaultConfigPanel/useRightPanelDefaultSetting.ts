import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadRightPanelDefaultCollapsedFromStore as loadRightPanelDefaultCollapsed,
  saveRightPanelDefaultCollapsedToStore as saveRightPanelDefaultCollapsed,
} from "../../services/wiseDefaultConfigStore";
import { RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK } from "../../utils/rightPanelStorage";

export function useRightPanelDefaultSetting() {
  const [collapsed, setCollapsed] = useState(RIGHT_PANEL_DEFAULT_COLLAPSED_FALLBACK);
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
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [collapsed]);

  return { collapsed, loading, saving, refresh, save };
}
