import { useCallback, useEffect, useState } from "react";
import {
  loadWorkspaceInspectorPanelsFromStore,
  WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED,
  type WorkspaceInspectorPanelsDefaults,
} from "../services/wiseDefaultConfigStore";

/** 右栏快捷操作 / 备忘录 / 待办默认显隐（`wise.defaultConfig.v1`）。 */
export function useWorkspaceInspectorPanelsDefault(): WorkspaceInspectorPanelsDefaults {
  const [state, setState] = useState<WorkspaceInspectorPanelsDefaults>({
    showWorkspaceQuickActionsPanel: true,
    showWorkspaceMemosPanel: true,
    showWorkspaceTodosPanel: true,
  });

  const apply = useCallback((next: WorkspaceInspectorPanelsDefaults) => {
    setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceInspectorPanelsFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<Partial<WorkspaceInspectorPanelsDefaults>>).detail;
      if (!detail) return;
      setState((prev) => ({
        showWorkspaceQuickActionsPanel:
          typeof detail.showWorkspaceQuickActionsPanel === "boolean"
            ? detail.showWorkspaceQuickActionsPanel
            : prev.showWorkspaceQuickActionsPanel,
        showWorkspaceMemosPanel:
          typeof detail.showWorkspaceMemosPanel === "boolean"
            ? detail.showWorkspaceMemosPanel
            : prev.showWorkspaceMemosPanel,
        showWorkspaceTodosPanel:
          typeof detail.showWorkspaceTodosPanel === "boolean"
            ? detail.showWorkspaceTodosPanel
            : prev.showWorkspaceTodosPanel,
      }));
    };
    window.addEventListener(WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_WORKSPACE_INSPECTOR_PANELS_CHANGED, onChanged);
    };
  }, [apply]);

  return state;
}
