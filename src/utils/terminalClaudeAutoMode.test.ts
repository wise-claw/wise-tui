import { describe, expect, test } from "bun:test";
import {
  CLAUDE_AUTO_MODE_TERMINAL_COMMAND,
  buildClaudeAutoModeTerminalInput,
} from "./terminalClaudeAutoMode";

describe("terminalClaudeAutoMode", () => {
  test("buildClaudeAutoModeTerminalInput appends newline for PTY", () => {
    expect(buildClaudeAutoModeTerminalInput()).toBe(`${CLAUDE_AUTO_MODE_TERMINAL_COMMAND}\n`);
  });
});
