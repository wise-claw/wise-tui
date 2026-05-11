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
    onSessionExit: (_repositoryId, terminalId) => {
      if (
        terminals.length === 1 &&
        terminals[0]?.id === terminalId &&
        !closeTriggeredByButtonRef.current
      ) {
        onClose();
      }
      closeTerminal(terminalId);
      closeTriggeredByButtonRef.current = false;
    },
  });

  useEffect(() => {
    ensureTerminal();
  }, [ensureTerminal]);

  // 标题栏关闭 = 收起整个终端区：须始终 onClose。仅当「最后一个 tab」才 onClose 时，若存在多个 tab
  //（例如重复 ensure），第一次只会 closeTerminal 切换会话，表现为刷新；第二次才收起。
  const handleCloseTerminal = useCallback(
    (_terminalId: string) => {
      closeTriggeredByButtonRef.current = true;
      closeAllTerminals();
      onClose();
    },
    [closeAllTerminals, onClose],
  );

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
      onCloseTerminal={handleCloseTerminal}
      terminalNode={terminalPanelNode}
    />
  );
}

export { TerminalDock } from "./TerminalDock";
export { TerminalPanel as TerminalPanelSurface } from "./TerminalPanel";
export type { TerminalTab } from "../../hooks/useTerminalTabs";
export type { TerminalStatus } from "../../hooks/useTerminalSession";
