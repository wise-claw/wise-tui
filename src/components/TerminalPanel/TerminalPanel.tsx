import type { RefObject } from "react";
import type { TerminalStatus } from "../../hooks/useTerminalSession";
import "./index.css";

type TerminalPanelProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  status: TerminalStatus;
  message: string;
};

export function TerminalPanel({
  containerRef,
  status,
  message,
}: TerminalPanelProps) {
  return (
    <div className="terminal-shell">
      <div ref={containerRef} className="terminal-surface" />
      {status !== "ready" && (
        <div className="terminal-overlay">
          <div className="terminal-status">{message}</div>
        </div>
      )}
    </div>
  );
}
