// @refresh reset — hook 数量变更时需重挂载 TerminalPanel，避免 Fast Refresh 报 hooks 数量不一致
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
import {
  applyInputToDraft,
  commitDraftToHistory,
  historyEntryAt,
  pickCommandSuggestion,
  readTerminalInputDraft,
  resolveTerminalKeydown,
  suggestionSuffix,
  TERMINAL_KEY_BYTES,
} from "./terminalInput";
const MAX_BUFFER_CHARS = 200_000;
const MAX_CACHED_TERMINAL_KEYS = 6;
const TERMINAL_SCROLLBACK = 1500;
const TERMINAL_RESIZE_DEBOUNCE_MS = 120;

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
  commandSuggestion: string | null;
  commandSuggestionSuffix: string;
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

/** 等布局稳定后再 fit，避免容器高度未就绪时多算行数导致 xterm-rows 顶部空行。 */
function scheduleTerminalFit(fitAddon: FitAddon): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // 容器仍不可见时 fit 可能失败，ResizeObserver 会再次触发
        }
        resolve();
      });
    });
  });
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
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
  const terminalKeyLruRef = useRef<string[]>([]);
  const activeKeyRef = useRef<string | null>(null);
  const renderedKeyRef = useRef<string | null>(null);
  const activeRepositoryRef = useRef<Repository | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef(false);
  const pendingOutputRef = useRef("");
  const outputFlushRafRef = useRef<number | null>(null);
  const resizeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandHistoryRef = useRef<string[]>([]);
  const historyBrowseIndexRef = useRef(-1);
  const inputDraftRef = useRef("");
  const [status, setStatus] = useState<TerminalStatus>("idle");
  const [message, setMessage] = useState("Open a terminal to start a session.");
  const [hasSession, setHasSession] = useState(false);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const [commandSuggestion, setCommandSuggestion] = useState<string | null>(null);
  const [commandSuggestionSuffix, setCommandSuggestionSuffix] = useState("");
  const [sessionResetCounter, setSessionResetCounter] = useState(0);

  const syncCommandSuggestion = useCallback((draft: string) => {
    const suggestion = pickCommandSuggestion(commandHistoryRef.current, draft);
    setCommandSuggestion(suggestion);
    setCommandSuggestionSuffix(
      suggestion ? suggestionSuffix(suggestion, draft) : "",
    );
  }, []);

  const touchTerminalKeyCache = useCallback((key: string) => {
    const lru = terminalKeyLruRef.current;
    const idx = lru.indexOf(key);
    if (idx >= 0) lru.splice(idx, 1);
    lru.push(key);
    while (lru.length > MAX_CACHED_TERMINAL_KEYS) {
      const evict = lru.shift();
      if (!evict || evict === activeKeyRef.current) continue;
      outputBuffersRef.current.delete(evict);
      openedSessionsRef.current.delete(evict);
      openingSessionKeysRef.current.delete(evict);
    }
  }, []);

  const syncDraftFromScreen = useCallback(() => {
    const term = terminalRef.current;
    if (!term) {
      return;
    }
    const draft = readTerminalInputDraft(term);
    inputDraftRef.current = draft;
    syncCommandSuggestion(draft);
  }, [syncCommandSuggestion]);

  const cleanupTerminalSession = useCallback(
    (repositoryId: number, terminalId: string) => {
      const key = `${repositoryId}:${terminalId}`;
      outputBuffersRef.current.delete(key);
      openedSessionsRef.current.delete(key);
      openingSessionKeysRef.current.delete(key);
      const lru = terminalKeyLruRef.current;
      const idx = lru.indexOf(key);
      if (idx >= 0) lru.splice(idx, 1);
      if (readyKey === key) {
        setReadyKey(null);
      }
      setSessionResetCounter((prev) => prev + 1);
      if (activeKeyRef.current === key) {
        terminalRef.current?.reset();
        commandHistoryRef.current = [];
        historyBrowseIndexRef.current = -1;
        inputDraftRef.current = "";
        setCommandSuggestion(null);
        setCommandSuggestionSuffix("");
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

  const flushPendingOutput = useCallback(() => {
    outputFlushRafRef.current = null;
    const term = terminalRef.current;
    const chunk = pendingOutputRef.current;
    if (!term || !chunk) {
      return;
    }
    pendingOutputRef.current = "";
    term.write(chunk);
    syncDraftFromScreen();
  }, [syncDraftFromScreen]);

  const sendTerminalInput = useCallback((data: string) => {
    const repository = activeRepositoryRef.current;
    const terminalId = activeTerminalIdRef.current;
    if (!repository || !terminalId) {
      return;
    }
    const key = `${repository.id}:${terminalId}`;
    if (!openedSessionsRef.current.has(key)) {
      return;
    }

    if (data === TERMINAL_KEY_BYTES.enter || data === "\n") {
      commandHistoryRef.current = commitDraftToHistory(
        commandHistoryRef.current,
        inputDraftRef.current,
      );
      historyBrowseIndexRef.current = -1;
      inputDraftRef.current = "";
      syncCommandSuggestion("");
    } else {
      historyBrowseIndexRef.current = -1;
      inputDraftRef.current = applyInputToDraft(inputDraftRef.current, data);
      syncCommandSuggestion(inputDraftRef.current);
    }

    void writeTerminalSession(repository.id.toString(), terminalId, data).catch((error) => {
      if (shouldIgnoreTerminalError(error)) {
        openedSessionsRef.current.delete(key);
      }
    });
  }, [syncCommandSuggestion]);

  const enqueueTerminalOutput = useCallback(
    (key: string, data: string) => {
      touchTerminalKeyCache(key);
      const next = appendBuffer(outputBuffersRef.current.get(key), data);
      outputBuffersRef.current.set(key, next);
      if (activeKeyRef.current !== key) {
        return;
      }
      pendingOutputRef.current += data;
      if (outputFlushRafRef.current === null) {
        outputFlushRafRef.current = requestAnimationFrame(() => {
          flushPendingOutput();
        });
      }
    },
    [flushPendingOutput, touchTerminalKeyCache],
  );

  const focusTerminalIfRequested = useCallback(() => {
    if (!pendingFocusRef.current) {
      return;
    }
    pendingFocusRef.current = false;
    terminalRef.current?.focus();
  }, []);

  const syncActiveBuffer = useCallback(
    (key: string) => {
      const term = terminalRef.current;
      if (!term) {
        return;
      }
      if (outputFlushRafRef.current !== null) {
        cancelAnimationFrame(outputFlushRafRef.current);
        outputFlushRafRef.current = null;
      }
      pendingOutputRef.current = "";
      term.reset();
      const buffered = outputBuffersRef.current.get(key);
      if (buffered) {
        term.write(buffered);
      }
      focusTerminalIfRequested();
    },
    [focusTerminalIfRequested],
  );

  // Subscribe to terminal output events
  useEffect(() => {
    const unlisten = subscribeTerminalOutput(
      (payload: TerminalOutputEvent) => {
        const key = `${payload.workspaceId}:${payload.terminalId}`;
        enqueueTerminalOutput(key, payload.data);
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
  }, [enqueueTerminalOutput]);

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
        /* 透明模式下 block 光标可能只绘空心框，叠在 prompt 字形上会像“遮挡” */
        allowTransparency: false,
        theme: appearance.theme,
        scrollback: TERMINAL_SCROLLBACK,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      scheduleTerminalFit(fitAddon);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type === "keydown") {
          const hasSelection = terminal.hasSelection();
          const isMacCopy = event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c";
          const isWinLinuxCopy =
            !event.metaKey && event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "c";
          if (hasSelection && (isMacCopy || isWinLinuxCopy)) {
            event.preventDefault();
            void copyTextToClipboard(terminal.getSelection());
            return false;
          }
        }
        if (
          event.type === "keydown" &&
          event.key === "Tab" &&
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey
        ) {
          const suggestion = pickCommandSuggestion(
            commandHistoryRef.current,
            inputDraftRef.current,
          );
          const suffix = suggestion
            ? suggestionSuffix(suggestion, inputDraftRef.current)
            : "";
          if (suffix) {
            sendTerminalInput(suffix);
            return false;
          }
        }
        const action = resolveTerminalKeydown(event);
        if (!action) {
          return true;
        }
        if (action.kind === "history-prev") {
          const nextIndex = historyBrowseIndexRef.current + 1;
          const entry = historyEntryAt(commandHistoryRef.current, nextIndex);
          if (!entry) {
            return true;
          }
          historyBrowseIndexRef.current = nextIndex;
          sendTerminalInput(TERMINAL_KEY_BYTES.killLine);
          sendTerminalInput(entry);
          inputDraftRef.current = entry;
          syncCommandSuggestion(entry);
          return false;
        }
        if (action.kind === "history-next") {
          if (historyBrowseIndexRef.current < 0) {
            return true;
          }
          if (historyBrowseIndexRef.current === 0) {
            historyBrowseIndexRef.current = -1;
            sendTerminalInput(TERMINAL_KEY_BYTES.killLine);
            inputDraftRef.current = "";
            syncCommandSuggestion("");
            return false;
          }
          const nextIndex = historyBrowseIndexRef.current - 1;
          const entry = historyEntryAt(commandHistoryRef.current, nextIndex);
          if (!entry) {
            return true;
          }
          historyBrowseIndexRef.current = nextIndex;
          sendTerminalInput(TERMINAL_KEY_BYTES.killLine);
          sendTerminalInput(entry);
          inputDraftRef.current = entry;
          syncCommandSuggestion(entry);
          return false;
        }
        sendTerminalInput(action.data);
        return false;
      });

      inputDisposableRef.current = terminal.onData((data: string) => {
        sendTerminalInput(data);
      });
    }
  }, [isVisible, sendTerminalInput, syncCommandSuggestion]);

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

    const openSession = async () => {
      await scheduleTerminalFit(fitAddon);
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (openedSessionsRef.current.has(key)) {
        touchTerminalKeyCache(key);
        setStatus("ready");
        setMessage("Terminal ready.");
        setHasSession(true);
        setReadyKey(key);
        if (renderedKeyRef.current !== key) {
          syncActiveBuffer(key);
          renderedKeyRef.current = key;
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
        touchTerminalKeyCache(key);
        setStatus("ready");
        setMessage("Terminal ready.");
        setHasSession(true);
        setReadyKey(key);
        if (renderedKeyRef.current !== key) {
          syncActiveBuffer(key);
          renderedKeyRef.current = key;
        }
        terminal.focus();
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
    syncActiveBuffer,
    sessionResetCounter,
    touchTerminalKeyCache,
  ]);

  // Focus on request
  useEffect(() => {
    if (!isVisible || focusRequestVersion === 0) {
      return;
    }
    pendingFocusRef.current = true;
    focusTerminalIfRequested();
  }, [focusRequestVersion, focusTerminalIfRequested, isVisible]);

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
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
      }
      resizeDebounceRef.current = setTimeout(() => {
        resizeDebounceRef.current = null;
        void scheduleTerminalFit(fitAddon).then(() => {
          terminal.focus();
          const key = `${activeRepository.id}:${activeTerminalId}`;
          resizeTerminalSession(
            activeRepository.id.toString(),
            activeTerminalId,
            terminal.cols,
            terminal.rows,
          ).catch((error) => {
            if (shouldIgnoreTerminalError(error)) {
              openedSessionsRef.current.delete(key);
            }
          });
        });
      }, TERMINAL_RESIZE_DEBOUNCE_MS);
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
      if (resizeDebounceRef.current) {
        clearTimeout(resizeDebounceRef.current);
        resizeDebounceRef.current = null;
      }
    };
  }, [activeTerminalId, activeRepository, hasSession, isVisible]);

  useEffect(() => {
    return () => {
      if (outputFlushRafRef.current !== null) {
        cancelAnimationFrame(outputFlushRafRef.current);
        outputFlushRafRef.current = null;
      }
    };
  }, []);

  return {
    status,
    message,
    containerRef,
    hasSession,
    readyKey,
    commandSuggestion,
    commandSuggestionSuffix,
    cleanupTerminalSession,
  };
}
