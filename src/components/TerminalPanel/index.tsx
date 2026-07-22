// @refresh reset
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTerminalContext } from "../../hooks/useTerminalContext";
import { useTerminalSession } from "../../hooks/useTerminalSession";
import type { Repository } from "../../types";
import { writeTerminalSession } from "../../services/terminal";
import { buildClaudeAutoModeTerminalInput } from "../../utils/terminalClaudeAutoMode";
import { TerminalDock } from "./TerminalDock";
import { TerminalPanel as TerminalPanelSurface } from "./TerminalPanel";
import "./index.css";

const TERMINAL_WORKSPACE_ID = "0";

interface Props {
  repositoryPath: string;
  repositoryName: string;
  branch: string | undefined;
  dirty: boolean;
  collapsed?: boolean;
  onCollapse: () => void;
  onClose: () => void;
  /** center：占满中栏消息区（与文件同 slot）；dock：底部抽屉（兼容旧布局）。 */
  layout?: "center" | "dock";
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /**
   * PTY workspaceId。多屏各自独立终端时按屏区分（如 `pane-0`），
   * 避免 terminal-created 事件串台。默认 `"0"`。
   */
  workspaceId?: string;
}

export function TerminalPanel({
  repositoryPath: _repositoryPath,
  repositoryName,
  branch,
  dirty: _dirty,
  collapsed = false,
  onCollapse,
  onClose,
  layout = "dock",
  fullscreen = false,
  onToggleFullscreen,
  workspaceId = TERMINAL_WORKSPACE_ID,
}: Props) {
  const { message } = App.useApp();
  const {
    terminals,
    activeTerminalId,
    closeTerminal,
    closeAllTerminals,
    ensureTerminal,
    createTerminal,
    setActiveTerminal,
    rememberSurfaceSnapshot,
    getSurfaceSnapshot,
  } = useTerminalContext({ workspaceId });
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
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

  const handleCloseTerminalTab = useCallback(
    (terminalId: string) => {
      closeTriggeredByButtonRef.current = true;
      closeTerminal(terminalId);
      if (terminals.length <= 1) {
        onClose();
      }
      closeTriggeredByButtonRef.current = false;
    },
    [closeTerminal, onClose, terminals.length],
  );

  const handleClosePanel = useCallback(() => {
    closeTriggeredByButtonRef.current = true;
    closeAllTerminals();
    onClose();
  }, [closeAllTerminals, onClose]);

  const handleCollapseTerminal = useCallback(() => {
    onCollapse();
  }, [onCollapse]);

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
    isVisible: !collapsed,
    focusRequestVersion,
    closeOnUnmount: false,
    surfaceSnapshot: getSurfaceSnapshot(activeTerminalId),
    onSurfaceSnapshot: (snapshot) => {
      if (!activeTerminalId) return;
      rememberSurfaceSnapshot(activeTerminalId, snapshot);
    },
    onSessionExit: handleSessionExit,
  });

  useEffect(() => {
    setFocusRequestVersion((value) => value + 1);
  }, [activeTerminalId]);

  useEffect(() => {
    if (!collapsed) {
      setFocusRequestVersion((value) => value + 1);
    }
  }, [collapsed]);

  useEffect(() => {
    ensureTerminal();
  }, [ensureTerminal]);

  const launchClaudeAutoMode = useCallback(async () => {
    const terminalId = activeTerminalId ?? ensureTerminal();
    if (!terminalId) {
      message.warning("终端尚未就绪");
      return;
    }
    if (terminalState.status !== "ready") {
      message.warning("请等待终端连接完成后再启动 Claude");
      return;
    }
    try {
      await writeTerminalSession(
        workspaceId,
        terminalId,
        buildClaudeAutoModeTerminalInput(),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "无法在终端中启动 Claude");
    }
  }, [activeTerminalId, ensureTerminal, message, terminalState.status, workspaceId]);

  const terminalPanelNode = (
    <TerminalPanelSurface
      containerRef={terminalState.containerRef}
      canvasRef={terminalState.canvasRef}
      inputRef={terminalState.inputRef}
      status={terminalState.status}
      message={terminalState.message}
      onSurfacePointerDown={terminalState.focusInput}
    />
  );

  return (
    <TerminalDock
      isOpen={true}
      layout={layout}
      terminals={terminals}
      activeTerminalId={activeTerminalId}
      onSelectTerminal={setActiveTerminal}
      onCreateTerminal={() => {
        createTerminal("user");
        setFocusRequestVersion((value) => value + 1);
      }}
      onCloseTerminal={handleCloseTerminalTab}
      onClosePanel={handleClosePanel}
      onCollapse={handleCollapseTerminal}
      terminalNode={terminalPanelNode}
      fullscreen={layout === "center" ? true : fullscreen}
      onToggleFullscreen={layout === "center" ? undefined : onToggleFullscreen}
      onLaunchClaudeAutoMode={() => void launchClaudeAutoMode()}
      claudeAutoModeDisabled={terminalState.status !== "ready"}
    />
  );
}

export { TerminalDock } from "./TerminalDock";
export { TerminalPanel as TerminalPanelSurface } from "./TerminalPanel";
export type { TerminalTab } from "../../hooks/useTerminalTabs";
export type { TerminalStatus } from "../../hooks/useTerminalSession";
