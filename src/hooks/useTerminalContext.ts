import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TERMINAL_WORKSPACE_ID } from "../constants/terminalWorkspace";
import { subscribeTerminalCreated, subscribeTerminalExit } from "../services/events";
import { closeTerminalSession } from "../services/terminal";
import type { TerminalSurfaceSnapshot, TerminalSessionSource } from "../types/terminal";
import { useTerminalTabs, type TerminalTab } from "./useTerminalTabs";

export type TerminalContextTab = TerminalTab & {
  source: TerminalSessionSource;
};

type UseTerminalContextOptions = {
  workspaceId?: string;
  onCloseTerminal?: (terminalId: string) => void;
  /** Agent 创建终端时自动聚焦该 tab。 */
  autoFocusAgentSessions?: boolean;
};

export function useTerminalContext({
  workspaceId = DEFAULT_TERMINAL_WORKSPACE_ID,
  onCloseTerminal,
  autoFocusAgentSessions = true,
}: UseTerminalContextOptions = {}) {
  const {
    terminals: rawTerminals,
    activeTerminalId,
    createTerminal,
    registerTerminal,
    getTerminalSource,
    closeTerminal,
    closeAllTerminals,
    setActiveTerminal,
    ensureTerminal,
  } = useTerminalTabs({ workspaceId, onCloseTerminal });
  const [surfaceSnapshots, setSurfaceSnapshots] = useState<
    Record<string, TerminalSurfaceSnapshot>
  >({});
  const surfaceSnapshotsRef = useRef(surfaceSnapshots);
  surfaceSnapshotsRef.current = surfaceSnapshots;

  useEffect(() => {
    return subscribeTerminalCreated((event) => {
      if (event.workspaceId !== workspaceId) return;
      registerTerminal({
        id: event.terminalId,
        title: event.title,
        source: event.source,
      });
      if (autoFocusAgentSessions && event.source === "agent") {
        setActiveTerminal(event.terminalId);
      }
      setSurfaceSnapshots((prev) => ({
        ...prev,
        [event.terminalId]: {
          cursor: event.cursor,
          cols: event.cols,
          rows: event.rows,
        },
      }));
    });
  }, [autoFocusAgentSessions, registerTerminal, setActiveTerminal, workspaceId]);

  useEffect(() => {
    return subscribeTerminalExit((event) => {
      if (event.workspaceId !== workspaceId) return;
      setSurfaceSnapshots((prev) => {
        if (!(event.terminalId in prev)) return prev;
        const next = { ...prev };
        delete next[event.terminalId];
        return next;
      });
    });
  }, [workspaceId]);

  const closeTerminalSessionById = useCallback(
    (terminalId: string) => {
      void closeTerminalSession(workspaceId, terminalId).catch(() => undefined);
      closeTerminal(terminalId);
    },
    [closeTerminal, workspaceId],
  );

  const closeAllTerminalSessions = useCallback(() => {
    for (const tab of rawTerminals) {
      void closeTerminalSession(workspaceId, tab.id).catch(() => undefined);
    }
    closeAllTerminals();
  }, [closeAllTerminals, rawTerminals, workspaceId]);

  const terminals = useMemo<TerminalContextTab[]>(
    () =>
      rawTerminals.map((tab) => ({
        ...tab,
        source: getTerminalSource(tab.id),
      })),
    [rawTerminals, getTerminalSource],
  );

  const rememberSurfaceSnapshot = useCallback(
    (terminalId: string, snapshot: TerminalSurfaceSnapshot) => {
      setSurfaceSnapshots((prev) => {
        const existing = prev[terminalId];
        // 值级去重：cols/rows/scrollY/cursor 均未变时复用旧引用，避免终端活动输出期间
        // 每帧（~60Hz）setState 新对象导致 TerminalPanel 子树冗余重渲染。
        if (
          existing &&
          existing.cols === snapshot.cols &&
          existing.rows === snapshot.rows &&
          existing.scrollY === snapshot.scrollY &&
          existing.cursor === snapshot.cursor
        ) {
          return prev;
        }
        return {
          ...prev,
          [terminalId]: snapshot,
        };
      });
    },
    [],
  );

  const getSurfaceSnapshot = useCallback((terminalId: string | null) => {
    if (!terminalId) return null;
    return surfaceSnapshotsRef.current[terminalId] ?? null;
  }, []);

  return {
    terminals,
    activeTerminalId,
    createTerminal,
    closeTerminal: closeTerminalSessionById,
    closeAllTerminals: closeAllTerminalSessions,
    setActiveTerminal,
    ensureTerminal,
    rememberSurfaceSnapshot,
    getSurfaceSnapshot,
  };
}
