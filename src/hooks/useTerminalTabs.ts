import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_TERMINAL_WORKSPACE_ID } from "../constants/terminalWorkspace";
import type { TerminalSessionSource } from "../types/terminal";
import {
  clearWorkspaceTerminals,
  closeWorkspaceTerminal,
  createWorkspaceTerminal,
  ensureWorkspaceTerminal,
  getTerminalWorkspaceTabs,
  getWorkspaceTerminalSource,
  registerWorkspaceTerminal,
  setWorkspaceActiveTerminal,
  subscribeTerminalWorkspaceTabs,
  type TerminalTab,
} from "../stores/terminalWorkspaceTabsStore";

export type { TerminalTab };

type UseTerminalTabsOptions = {
  /** PTY 命名空间；tab 状态按它分桶存放在模块级 store 中，跨组件卸载存活。 */
  workspaceId?: string;
  onCloseTerminal?: (terminalId: string) => void;
};

/**
 * 终端 tab 列表与 active tab。状态本身在 `terminalWorkspaceTabsStore`，本 hook 只做
 * 订阅与转发——布局重建（如 1 屏 ↔ 多屏切换）卸载本组件时 tab id 不能丢，否则重建
 * 后无法 attach 回原 PTY。
 */
export function useTerminalTabs({
  workspaceId = DEFAULT_TERMINAL_WORKSPACE_ID,
  onCloseTerminal,
}: UseTerminalTabsOptions = {}) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeTerminalWorkspaceTabs(workspaceId, listener),
    [workspaceId],
  );
  const getSnapshot = useCallback(
    () => getTerminalWorkspaceTabs(workspaceId),
    [workspaceId],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const createTerminal = useCallback(
    (source: TerminalSessionSource = "user") =>
      createWorkspaceTerminal(workspaceId, source),
    [workspaceId],
  );

  const registerTerminal = useCallback(
    (input: { id: string; title?: string; source?: TerminalSessionSource }) => {
      registerWorkspaceTerminal(workspaceId, input);
    },
    [workspaceId],
  );

  const getTerminalSource = useCallback(
    (terminalId: string): TerminalSessionSource =>
      getWorkspaceTerminalSource(workspaceId, terminalId),
    [workspaceId],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      closeWorkspaceTerminal(workspaceId, terminalId);
      onCloseTerminal?.(terminalId);
    },
    [onCloseTerminal, workspaceId],
  );

  const closeAllTerminals = useCallback(() => {
    clearWorkspaceTerminals(workspaceId);
  }, [workspaceId]);

  const setActiveTerminal = useCallback(
    (terminalId: string) => {
      setWorkspaceActiveTerminal(workspaceId, terminalId);
    },
    [workspaceId],
  );

  const ensureTerminal = useCallback(
    () => ensureWorkspaceTerminal(workspaceId),
    [workspaceId],
  );

  const terminals = useMemo<TerminalTab[]>(
    () =>
      snapshot.tabs.map(({ id, title, source }) => ({ id, title, source })),
    [snapshot.tabs],
  );

  return {
    terminals,
    activeTerminalId: snapshot.activeTerminalId,
    createTerminal,
    registerTerminal,
    getTerminalSource,
    closeTerminal,
    closeAllTerminals,
    setActiveTerminal,
    ensureTerminal,
  };
}
