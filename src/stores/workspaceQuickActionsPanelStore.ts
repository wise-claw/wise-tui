import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";

/**
 * 全局快捷操作中栏面板开关（独立 CenterView「quickActions」slot）。
 * 侧栏入口与 layout 通过本 store 解耦；与需求 / 文件 / 终端并列，打开时不再互斥关闭。
 */

export interface WorkspaceQuickActionsPanelContext {
  projectId: string | null;
  repositoryId: number | null;
  /** 合并展示用的额外仓库 id（侧栏已注册的全部仓库）。 */
  additionalRepositoryIds: number[];
  /** 是否存在可选工作区/仓库（控制「添加」可用性）。 */
  canManage: boolean;
}

const EMPTY_CONTEXT: WorkspaceQuickActionsPanelContext = {
  projectId: null,
  repositoryId: null,
  additionalRepositoryIds: [],
  canManage: false,
};

let open = false;
let context: WorkspaceQuickActionsPanelContext = EMPTY_CONTEXT;
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

export function getWorkspaceQuickActionsPanelOpen(): boolean {
  return open;
}

export function getWorkspaceQuickActionsPanelContext(): WorkspaceQuickActionsPanelContext {
  return context;
}

export function subscribeWorkspaceQuickActionsPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 由侧栏同步当前工作区/仓库上下文，供中栏面板读取（稳定 NODE 无 props）。 */
export function setWorkspaceQuickActionsPanelContext(
  next: WorkspaceQuickActionsPanelContext,
): void {
  const prev = context;
  const sameIds =
    prev.additionalRepositoryIds.length === next.additionalRepositoryIds.length &&
    prev.additionalRepositoryIds.every((id, i) => id === next.additionalRepositoryIds[i]);
  if (
    prev.projectId === next.projectId &&
    prev.repositoryId === next.repositoryId &&
    prev.canManage === next.canManage &&
    sameIds
  ) {
    return;
  }
  context = next;
  emit();
}

export function openWorkspaceQuickActionsPanel(): void {
  if (open) {
    requestPaneCenterView(0, "quickActions");
    return;
  }
  open = true;
  emit();
  requestPaneCenterView(0, "quickActions");
}

export function closeWorkspaceQuickActionsPanel(): void {
  if (!open) return;
  open = false;
  emit();
}

export function toggleWorkspaceQuickActionsPanel(): void {
  if (open) {
    closeWorkspaceQuickActionsPanel();
    return;
  }
  openWorkspaceQuickActionsPanel();
}

export function useWorkspaceQuickActionsPanelOpen(): boolean {
  return useSyncExternalStore(
    subscribeWorkspaceQuickActionsPanel,
    getWorkspaceQuickActionsPanelOpen,
    () => false,
  );
}

export function useWorkspaceQuickActionsPanelContext(): WorkspaceQuickActionsPanelContext {
  return useSyncExternalStore(
    subscribeWorkspaceQuickActionsPanel,
    getWorkspaceQuickActionsPanelContext,
    () => EMPTY_CONTEXT,
  );
}
