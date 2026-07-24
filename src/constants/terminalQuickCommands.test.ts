import { describe, expect, test } from "bun:test";
import {
  buildTerminalQuickCommandInput,
  createTerminalQuickCommand,
  parseTerminalQuickCommands,
  terminalQuickCommandLabel,
} from "./terminalQuickCommands";

describe("terminalQuickCommands", () => {
  test("buildTerminalQuickCommandInput appends newline", () => {
    expect(buildTerminalQuickCommandInput("ls -la")).toBe("ls -la\n");
    expect(buildTerminalQuickCommandInput("pwd\n")).toBe("pwd\n");
  });

  test("createTerminalQuickCommand rejects empty command", () => {
    expect(createTerminalQuickCommand({ command: "  " })).toBeNull();
    const item = createTerminalQuickCommand({
      title: " 状态 ",
      command: "  git status  ",
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe("状态");
    expect(item!.command).toBe("git status");
    expect(item!.id.length).toBeGreaterThan(0);
  });

  test("parseTerminalQuickCommands drops invalid entries", () => {
    expect(parseTerminalQuickCommands(null)).toEqual([]);
    const parsed = parseTerminalQuickCommands([
      { id: "a", title: "A", command: "echo a" },
      { id: "b", title: "", command: "  " },
      { title: "C", command: "echo c" },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "a", title: "A", command: "echo a" });
    expect(parsed[1]!.command).toBe("echo c");
    expect(parsed[1]!.id.length).toBeGreaterThan(0);
  });

  test("terminalQuickCommandLabel falls back to command", () => {
    expect(
      terminalQuickCommandLabel({ id: "1", title: "拉取", command: "git pull" }),
    ).toBe("拉取");
    expect(
      terminalQuickCommandLabel({ id: "2", title: "", command: "pwd" }),
    ).toBe("pwd");
  });
});
