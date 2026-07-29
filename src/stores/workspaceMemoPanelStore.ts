import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";

/**
 * 全局需求管理中栏面板开关（与打开文件同一 slot：`panelBelowMessages` + CenterView「files」）。
 * 侧栏入口与 layout 通过本 store 解耦，避免 prop 穿透。
 * 终端已是独立 slot，打开需求面板不再 collapse 终端。
 * 函数名保留 Memo 前缀以兼容既有调用方。
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
