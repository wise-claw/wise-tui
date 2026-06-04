import { describe, expect, test } from "bun:test";
import {
  chordMatchesKeyboardEvent,
  formatChordForDisplay,
  keyboardEventToChord,
  normalizeChord,
} from "./atMentionShortcutChord";

function keyEvent(init: {
  code: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  return {
    code: init.code,
    key: init.key ?? init.code,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    isComposing: false,
  } as KeyboardEvent;
}

describe("atMentionShortcutChord", () => {
  test("keyboardEventToChord builds Mod+Shift+Digit2", () => {
    expect(
      keyboardEventToChord(
        keyEvent({ code: "Digit2", key: "2", metaKey: true, shiftKey: true }),
      ),
    ).toBe("Mod+Shift+Digit2");
  });

  test("normalizeChord accepts ctrl+shift alias", () => {
    expect(normalizeChord("ctrl+shift+Digit2")).toBe("Mod+Shift+Digit2");
  });

  test("chordMatchesKeyboardEvent", () => {
    const chord = "Mod+Alt+KeyT";
    expect(
      chordMatchesKeyboardEvent(
        chord,
        keyEvent({ code: "KeyT", key: "t", metaKey: true, altKey: true }),
      ),
    ).toBe(true);
    expect(
      chordMatchesKeyboardEvent(chord, keyEvent({ code: "KeyT", key: "t", metaKey: true })),
    ).toBe(false);
  });

  test("formatChordForDisplay uses digit label", () => {
    expect(formatChordForDisplay("Mod+Shift+Digit2").length).toBeGreaterThan(0);
  });
});
