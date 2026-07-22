import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";
import { closeWorkspaceMemoPanel } from "./workspaceMemoPanelStore";

/**
 * 内置终端中栏面板开关（与打开文件同一 slot：`panelBelowMessages` + CenterView「files」）。
 * 多屏下按 `hostPaneIndex` 挂到对应屏；顶栏 / 快捷键可指定目标屏。
 */

export type TerminalCenterPanelState = {
  mounted: boolean;
  collapsed: boolean;
  /** 终端占用的中栏 pane（0 = primary）。 */
  hostPaneIndex: number;
  /** mounted && !collapsed：终端正占用 hostPaneIndex 的中栏 slot。 */
  visible: boolean;
};

let mounted = false;
let collapsed = true;
let hostPaneIndex = 0;
const listeners = new Set<() => void>();

/** useSyncExternalStore 要求 getSnapshot 在未变化时返回同一引用，否则会无限重渲。 */
let snapshot: TerminalCenterPanelState = {
  mounted: false,
  collapsed: true,
  hostPaneIndex: 0,
  visible: false,
};

function normalizePaneIndex(paneIndex: number | null | undefined): number {
  if (typeof paneIndex !== "number" || !Number.isFinite(paneIndex) || paneIndex < 0) {
    return 0;
  }
  return Math.floor(paneIndex);
}

function syncSnapshot(): TerminalCenterPanelState {
  const visible = mounted && !collapsed;
  if (
    snapshot.mounted === mounted &&
    snapshot.collapsed === collapsed &&
    snapshot.hostPaneIndex === hostPaneIndex &&
    snapshot.visible === visible
  ) {
    return snapshot;
  }
  snapshot = { mounted, collapsed, hostPaneIndex, visible };
  return snapshot;
}

function emit(): void {
  syncSnapshot();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

export function getTerminalCenterPanelState(): TerminalCenterPanelState {
  return syncSnapshot();
}

export function subscribeTerminalCenterPanel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openTerminalCenterPanel(paneIndex: number = 0): void {
  const target = normalizePaneIndex(paneIndex);
  // 备忘录仅占 pane 0：仅当终端挂到 pane 0 时才收起备忘录。
  if (target === 0) {
    closeWorkspaceMemoPanel();
  }
  const alreadySameVisible =
    mounted && !collapsed && hostPaneIndex === target;
  mounted = true;
  collapsed = false;
  hostPaneIndex = target;
  if (!alreadySameVisible) {
    emit();
  } else {
    syncSnapshot();
  }
  requestPaneCenterView(target, "files");
}

export function collapseTerminalCenterPanel(): void {
  if (!mounted || collapsed) return;
  collapsed = true;
  emit();
}

/**
 * 打开文件等场景：仅当终端正挂在同一 pane 时收起，避免误伤其它屏上的终端。
 */
export function collapseTerminalCenterPanelOnPane(paneIndex: number): void {
  const target = normalizePaneIndex(paneIndex);
  if (!mounted || collapsed) return;
  if (hostPaneIndex !== target) return;
  collapsed = true;
  emit();
}

export function closeTerminalCenterPanel(): void {
  if (!mounted && collapsed) return;
  mounted = false;
  collapsed = true;
  emit();
}

/**
 * @param paneIndex 目标屏；省略时保持当前 host（若尚未挂载则落到 0）。
 */
export function toggleTerminalCenterPanel(paneIndex?: number): void {
  const target =
    paneIndex === undefined ? (mounted ? hostPaneIndex : 0) : normalizePaneIndex(paneIndex);
  if (mounted && !collapsed && hostPaneIndex === target) {
    collapseTerminalCenterPanel();
    return;
  }
  openTerminalCenterPanel(target);
}

/** paneCount 收缩时若 host 越界，收回 primary，避免幽灵屏占用。 */
export function clampTerminalCenterPanelHost(paneCount: number): void {
  const maxIndex = Math.max(0, Math.floor(paneCount) - 1);
  if (hostPaneIndex <= maxIndex) return;
  hostPaneIndex = 0;
  emit();
}

export function useTerminalCenterPanelState(): TerminalCenterPanelState {
  return useSyncExternalStore(
    subscribeTerminalCenterPanel,
    getTerminalCenterPanelState,
    getTerminalCenterPanelState,
  );
}
