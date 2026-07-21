import { describe, expect, test } from "bun:test";
import {
  forceTerminalFullRedraw,
  TERMINAL_BLANK_RECOVERY_DELAYS_MS,
  TERMINAL_LAYOUT_SETTLE_DELAYS_MS,
} from "./terminalTheme";

describe("terminalTheme layout settle helpers", () => {
  test("layout settle delays are non-empty ascending", () => {
    expect(TERMINAL_BLANK_RECOVERY_DELAYS_MS.length).toBeGreaterThan(0);
    expect([...TERMINAL_BLANK_RECOVERY_DELAYS_MS]).toEqual([
      ...TERMINAL_LAYOUT_SETTLE_DELAYS_MS,
    ]);
    for (let i = 1; i < TERMINAL_BLANK_RECOVERY_DELAYS_MS.length; i += 1) {
      expect(TERMINAL_BLANK_RECOVERY_DELAYS_MS[i]!).toBeGreaterThan(
        TERMINAL_BLANK_RECOVERY_DELAYS_MS[i - 1]!,
      );
    }
  });

  test("forceTerminalFullRedraw is a no-op without renderer", () => {
    const terminal = {
      renderer: undefined,
      wasmTerm: undefined,
      getViewportY: () => 0,
    };
    expect(() =>
      forceTerminalFullRedraw(terminal as Parameters<typeof forceTerminalFullRedraw>[0]),
    ).not.toThrow();
  });

  test("forceTerminalFullRedraw calls renderer.render with forceAll", () => {
    const calls: unknown[][] = [];
    const wasmTerm = { id: "wasm" };
    const terminal = {
      renderer: {
        render: (...args: unknown[]) => {
          calls.push(args);
        },
      },
      wasmTerm,
      getViewportY: () => 3,
    };
    forceTerminalFullRedraw(terminal as Parameters<typeof forceTerminalFullRedraw>[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe(wasmTerm);
    expect(calls[0]![1]).toBe(true);
    expect(calls[0]![2]).toBe(3);
    expect(calls[0]![3]).toBe(terminal);
  });
});
