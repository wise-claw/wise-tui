import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import { WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT } from "../../constants/workspaceSidebarLayout";
import {
  loadWorkspaceSidebarRowPreviewLimitFromStore,
  saveWorkspaceSidebarRowPreviewLimitToStore,
} from "../../services/wiseDefaultConfigStore";

export function useWorkspaceSidebarRowPreviewLimitSetting() {
  const [previewLimit, setPreviewLimit] = useState(WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadWorkspaceSidebarRowPreviewLimitFromStore();
      setPreviewLimit(loaded);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const savePreviewLimit = useCallback(
    async (next: number) => {
      if (next === previewLimit) return;
      setSaving(true);
      try {
        await saveWorkspaceSidebarRowPreviewLimitToStore(next);
        setPreviewLimit(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [previewLimit],
  );

  return {
    previewLimit,
    loading,
    saving,
    refresh,
    savePreviewLimit,
  };
}
