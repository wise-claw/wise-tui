/**
 * 内置终端 tab 状态（按 PTY `workspaceId` 分桶的模块级 store）。
 *
 * 为什么不放组件本地 state：`TerminalPanel` 的宿主子树会因布局变化整棵卸载重建
 * （典型场景是 1 屏 ↔ 多屏切换，`ClaudeSessionsChatHost` 按 paneCount 切换到另一个
 * 组件分支）。tab id 一旦随组件销毁，重建时只能新开 PTY，用户会看到「终端被干掉」。
 * 放到模块级后 tab id 与 active tab 跨卸载存活，重建时 `useTerminalSession` 先走
 * `terminal_attach`，后端返回完整网格帧与输出 replay，画面和正在跑的命令都保留。
 *
 * PTY 关闭时机与本 store 的关系：卸载本身不再代表「用户要关终端」，所以显式关闭
 * （⌃`、关闭按钮、paneCount 收缩）必须先调用 `markWorkspaceTerminalsClosing`，
 * 由 `TerminalPanel` 在卸载时消费该标记再真正关闭 PTY。
 */
import type { TerminalSessionSource } from "../types/terminal";

export type TerminalTab = {
  id: string;
  title: string;
  source: TerminalSessionSource;
};

export type TerminalTabRecord = TerminalTab & {
  /** 标题由 `Terminal N` 自动编号而来，关闭其它 tab 后需要重排。 */
  autoNamed: boolean;
};

export type TerminalWorkspaceTabsSnapshot = {
  tabs: readonly TerminalTabRecord[];
  activeTerminalId: string | null;
};

const EMPTY_SNAPSHOT: TerminalWorkspaceTabsSnapshot = Object.freeze({
  tabs: Object.freeze([]) as readonly TerminalTabRecord[],
  activeTerminalId: null,
});

const snapshots = new Map<string, TerminalWorkspaceTabsSnapshot>();
const listeners = new Map<string, Set<() => void>>();
const closingWorkspaces = new Set<string>();

