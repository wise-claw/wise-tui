import { useCallback, useEffect } from "react";
import { chordMatchesKeyboardEvent } from "../utils/atMentionShortcutChord";
import type { Repository } from "../types";

interface UseRepositoryActionShortcutsOptions {
  terminalShortcut: string;
  editorShortcut: string;
  activeRepositoryId: number | null;
  repositoriesById: Map<number, Repository>;
  onOpenInTerminal?: (repository: Repository) => void;
  openRepositoryInPreferredEditor: (repository: Repository) => void;
}

export function useRepositoryActionShortcuts({
  terminalShortcut,
  editorShortcut,
  activeRepositoryId,
  repositoriesById,
  onOpenInTerminal,
  openRepositoryInPreferredEditor,
}: UseRepositoryActionShortcutsOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (!activeRepositoryId) return;

      // Ignore if user is typing in an input/textarea/contenteditable
      const target = event.target as Node | null;
      if (!target) return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const repository = repositoriesById.get(activeRepositoryId);
      if (!repository) return;

      if (terminalShortcut && chordMatchesKeyboardEvent(terminalShortcut, event)) {
        event.preventDefault();
        event.stopPropagation();
        onOpenInTerminal?.(repository);
        return;
      }

      if (editorShortcut && chordMatchesKeyboardEvent(editorShortcut, event)) {
        event.preventDefault();
        event.stopPropagation();
        openRepositoryInPreferredEditor(repository);
        return;
      }
    },
    [
      terminalShortcut,
      editorShortcut,
      activeRepositoryId,
      repositoriesById,
      onOpenInTerminal,
      openRepositoryInPreferredEditor,
    ],
  );

  useEffect(() => {
    if (!terminalShortcut && !editorShortcut) return;
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [handleKeyDown, terminalShortcut, editorShortcut]);
}
