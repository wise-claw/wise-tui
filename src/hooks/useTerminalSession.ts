// @refresh reset
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Repository } from "../types";
import type { TerminalFrame, TerminalSurfaceSnapshot } from "../types/terminal";
import {
  subscribeTerminalExit,
  subscribeTerminalFrame,
} from "../services/events";
import {
  attachTerminalSession,
  closeTerminalSession,
  openTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "../services/terminal";
import {
  encodeTerminalKey,
  measureTerminalMetrics,
  readTerminalBackground,
  renderTerminalFrame,
  TERMINAL_FONT_SIZE,
} from "../utils/alacrittyTerminalCanvas";
import { shouldIgnoreTerminalError } from "../utils/terminalErrors";

export type TerminalStatus = "idle" | "connecting" | "ready" | "error";

export type TerminalSessionState = {
  status: TerminalStatus;
  message: string;
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  focusInput: () => void;
  cleanupTerminalSession: (repositoryId: number, terminalId: string) => void;
};

interface UseTerminalSessionOptions {
  activeRepository: Repository | null;
  activeTerminalId: string | null;
  isVisible: boolean;
  focusRequestVersion: number;
  surfaceSnapshot?: TerminalSurfaceSnapshot | null;
  onSurfaceSnapshot?: (snapshot: TerminalSurfaceSnapshot) => void;
  /** 卸载 UI 时是否结束后端 PTY；tab 切换时应为 false。 */
  closeOnUnmount?: boolean;
  onSessionExit?: (repositoryId: number, terminalId: string) => void;
}

const TERMINAL_DIM_MIN = 1;
const TERMINAL_DIM_MAX = 1024;
const TERMINAL_RESIZE_DEBOUNCE_MS = 100;
const MAX_CONTAINER_WAIT_FRAMES = 120;

const clampTerminalDim = (n: number) => {
  if (!Number.isFinite(n)) return TERMINAL_DIM_MIN;
  return Math.max(TERMINAL_DIM_MIN, Math.min(TERMINAL_DIM_MAX, Math.floor(n)));
};

async function waitForStableLayout(container: HTMLElement): Promise<void> {
  const deadline = Date.now() + 5000;
  let lastW = -1;
  let lastH = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 8 && h > 8 && w === lastW && h === lastH) {
      stable += 1;
      if (stable >= 3) return;
    } else {
      stable = 0;
      lastW = w;
      lastH = h;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export function useTerminalSession({
  activeRepository,
  activeTerminalId,
  isVisible,
  focusRequestVersion,
  surfaceSnapshot,
  onSurfaceSnapshot,
  closeOnUnmount = false,
  onSessionExit,
}: UseTerminalSessionOptions): TerminalSessionState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [message, setMessage] = useState("");

  const onSessionExitRef = useRef(onSessionExit);
  useEffect(() => {
    onSessionExitRef.current = onSessionExit;
  }, [onSessionExit]);

  const onSurfaceSnapshotRef = useRef(onSurfaceSnapshot);
  useEffect(() => {
    onSurfaceSnapshotRef.current = onSurfaceSnapshot;
  }, [onSurfaceSnapshot]);

  const focusInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      try {
        input.focus();
      } catch {
        // ignore
      }
    }
  }, []);

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

  const repositoryId = activeRepository?.id ?? null;
  const cwd = activeRepository?.path ?? null;
  const initialSizeRef = useRef(
    surfaceSnapshot?.cols && surfaceSnapshot?.rows
      ? { cols: surfaceSnapshot.cols, rows: surfaceSnapshot.rows }
      : undefined,
  );

  useEffect(() => {
    initialSizeRef.current =
      surfaceSnapshot?.cols && surfaceSnapshot?.rows
        ? { cols: surfaceSnapshot.cols, rows: surfaceSnapshot.rows }
        : undefined;
  }, [activeTerminalId, surfaceSnapshot]);

  useEffect(() => {
    if (focusRequestVersion <= 0) return;
    focusInput();
  }, [focusRequestVersion, focusInput]);

  useEffect(() => {
    if (repositoryId === null || !activeTerminalId || !cwd || !isVisible) {
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let containerWaitRaf: number | null = null;
    let containerWaitFrames = 0;

    const startSession = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const input = inputRef.current;
      if (!container || !canvas || !input) {
        if (containerWaitFrames >= MAX_CONTAINER_WAIT_FRAMES) {
          return;
        }
        containerWaitFrames += 1;
        containerWaitRaf = requestAnimationFrame(() => {
          if (!cancelled) startSession();
        });
        return;
      }

      const terminalId = activeTerminalId;
      const workspaceId = repositoryId.toString();
      let sessionEnded = false;
      let latestFrame: TerminalFrame | null = null;
      let resizeDebounceTimer: number | null = null;
      let paintRaf = 0;

      const metricsRef = {
        current: measureTerminalMetrics(container, TERMINAL_FONT_SIZE),
      };

      const persistSnapshot = (frame: TerminalFrame | null) => {
        onSurfaceSnapshotRef.current?.({
          cols: frame?.cols ?? metricsRef.current.cols,
          rows: frame?.rows ?? metricsRef.current.rows,
          cursor: 0,
        });
      };

      const paint = () => {
        if (!latestFrame) return;
        const liveCanvas = canvasRef.current;
        const liveContainer = containerRef.current;
        if (!liveCanvas || !liveContainer) return;
        renderTerminalFrame(
          liveCanvas,
          latestFrame,
          metricsRef.current,
          readTerminalBackground(liveContainer),
        );
      };

      const schedulePaint = () => {
        if (paintRaf) return;
        paintRaf = requestAnimationFrame(() => {
          paintRaf = 0;
          paint();
        });
      };

      const applyFrame = (frame: TerminalFrame) => {
        latestFrame = frame;
        schedulePaint();
        persistSnapshot(frame);
      };

      const syncResize = () => {
        const liveContainer = containerRef.current;
        if (!liveContainer) return { cols: 80, rows: 24 };
        metricsRef.current = measureTerminalMetrics(
          liveContainer,
          TERMINAL_FONT_SIZE,
        );
        const cols = clampTerminalDim(
          initialSizeRef.current?.cols ?? metricsRef.current.cols,
        );
        const rows = clampTerminalDim(
          initialSizeRef.current?.rows ?? metricsRef.current.rows,
        );
        initialSizeRef.current = undefined;
        void resizeTerminalSession(workspaceId, terminalId, cols, rows).catch(
          () => undefined,
        );
        persistSnapshot(latestFrame);
        return { cols, rows };
      };

      const bootstrap = async () => {
        setStatus("connecting");
        setMessage("正在连接终端…");
        await waitForStableLayout(container);
        if (cancelled) return () => undefined;

        if (typeof document !== "undefined" && document.fonts) {
          await document.fonts.ready;
        }
        if (cancelled) return () => undefined;

        const frameUnsub = subscribeTerminalFrame((event) => {
          if (
            event.workspaceId === workspaceId &&
            event.terminalId === terminalId
          ) {
            applyFrame(event.frame);
          }
        });

        const exitUnsub = subscribeTerminalExit((event) => {
          if (
            event.workspaceId === workspaceId &&
            event.terminalId === terminalId
          ) {
            sessionEnded = true;
            onSessionExitRef.current?.(repositoryId, terminalId);
          }
        });

        const writeData = (data: string) => {
          if (sessionEnded || !data) return;
          void writeTerminalSession(workspaceId, terminalId, data).catch(
            (error) => {
              if (shouldIgnoreTerminalError(error)) {
                sessionEnded = true;
                return;
              }
              console.warn("write terminal session failed", error);
              setStatus((prev) => (prev === "ready" ? "error" : prev));
              setMessage(
                error instanceof Error ? error.message : "终端写入失败",
              );
            },
          );
        };

        const onKeyDown = (event: KeyboardEvent) => {
          if (event.isComposing || event.key === "Process") return;
          const encoded = encodeTerminalKey(event);
          if (encoded == null) return;
          event.preventDefault();
          event.stopPropagation();
          writeData(encoded);
        };

        const onPaste = (event: ClipboardEvent) => {
          const text = event.clipboardData?.getData("text");
          if (!text) return;
          event.preventDefault();
          writeData(text.replace(/\r?\n/g, "\r"));
        };

        // 防止 textarea 自己堆积字符；内容一律走 PTY。
        const onInput = () => {
          if (input.value) input.value = "";
        };

        input.addEventListener("keydown", onKeyDown);
        input.addEventListener("paste", onPaste);
        input.addEventListener("input", onInput);

        const resizeObserver = new ResizeObserver(() => {
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          resizeDebounceTimer = window.setTimeout(() => {
            resizeDebounceTimer = null;
            if (cancelled || sessionEnded) return;
            const liveContainer = containerRef.current;
            if (!liveContainer) return;
            metricsRef.current = measureTerminalMetrics(
              liveContainer,
              TERMINAL_FONT_SIZE,
            );
            const cols = clampTerminalDim(metricsRef.current.cols);
            const rows = clampTerminalDim(metricsRef.current.rows);
            void resizeTerminalSession(
              workspaceId,
              terminalId,
              cols,
              rows,
            ).catch((error) => {
              if (!shouldIgnoreTerminalError(error)) {
                console.warn("resize terminal session failed", error);
              }
            });
            schedulePaint();
            persistSnapshot(latestFrame);
          }, TERMINAL_RESIZE_DEBOUNCE_MS);
        });
        resizeObserver.observe(container);

        const finalizeReady = () => {
          if (cancelled) return;
          setStatus("ready");
          setMessage("");
          syncResize();
          // status 更新后等一帧再 focus，确保 React 托管的 textarea 仍在。
          requestAnimationFrame(() => {
            if (!cancelled) focusInput();
          });
        };

        try {
          const attach = await attachTerminalSession(workspaceId, terminalId, 0);
          if (cancelled) return () => undefined;
          applyFrame(attach.frame);
          finalizeReady();
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : String(error);
          const missing = errMessage
            .toLowerCase()
            .includes("terminal session not found");
          if (!missing && !shouldIgnoreTerminalError(error)) {
            if (cancelled) return () => undefined;
            setStatus("error");
            setMessage(errMessage || "终端连接失败");
          } else {
            const liveContainer = containerRef.current ?? container;
            metricsRef.current = measureTerminalMetrics(
              liveContainer,
              TERMINAL_FONT_SIZE,
            );
            const cols = clampTerminalDim(
              initialSizeRef.current?.cols ?? metricsRef.current.cols,
            );
            const rows = clampTerminalDim(
              initialSizeRef.current?.rows ?? metricsRef.current.rows,
            );
            try {
              await openTerminalSession(workspaceId, terminalId, cols, rows, cwd, {
                source: "user",
              });
              if (cancelled) return () => undefined;
              try {
                const attach = await attachTerminalSession(
                  workspaceId,
                  terminalId,
                  0,
                );
                if (!cancelled) applyFrame(attach.frame);
              } catch {
                // 首帧可等 terminal-frame 事件
              }
              finalizeReady();
            } catch (openError) {
              if (cancelled) return () => undefined;
              if (!shouldIgnoreTerminalError(openError)) {
                console.warn("open terminal session failed", openError);
              }
              setStatus("error");
              setMessage(
                openError instanceof Error
                  ? openError.message
                  : "终端启动失败",
              );
            }
          }
        }

        return () => {
          cancelled = true;
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          if (paintRaf) {
            cancelAnimationFrame(paintRaf);
          }
          resizeObserver.disconnect();
          input.removeEventListener("keydown", onKeyDown);
          input.removeEventListener("paste", onPaste);
          input.removeEventListener("input", onInput);
          frameUnsub();
          exitUnsub();
          persistSnapshot(latestFrame);
          if (closeOnUnmount) {
            cleanupTerminalSession(repositoryId, terminalId);
          }
        };
      };

      void bootstrap().then((dispose) => {
        cleanup = dispose;
      });
    };

    startSession();

    return () => {
      cancelled = true;
      if (containerWaitRaf !== null) {
        cancelAnimationFrame(containerWaitRaf);
      }
      cleanup?.();
    };
  }, [
    repositoryId,
    cwd,
    activeTerminalId,
    isVisible,
    cleanupTerminalSession,
    closeOnUnmount,
    focusInput,
  ]);

  return {
    status,
    message,
    containerRef,
    canvasRef,
    inputRef,
    focusInput,
    cleanupTerminalSession,
  };
}
