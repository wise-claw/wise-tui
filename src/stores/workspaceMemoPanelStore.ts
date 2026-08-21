import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";

/**
 * 全局需求管理中栏面板开关（独立 CenterView「requirements」slot）。
 * 侧栏入口与 layout 通过本 store 解耦，避免 prop 穿透。
 * 「新增 / 编辑需求」弹窗可独立于需求 tab 打开。
 * 函数名保留 Memo 前缀以兼容既有调用方。
 *
 * 状态挂在 globalThis，避免 Vite HMR / 多 chunk 出现两份模块级变量。
 */

type MemoPanelState = {
  open: boolean;
  /** 从左栏定位到右栏的当前需求。 */
  selectedRequirementId: string | null;
  createModalOpen: boolean;
  /** 每次打开新增弹窗递增，用于重置编辑器实例 */
  createModalEpoch: number;
  /** 打开新增弹窗时预填的仓库 id（优先于当前选中仓库） */
  createModalDefaultRepositoryId: string | null;
  /** 独立编辑弹窗（不打开中栏需求 tab） */
  editModalOpen: boolean;
  editModalEpoch: number;
  editModalRequirementId: string | null;
  listeners: Set<() => void>;
  createModalListeners: Set<() => void>;
  editModalListeners: Set<() => void>;
};

const STATE_KEY = "__wise_workspace_memo_panel_state__";

/** 需求详情请求打开其关联执行会话；由 App 根节点统一处理路由。 */
export const WISE_UI_EVENT_OPEN_WORKSPACE_REQUIREMENT_SESSION =
  "wise:open-workspace-requirement-session";
export const WISE_UI_EVENT_RESUME_WORKSPACE_REQUIREMENT_SESSION =
  "wise:resume-workspace-requirement-session";

export type ResumeWorkspaceRequirementSessionDetail = {
  sessionId: string;
  prompt: string;
  resolve: (accepted: boolean) => void;
};

export function openWorkspaceRequirementExecutionSession(sessionId: string): void {
  const id = sessionId.trim();
  if (!id || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ sessionId: string }>(WISE_UI_EVENT_OPEN_WORKSPACE_REQUIREMENT_SESSION, {
      detail: { sessionId: id },
    }),
  );
}

/** 通过 App 中已注册的会话运行时续接 worker，不能直接把 tab id 当 streaming id 调用。 */
export function resumeWorkspaceRequirementExecutionSession(
  sessionId: string,
  prompt: string,
): Promise<boolean> {
  const id = sessionId.trim();
  const text = prompt.trim();
  if (!id || !text || typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ResumeWorkspaceRequirementSessionDetail>(
        WISE_UI_EVENT_RESUME_WORKSPACE_REQUIREMENT_SESSION,
        { detail: { sessionId: id, prompt: text, resolve } },
      ),
    );
  });
}

function getState(): MemoPanelState {
  const g = globalThis as typeof globalThis & {
    [STATE_KEY]?: MemoPanelState;
  };
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = {
      open: false,
      selectedRequirementId: null,
      createModalOpen: false,
      createModalEpoch: 0,
      createModalDefaultRepositoryId: null,
      editModalOpen: false,
      editModalEpoch: 0,
      editModalRequirementId: null,
      listeners: new Set(),
      createModalListeners: new Set(),
      editModalListeners: new Set(),
    };
  } else {
    // Vite HMR 可能保留缺新字段的旧 in-memory shape；用 Partial 补齐，避免 `in` 把类型收窄成 never。
    const state = g[STATE_KEY] as Partial<MemoPanelState> & {
      listeners: Set<() => void>;
      createModalListeners: Set<() => void>;
      editModalListeners?: Set<() => void>;
      /** @deprecated HMR 旧字段 */
      editRequestId?: string | null;
      editRequestEpoch?: number;
    };
    if (state.createModalDefaultRepositoryId === undefined) {
      state.createModalDefaultRepositoryId = null;
    }
    if (state.selectedRequirementId === undefined) {
      state.selectedRequirementId = null;
    }
    if (state.editModalOpen === undefined) {
      state.editModalOpen = false;
    }
    if (state.editModalEpoch === undefined) {
      state.editModalEpoch =
        typeof state.editRequestEpoch === "number" ? state.editRequestEpoch : 0;
    }
    if (state.editModalRequirementId === undefined) {
      state.editModalRequirementId =
        typeof state.editRequestId === "string" ? state.editRequestId : null;
    }
    if (!state.editModalListeners) {
      state.editModalListeners = new Set();
    }
    g[STATE_KEY] = state as MemoPanelState;
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

function emitEditModal(): void {
  const { editModalListeners } = getState();
  for (const listener of editModalListeners) {
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

export function getWorkspaceMemoPanelSelectedRequirementId(): string | null {
  return getState().selectedRequirementId;
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

export function openWorkspaceMemoPanel(requirementId?: string | null): void {
  const state = getState();
  const selectedId = requirementId?.trim() || null;
  const selectionChanged = selectedId != null && selectedId !== state.selectedRequirementId;
  if (selectedId) state.selectedRequirementId = selectedId;
  if (state.open) {
    if (selectionChanged) emit();
    requestPaneCenterView(0, "requirements");
    return;
  }
  state.open = true;
  emit();
  requestPaneCenterView(0, "requirements");
}

/**
 * 仅弹出「编辑需求」弹窗，不打开 / 不切换中栏需求 tab。
 */
export function requestWorkspaceRequirementEdit(requirementId: string): void {
  const id = requirementId.trim();
  if (!id) return;
  const state = getState();
  state.editModalRequirementId = id;
  state.editModalOpen = true;
  state.editModalEpoch += 1;
  emitEditModal();
}

export function closeWorkspaceRequirementEditModal(): void {
  const state = getState();
  if (!state.editModalOpen) return;
  state.editModalOpen = false;
  state.editModalRequirementId = null;
  emitEditModal();
}

export function getWorkspaceRequirementEditModalOpen(): boolean {
  return getState().editModalOpen;
}

export function getWorkspaceRequirementEditModalEpoch(): number {
  return getState().editModalEpoch;
}

export function getWorkspaceRequirementEditModalRequirementId(): string | null {
  return getState().editModalRequirementId;
}

export function subscribeWorkspaceRequirementEditModal(listener: () => void): () => void {
  const { editModalListeners } = getState();
  editModalListeners.add(listener);
  return () => {
    editModalListeners.delete(listener);
  };
}

export function useWorkspaceRequirementEditModalOpen(): boolean {
  return useSyncExternalStore(
    subscribeWorkspaceRequirementEditModal,
    getWorkspaceRequirementEditModalOpen,
    () => false,
  );
}

export function useWorkspaceRequirementEditModalEpoch(): number {
  return useSyncExternalStore(
    subscribeWorkspaceRequirementEditModal,
    getWorkspaceRequirementEditModalEpoch,
    () => 0,
  );
}

export function useWorkspaceRequirementEditModalRequirementId(): string | null {
  return useSyncExternalStore(
    subscribeWorkspaceRequirementEditModal,
    getWorkspaceRequirementEditModalRequirementId,
    () => null,
  );
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

export function useWorkspaceMemoPanelSelectedRequirementId(): string | null {
  return useSyncExternalStore(
    subscribeWorkspaceMemoPanel,
    getWorkspaceMemoPanelSelectedRequirementId,
    () => null,
  );
}
