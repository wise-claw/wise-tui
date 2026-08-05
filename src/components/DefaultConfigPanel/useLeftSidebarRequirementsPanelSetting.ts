import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarRequirementsPanelDefaultFromStore,
  saveLeftSidebarRequirementsPanelVisibleToStore,
  saveRequirementsPanelVisibleRowsToStore,
} from "../../services/wiseDefaultConfigStore";
import { REQUIREMENTS_PANEL_VISIBLE_ROWS_DEFAULT } from "../../constants/requirementsPanelLayout";

export function useLeftSidebarRequirementsPanelSetting() {
  const [visible, setVisible] = useState(true);
  const [visibleRows, setVisibleRows] = useState(REQUIREMENTS_PANEL_VISIBLE_ROWS_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadLeftSidebarRequirementsPanelDefaultFromStore();
      setVisible(loaded.visible);
      setVisibleRows(loaded.visibleRows);
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
        await saveLeftSidebarRequirementsPanelVisibleToStore(next);
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

  const saveVisibleRows = useCallback(
    async (next: number) => {
      if (next === visibleRows) return;
      setSaving(true);
      try {
        await saveRequirementsPanelVisibleRowsToStore(next);
        setVisibleRows(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [visibleRows],
  );

  return {
    visible,
    visibleRows,
    loading,
    saving,
    refresh,
    saveVisible,
    saveVisibleRows,
  };
}
