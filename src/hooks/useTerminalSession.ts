// @refresh reset
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { FitAddon, Terminal } from "ghostty-web";
import type { Repository } from "../types";
import type { TerminalSurfaceSnapshot } from "../types/terminal";
import {
  subscribeTerminalExit,
  subscribeTerminalOutput,
} from "../services/events";
import {
  attachTerminalSession,
  closeTerminalSession,
  openTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "../services/terminal";
import { loadGhosttyModule } from "../utils/ghosttyLoader";
import {
  resetTerminalKeyboardProtocol,
  sanitizeTerminalPtyOutput,
} from "../utils/terminalSanitize";
import {
  configureGhosttyInputSurface,
  forceTerminalRemeasureAndFit,
  observeTerminalTheme,
  readTerminalThemeFromContainer,
  reconcileTerminalCanvasFit,
  registerTerminalLinkProviders,
  TERMINAL_BLANK_RECOVERY_DELAYS_MS,
  terminalBufferLooksEmpty,
  terminalNeedsBlankRecovery,
  waitForTerminalContainerLayout,
} from "../utils/terminalTheme";
import { terminalWriter } from "../utils/terminalWriter";
import { shouldIgnoreTerminalError } from "../utils/terminalErrors";

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
  surfaceSnapshot?: TerminalSurfaceSnapshot | null;
  onSurfaceSnapshot?: (snapshot: TerminalSurfaceSnapshot) => void;
  /** 卸载 UI 时是否结束后端 PTY；tab 切换时应为 false。 */
  closeOnUnmount?: boolean;
  onSessionExit?: (repositoryId: number, terminalId: string) => void;
}

/** 与后端 TERMINAL_DIM_MIN/MAX 保持一致：clamp 维度防止 0 或异常巨大值进入 IPC。 */
const TERMINAL_DIM_MIN = 1;
const TERMINAL_DIM_MAX = 1024;

/** 调整频率限制，防止拖拽分隔条时高频 resize 把后端压垮。 */
const TERMINAL_RESIZE_DEBOUNCE_MS = 100;

/** 与 OpenCode Desktop 对齐的 scrollback 上限。 */
const TERMINAL_SCROLLBACK = 10_000;

/** 嵌入式终端字号（略大于编辑器侧栏，提升浅色主题可读性）。 */
const TERMINAL_FONT_SIZE = 14;

/** 等待 container ref 挂载的最大帧数（约 2s @60Hz）。 */
const MAX_CONTAINER_WAIT_FRAMES = 120;

