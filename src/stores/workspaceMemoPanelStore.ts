import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";

/**
 * 全局需求管理中栏面板开关（独立 CenterView「requirements」slot）。
 * 侧栏入口与 layout 通过本 store 解耦，避免 prop 穿透。
 * 「新增需求」弹窗可独立于需求 tab 打开（⌘A）。
 * 函数名保留 Memo 前缀以兼容既有调用方。
 *
 * 状态挂在 globalThis，避免 Vite HMR / 多 chunk 出现两份模块级变量。
 */

type MemoPanelState = {
  open: boolean;
  createModalOpen: boolean;
  /** 每次打开新增弹窗递增，用于重置编辑器实例 */
  createModalEpoch: number;
  listeners: Set<() => void>;
  createModalListeners: Set<() => void>;
};

const STATE_KEY = "__wise_workspace_memo_panel_state__";

function getState(): MemoPanelState {
  const g = globalThis as typeof globalThis & {
    [STATE_KEY]?: MemoPanelState;
  };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      open: false,
      createModalOpen: false,
      createModalEpoch: 0,
      listeners: new Set(),
      createModalListeners: new Set(),
    };
  }
  return g[STATE_KEY];
}

function emit(): void {
  const { listeners } = getState();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function emitCreateModal(): void {
  const { createModalListeners } = getState();
  for (const listener of createModalListeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function getWorkspaceMemoPanelOpen(): boolean {
  return getState().open;
}

export function subscribeWorkspaceMemoPanel(listener: () => void): () => void {
  const { listeners } = getState();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWorkspaceRequirementCreateModalOpen(): boolean {
  return getState().createModalOpen;
}

export function getWorkspaceRequirementCreateModalEpoch(): number {
  return getState().createModalEpoch;
}

export function subscribeWorkspaceRequirementCreateModal(listener: () => void): () => void {
  const { createModalListeners } = getState();
  createModalListeners.add(listener);
  return () => {
    createModalListeners.delete(listener);
  };
}

/**
 * 仅弹出「新增需求」弹窗，不打开 / 不切换需求 tab。
 * 供全局快捷键 ⌘A / Ctrl+A 与面板「新增」按钮使用。
 */
export function requestWorkspaceRequirementCreate(): void {
  const state = getState();
  state.createModalOpen = true;
  state.createModalEpoch += 1;
  emitCreateModal();
}

export function closeWorkspaceRequirementCreateModal(): void {
  const state = getState();
  if (!state.createModalOpen) return;
  state.createModalOpen = false;
  emitCreateModal();
}

export function useWorkspaceRequirementCreateModalOpen(): boolean {
  return useSyncExternalStore(
    subscribeWorkspaceRequirementCreateModal,
    getWorkspaceRequirementCreateModalOpen,
    () => false,
  );
}

export function useWorkspaceRequirementCreateModalEpoch(): number {
  return useSyncExternalStore(
    subscribeWorkspaceRequirementCreateModal,
    getWorkspaceRequirementCreateModalEpoch,
    () => 0,
  );
}

export function openWorkspaceMemoPanel(): void {
  const state = getState();
  if (state.open) {
    requestPaneCenterView(0, "requirements");
    return;
  }
  state.open = true;
  emit();
  requestPaneCenterView(0, "requirements");
}

export function closeWorkspaceMemoPanel(): void {
  const state = getState();
  if (!state.open) return;
  state.open = false;
  emit();
}

export function toggleWorkspaceMemoPanel(): void {
  if (getState().open) {
    closeWorkspaceMemoPanel();
    return;
  }
  openWorkspaceMemoPanel();
}

export function useWorkspaceMemoPanelOpen(): boolean {
  return useSyncExternalStore(subscribeWorkspaceMemoPanel, getWorkspaceMemoPanelOpen, () => false);
}
