import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadWorkspaceInspectorPanelsFromStore,
  saveWorkspaceInspectorPanelsToStore,
  type WorkspaceInspectorPanelsDefaults,
} from "../../services/wiseDefaultConfigStore";

export function useWorkspaceInspectorPanelsSetting() {
  const [panels, setPanels] = useState<WorkspaceInspectorPanelsDefaults>({
    showWorkspaceQuickActionsPanel: true,
    showWorkspaceTodosPanel: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setPanels(await loadWorkspaceInspectorPanelsFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveQuickActions = useCallback(
    async (visible: boolean) => {
      if (visible === panels.showWorkspaceQuickActionsPanel) return;
      setSaving(true);
      try {
        await saveWorkspaceInspectorPanelsToStore({ showWorkspaceQuickActionsPanel: visible });
        setPanels((prev) => ({ ...prev, showWorkspaceQuickActionsPanel: visible }));
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [panels.showWorkspaceQuickActionsPanel],
  );

  const saveTodos = useCallback(
    async (visible: boolean) => {
      if (visible === panels.showWorkspaceTodosPanel) return;
      setSaving(true);
      try {
        await saveWorkspaceInspectorPanelsToStore({ showWorkspaceTodosPanel: visible });
        setPanels((prev) => ({ ...prev, showWorkspaceTodosPanel: visible }));
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [panels.showWorkspaceTodosPanel],
  );

  return {
    ...panels,
    loading,
    saving,
    refresh,
    saveQuickActions,
    saveTodos,
  };
}
