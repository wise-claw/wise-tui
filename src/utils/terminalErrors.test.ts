import { describe, expect, test } from "bun:test";
import { shouldIgnoreTerminalError } from "./terminalErrors";

describe("shouldIgnoreTerminalError", () => {
  test("ignores expected PTY disconnect errors", () => {
    expect(shouldIgnoreTerminalError(new Error("Terminal session not found: 0:abc"))).toBe(
      true,
    );
    expect(shouldIgnoreTerminalError(new Error("broken pipe"))).toBe(true);
  });

  test("does not ignore unexpected errors", () => {
    expect(shouldIgnoreTerminalError(new Error("permission denied"))).toBe(false);
  });
});
