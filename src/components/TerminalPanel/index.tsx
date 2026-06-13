// @refresh reset
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTerminalTabs } from "../../hooks/useTerminalTabs";
import { useTerminalSession } from "../../hooks/useTerminalSession";
import type { Repository } from "../../types";
import { TerminalDock } from "./TerminalDock";
import { TerminalPanel as TerminalPanelSurface } from "./TerminalPanel";
import "./index.css";

interface Props {
  repositoryPath: string;
  repositoryName: string;
  branch: string | undefined;
  dirty: boolean;
  onClose: () => void;
}

export function TerminalPanel({
  repositoryPath: _repositoryPath,
  repositoryName,
  branch,
  dirty: _dirty,
  onClose,
}: Props) {
  const {
    terminals,
    activeTerminalId,
    closeTerminal,
    closeAllTerminals,
    ensureTerminal,
  } = useTerminalTabs();
  const closeTriggeredByButtonRef = useRef(false);
  const soleTerminalIdRef = useRef<string | null>(null);
  soleTerminalIdRef.current =
    terminals.length === 1 ? (terminals[0]?.id ?? null) : null;

  const handleSessionExit = useCallback(
    (_repositoryId: number, terminalId: string) => {
      if (
        soleTerminalIdRef.current === terminalId &&
        !closeTriggeredByButtonRef.current
      ) {
        onClose();
      }
      closeTerminal(terminalId);
      closeTriggeredByButtonRef.current = false;
    },
    [closeTerminal, onClose],
  );

  const handleCloseTerminal = useCallback(
    (_terminalId: string) => {
      closeTriggeredByButtonRef.current = true;
      closeAllTerminals();
      onClose();
    },
    [closeAllTerminals, onClose],
  );

  // 用 useMemo 让 activeRepository 在 path/name/branch 不变时保持引用稳定，
  // 避免 useTerminalSession 的 effect 在每次渲染都重新建立 PTY 会话。
  const activeRepository = useMemo<Repository | null>(() => {
    if (terminals.length === 0 || !activeTerminalId) {
      return null;
    }
    return {
      id: 0,
      name: repositoryName,
      path: _repositoryPath,
      repositoryType: "frontend",
      branch,
      createdAt: "",
      updatedAt: "",
    };
  }, [
    terminals.length,
    activeTerminalId,
    repositoryName,
    _repositoryPath,
    branch,
  ]);

  const terminalState = useTerminalSession({
    activeRepository,
    activeTerminalId,
    isVisible: true,
    focusRequestVersion: 0,
    onSessionExit: handleSessionExit,
  });

  useEffect(() => {
    ensureTerminal();
  }, [ensureTerminal]);

  const terminalPanelNode = (
    <TerminalPanelSurface
      containerRef={terminalState.containerRef}
      status={terminalState.status}
      message={terminalState.message}
    />
  );

  return (
    <TerminalDock
      isOpen={true}
      activeTerminalId={activeTerminalId}
      onCloseTerminal={handleCloseTerminal}
      terminalNode={terminalPanelNode}
    />
  );
}

export { TerminalDock } from "./TerminalDock";
export { TerminalPanel as TerminalPanelSurface } from "./TerminalPanel";
export type { TerminalTab } from "../../hooks/useTerminalTabs";
export type { TerminalStatus } from "../../hooks/useTerminalSession";
