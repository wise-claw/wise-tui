import { Empty, Spin } from "antd";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { subscribeTerminalFrame, subscribeTerminalOutput } from "../../services/events";
import { attachTerminalSession } from "../../services/terminal";
import { getTerminalThemeState, subscribeTerminalTheme } from "../../stores/terminalThemeStore";
import {
  measureTerminalMetrics,
  releaseTerminalCanvas,
  renderTerminalFrame,
  TERMINAL_FONT_SIZE,
  terminalFallbackPalette,
} from "../../utils/alacrittyTerminalCanvas";
import {
  normalizeBackgroundScriptOutputText,
  resolveBackgroundScriptDisplayText,
} from "../../utils/backgroundScriptOutput";
import { shouldIgnoreTerminalError } from "../../utils/terminalErrors";

export interface BackgroundScriptTerminalViewProps {
  workspaceId: string;
  terminalId: string;
  /** attach 失败或进程已退出时展示的 terminal-output 累积文本 */
  fallbackOutput?: string;
}

/**
 * 运行面板详情：只读附着已有后台 PTY，展示 assistant-script / workflow-code 终端输出。
 * 进程退出后 session 会从后端移除，此时 fallback 到 dispatch store 捕获的 terminal-output。
 */
export const BackgroundScriptTerminalView = memo(function BackgroundScriptTerminalView({
  workspaceId,
  terminalId,
  fallbackOutput = "",
}: BackgroundScriptTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasActiveRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "canvas" | "text" | "empty">("loading");
  const [liveText, setLiveText] = useState("");

  const normalizedFallback = useMemo(
    () => normalizeBackgroundScriptOutputText(fallbackOutput),
    [fallbackOutput],
  );

  useEffect(() => {
    setLiveText("");
    setStatus("loading");

    const container = containerRef.current;
    const canvas = canvasRef.current;
    const wid = workspaceId.trim();
    const tid = terminalId.trim();
    if (!wid || !tid) {
      setStatus(normalizedFallback ? "text" : "empty");
      if (normalizedFallback) setLiveText(normalizedFallback);
      return;
    }

    let cancelled = false;
    canvasActiveRef.current = false;
    let frameUnsub: (() => void) | undefined;
    let outputUnsub: (() => void) | undefined;
    let themeUnsub: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let latestFrame: import("../../types/terminal").TerminalFrame | null = null;
    const textChunks: string[] = [];

    const showTextFallback = () => {
      const merged = resolveBackgroundScriptDisplayText(textChunks, normalizedFallback);
      setLiveText(merged);
      setStatus(merged ? "text" : "empty");
    };

    const subscribeLiveOutput = () => {
      if (outputUnsub) return;
      outputUnsub = subscribeTerminalOutput((event) => {
        if (event.workspaceId !== wid || event.terminalId !== tid) return;
        if (!event.data) return;
        textChunks.push(event.data);
        if (!cancelled && !canvasActiveRef.current) {
          const merged = resolveBackgroundScriptDisplayText(textChunks, normalizedFallback);
          setLiveText(merged);
          if (merged) setStatus("text");
        }
      });
    };

    const paint = () => {
      if (cancelled || !latestFrame || !container || !canvas) return;
      const metrics = measureTerminalMetrics(container, TERMINAL_FONT_SIZE);
      renderTerminalFrame(
        canvas,
        latestFrame,
        metrics,
        terminalFallbackPalette(getTerminalThemeState().dark),
      );
    };

    void (async () => {
      if (!container || !canvas) {
        showTextFallback();
        return;
      }
      try {
        const attach = await attachTerminalSession(wid, tid, 0);
        if (cancelled) return;
        latestFrame = attach.frame;
        paint();
        canvasActiveRef.current = true;
        setStatus("canvas");

        frameUnsub = subscribeTerminalFrame((event) => {
          if (event.workspaceId !== wid || event.terminalId !== tid) return;
          latestFrame = event.frame;
          paint();
        });

        themeUnsub = subscribeTerminalTheme(() => {
          paint();
        });

        resizeObserver = new ResizeObserver(() => {
          paint();
        });
        resizeObserver.observe(container);
      } catch (error) {
        if (cancelled) return;
        if (!shouldIgnoreTerminalError(error)) {
          console.warn("attach background script terminal failed", error);
        }
        subscribeLiveOutput();
        showTextFallback();
      }
    })();

    return () => {
      cancelled = true;
      frameUnsub?.();
      outputUnsub?.();
      themeUnsub?.();
      resizeObserver?.disconnect();
      if (canvas) releaseTerminalCanvas(canvas);
    };
  }, [normalizedFallback, terminalId, workspaceId]);

  const displayText = liveText || normalizedFallback;

  return (
    <div className="app-monitor-panel__background-script-terminal">
      <div ref={containerRef} className="app-monitor-panel__background-script-terminal-viewport">
        {status === "canvas" ? (
          <canvas ref={canvasRef} className="app-monitor-panel__background-script-terminal-canvas" />
        ) : null}
        {status === "loading" ? (
          <div className="app-monitor-panel__background-script-terminal-loading" aria-busy="true">
            <Spin size="small" />
            <span>连接终端输出…</span>
          </div>
        ) : null}
        {status === "text" && displayText ? (
          <pre className="app-monitor-panel__background-script-terminal-text">{displayText}</pre>
        ) : null}
        {status === "empty" ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无脚本输出" />
        ) : null}
      </div>
    </div>
  );
});
