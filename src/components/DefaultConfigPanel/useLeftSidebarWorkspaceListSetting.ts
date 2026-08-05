import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadLeftSidebarWorkspaceListDefaultFromStore,
  saveLeftSidebarWorkspaceListVisibleToStore,
  saveWorkspaceListPlacementToStore,
  saveWorkspaceListVisibleRowsToStore,
  type WorkspaceListPlacement,
  WISE_WORKSPACE_LIST_PLACEMENT_CHANGED,
} from "../../services/wiseDefaultConfigStore";
import { WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT } from "../../constants/workspaceListLayout";

export function useLeftSidebarWorkspaceListSetting() {
  const [visible, setVisible] = useState(true);
  const [visibleRows, setVisibleRows] = useState(WORKSPACE_LIST_VISIBLE_ROWS_DEFAULT);
  const [placement, setPlacement] = useState<WorkspaceListPlacement>("top");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadLeftSidebarWorkspaceListDefaultFromStore();
      setVisible(loaded.visible);
      setVisibleRows(loaded.visibleRows);
      setPlacement(loaded.placement);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onPlacementChanged = (event: Event) => {
      const next = (event as CustomEvent<{ workspaceListPlacement?: WorkspaceListPlacement }>).detail
        ?.workspaceListPlacement;
      if (next === "top" || next === "bottom") {
        setPlacement(next);
      }
    };
    window.addEventListener(WISE_WORKSPACE_LIST_PLACEMENT_CHANGED, onPlacementChanged);
    return () => window.removeEventListener(WISE_WORKSPACE_LIST_PLACEMENT_CHANGED, onPlacementChanged);
  }, []);

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

  const saveVisibleRows = useCallback(
    async (next: number) => {
      if (next === visibleRows) return;
      setSaving(true);
      try {
        await saveWorkspaceListVisibleRowsToStore(next);
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

  const savePlacement = useCallback(
    async (next: WorkspaceListPlacement) => {
      if (next === placement) return;
      setSaving(true);
      try {
        await saveWorkspaceListPlacementToStore(next);
        setPlacement(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [placement],
  );

  return {
    visible,
    visibleRows,
    placement,
    loading,
    saving,
    refresh,
    saveVisible,
    saveVisibleRows,
    savePlacement,
  };
}