const clampTerminalDim = (n: number) => {
  if (!Number.isFinite(n)) return TERMINAL_DIM_MIN;
  return Math.max(TERMINAL_DIM_MIN, Math.min(TERMINAL_DIM_MAX, Math.floor(n)));
};

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
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
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
  const initialCursorRef = useRef(surfaceSnapshot?.cursor ?? 0);
  const initialScrollYRef = useRef(surfaceSnapshot?.scrollY);
  const initialSizeRef = useRef(
    surfaceSnapshot?.cols && surfaceSnapshot?.rows
      ? { cols: surfaceSnapshot.cols, rows: surfaceSnapshot.rows }
      : undefined,
  );

  useEffect(() => {
    initialCursorRef.current = surfaceSnapshot?.cursor ?? 0;
    initialScrollYRef.current = surfaceSnapshot?.scrollY;
    initialSizeRef.current =
      surfaceSnapshot?.cols && surfaceSnapshot?.rows
        ? { cols: surfaceSnapshot.cols, rows: surfaceSnapshot.rows }
        : undefined;
  }, [activeTerminalId, surfaceSnapshot]);

  useEffect(() => {
    if (focusRequestVersion <= 0) return;
    const term = terminalRef.current;
    if (!term) return;
    try {
      term.focus();
      term.textarea?.focus();
    } catch {
      // ignore
    }
  }, [focusRequestVersion]);

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
      if (!container) {
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
      /** 每次挂载新 ghostty 实例必须从 0 重放；snapshot.cursor 仅用于持久化。 */
      const ATTACH_REPLAY_CURSOR = 0;

      const theme = readTerminalThemeFromContainer(container);

      let outputWriter: ReturnType<typeof terminalWriter> | undefined;
      let streamCursor = ATTACH_REPLAY_CURSOR;
      let sessionEnded = false;

    const fitAndOpenRafRef: { current: number | null } = { current: null };
    const resizeDebounceTimerRef: { current: number | null } = { current: null };
    const visibleRefitTimerRef: { current: number | null } = { current: null };
    const blankRecoveryTimerRef: { current: number | null } = { current: null };
    const blankRecoveryGenerationRef: { current: number } = { current: 0 };

    const persistSurfaceSnapshot = (term: Terminal) => {
      onSurfaceSnapshotRef.current?.({
        cols: term.cols,
        rows: term.rows,
        scrollY: term.getViewportY(),
        cursor: streamCursor,
      });
    };

    const bootstrap = async () => {
      setStatus("connecting");
      setMessage("正在连接终端…");

      await waitForTerminalContainerLayout(container);
      if (cancelled) return () => undefined;

      const ghosttyModule = await loadGhosttyModule();
      if (cancelled) return () => undefined;

      const terminal = new ghosttyModule.Terminal({
        cursorBlink: false,
        convertEol: false,
        scrollback: TERMINAL_SCROLLBACK,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: TERMINAL_FONT_SIZE,
        ghostty: ghosttyModule.ghostty,
        theme,
        cols: initialSizeRef.current?.cols,
        rows: initialSizeRef.current?.rows,
      });
      const fitAddon = new ghosttyModule.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      const unregisterInputSurface = configureGhosttyInputSurface(terminal);
      if (cancelled) {
        terminal.dispose();
        return () => undefined;
      }

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      outputWriter = terminalWriter((data, done) => {
        try {
          terminal.write(data, done);
        } catch {
          done?.();
        }
      });

      const outputUnsubscribe = subscribeTerminalOutput((event) => {
        if (event.workspaceId === workspaceId && event.terminalId === terminalId) {
          const sanitized = sanitizeTerminalPtyOutput(event.data);
          if (!sanitized) return;
          outputWriter?.push(sanitized);
          streamCursor += event.data.length;
          outputWriter?.flush();
        }
      });

      const exitUnsubscribe = subscribeTerminalExit((event) => {
        if (event.workspaceId === workspaceId && event.terminalId === terminalId) {
          sessionEnded = true;
          outputWriter?.clear();
          if (event.reason) {
            try {
              terminal.write(
                `\r\n\x1b[31m[终端已断开] ${event.reason}\x1b[0m\r\n`,
              );
            } catch {
              // 忽略写入失败：终端可能已被 dispose
            }
          }
          onSessionExitRef.current?.(repositoryId, terminalId);
        }
      });

      const enableCursorBlink = () => {
        try {
          terminal.options.cursorBlink = true;
        } catch {
          // ignore
        }
      };

      const fitTerminalToContainer = () => {
        forceTerminalRemeasureAndFit(terminal, fitAddon, container);
      };

      const syncTerminalDimensions = () => {
        const nextCols = clampTerminalDim(terminal.cols);
        const nextRows = clampTerminalDim(terminal.rows);
        void resizeTerminalSession(workspaceId, terminalId, nextCols, nextRows).catch(
          () => undefined,
        );
      };

      const replayAttachOutput = async (clientCursor = ATTACH_REPLAY_CURSOR) => {
        const attach = await attachTerminalSession(
          workspaceId,
          terminalId,
          clientCursor,
        );
        if (cancelled) return false;
        streamCursor = attach.cursor;
        const replay = sanitizeTerminalPtyOutput(attach.replay);
        if (!replay) return false;
        await new Promise<void>((resolve) => {
          outputWriter?.push(replay);
          outputWriter?.flush(resolve);
        });
        return true;
      };

      const scheduleBlankRecoveryRefit = (attempt = 0) => {
        const delay = TERMINAL_BLANK_RECOVERY_DELAYS_MS[attempt];
        if (delay === undefined) return;

        const generation = blankRecoveryGenerationRef.current;
        if (blankRecoveryTimerRef.current !== null) {
          window.clearTimeout(blankRecoveryTimerRef.current);
        }
        blankRecoveryTimerRef.current = window.setTimeout(() => {
          blankRecoveryTimerRef.current = null;
          if (cancelled || sessionEnded || generation !== blankRecoveryGenerationRef.current) {
            return;
          }
          void (async () => {
            if (!terminalNeedsBlankRecovery(container, terminal)) {
              return;
            }
            try {
              fitTerminalToContainer();
              syncTerminalDimensions();
              if (terminalBufferLooksEmpty(terminal)) {
                await replayAttachOutput(ATTACH_REPLAY_CURSOR);
                fitTerminalToContainer();
                syncTerminalDimensions();
              }
              if (
                terminalNeedsBlankRecovery(container, terminal) &&
                attempt + 1 < TERMINAL_BLANK_RECOVERY_DELAYS_MS.length
              ) {
                scheduleBlankRecoveryRefit(attempt + 1);
              }
            } catch {
              if (attempt + 1 < TERMINAL_BLANK_RECOVERY_DELAYS_MS.length) {
                scheduleBlankRecoveryRefit(attempt + 1);
              }
            }
          })();
        }, delay);
      };

      const finalizeSessionReady = () => {
        if (cancelled) return;
        setStatus("ready");
        setMessage("");
        try {
          fitTerminalToContainer();
          syncTerminalDimensions();
          if (initialScrollYRef.current !== undefined) {
            terminal.scrollToLine(initialScrollYRef.current);
          }
          enableCursorBlink();
          if (outputWriter) {
            resetTerminalKeyboardProtocol(outputWriter);
          }
          terminal.focus();
          persistSurfaceSnapshot(terminal);
          blankRecoveryGenerationRef.current += 1;
          scheduleBlankRecoveryRefit(0);
        } catch {
          // ignore finalize errors
        }
      };

      const unregisterLinks = registerTerminalLinkProviders(terminal);
      const unsubscribeTheme = observeTerminalTheme(container, () => {
        try {
          terminal.options.theme = readTerminalThemeFromContainer(container);
        } catch {
          // ignore runtime theme update errors
        }
      });

      const dataDisposable = terminal.onData((data) => {
        if (sessionEnded) return;
        void writeTerminalSession(workspaceId, terminalId, data).catch((error) => {
          if (shouldIgnoreTerminalError(error)) {
            sessionEnded = true;
            return;
          }
          console.warn("write terminal session failed", error);
          setStatus((prev) => (prev === "ready" ? "error" : prev));
          setMessage(error instanceof Error ? error.message : "终端写入失败");
        });
      });

      const scheduleVisibleRefit = () => {
        if (visibleRefitTimerRef.current !== null) {
          window.clearTimeout(visibleRefitTimerRef.current);
        }
        visibleRefitTimerRef.current = window.setTimeout(() => {
          visibleRefitTimerRef.current = null;
          if (cancelled || sessionEnded) return;
          try {
            fitTerminalToContainer();
            const term = terminalRef.current;
            if (!term) return;
            const nextCols = clampTerminalDim(term.cols);
            const nextRows = clampTerminalDim(term.rows);
            void resizeTerminalSession(
              workspaceId,
              terminalId,
              nextCols,
              nextRows,
            ).catch(() => undefined);
            if (outputWriter) {
              resetTerminalKeyboardProtocol(outputWriter);
            }
            persistSurfaceSnapshot(term);
            blankRecoveryGenerationRef.current += 1;
            scheduleBlankRecoveryRefit(0);
          } catch {
            // ignore
          }
        }, 80);
      };

      const fitAndOpen = async () => {
        if (cancelled) return;
        await waitForTerminalContainerLayout(container);
        if (cancelled) return;
        try {
          fitTerminalToContainer();
        } catch {
          // 容器尚未可见时忽略
        }
        const cols = clampTerminalDim(terminal.cols || 80);
        const rows = clampTerminalDim(terminal.rows || 24);

        let needsOpen = false;
        try {
          const didReplay = await replayAttachOutput(ATTACH_REPLAY_CURSOR);
          if (cancelled) return;
          if (didReplay) {
            fitTerminalToContainer();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.toLowerCase().includes("terminal session not found")) {
            needsOpen = true;
          } else if (!shouldIgnoreTerminalError(error)) {
            if (cancelled) return;
            setStatus("error");
            setMessage(message || "终端连接失败");
            return;
          } else {
            needsOpen = true;
          }
        }

        if (!needsOpen) {
          if (cancelled) return;
          finalizeSessionReady();
          return;
        }

        void openTerminalSession(workspaceId, terminalId, cols, rows, cwd, {
          source: "user",
        })
          .then(() => {
            if (cancelled) return;
            finalizeSessionReady();
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

      if (typeof document !== "undefined" && document.fonts) {
        await document.fonts.ready;
      }
      if (cancelled) return;

      try {
        (
          terminal.renderer as { remeasureFont?: () => void } | undefined
        )?.remeasureFont?.();
        fitTerminalToContainer();
      } catch {
        // ignore font remeasure errors
      }

      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          const raf3 = requestAnimationFrame(() => {
            void fitAndOpen();
          });
          fitAndOpenRafRef.current = raf3;
        });
        fitAndOpenRafRef.current = raf2;
      });
      fitAndOpenRafRef.current = raf1;

      fitAddon.observeResize();
      const resizeObserver = new ResizeObserver(() => {
        const fit = fitAddonRef.current;
        const term = terminalRef.current;
        if (!fit || !term) return;
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
            reconcileTerminalCanvasFit(term2, container);
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
            persistSurfaceSnapshot(term2);
          } catch {
            // ignore fit 失败
          }
        }, TERMINAL_RESIZE_DEBOUNCE_MS);
      });
      resizeObserver.observe(container);
      const layoutParent = container.closest(".terminal-body") ?? container.parentElement;
      if (layoutParent instanceof HTMLElement && layoutParent !== container) {
        resizeObserver.observe(layoutParent);
      }

      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          scheduleVisibleRefit();
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);

      const intersectionObserver =
        typeof IntersectionObserver !== "undefined"
          ? new IntersectionObserver((entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                scheduleVisibleRefit();
              }
            })
          : null;
      intersectionObserver?.observe(container);

      return () => {
        intersectionObserver?.disconnect();
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        cancelled = true;
        cancelAnimationFrame(raf1);
        if (fitAndOpenRafRef.current !== null) {
          cancelAnimationFrame(fitAndOpenRafRef.current);
        }
        if (resizeDebounceTimerRef.current !== null) {
          window.clearTimeout(resizeDebounceTimerRef.current);
          resizeDebounceTimerRef.current = null;
        }
        if (visibleRefitTimerRef.current !== null) {
          window.clearTimeout(visibleRefitTimerRef.current);
          visibleRefitTimerRef.current = null;
        }
        if (blankRecoveryTimerRef.current !== null) {
          window.clearTimeout(blankRecoveryTimerRef.current);
          blankRecoveryTimerRef.current = null;
        }
        blankRecoveryGenerationRef.current += 1;
        resizeObserver.disconnect();
        unregisterLinks();
        unregisterInputSurface();
        unsubscribeTheme();
        dataDisposable.dispose();
        outputUnsubscribe();
        exitUnsubscribe();
        try {
          persistSurfaceSnapshot(terminal);
          terminal.dispose();
        } catch {
          // ignore dispose 错误
        }
        terminalRef.current = null;
        fitAddonRef.current = null;
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
  ]);

  return {
    status,
    message,
    containerRef,
    cleanupTerminalSession,
  };
}
