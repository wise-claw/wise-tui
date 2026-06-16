import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadRepositoryIconBadgesVisibleInWorkspaceListFromStore,
  saveRepositoryIconBadgesVisibleInWorkspaceListToStore,
} from "../../services/wiseDefaultConfigStore";

export function useLeftSidebarRepositoryIconBadgesSetting() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setVisible(await loadRepositoryIconBadgesVisibleInWorkspaceListFromStore());
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
        await saveRepositoryIconBadgesVisibleInWorkspaceListToStore(next);
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
