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
  scrollTerminalSession,
  writeTerminalSession,
} from "../services/terminal";
import {
  encodeTerminalKey,
  measureTerminalMetrics,
  readTerminalBackground,
  renderTerminalFrame,
  TERMINAL_FONT_SIZE,
  wheelDeltaToScrollLines,
} from "../utils/alacrittyTerminalCanvas";
import { shouldIgnoreTerminalError } from "../utils/terminalErrors";
import {
  expandTerminalSelectionToAll,
  expandTerminalSelectionToLine,
  expandTerminalSelectionToWord,
  extractTerminalSelectionText,
  terminalPointFromOffset,
  terminalSelectionIsEmpty,
  type TerminalSelectionRange,
} from "../utils/terminalSelection";

export type TerminalStatus = "idle" | "connecting" | "ready" | "error";

export type TerminalSessionState = {
  status: TerminalStatus;
  message: string;
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  focusInput: () => void;
  cleanupTerminalSession: (workspaceId: string, terminalId: string) => void;
};

interface UseTerminalSessionOptions {
  /** PTY 命名空间，须与 `useTerminalContext({ workspaceId })` / `writeTerminalSession` 一致。 */
  workspaceId: string;
  activeRepository: Repository | null;
  activeTerminalId: string | null;
  isVisible: boolean;
  focusRequestVersion: number;
  surfaceSnapshot?: TerminalSurfaceSnapshot | null;
  onSurfaceSnapshot?: (snapshot: TerminalSurfaceSnapshot) => void;
  /** 卸载 UI 时是否结束后端 PTY；tab 切换时应为 false。 */
  closeOnUnmount?: boolean;
  onSessionExit?: (workspaceId: string, terminalId: string) => void;
  /** 终端选区写入剪贴板成功时回调（用于 toast）。 */
  onCopySuccess?: () => void;
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
  workspaceId,
  activeRepository,
  activeTerminalId,
  isVisible,
  focusRequestVersion,
  surfaceSnapshot,
  onSurfaceSnapshot,
  closeOnUnmount = false,
  onSessionExit,
  onCopySuccess,
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

