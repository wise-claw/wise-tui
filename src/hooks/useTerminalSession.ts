import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Repository } from "../types";
import {
  subscribeTerminalExit,
  subscribeTerminalOutput,
  type TerminalExitEvent,
  type TerminalOutputEvent,
} from "../services/events";
import {
  openTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "../services/terminal";

const MAX_BUFFER_CHARS = 200_000;

export type TerminalStatus = "idle" | "connecting" | "ready" | "error";

type TerminalAppearance = {
  theme: {
    background: string;
    foreground: string;
    cursor: string;
    selection?: string;
  };
  fontFamily: string;
};

export type TerminalSessionState = {
  status: TerminalStatus;
  message: string;
  containerRef: RefObject<HTMLDivElement | null>;
  hasSession: boolean;
  readyKey: string | null;
  cleanupTerminalSession: (repositoryId: number, terminalId: string) => void;
};

function appendBuffer(existing: string | undefined, data: string): string {
  const next = (existing ?? "") + data;
  if (next.length <= MAX_BUFFER_CHARS) {
    return next;
  }
  return next.slice(next.length - MAX_BUFFER_CHARS);
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

function getTerminalAppearance(container: HTMLElement | null): TerminalAppearance {
  if (typeof window === "undefined") {
    return {
      theme: {
        background: "transparent",
        foreground: "#d9dee7",
        cursor: "#d9dee7",
      },
      fontFamily: "Menlo, Monaco, \"Courier New\", monospace",
    };
  }

  const target = container ?? document.documentElement;
  const styles = getComputedStyle(target);
  const background =
    styles.getPropertyValue("--terminal-background").trim() ||
    styles.getPropertyValue("--ant-color-bg-container").trim() ||
    "#11151b";
  const foreground =
    styles.getPropertyValue("--terminal-foreground").trim() ||
    styles.getPropertyValue("--ant-color-text").trim() ||
    "#d9dee7";
  const cursor =
    styles.getPropertyValue("--terminal-cursor").trim() || foreground;
  const selection = styles.getPropertyValue("--terminal-selection").trim();
  const fontFamily =
    styles.getPropertyValue("--terminal-font-family").trim() ||
    "Menlo, Monaco, \"Courier New\", monospace";

  return {
    theme: {
      background,
      foreground,
      cursor,
      selection: selection || undefined,
    },
    fontFamily,
  };
}

type UseTerminalSessionOptions = {
  activeRepository: Repository | null;
  activeTerminalId: string | null;
  isVisible: boolean;
  focusRequestVersion: number;
  onSessionExit?: (repositoryId: number, terminalId: string) => void;
};

export function useTerminalSession({
  activeRepository,
  activeTerminalId,
  isVisible,
  focusRequestVersion,
  onSessionExit,
}: UseTerminalSessionOptions): TerminalSessionState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const openedSessionsRef = useRef<Set<string>>(new Set());
  /** 防止 Strict Mode / 依赖重跑时并发两次 openTerminalSession（opened 只在 await 之后才写入）。 */
  const openingSessionKeysRef = useRef<Set<string>>(new Set());
  const outputBuffersRef = useRef<Map<string, string>>(new Map());
  const activeKeyRef = useRef<string | null>(null);
  const renderedKeyRef = useRef<string | null>(null);
  const activeRepositoryRef = useRef<Repository | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef(false);
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [message, setMessage] = useState("Open a terminal to start a session.");
  const [hasSession, setHasSession] = useState(false);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [sessionResetCounter, setSessionResetCounter] = useState(0);

  const cleanupTerminalSession = useCallback(
    (repositoryId: number, terminalId: string) => {
      const key = `${repositoryId}:${terminalId}`;
      outputBuffersRef.current.delete(key);
      openedSessionsRef.current.delete(key);
      openingSessionKeysRef.current.delete(key);
      if (readyKey === key) {
        setReadyKey(null);
      }
      setSessionResetCounter((prev) => prev + 1);
      if (activeKeyRef.current === key) {
        terminalRef.current?.reset();
        setHasSession(false);
        setStatus("idle");
        setMessage("Open a terminal to start a session.");
      }
    },
    [readyKey],
  );

  const activeKey = activeRepository && activeTerminalId
    ? `${activeRepository.id}:${activeTerminalId}`
    : null;

  useEffect(() => {
    activeKeyRef.current = activeKey;
    activeRepositoryRef.current = activeRepository;
    activeTerminalIdRef.current = activeTerminalId;
  }, [activeKey, activeTerminalId, activeRepository]);

  const writeToTerminal = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  const focusTerminalIfRequested = useCallback(() => {
    if (!pendingFocusRef.current) {
      return;
    }
    pendingFocusRef.current = false;
    terminalRef.current?.focus();
  }, []);

  const refreshTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const lastRow = Math.max(0, terminal.rows - 1);
    terminal.refresh(0, lastRow);
    focusTerminalIfRequested();
  }, [focusTerminalIfRequested]);

  const syncActiveBuffer = useCallback(
    (key: string) => {
      const term = terminalRef.current;
      if (!term) {
        return;
      }
      term.reset();
      const buffered = outputBuffersRef.current.get(key);
      if (buffered) {
        term.write(buffered);
      }
      refreshTerminal();
    },
    [refreshTerminal],
  );

  // Subscribe to terminal output events
  useEffect(() => {
    const unlisten = subscribeTerminalOutput(
      (payload: TerminalOutputEvent) => {
        const key = `${payload.workspaceId}:${payload.terminalId}`;
        const next = appendBuffer(outputBuffersRef.current.get(key), payload.data);
        outputBuffersRef.current.set(key, next);
        if (activeKeyRef.current === key) {
          writeToTerminal(payload.data);
        }
      },
      {
        onError: () => {
          // ignore listen errors in non-debug mode
        },
      },
    );
    return () => {
      unlisten();
    };
  }, [writeToTerminal]);

  // Subscribe to terminal exit events
  useEffect(() => {
    const unlisten = subscribeTerminalExit(
      (payload: TerminalExitEvent) => {
        cleanupTerminalSession(
          Number(payload.workspaceId),
          payload.terminalId,
        );
        onSessionExit?.(Number(payload.workspaceId), payload.terminalId);
      },
      {
        onError: () => {
          // ignore listen errors
        },
      },
    );
    return () => {
      unlisten();
    };
  }, [cleanupTerminalSession, onSessionExit]);

  // Create xterm instance when visible
  useEffect(() => {
    if (!isVisible) {
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
      renderedKeyRef.current = null;
      return;
    }

    if (!terminalRef.current && containerRef.current) {
      const appearance = getTerminalAppearance(containerRef.current);
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: appearance.fontFamily,
        allowTransparency: true,
        theme: appearance.theme,
        scrollback: 5000,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      inputDisposableRef.current = terminal.onData((data: string) => {
        const repository = activeRepositoryRef.current;
        const terminalId = activeTerminalIdRef.current;
        if (!repository || !terminalId) {
          return;
        }
        const key = `${repository.id}:${terminalId}`;
        if (!openedSessionsRef.current.has(key)) {
          return;
        }
        void writeTerminalSession(repository.id.toString(), terminalId, data).catch((error) => {
          if (shouldIgnoreTerminalError(error)) {
            openedSessionsRef.current.delete(key);
            return;
          }
        });
      });
    }
  }, [isVisible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
    };
  }, []);

  // Open session when repository + terminal are ready
  useEffect(() => {
    if (!isVisible) {
      setHasSession(false);
      setReadyKey(null);
      return;
    }
    if (!activeRepository || !activeTerminalId) {
      setStatus("idle");
      setMessage("Open a terminal to start a session.");
      setHasSession(false);
      setReadyKey(null);
      return;
    }
    if (!terminalRef.current || !fitAddonRef.current) {
      setStatus("idle");
      setMessage("Preparing terminal...");
      setHasSession(false);
      setReadyKey(null);
      return;
    }
    const key = `${activeRepository.id}:${activeTerminalId}`;
    const fitAddon = fitAddonRef.current;
    fitAddon.fit();

    const cols = terminalRef.current.cols;
    const rows = terminalRef.current.rows;
    const openSession = async () => {
      if (openedSessionsRef.current.has(key)) {
        setStatus("ready");
        setMessage("Terminal ready.");
        setHasSession(true);
        setReadyKey(key);
        if (renderedKeyRef.current !== key) {
          syncActiveBuffer(key);
          renderedKeyRef.current = key;
        } else {
          refreshTerminal();
        }
        return;
      }
      if (openingSessionKeysRef.current.has(key)) {
        return;
      }
      openingSessionKeysRef.current.add(key);
      setStatus("connecting");
      setMessage("Starting terminal session...");
      try {
        await openTerminalSession(
          activeRepository.id.toString(),
          activeTerminalId,
          cols,
          rows,
          activeRepository.path,
        );
        openedSessionsRef.current.add(key);
        setStatus("ready");
        setMessage("Terminal ready.");
        setHasSession(true);
        setReadyKey(key);
        if (renderedKeyRef.current !== key) {
          syncActiveBuffer(key);
          renderedKeyRef.current = key;
        } else {
          refreshTerminal();
        }
      } catch {
        setStatus("error");
        setMessage("Failed to start terminal session.");
      } finally {
        openingSessionKeysRef.current.delete(key);
      }
    };

    void openSession();
  }, [
    activeTerminalId,
    activeRepository,
    isVisible,
    refreshTerminal,
    syncActiveBuffer,
    sessionResetCounter,
  ]);

  // Focus on request
  useEffect(() => {
    if (!isVisible || focusRequestVersion === 0) {
      return;
    }
    pendingFocusRef.current = true;
    focusTerminalIfRequested();
  }, [focusRequestVersion, focusTerminalIfRequested, isVisible]);

  // Resize on viewport change
  useEffect(() => {
    if (!isVisible || !activeKey || !terminalRef.current || !fitAddonRef.current) {
      return;
    }
    fitAddonRef.current.fit();
    refreshTerminal();
  }, [activeKey, isVisible, refreshTerminal]);

  // Resize observer
  useEffect(() => {
    if (
      !isVisible ||
      !terminalRef.current ||
      !activeRepository ||
      !activeTerminalId ||
      !hasSession
    ) {
      return;
    }
    const fitAddon = fitAddonRef.current;
    const terminal = terminalRef.current;
    if (!fitAddon) {
      return;
    }

    const resize = () => {
      fitAddon.fit();
      const key = `${activeRepository.id}:${activeTerminalId}`;
      resizeTerminalSession(
        activeRepository.id.toString(),
        activeTerminalId,
        terminal.cols,
        terminal.rows,
      ).catch((error) => {
        if (shouldIgnoreTerminalError(error)) {
          openedSessionsRef.current.delete(key);
          return;
        }
      });
    };

    const observer = new ResizeObserver(() => {
      resize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    resize();

    return () => {
      observer.disconnect();
    };
  }, [activeTerminalId, activeRepository, hasSession, isVisible]);

  return {
    status,
    message,
    containerRef,
    hasSession,
    readyKey,
    cleanupTerminalSession,
  };
}
