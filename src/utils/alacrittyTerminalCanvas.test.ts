import { describe, expect, test } from "bun:test";
import {
  encodeTerminalKey,
  noteTerminalPaintDuration,
  releaseTerminalCanvas,
  resetTerminalPaintQuality,
  TERMINAL_DARK_PALETTE,
  TERMINAL_LIGHT_PALETTE,
  terminalDevicePixelRatio,
  terminalFallbackPalette,
  terminalRunNeedsPerGlyphPaint,
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

describe("releaseTerminalCanvas", () => {
  test("shrinks backing store and drops inline size on collapse", () => {
    const removed: string[] = [];
    const canvas = {
      width: 2400,
      height: 1600,
      style: {
        removeProperty: (name: string) => {
          removed.push(name);
        },
      },
    } as unknown as HTMLCanvasElement;

    releaseTerminalCanvas(canvas);

    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(removed).toEqual(["width", "height"]);
  });
});

describe("terminalDevicePixelRatio", () => {
  test("allows retina dpr up to 2 for sharpness", () => {
    resetTerminalPaintQuality();
    expect(terminalDevicePixelRatio(2)).toBe(2);
    expect(terminalDevicePixelRatio(3)).toBe(2);
    expect(terminalDevicePixelRatio(1)).toBe(1);
    expect(terminalDevicePixelRatio(0.5)).toBe(1);
  });

  test("noteTerminalPaintDuration drops dpr after sustained jank", () => {
    resetTerminalPaintQuality();
    expect(terminalDevicePixelRatio(2)).toBe(2);
    noteTerminalPaintDuration(30);
    expect(terminalDevicePixelRatio(2)).toBe(2);
    noteTerminalPaintDuration(30);
    expect(terminalDevicePixelRatio(2)).toBe(1);
  });
});

describe("terminalRunNeedsPerGlyphPaint", () => {
  test("ASCII runs can batch; CJK needs per-glyph", () => {
    expect(terminalRunNeedsPerGlyphPaint("hello")).toBe(false);
    expect(terminalRunNeedsPerGlyphPaint("a b")).toBe(false);
    expect(terminalRunNeedsPerGlyphPaint("你好")).toBe(true);
    expect(terminalRunNeedsPerGlyphPaint("hi，")).toBe(true);
  });
});

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

  test("ignores IME composition keydowns", () => {
    expect(encodeTerminalKey(keyEvent({ key: "c", isComposing: true }))).toBeNull();
    expect(
      encodeTerminalKey({
        key: "c",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        isComposing: false,
        keyCode: 229,
      } as KeyboardEvent),
    ).toBeNull();
    expect(
      encodeTerminalKey({
        key: "Process",
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        isComposing: false,
        keyCode: 229,
      } as KeyboardEvent),
    ).toBeNull();
  });
});

describe("terminal palette fallbacks", () => {
  test("dark matches Catppuccin Mocha hex used by Rust palette", () => {
    expect(TERMINAL_DARK_PALETTE.background).toBe("#1e1e2e");
    expect(TERMINAL_DARK_PALETTE.foreground).toBe("#cdd6f4");
    expect(TERMINAL_DARK_PALETTE.cursor).toBe("#f5e0dc");
  });

  test("light matches Catppuccin Latte hex used by Rust palette", () => {
    expect(TERMINAL_LIGHT_PALETTE.background).toBe("#eff1f5");
    expect(TERMINAL_LIGHT_PALETTE.foreground).toBe("#4c4f69");
    expect(TERMINAL_LIGHT_PALETTE.cursor).toBe("#dc8a78");
  });

  test("terminalFallbackPalette follows the resolved appearance", () => {
    expect(terminalFallbackPalette(true)).toBe(TERMINAL_DARK_PALETTE);
    expect(terminalFallbackPalette(false)).toBe(TERMINAL_LIGHT_PALETTE);
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
