// @refresh reset
import { useCallback, useEffect, useRef } from "react";
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

  const activeRepository: Repository | null =
    terminals.length > 0 && activeTerminalId
      ? {
          id: 0,
          name: repositoryName,
          path: _repositoryPath,
          repositoryType: "frontend",
          branch,
          createdAt: "",
          updatedAt: "",
        }
      : null;

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

  // --- Following refs buildSecondaryNodes: Dock wraps Panel ---

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
      status={terminalState.status}
      commandSuggestion={terminalState.commandSuggestion}
      commandSuggestionSuffix={terminalState.commandSuggestionSuffix}
      onCloseTerminal={handleCloseTerminal}
      terminalNode={terminalPanelNode}
    />
  );
}

export { TerminalDock } from "./TerminalDock";
export { TerminalPanel as TerminalPanelSurface } from "./TerminalPanel";
export type { TerminalTab } from "../../hooks/useTerminalTabs";
export type { TerminalStatus } from "../../hooks/useTerminalSession";
