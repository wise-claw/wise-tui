import { describe, expect, test } from "bun:test";
import { sanitizeTerminalPtyOutput } from "./terminalSanitize";

describe("sanitizeTerminalPtyOutput", () => {
  test("strips kitty keyboard push sequences", () => {
    expect(sanitizeTerminalPtyOutput("\x1b[>6;5uhello")).toBe("hello");
  });

  test("strips kitty key event suffixes", () => {
    expect(sanitizeTerminalPtyOutput("prefix\x1b[99;5u suffix")).toBe("prefix suffix");
  });

  test("preserves normal text and SGR color sequences", () => {
    const colored = "ok\x1b[31mred\x1b[0m";
    expect(sanitizeTerminalPtyOutput(colored)).toBe(colored);
  });

  test("strips bracketed paste DECSET sequences", () => {
    expect(sanitizeTerminalPtyOutput("\x1b[?2004hprompt")).toBe("prompt");
    expect(sanitizeTerminalPtyOutput("?\x1b[?2004l")).toBe("?");
  });

  test("strips orphan bracketed paste fragments without ESC", () => {
    expect(sanitizeTerminalPtyOutput("?2004h")).toBe("");
    expect(sanitizeTerminalPtyOutput("?2004l\nok")).toBe("\nok");
  });
});