  const onCopySuccessRef = useRef(onCopySuccess);
  useEffect(() => {
    onCopySuccessRef.current = onCopySuccess;
  }, [onCopySuccess]);

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
    (sessionWorkspaceId: string, terminalId: string) => {
      void closeTerminalSession(sessionWorkspaceId, terminalId).catch(
        (error) => {
          if (!shouldIgnoreTerminalError(error)) {
            console.warn("close terminal session failed", error);
          }
        },
      );
    },
    [],
  );

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
    if (!workspaceId || !activeTerminalId || !cwd || !isVisible) {
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
      let sessionEnded = false;
      let latestFrame: TerminalFrame | null = null;
      let selectionRange: TerminalSelectionRange | null = null;
      let selecting = false;
      let selectionAnchor: { col: number; row: number } | null = null;
      let selectionDragged = false;
      let lastClickAt = 0;
      let clickCount = 0;
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
          selectionRange,
        );
      };

      const schedulePaint = () => {
        if (paintRaf) return;
        paintRaf = requestAnimationFrame(() => {
          paintRaf = 0;
          paint();
        });
      };

      const setSelection = (next: TerminalSelectionRange | null) => {
        selectionRange = next;
        schedulePaint();
      };

      const clearSelection = () => {
        if (!selectionRange) return;
        selectionRange = null;
        schedulePaint();
      };

      const pointFromClient = (clientX: number, clientY: number) => {
        const liveCanvas = canvasRef.current;
        const frame = latestFrame;
        if (!liveCanvas || !frame) return null;
        const rect = liveCanvas.getBoundingClientRect();
        return terminalPointFromOffset(
          clientX - rect.left,
          clientY - rect.top,
          metricsRef.current,
          { cols: frame.cols, rows: frame.rows },
        );
      };

      const copySelection = async (): Promise<boolean> => {
        if (!latestFrame || terminalSelectionIsEmpty(selectionRange)) return false;
        const text = extractTerminalSelectionText(latestFrame, selectionRange);
        if (!text) return false;
        try {
          await navigator.clipboard.writeText(text);
          onCopySuccessRef.current?.();
          return true;
        } catch (error) {
          console.warn("copy terminal selection failed", error);
          return false;
        }
      };

      /** 选中完成后写入剪贴板（拖选 / 双击 / 三击 / 全选）。 */
      const copySelectionAfterSelect = () => {
        void copySelection();
      };

      const applyFrame = (frame: TerminalFrame) => {
        latestFrame = frame;
        // 尺寸变化时钳制选区，避免悬空高亮。
        if (selectionRange) {
          selectionRange = {
            start: {
              col: Math.min(selectionRange.start.col, Math.max(0, frame.cols - 1)),
              row: Math.min(selectionRange.start.row, Math.max(0, frame.rows - 1)),
            },
            end: {
              col: Math.min(selectionRange.end.col, Math.max(0, frame.cols - 1)),
              row: Math.min(selectionRange.end.row, Math.max(0, frame.rows - 1)),
            },
          };
        }
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
            onSessionExitRef.current?.(workspaceId, terminalId);
          }
        });

        const writeData = (data: string) => {
          if (sessionEnded || !data) return;
          clearSelection();
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

        let wheelAccum = 0;
        let scrollRaf = 0;
        let pendingScrollDelta = 0;

        const flushScroll = () => {
          scrollRaf = 0;
          const delta = pendingScrollDelta;
          pendingScrollDelta = 0;
          if (sessionEnded || delta === 0) return;
          void scrollTerminalSession(workspaceId, terminalId, delta)
            .then((frame) => {
              if (!cancelled && !sessionEnded) applyFrame(frame);
            })
            .catch((error) => {
              if (!shouldIgnoreTerminalError(error)) {
                console.warn("scroll terminal session failed", error);
              }
            });
        };

        const queueScroll = (deltaLines: number) => {
          if (sessionEnded || deltaLines === 0) return;
          pendingScrollDelta += deltaLines;
          if (scrollRaf) return;
          scrollRaf = requestAnimationFrame(flushScroll);
        };

        const onWheel = (event: WheelEvent) => {
          if (sessionEnded) return;
          event.preventDefault();
          event.stopPropagation();
          const cellHeight = Math.max(1, metricsRef.current.cellHeight);
          wheelAccum += wheelDeltaToScrollLines(event, cellHeight);
          const lines = Math.trunc(wheelAccum);
          if (lines === 0) return;
          wheelAccum -= lines;
          queueScroll(lines);
        };

        const onKeyDown = (event: KeyboardEvent) => {
          if (event.isComposing || event.key === "Process") return;

          const key = event.key.toLowerCase();
          const hasSel = !terminalSelectionIsEmpty(selectionRange);

          // Shift+PageUp/PageDown：滚动历史（无 Shift 仍发给 PTY，供 less/vim）。
          if (
            (event.key === "PageUp" || event.key === "PageDown") &&
            event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            const page = Math.max(1, metricsRef.current.rows - 1);
            queueScroll(event.key === "PageUp" ? page : -page);
            return;
          }

          // Cmd+C（macOS）/ Ctrl+Shift+C：复制选区；Cmd+C 无选区时不发往 PTY。
          // Ctrl+C（无 Shift）始终走 encodeTerminalKey → SIGINT。
          if (
            key === "c" &&
            !event.altKey &&
            (event.metaKey || (event.ctrlKey && event.shiftKey))
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (hasSel) void copySelection();
            return;
          }

          if (
            key === "a" &&
            !event.altKey &&
            (event.metaKey || (event.ctrlKey && event.shiftKey))
          ) {
            if (latestFrame) {
              event.preventDefault();
              event.stopPropagation();
              setSelection(expandTerminalSelectionToAll(latestFrame));
              copySelectionAfterSelect();
              return;
            }
          }

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

        const onPointerDown = (event: PointerEvent) => {
          if (event.button !== 0) return;
          focusInput();
          const point = pointFromClient(event.clientX, event.clientY);
          if (!point || !latestFrame) return;

          const now = Date.now();
          if (now - lastClickAt <= 400) {
            clickCount += 1;
          } else {
            clickCount = 1;
          }
          lastClickAt = now;

          if (clickCount >= 3) {
            setSelection(expandTerminalSelectionToLine(latestFrame, point));
            selecting = false;
            selectionAnchor = null;
            copySelectionAfterSelect();
            event.preventDefault();
            return;
          }
          if (clickCount === 2) {
            setSelection(expandTerminalSelectionToWord(latestFrame, point));
            selecting = false;
            selectionAnchor = null;
            copySelectionAfterSelect();
            event.preventDefault();
            return;
          }

          selecting = true;
          selectionDragged = false;
          selectionAnchor = point;
          setSelection({ start: point, end: point });
          try {
            input.setPointerCapture(event.pointerId);
          } catch {
            // ignore
          }
          event.preventDefault();
        };

        const onPointerMove = (event: PointerEvent) => {
          if (!selecting || !selectionAnchor) return;
          const point = pointFromClient(event.clientX, event.clientY);
          if (!point) return;
          if (
            point.col !== selectionAnchor.col ||
            point.row !== selectionAnchor.row
          ) {
            selectionDragged = true;
          }
          setSelection({ start: selectionAnchor, end: point });
          event.preventDefault();
        };

        const onPointerUp = (event: PointerEvent) => {
          if (!selecting) return;
          selecting = false;
          selectionAnchor = null;
          try {
            if (input.hasPointerCapture(event.pointerId)) {
              input.releasePointerCapture(event.pointerId);
            }
          } catch {
            // ignore
          }
          // 单击未拖拽：清空选区，避免残留单格高亮挡住继续输入。
          if (!selectionDragged) {
            clearSelection();
          } else {
            // 拖选结束：有有效选区则立即复制。
            copySelectionAfterSelect();
          }
          selectionDragged = false;
        };

        const onCopy = (event: ClipboardEvent) => {
          if (!latestFrame || terminalSelectionIsEmpty(selectionRange)) return;
          const text = extractTerminalSelectionText(latestFrame, selectionRange);
          if (!text) return;
          event.preventDefault();
          event.clipboardData?.setData("text/plain", text);
        };

        input.addEventListener("keydown", onKeyDown);
        input.addEventListener("paste", onPaste);
        input.addEventListener("input", onInput);
        input.addEventListener("pointerdown", onPointerDown);
        input.addEventListener("pointermove", onPointerMove);
        input.addEventListener("pointerup", onPointerUp);
        input.addEventListener("pointercancel", onPointerUp);
        input.addEventListener("copy", onCopy);
        input.addEventListener("wheel", onWheel, { passive: false });

        const resizeObserver = new ResizeObserver(() => {
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          resizeDebounceTimer = window.setTimeout(() => {
            resizeDebounceTimer = null;
            if (cancelled || sessionEnded) return;
            const liveContainer = containerRef.current;
            if (!liveContainer) return;
            // 中栏 tab 隐藏或布局未就绪时尺寸会归零；勿把 PTY 缩成 1×1，否则切回像内容被清空。
            if (liveContainer.clientWidth < 8 || liveContainer.clientHeight < 8) {
              return;
            }
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
          if (scrollRaf) {
            cancelAnimationFrame(scrollRaf);
          }
          resizeObserver.disconnect();
          input.removeEventListener("keydown", onKeyDown);
          input.removeEventListener("paste", onPaste);
          input.removeEventListener("input", onInput);
          input.removeEventListener("pointerdown", onPointerDown);
          input.removeEventListener("pointermove", onPointerMove);
          input.removeEventListener("pointerup", onPointerUp);
          input.removeEventListener("pointercancel", onPointerUp);
          input.removeEventListener("copy", onCopy);
          input.removeEventListener("wheel", onWheel);
          frameUnsub();
          exitUnsub();
          persistSnapshot(latestFrame);
          if (closeOnUnmount) {
            cleanupTerminalSession(workspaceId, terminalId);
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
    workspaceId,
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
