// @refresh reset
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Repository } from "../types";
import {
  subscribeTerminalExit,
  subscribeTerminalOutput,
} from "../services/events";
import {
  closeTerminalSession,
  openTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "../services/terminal";

export type TerminalStatus = "idle" | "connecting" | "ready" | "error";

export type TerminalSessionState = {
  status: TerminalStatus;
  message: string;
  containerRef: RefObject<HTMLDivElement | null>;
  cleanupTerminalSession: (repositoryId: number, terminalId: string) => void;
};

interface UseTerminalSessionOptions {
  activeRepository: Repository | null;
  activeTerminalId: string | null;
  isVisible: boolean;
  focusRequestVersion: number;
  onSessionExit?: (repositoryId: number, terminalId: string) => void;
}

function shouldIgnoreTerminalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("terminal session not found") ||
    lower.includes("broken pipe") ||
    lower.includes("input/output error") ||
    lower.includes("os error 5") ||
    lower.includes("eio") ||
    lower.includes("not connected") ||
    lower.includes("closed")
  );
}

/** 与后端 TERMINAL_DIM_MIN/MAX 保持一致：clamp 维度防止 0 或异常巨大值进入 IPC。 */
const TERMINAL_DIM_MIN = 1;
const TERMINAL_DIM_MAX = 1024;

/** 调整频率限制，防止拖拽分隔条时高频 resize 把后端压垮。 */
const TERMINAL_RESIZE_DEBOUNCE_MS = 32;

const clampTerminalDim = (n: number) => {
  if (!Number.isFinite(n)) return TERMINAL_DIM_MIN;
  return Math.max(TERMINAL_DIM_MIN, Math.min(TERMINAL_DIM_MAX, Math.floor(n)));
};

