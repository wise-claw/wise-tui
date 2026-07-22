import { describe, expect, test } from "bun:test";
import { encodeTerminalKey } from "./alacrittyTerminalCanvas";

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
