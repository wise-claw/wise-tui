import { describe, expect, it } from "bun:test";
import {
  isTerminalThemeMode,
  parseTerminalThemeMode,
  resolveTerminalDark,
} from "./terminalThemeMode";

describe("isTerminalThemeMode / parseTerminalThemeMode", () => {
  it("accepts follow / light / dark", () => {
    expect(isTerminalThemeMode("follow")).toBe(true);
    expect(isTerminalThemeMode("light")).toBe(true);
    expect(isTerminalThemeMode("dark")).toBe(true);
    expect(isTerminalThemeMode("system")).toBe(false);
    expect(isTerminalThemeMode(null)).toBe(false);
  });

  it("falls back to follow for unknown values", () => {
    expect(parseTerminalThemeMode("dark")).toBe("dark");
    expect(parseTerminalThemeMode("nope")).toBe("follow");
    expect(parseTerminalThemeMode(undefined)).toBe("follow");
  });
});

describe("resolveTerminalDark", () => {
  it("forces light and dark", () => {
    expect(resolveTerminalDark("light", true)).toBe(false);
    expect(resolveTerminalDark("dark", false)).toBe(true);
  });

  it("follows app appearance when mode is follow", () => {
    expect(resolveTerminalDark("follow", true)).toBe(true);
    expect(resolveTerminalDark("follow", false)).toBe(false);
  });
});
