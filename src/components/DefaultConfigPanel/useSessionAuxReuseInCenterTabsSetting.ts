import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadSessionAuxReuseInCenterTabsFromStore,
  saveSessionAuxReuseInCenterTabsToStore,
  WISE_SESSION_AUX_REUSE_IN_CENTER_TABS_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useSessionAuxReuseInCenterTabsSetting() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEnabled(await loadSessionAuxReuseInCenterTabsFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === "boolean") {
        setEnabled(detail.enabled);
      } else {
        void refresh();
      }
    };
    window.addEventListener(WISE_SESSION_AUX_REUSE_IN_CENTER_TABS_CHANGED, onChanged as EventListener);
    return () => {
      window.removeEventListener(
        WISE_SESSION_AUX_REUSE_IN_CENTER_TABS_CHANGED,
        onChanged as EventListener,
      );
    };
  }, [refresh]);

  const save = useCallback(
    async (next: boolean) => {
      if (next === enabled) return;
      setSaving(true);
      try {
        await saveSessionAuxReuseInCenterTabsToStore(next);
        setEnabled(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [enabled],
  );

  return { enabled, loading, saving, refresh, save };
}
