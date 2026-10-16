import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadDynamicIslandNotificationsFromStore,
  saveDynamicIslandNotificationsToStore,
} from "../../services/wiseDefaultConfigStore";

export function useDynamicIslandNotificationsSetting() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const defaults = await loadDynamicIslandNotificationsFromStore();
      setEnabled(defaults);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (next: boolean) => {
    if (next === enabled) return;
    setSaving(true);
    try {
      await saveDynamicIslandNotificationsToStore(next);
      setEnabled(next);
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [enabled]);

  return { enabled, loading, saving, refresh, save };
}
