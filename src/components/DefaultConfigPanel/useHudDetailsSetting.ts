import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadHudDetailsDefaultsFromStore,
  saveHudDetailsDefaultsToStore,
} from "../../services/wiseDefaultConfigStore";

export function useHudDetailsSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const defaults = await loadHudDetailsDefaultsFromStore();
      setEnabled(defaults.showHudPersistentDetails);
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
      await saveHudDetailsDefaultsToStore({ showHudPersistentDetails: next });
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
