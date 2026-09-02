import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { chordMatchesKeyboardEvent } from "../utils/atMentionShortcutChord";
import {
  isKeyShortcutCaptureListening,
  subscribeKeyShortcutCaptureLock,
} from "../utils/keyShortcutCaptureLock";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import {
  GLOBAL_REPOSITORY_ACTION_SHORTCUT_EVENT,
  loadOpenInEditorShortcutFromStore,
  loadOpenInTerminalShortcutFromStore,
  registerRepositoryActionGlobalShortcuts,
  WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED,
  WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED,
} from "../services/wiseDefaultConfigStore";
import type { Repository } from "../types";

export type RepositoryActionShortcutKind = "terminal" | "editor";

const REPOSITORY_ACTION_DEDUPE_MS = 400;
let lastRepositoryActionAt = 0;
let lastRepositoryAction: RepositoryActionShortcutKind | null = null;

interface UseRepositoryActionShortcutsOptions {
  activeRepositoryId: number | null;
  repositories: readonly Repository[];
  onOpenInTerminal?: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
}

export function matchRepositoryActionShortcut(
  event: KeyboardEvent,
  options: {
    terminalShortcut: string;
    editorShortcut: string;
    shortcutCaptureListening: boolean;
  },
): RepositoryActionShortcutKind | null {
  if (event.isComposing || options.shortcutCaptureListening) return null;
  if (options.terminalShortcut && chordMatchesKeyboardEvent(options.terminalShortcut, event)) {
    return "terminal";
  }
  if (options.editorShortcut && chordMatchesKeyboardEvent(options.editorShortcut, event)) {
    return "editor";
  }
  return null;
}

export function consumeRepositoryActionShortcut(
  action: RepositoryActionShortcutKind,
  now = Date.now(),
): boolean {
  if (
    lastRepositoryAction === action &&
    now - lastRepositoryActionAt < REPOSITORY_ACTION_DEDUPE_MS
  ) {
    return false;
  }
  lastRepositoryAction = action;
  lastRepositoryActionAt = now;
  return true;
}

export function resetRepositoryActionShortcutDedupeForTests(): void {
  lastRepositoryAction = null;
  lastRepositoryActionAt = 0;
}

function parseRepositoryActionPayload(payload: unknown): RepositoryActionShortcutKind | null {
  const action = (payload as { action?: unknown } | null)?.action;
  return action === "terminal" || action === "editor" ? action : null;
}

export function useRepositoryActionShortcuts({
  activeRepositoryId,
  repositories,
  onOpenInTerminal,
  openRepositoryInPreferredEditor,
}: UseRepositoryActionShortcutsOptions) {
  const [terminalShortcut, setTerminalShortcut] = useState("");
  const [editorShortcut, setEditorShortcut] = useState("");
  const [captureListening, setCaptureListening] = useState(isKeyShortcutCaptureListening);

  useEffect(() => {
    void loadOpenInTerminalShortcutFromStore().then(setTerminalShortcut);
    void loadOpenInEditorShortcutFromStore().then(setEditorShortcut);
  }, []);

  useEffect(() => {
    const onTerminalChanged = (event: Event) => {
      const { chord } = (event as CustomEvent<{ chord: string }>).detail;
      setTerminalShortcut(chord);
    };
    const onEditorChanged = (event: Event) => {
      const { chord } = (event as CustomEvent<{ chord: string }>).detail;
      setEditorShortcut(chord);
    };
    window.addEventListener(WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED, onTerminalChanged as EventListener);
    window.addEventListener(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, onEditorChanged as EventListener);
    return () => {
      window.removeEventListener(WISE_OPEN_IN_TERMINAL_SHORTCUT_CHANGED, onTerminalChanged as EventListener);
      window.removeEventListener(WISE_OPEN_IN_EDITOR_SHORTCUT_CHANGED, onEditorChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    return subscribeKeyShortcutCaptureLock(() => {
      setCaptureListening(isKeyShortcutCaptureListening());
    });
  }, []);

  useEffect(() => {
    const bindings = captureListening
      ? { terminalShortcut: "", editorShortcut: "" }
      : { terminalShortcut, editorShortcut };
    void registerRepositoryActionGlobalShortcuts(bindings).catch(() => {
      /* browser / non-Tauri */
    });
  }, [captureListening, editorShortcut, terminalShortcut]);

  const runAction = useCallback(
    (action: RepositoryActionShortcutKind) => {
      if (isKeyShortcutCaptureListening()) return;
      if (!activeRepositoryId) return;
      const repository = repositories.find((item) => item.id === activeRepositoryId);
      if (!repository) return;
      if (!consumeRepositoryActionShortcut(action)) return;
      if (action === "terminal") {
        onOpenInTerminal?.(repository);
        return;
      }
      openRepositoryInPreferredEditor(repository);
    },
    [
      activeRepositoryId,
      repositories,
      onOpenInTerminal,
      openRepositoryInPreferredEditor,
    ],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen(GLOBAL_REPOSITORY_ACTION_SHORTCUT_EVENT, (event) => {
      const action = parseRepositoryActionPayload(event.payload);
      if (action) runAction(action);
    })
      .then((fn) => {
        if (cancelled) safeUnlisten(fn);
        else unlisten = fn;
      })
      .catch(() => {
        /* browser / non-Tauri */
      });
    return () => {
      cancelled = true;
      safeUnlisten(unlisten);
    };
  }, [runAction]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const action = matchRepositoryActionShortcut(event, {
        terminalShortcut,
        editorShortcut,
        shortcutCaptureListening: isKeyShortcutCaptureListening(),
      });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      runAction(action);
    },
    [terminalShortcut, editorShortcut, runAction],
  );

  useEffect(() => {
    if (!terminalShortcut && !editorShortcut) return;
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [handleKeyDown, terminalShortcut, editorShortcut]);
}
