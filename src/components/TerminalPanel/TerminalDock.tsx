import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import "./index.css";

type TerminalDockProps = {
  isOpen: boolean;
  activeTerminalId: string | null;
  onCloseTerminal: (terminalId: string) => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  terminalNode: ReactNode;
};

export function TerminalDock({
  isOpen,
  activeTerminalId,
  onCloseTerminal,
  onResizeStart,
  terminalNode,
}: TerminalDockProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <section className="terminal-panel">
      {onResizeStart && (
        <div
          className="terminal-panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
          onMouseDown={onResizeStart}
        />
      )}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <span className="terminal-header-title">终端</span>
        </div>
        <button
          className="terminal-header-close"
          type="button"
          onClick={() => {
            const id = activeTerminalId;
            if (id) onCloseTerminal(id);
          }}
          aria-label="关闭终端"
        >
          &times;
        </button>
      </div>
      <div className="terminal-body">{terminalNode}</div>
    </section>
  );
}
