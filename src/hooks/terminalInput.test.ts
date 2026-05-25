import { describe, expect, test } from "bun:test";
import {
  applyInputToDraft,
  commitDraftToHistory,
  historyEntryAt,
  normalizeTerminalCommandInput,
  pickCommandSuggestion,
  suggestionSuffix,
  TERMINAL_KEY_BYTES,
} from "./terminalInput";

describe("applyInputToDraft", () => {
  test("appends printable input", () => {
    expect(applyInputToDraft("git", " ")).toBe("git ");
    expect(applyInputToDraft("git ", "s")).toBe("git s");
  });

  test("backspace removes last character", () => {
    expect(applyInputToDraft("ls", TERMINAL_KEY_BYTES.backspace)).toBe("l");
  });

  test("ctrl-u clears draft", () => {
    expect(applyInputToDraft("npm test", TERMINAL_KEY_BYTES.killLine)).toBe("");
  });

  test("ctrl-w removes last word", () => {
    expect(applyInputToDraft("git status", TERMINAL_KEY_BYTES.killWord)).toBe("git ");
  });

  test("enter clears draft", () => {
    expect(applyInputToDraft("bun test", TERMINAL_KEY_BYTES.enter)).toBe("");
  });
});

describe("normalizeTerminalCommandInput", () => {
  test("strips simple prompt prefix", () => {
    expect(normalizeTerminalCommandInput("> ls")).toBe("ls");
    expect(normalizeTerminalCommandInput("  > git status")).toBe("git status");
  });

  test("strips other common prompts", () => {
    expect(normalizeTerminalCommandInput("$ echo hi")).toBe("echo hi");
    expect(normalizeTerminalCommandInput("❯ bun test")).toBe("bun test");
  });
});

describe("command history", () => {
  test("commitDraftToHistory stores command only", () => {
    const next = commitDraftToHistory(["ls", "pwd"], "> ls");
    expect(next).toEqual(["pwd", "ls"]);
  });

  test("commitDraftToHistory dedupes and caps", () => {
    const next = commitDraftToHistory(["ls", "pwd"], "ls");
    expect(next).toEqual(["pwd", "ls"]);
  });

  test("pickCommandSuggestion returns latest prefix match", () => {
    const history = ["git pull", "git status", "bun test"];
    expect(pickCommandSuggestion(history, "git s")).toBe("git status");
    expect(pickCommandSuggestion(history, "> git s")).toBe("git status");
    expect(pickCommandSuggestion(history, "npm")).toBeNull();
  });

  test("suggestionSuffix returns remainder", () => {
    expect(suggestionSuffix("git status", "git s")).toBe("tatus");
    expect(suggestionSuffix("git status", "> git s")).toBe("tatus");
  });

  test("historyEntryAt walks from end", () => {
    expect(historyEntryAt(["a", "b", "c"], 0)).toBe("c");
    expect(historyEntryAt(["a", "b", "c"], 2)).toBe("a");
    expect(historyEntryAt(["a"], 3)).toBeNull();
  });
});