export function createTerminalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `terminal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 自动命名的 tab 按当前顺序重排为 `Terminal 1..N`；无变化时返回原数组引用。 */
export function renumberAutoNamedTabs(
  tabs: readonly TerminalTabRecord[],
): readonly TerminalTabRecord[] {
  let autoNamedIndex = 1;
  let changed = false;
  const nextTabs = tabs.map((tab) => {
    if (!tab.autoNamed) return tab;
    const nextTitle = `Terminal ${autoNamedIndex}`;
    autoNamedIndex += 1;
    if (tab.title === nextTitle) return tab;
    changed = true;
    return { ...tab, title: nextTitle };
  });
  return changed ? nextTabs : tabs;
}

/** useSyncExternalStore 要求未变化时返回同一引用，否则会无限重渲。 */
export function getTerminalWorkspaceTabs(
  workspaceId: string,
): TerminalWorkspaceTabsSnapshot {
  return snapshots.get(workspaceId) ?? EMPTY_SNAPSHOT;
}

export function subscribeTerminalWorkspaceTabs(
  workspaceId: string,
  listener: () => void,
): () => void {
  let bucket = listeners.get(workspaceId);
  if (!bucket) {
    bucket = new Set();
    listeners.set(workspaceId, bucket);
  }
  bucket.add(listener);
  return () => {
    const current = listeners.get(workspaceId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(workspaceId);
  };
}

function emit(workspaceId: string): void {
  const bucket = listeners.get(workspaceId);
  if (!bucket) return;
  for (const listener of bucket) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function write(
  workspaceId: string,
  tabs: readonly TerminalTabRecord[],
  activeTerminalId: string | null,
): void {
  const prev = getTerminalWorkspaceTabs(workspaceId);
  if (prev.tabs === tabs && prev.activeTerminalId === activeTerminalId) return;
  if (tabs.length === 0 && activeTerminalId === null) {
    snapshots.delete(workspaceId);
  } else {
    snapshots.set(workspaceId, { tabs, activeTerminalId });
  }
  emit(workspaceId);
}

export function createWorkspaceTerminal(
  workspaceId: string,
  source: TerminalSessionSource = "user",
): string {
  const id = createTerminalId();
  const prev = getTerminalWorkspaceTabs(workspaceId);
  write(
    workspaceId,
    renumberAutoNamedTabs([
      ...prev.tabs,
      { id, title: "", autoNamed: true, source },
    ]),
    id,
  );
  return id;
}

/** 后端 terminal-created 事件回填（Agent 终端等非本地发起的会话）。 */
export function registerWorkspaceTerminal(
  workspaceId: string,
  input: { id: string; title?: string; source?: TerminalSessionSource },
): void {
  const prev = getTerminalWorkspaceTabs(workspaceId);
  if (prev.tabs.some((tab) => tab.id === input.id)) return;
  const source = input.source ?? "user";
  const title = input.title?.trim() || (source === "agent" ? "Agent 终端" : "");
  write(
    workspaceId,
    renumberAutoNamedTabs([
      ...prev.tabs,
      { id: input.id, title, source, autoNamed: !input.title?.trim() },
    ]),
    prev.activeTerminalId,
  );
}

export function getWorkspaceTerminalSource(
  workspaceId: string,
  terminalId: string,
): TerminalSessionSource {
  return (
    getTerminalWorkspaceTabs(workspaceId).tabs.find(
      (tab) => tab.id === terminalId,
    )?.source ?? "user"
  );
}

export function setWorkspaceActiveTerminal(
  workspaceId: string,
  terminalId: string,
): void {
  const prev = getTerminalWorkspaceTabs(workspaceId);
  write(workspaceId, prev.tabs, terminalId);
}

export function closeWorkspaceTerminal(
  workspaceId: string,
  terminalId: string,
): void {
  const prev = getTerminalWorkspaceTabs(workspaceId);
  if (!prev.tabs.some((tab) => tab.id === terminalId)) return;
  const nextTabs = renumberAutoNamedTabs(
    prev.tabs.filter((tab) => tab.id !== terminalId),
  );
  const nextActive =
    prev.activeTerminalId === terminalId
      ? (nextTabs[0]?.id ?? null)
      : prev.activeTerminalId;
  write(workspaceId, nextTabs, nextActive);
}

export function clearWorkspaceTerminals(workspaceId: string): void {
  write(workspaceId, Object.freeze([]) as readonly TerminalTabRecord[], null);
}

/**
 * 保证该 workspace 至少有一个 tab，返回应连接的 terminalId。
 * store 是同步的，无需旧实现里的 in-flight ref 去重。
 */
export function ensureWorkspaceTerminal(workspaceId: string): string {
  const prev = getTerminalWorkspaceTabs(workspaceId);
  if (prev.activeTerminalId) return prev.activeTerminalId;
  const lastTab = prev.tabs[prev.tabs.length - 1];
  if (lastTab) {
    setWorkspaceActiveTerminal(workspaceId, lastTab.id);
    return lastTab.id;
  }
  return createWorkspaceTerminal(workspaceId, "user");
}

export function listWorkspaceTerminalIds(workspaceId: string): string[] {
  return getTerminalWorkspaceTabs(workspaceId).tabs.map((tab) => tab.id);
}

/**
 * 标记「下一次卸载是用户显式关闭」，由 `TerminalPanel` 卸载时消费并关闭 PTY。
 * 布局重建导致的卸载不会带这个标记，因此 PTY 保活。
 */
export function markWorkspaceTerminalsClosing(workspaceId: string): void {
  closingWorkspaces.add(workspaceId);
}

export function consumeWorkspaceTerminalsClosing(workspaceId: string): boolean {
  return closingWorkspaces.delete(workspaceId);
}

/** 重新打开同一屏的终端时撤销未被消费的关闭标记，避免误杀新会话。 */
export function clearWorkspaceTerminalsClosing(workspaceId: string): void {
  closingWorkspaces.delete(workspaceId);
}

/** 仅供测试重置模块级状态。 */
export function resetTerminalWorkspaceTabsStoreForTests(): void {
  snapshots.clear();
  listeners.clear();
  closingWorkspaces.clear();
}
