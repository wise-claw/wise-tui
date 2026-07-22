import type { RefObject } from "react";
import type { TerminalStatus } from "../../hooks/useTerminalSession";
import "./index.css";

type TerminalPanelProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  status: TerminalStatus;
  message: string;
  onSurfacePointerDown?: () => void;
};

export function TerminalPanel({
  containerRef,
  canvasRef,
  inputRef,
  status,
  message,
  onSurfacePointerDown,
}: TerminalPanelProps) {
  return (
    <div className="terminal-shell">
      <div
        ref={containerRef}
        className="terminal-surface"
        onPointerDown={onSurfacePointerDown}
      >
        <canvas ref={canvasRef} className="terminal-canvas" aria-hidden />
        <textarea
          ref={inputRef}
          className="terminal-input"
          aria-label="终端输入"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          wrap="off"
        />
      </div>
      {status !== "ready" && (
        <div className="terminal-overlay">
          <div className="terminal-status">{message}</div>
        </div>
      )}
    </div>
  );
}
