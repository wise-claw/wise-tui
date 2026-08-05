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
  /** 打开新增弹窗时预填的仓库 id（优先于当前选中仓库） */
  createModalDefaultRepositoryId: string | null;
  /** 侧栏等入口请求打开编辑某条需求 */
  editRequestId: string | null;
  editRequestEpoch: number;
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
      createModalDefaultRepositoryId: null,
      editRequestId: null,
      editRequestEpoch: 0,
      listeners: new Set(),
      createModalListeners: new Set(),
    };
  } else {
    const state = g[STATE_KEY]!;
    if (!("createModalDefaultRepositoryId" in state)) {
      state.createModalDefaultRepositoryId = null;
    }
    if (!("editRequestId" in state)) {
      state.editRequestId = null;
      state.editRequestEpoch = 0;
    }
  }
  return g[STATE_KEY]!;
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

export function getWorkspaceRequirementCreateModalDefaultRepositoryId(): string | null {
  return getState().createModalDefaultRepositoryId;
}

export function subscribeWorkspaceRequirementCreateModal(listener: () => void): () => void {
  const { createModalListeners } = getState();
  createModalListeners.add(listener);
  return () => {
    createModalListeners.delete(listener);
  };
}

export type RequestWorkspaceRequirementCreateOptions = {
  /** 预填归属仓库；省略则由弹窗回退到当前选中仓库 */
  defaultRepositoryId?: string | null;
};

/**
 * 仅弹出「新增需求」弹窗，不打开 / 不切换需求 tab。
 * 供全局快捷键 ⌘A / Ctrl+A 与面板「新增」按钮使用。
 */
export function requestWorkspaceRequirementCreate(
  options?: RequestWorkspaceRequirementCreateOptions,
): void {
  const state = getState();
  const raw = options?.defaultRepositoryId;
  state.createModalDefaultRepositoryId =
    typeof raw === "string" && raw.trim() ? raw.trim() : null;
  state.createModalOpen = true;
  state.createModalEpoch += 1;
  emitCreateModal();
}

export function closeWorkspaceRequirementCreateModal(): void {
  const state = getState();
  if (!state.createModalOpen) return;
  state.createModalOpen = false;
  state.createModalDefaultRepositoryId = null;
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

export function useWorkspaceRequirementCreateModalDefaultRepositoryId(): string | null {
  return useSyncExternalStore(
    subscribeWorkspaceRequirementCreateModal,
    getWorkspaceRequirementCreateModalDefaultRepositoryId,
    () => null,
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

/**
 * 打开需求中栏面板并请求编辑指定条目（由 WorkspaceMemoPanel 消费）。
 */
export function requestWorkspaceRequirementEdit(requirementId: string): void {
  const id = requirementId.trim();
  if (!id) return;
  const state = getState();
  state.editRequestId = id;
  state.editRequestEpoch += 1;
  openWorkspaceMemoPanel();
  emit();
}

export function getWorkspaceRequirementEditRequestId(): string | null {
  return getState().editRequestId;
}

export function getWorkspaceRequirementEditRequestEpoch(): number {
  return getState().editRequestEpoch;
}

export function consumeWorkspaceRequirementEditRequest(): string | null {
  const state = getState();
  const id = state.editRequestId;
  if (!id) return null;
  state.editRequestId = null;
  emit();
  return id;
}

export function useWorkspaceRequirementEditRequestEpoch(): number {
  return useSyncExternalStore(
    subscribeWorkspaceMemoPanel,
    getWorkspaceRequirementEditRequestEpoch,
    () => 0,
  );
}

export function closeWorkspaceMemoPanel(): void {
  const state = getState();
  if (!state.open) return;
  state.open = false;
  state.editRequestId = null;
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
