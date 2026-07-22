import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";
import { collapseTerminalCenterPanelOnPane } from "./terminalCenterPanelStore";

/**
 * 全局备忘录中栏面板开关（与打开文件同一 slot：`panelBelowMessages` + CenterView「files」）。
 * 侧栏入口与 layout 通过本 store 解耦，避免 prop 穿透。
 */

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function getWorkspaceMemoPanelOpen(): boolean {
  return open;
}

export function subscribeWorkspaceMemoPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openWorkspaceMemoPanel(): void {
  // 备忘录占 pane 0：仅收起挂在 pane 0 的终端，其它屏终端不受影响。
  collapseTerminalCenterPanelOnPane(0);
  if (open) {
    requestPaneCenterView(0, "files");
    return;
  }
  open = true;
  emit();
  requestPaneCenterView(0, "files");
}

export function closeWorkspaceMemoPanel(): void {
  if (!open) return;
  open = false;
  emit();
}

export function toggleWorkspaceMemoPanel(): void {
  if (open) {
    closeWorkspaceMemoPanel();
    return;
  }
  openWorkspaceMemoPanel();
}

export function useWorkspaceMemoPanelOpen(): boolean {
  return useSyncExternalStore(subscribeWorkspaceMemoPanel, getWorkspaceMemoPanelOpen, () => false);
}
