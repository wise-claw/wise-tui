import {
  FullscreenExitOutlined,
  FullscreenOutlined,
  MinusOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { TerminalContextTab } from "../../hooks/useTerminalContext";
import { HoverHint } from "../shared/HoverHint";
import "./index.css";

type TerminalDockProps = {
  isOpen: boolean;
  terminals: TerminalContextTab[];
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onCreateTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onClosePanel?: () => void;
  onCollapse?: () => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  terminalNode: ReactNode;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onLaunchClaudeAutoMode?: () => void;
  claudeAutoModeDisabled?: boolean;
};

function terminalTabLabel(tab: TerminalContextTab): string {
  if (tab.title.trim()) return tab.title;
  return tab.source === "agent" ? "Agent" : "终端";
}

export function TerminalDock({
  isOpen,
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onCreateTerminal,
  onCloseTerminal,
  onClosePanel,
  onCollapse,
  onResizeStart,
  terminalNode,
  fullscreen = false,
  onToggleFullscreen,
  onLaunchClaudeAutoMode,
  claudeAutoModeDisabled = false,
}: TerminalDockProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <section
      className={`terminal-panel${fullscreen ? " terminal-panel--fullscreen" : ""}`}
    >
      {!fullscreen && onResizeStart ? (
        <div
          className="terminal-panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
          onMouseDown={onResizeStart}
        />
      ) : null}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <div className="terminal-tab-strip" role="tablist" aria-label="终端标签">
            {terminals.map((tab) => {
              const active = tab.id === activeTerminalId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`terminal-tab${active ? " terminal-tab--active" : ""}${
                    tab.source === "agent" ? " terminal-tab--agent" : ""
                  }`}
                  onClick={() => onSelectTerminal(tab.id)}
                >
                  <span className="terminal-tab__label">{terminalTabLabel(tab)}</span>
                  {terminals.length > 1 ? (
                    <span
                      className="terminal-tab__close"
                      role="button"
                      aria-label={`关闭 ${terminalTabLabel(tab)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTerminal(tab.id);
                      }}
                    >
                      ×
                    </span>
                  ) : null}
                </button>
              );
            })}
            <HoverHint title="新建终端">
              <button
                type="button"
                className="terminal-tab terminal-tab--add"
                aria-label="新建终端"
                onClick={onCreateTerminal}
              >
                <PlusOutlined />
              </button>
            </HoverHint>
          </div>
          {onLaunchClaudeAutoMode ? (
            <HoverHint title="在终端中以 Auto 权限模式启动 Claude Code">
              <button
                className="terminal-header-action"
                type="button"
                disabled={claudeAutoModeDisabled}
                aria-label="以 Auto 模式打开 Claude"
                onClick={onLaunchClaudeAutoMode}
              >
                <ThunderboltOutlined />
                <span className="terminal-header-action-label">Auto 模式</span>
              </button>
            </HoverHint>
          ) : null}
        </div>
        <div className="terminal-header-actions">
          {onToggleFullscreen ? (
            <HoverHint title={fullscreen ? "退出全屏" : "全屏占满主会话区域"}>
              <button
                className="terminal-header-icon-btn"
                type="button"
                aria-label={fullscreen ? "退出全屏" : "全屏"}
                onClick={onToggleFullscreen}
              >
                {fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              </button>
            </HoverHint>
          ) : null}
          {onCollapse ? (
            <HoverHint title="收起终端（保持会话运行）">
              <button
                className="terminal-header-icon-btn"
                type="button"
                aria-label="收起终端"
                onClick={onCollapse}
              >
                <MinusOutlined />
              </button>
            </HoverHint>
          ) : null}
          <HoverHint title="关闭全部终端（结束会话）">
            <button
              className="terminal-header-icon-btn terminal-header-close"
              type="button"
              onClick={() => {
                if (onClosePanel) {
                  onClosePanel();
                  return;
                }
                const id = activeTerminalId;
                if (id) onCloseTerminal(id);
              }}
              aria-label="关闭终端"
            >
              &times;
            </button>
          </HoverHint>
        </div>
      </div>
      <div className="terminal-body">{terminalNode}</div>
    </section>
  );
}
