import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarWorkspaceListVisibleFromStore,
  saveLeftSidebarWorkspaceListVisibleToStore,
} from "../../services/wiseDefaultConfigStore";

export function useLeftSidebarWorkspaceListSetting() {
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVisible(await loadLeftSidebarWorkspaceListVisibleFromStore());
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
        await saveLeftSidebarWorkspaceListVisibleToStore(next);
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

  return {
    visible,
    loading,
    saving,
    refresh,
    saveVisible,
  };
}