export function useTerminalSession({
  activeRepository,
  activeTerminalId,
  isVisible,
  focusRequestVersion: _focusRequestVersion,
  onSessionExit,
}: UseTerminalSessionOptions): TerminalSessionState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [message, setMessage] = useState("");

  // 用 ref 保留最新的 onSessionExit，避免父组件每次渲染都重建回调时触发
  // useEffect 重新挂载导致 PTY 会话不停销毁/重建。
  const onSessionExitRef = useRef(onSessionExit);
  useEffect(() => {
    onSessionExitRef.current = onSessionExit;
  }, [onSessionExit]);

  const cleanupTerminalSession = useCallback(
    (repositoryId: number, terminalId: string) => {
      void closeTerminalSession(repositoryId.toString(), terminalId).catch(
        (error) => {
          if (!shouldIgnoreTerminalError(error)) {
            console.warn("close terminal session failed", error);
          }
        },
      );
    },
    [],
  );

  // 仅依赖原始值（id/path）以保证 effect 不会因为 activeRepository 引用变化反复执行。
  const repositoryId = activeRepository?.id ?? null;
  const cwd = activeRepository?.path ?? null;

  useEffect(() => {
    if (
      repositoryId === null ||
      !activeTerminalId ||
      !cwd ||
      !isVisible
    ) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminalId = activeTerminalId;
    const workspaceId = repositoryId.toString();

    // 从容器上读取 Ant Design 解析后的颜色变量，让终端主题随浅/深色模式自动切换。
    const styles = getComputedStyle(container);
    const readColor = (name: string, fallback: string) => {
      const v = styles.getPropertyValue(name).trim();
      return v.length > 0 ? v : fallback;
    };
    const themeForeground = readColor("--terminal-foreground", "#1f1f1f");
    const themeBackground = readColor("--terminal-background", "#ffffff");
    const themeCursor = readColor("--terminal-cursor", themeForeground);
    const themeSelection = readColor(
      "--terminal-selection",
      "rgba(100, 200, 255, 0.25)",
    );

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      // Claude Code 等 alt-screen TUI 在长会话里会把每次重绘都塞进 scrollback，
      // 默认 1000 行 + 200 列 + 每 cell 28-40B 内部对象，长时间下来很容易把 webview 内存推到 GB 级。
      // 这里显式限制 scrollback，把单个 Terminal 实例的 normal-screen buffer 上限钉死在 ~1000 行。
      scrollback: 1000,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        foreground: themeForeground,
        background: themeBackground,
        cursor: themeCursor,
        cursorAccent: themeBackground,
        selectionBackground: themeSelection,
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      void writeTerminalSession(workspaceId, terminalId, data).catch((error) => {
        if (!shouldIgnoreTerminalError(error)) {
          console.warn("write terminal session failed", error);
          setStatus((prev) => (prev === "ready" ? "error" : prev));
          setMessage(error instanceof Error ? error.message : "终端写入失败");
        }
      });
    });

    const outputUnsubscribe = subscribeTerminalOutput((event) => {
      if (event.workspaceId === workspaceId && event.terminalId === terminalId) {
        terminal.write(event.data);
      }
    });

    const exitUnsubscribe = subscribeTerminalExit((event) => {
      if (event.workspaceId === workspaceId && event.terminalId === terminalId) {
        // 退出原因有值时一律提示一下，便于在终端面板上看见 PTY 何时崩了。
        if (event.reason) {
          try {
            terminal.write(`\r\n\x1b[31m[终端已断开] ${event.reason}\x1b[0m\r\n`);
          } catch {
            // 忽略写入失败：xterm 可能已被 dispose
          }
        }
        onSessionExitRef.current?.(repositoryId, terminalId);
      }
    });

    setStatus("connecting");
    setMessage("正在连接终端…");

    let cancelled = false;
    // 等容器布局稳定再 fit + 打开 PTY，避免容器尺寸为 0 时拿到错误的列/行。
    const fitAndOpen = () => {
      if (cancelled) return;
      try {
        fitAddon.fit();
      } catch {
        // 容器尚未可见时忽略，下面再用合理默认值兜底
      }
      const cols = clampTerminalDim(terminal.cols || 80);
      const rows = clampTerminalDim(terminal.rows || 24);
      void openTerminalSession(workspaceId, terminalId, cols, rows, cwd)
        .then(() => {
          if (cancelled) return;
          setStatus("ready");
          setMessage("");
          // 真正可见后再 fit 一次并通知后端，确保尺寸正确。
          try {
            fitAddon.fit();
            const finalCols = clampTerminalDim(terminal.cols);
            const finalRows = clampTerminalDim(terminal.rows);
            void resizeTerminalSession(
              workspaceId,
              terminalId,
              finalCols,
              finalRows,
            ).catch((error) => {
              if (!shouldIgnoreTerminalError(error)) {
                console.warn("resize terminal session failed", error);
              }
            });
          } catch {
            // ignore
          }
        })
        .catch((error) => {
          if (cancelled) return;
          if (!shouldIgnoreTerminalError(error)) {
            console.warn("open terminal session failed", error);
          }
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "终端启动失败");
        });
    };

    // 跨两个 RAF 等浏览器布局稳定后再 fit。
    const fitAndOpenRafRef: { current: number | null } = { current: null };
    const resizeDebounceTimerRef: { current: number | null } = { current: null };
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(fitAndOpen);
      // 把第二个 raf 句柄挂到外层变量上以便清理
      fitAndOpenRafRef.current = raf2;
    });

    const resizeObserver = new ResizeObserver(() => {
      const fit = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fit || !term) return;
      // 拖拽分隔条 / 全屏切换会以 60Hz 触发回调；先在前端合并一次再走 IPC。
      if (resizeDebounceTimerRef.current !== null) {
        window.clearTimeout(resizeDebounceTimerRef.current);
      }
      resizeDebounceTimerRef.current = window.setTimeout(() => {
        resizeDebounceTimerRef.current = null;
        const fit2 = fitAddonRef.current;
        const term2 = terminalRef.current;
        if (!fit2 || !term2) return;
        try {
          fit2.fit();
          const nextCols = clampTerminalDim(term2.cols);
          const nextRows = clampTerminalDim(term2.rows);
          void resizeTerminalSession(
            workspaceId,
            terminalId,
            nextCols,
            nextRows,
          ).catch((error) => {
            if (!shouldIgnoreTerminalError(error)) {
              console.warn("resize terminal session failed", error);
            }
          });
        } catch {
          // 忽略 fit 失败
        }
      }, TERMINAL_RESIZE_DEBOUNCE_MS);
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (fitAndOpenRafRef.current !== null) {
        cancelAnimationFrame(fitAndOpenRafRef.current);
      }
      if (resizeDebounceTimerRef.current !== null) {
        window.clearTimeout(resizeDebounceTimerRef.current);
        resizeDebounceTimerRef.current = null;
      }
      resizeObserver.disconnect();
      dataDisposable.dispose();
      outputUnsubscribe();
      exitUnsubscribe();
      try {
        terminal.dispose();
      } catch {
        // 忽略 dispose 错误
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
      cleanupTerminalSession(repositoryId, terminalId);
    };
  }, [
    repositoryId,
    cwd,
    activeTerminalId,
    isVisible,
    cleanupTerminalSession,
  ]);

  return {
    status,
    message,
    containerRef,
    cleanupTerminalSession,
  };
}
