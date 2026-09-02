import { describe, expect, test } from "bun:test";
import {
  consumeRepositoryActionShortcut,
  matchRepositoryActionShortcut,
  resetRepositoryActionShortcutDedupeForTests,
} from "./useRepositoryActionShortcuts";

function keyEvent(init: {
  code: string;
  key?: string;
  altKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  return {
    code: init.code,
    key: init.key ?? init.code,
    ctrlKey: false,
    metaKey: false,
    altKey: init.altKey ?? false,
    shiftKey: false,
    isComposing: init.isComposing ?? false,
  } as KeyboardEvent;
}

describe("matchRepositoryActionShortcut", () => {
  test("matches terminal and editor chords even when the target is an input", () => {
    const terminal = keyEvent({ code: "KeyT", key: "t", altKey: true });
    const editor = keyEvent({ code: "KeyE", key: "e", altKey: true });
    const options = {
      terminalShortcut: "Alt+KeyT",
      editorShortcut: "Alt+KeyE",
      shortcutCaptureListening: false,
    };

    expect(matchRepositoryActionShortcut(terminal, options)).toBe("terminal");
    expect(matchRepositoryActionShortcut(editor, options)).toBe("editor");
  });

  test("ignores chords while a shortcut capture field is recording", () => {
    const event = keyEvent({ code: "KeyT", key: "t", altKey: true });
    expect(
      matchRepositoryActionShortcut(event, {
        terminalShortcut: "Alt+KeyT",
        editorShortcut: "",
        shortcutCaptureListening: true,
      }),
    ).toBeNull();
  });

  test("prefers the terminal binding when both chords match", () => {
    const event = keyEvent({ code: "KeyT", key: "t", altKey: true });
    expect(
      matchRepositoryActionShortcut(event, {
        terminalShortcut: "Alt+KeyT",
        editorShortcut: "Alt+KeyT",
        shortcutCaptureListening: false,
      }),
    ).toBe("terminal");
  });
});

describe("consumeRepositoryActionShortcut", () => {
  test("drops a repeated action within the dedupe window", () => {
    resetRepositoryActionShortcutDedupeForTests();
    expect(consumeRepositoryActionShortcut("terminal", 1_000)).toBe(true);
    expect(consumeRepositoryActionShortcut("terminal", 1_200)).toBe(false);
    expect(consumeRepositoryActionShortcut("editor", 1_200)).toBe(true);
    expect(consumeRepositoryActionShortcut("terminal", 1_500)).toBe(true);
  });
});
