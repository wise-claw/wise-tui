import { useSyncExternalStore } from "react";
import { requestPaneCenterView } from "./paneCenterViewControlStore";
import { closeWorkspaceMemoPanel } from "./workspaceMemoPanelStore";

/**
 * 内置终端中栏面板开关（与打开文件同一 slot：`panelBelowMessages` + CenterView「files」）。
 * 多屏下每屏各自独立：第二屏打开终端不会关掉第一屏的。
 */

type PaneTerminalFlags = {
  mounted: boolean;
  collapsed: boolean;
};

export type TerminalCenterPanelState = {
  /** 有任意屏挂载过终端（含收起保活）。 */
  mounted: boolean;
  /** 兼容旧 Topbar：无任何屏可见时视为「收起」。 */
  collapsed: boolean;
  /** 当前可见终端所在屏（多屏同时打开时取最小 index；无人可见时为上次 host）。 */
  hostPaneIndex: number;
  /** 至少一屏终端可见。 */
  visible: boolean;
  /** 终端可见的屏索引（升序）。 */
  visiblePaneIndexes: readonly number[];
  /** 已挂载（含收起保活）的屏索引。 */
  mountedPaneIndexes: readonly number[];
  /** 状态修订号，供布局 memo 感知开/关变化。 */
  revision: number;
};

const paneFlags = new Map<number, PaneTerminalFlags>();
/** 最近一次作为 host 的屏（无人可见时仍保留，便于 clamp / 兼容字段）。 */
let lastHostPaneIndex = 0;
let revision = 0;
const listeners = new Set<() => void>();

/** useSyncExternalStore 要求 getSnapshot 在未变化时返回同一引用，否则会无限重渲。 */
let snapshot: TerminalCenterPanelState = {
  mounted: false,
  collapsed: true,
  hostPaneIndex: 0,
  visible: false,
  visiblePaneIndexes: Object.freeze([]),
  mountedPaneIndexes: Object.freeze([]),
  revision: 0,
};

function normalizePaneIndex(paneIndex: number | null | undefined): number {
  if (typeof paneIndex !== "number" || !Number.isFinite(paneIndex) || paneIndex < 0) {
    return 0;
  }
  return Math.floor(paneIndex);
}

function isPaneVisible(flags: PaneTerminalFlags | undefined): boolean {
  return Boolean(flags && flags.mounted && !flags.collapsed);
}

function listMountedPaneIndexes(): number[] {
  return Array.from(paneFlags.entries())
    .filter(([, flags]) => flags.mounted)
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

function listVisiblePaneIndexes(): number[] {
  return Array.from(paneFlags.entries())
    .filter(([, flags]) => isPaneVisible(flags))
    .map(([index]) => index)
    .sort((a, b) => a - b);
}

function sameNumberList(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function syncSnapshot(): TerminalCenterPanelState {
  const mountedPaneIndexes = listMountedPaneIndexes();
  const visiblePaneIndexes = listVisiblePaneIndexes();
  const mounted = mountedPaneIndexes.length > 0;
  const visible = visiblePaneIndexes.length > 0;
  const collapsed = !visible;
  const hostPaneIndex = visible
    ? visiblePaneIndexes[0]!
    : lastHostPaneIndex;

  if (
    snapshot.mounted === mounted &&
    snapshot.collapsed === collapsed &&
    snapshot.hostPaneIndex === hostPaneIndex &&
    snapshot.visible === visible &&
    snapshot.revision === revision &&
    sameNumberList(snapshot.visiblePaneIndexes, visiblePaneIndexes) &&
    sameNumberList(snapshot.mountedPaneIndexes, mountedPaneIndexes)
  ) {
    return snapshot;
  }

  snapshot = {
    mounted,
    collapsed,
    hostPaneIndex,
    visible,
    visiblePaneIndexes: Object.freeze(visiblePaneIndexes),
    mountedPaneIndexes: Object.freeze(mountedPaneIndexes),
    revision,
  };
  return snapshot;
}

function emit(): void {
  revision += 1;
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

export function isTerminalCenterPanelVisibleOnPane(paneIndex: number): boolean {
  return isPaneVisible(paneFlags.get(normalizePaneIndex(paneIndex)));
}

export function isTerminalCenterPanelMountedOnPane(paneIndex: number): boolean {
  return Boolean(paneFlags.get(normalizePaneIndex(paneIndex))?.mounted);
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
  const prev = paneFlags.get(target);
  if (isPaneVisible(prev)) {
    lastHostPaneIndex = target;
    syncSnapshot();
    requestPaneCenterView(target, "terminal");
    return;
  }
  paneFlags.set(target, { mounted: true, collapsed: false });
  lastHostPaneIndex = target;
  emit();
  requestPaneCenterView(target, "terminal");
}

/** 收起所有可见终端（保留挂载以维持 PTY）。 */
export function collapseTerminalCenterPanel(): void {
  let changed = false;
  for (const [index, flags] of paneFlags) {
    if (flags.mounted && !flags.collapsed) {
      paneFlags.set(index, { mounted: true, collapsed: true });
      changed = true;
    }
  }
  if (changed) emit();
}

/**
 * 打开文件等场景：仅收起指定屏上的终端，避免误伤其它屏。
 */
export function collapseTerminalCenterPanelOnPane(paneIndex: number): void {
  const target = normalizePaneIndex(paneIndex);
  const prev = paneFlags.get(target);
  if (!isPaneVisible(prev)) return;
  paneFlags.set(target, { mounted: true, collapsed: true });
  emit();
}

/** 关闭所有屏上的终端面板（卸挂载）。 */
export function closeTerminalCenterPanel(): void {
  if (paneFlags.size === 0) return;
  paneFlags.clear();
  emit();
}

/** 关闭指定屏上的终端面板。 */
export function closeTerminalCenterPanelOnPane(paneIndex: number): void {
  const target = normalizePaneIndex(paneIndex);
  if (!paneFlags.has(target)) return;
  paneFlags.delete(target);
  emit();
}

/**
 * @param paneIndex 目标屏；省略时默认 0。
 */
export function toggleTerminalCenterPanel(paneIndex?: number): void {
  const target = normalizePaneIndex(paneIndex ?? 0);
  if (isPaneVisible(paneFlags.get(target))) {
    collapseTerminalCenterPanelOnPane(target);
    return;
  }
  openTerminalCenterPanel(target);
}

/** paneCount 收缩时清掉越界屏上的终端，避免幽灵屏占用。 */
export function clampTerminalCenterPanelHost(paneCount: number): void {
  const maxIndex = Math.max(0, Math.floor(paneCount) - 1);
  let changed = false;
  for (const index of [...paneFlags.keys()]) {
    if (index > maxIndex) {
      paneFlags.delete(index);
      changed = true;
    }
  }
  if (lastHostPaneIndex > maxIndex) {
    lastHostPaneIndex = 0;
    changed = true;
  }
  if (changed) emit();
}

export function useTerminalCenterPanelState(): TerminalCenterPanelState {
  return useSyncExternalStore(
    subscribeTerminalCenterPanel,
    getTerminalCenterPanelState,
    getTerminalCenterPanelState,
  );
}
