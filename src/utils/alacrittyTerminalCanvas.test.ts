import { describe, expect, test } from "bun:test";
import {
  encodeTerminalKey,
  TERMINAL_DEFAULT_BACKGROUND,
  TERMINAL_DEFAULT_CURSOR,
  TERMINAL_DEFAULT_FOREGROUND,
  wheelDeltaToScrollLines,
} from "./alacrittyTerminalCanvas";

function keyEvent(partial: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: partial.key,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    metaKey: partial.metaKey ?? false,
    isComposing: partial.isComposing ?? false,
  } as KeyboardEvent;
}

describe("encodeTerminalKey", () => {
  test("maps enter/backspace/arrows", () => {
    expect(encodeTerminalKey(keyEvent({ key: "Enter" }))).toBe("\r");
    expect(encodeTerminalKey(keyEvent({ key: "Backspace" }))).toBe("\x7f");
    expect(encodeTerminalKey(keyEvent({ key: "ArrowUp" }))).toBe("\x1b[A");
  });

  test("maps printable and ctrl-c", () => {
    expect(encodeTerminalKey(keyEvent({ key: "a" }))).toBe("a");
    expect(encodeTerminalKey(keyEvent({ key: "c", ctrlKey: true }))).toBe("\x03");
  });

  test("ignores meta shortcuts", () => {
    expect(encodeTerminalKey(keyEvent({ key: "c", metaKey: true }))).toBeNull();
  });
});

describe("terminal theme constants", () => {
  test("matches Catppuccin Mocha hex used by Rust palette", () => {
    expect(TERMINAL_DEFAULT_BACKGROUND).toBe("#1e1e2e");
    expect(TERMINAL_DEFAULT_FOREGROUND).toBe("#cdd6f4");
    expect(TERMINAL_DEFAULT_CURSOR).toBe("#f5e0dc");
  });
});

describe("wheelDeltaToScrollLines", () => {
  test("pixel mode inverts browser deltaY", () => {
    expect(wheelDeltaToScrollLines({ deltaY: -30, deltaMode: 0 }, 15)).toBe(2);
    expect(wheelDeltaToScrollLines({ deltaY: 30, deltaMode: 0 }, 15)).toBe(-2);
  });

  test("line mode uses cell height", () => {
    expect(wheelDeltaToScrollLines({ deltaY: -3, deltaMode: 1 }, 15)).toBe(3);
  });
});
