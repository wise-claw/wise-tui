import { describe, expect, test } from "bun:test";
import { parseClaudeSessionJsonlLines } from "./claudeSessionJsonl";

describe("parseClaudeSessionJsonlLines — Write tool diagnostic preservation", () => {
  test("annotates assistant Write tool_use with empty input as suspected", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_w_1", name: "Write", input: {} },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([line]);
    expect(messages).toHaveLength(1);
    const part = messages[0]?.parts[0];
    expect(part).toMatchObject({
      type: "tool_use",
      name: "Write",
      diagnostics: {
        writeMissingFilePath: { suspected: true, confirmed: false },
      },
    });
  });

  test("annotates assistant Write tool_use with missing file_path key as suspected", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_w_2", name: "Write", input: { content: "x" } },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([line]);
    const part = messages[0]?.parts[0];
    expect((part as { diagnostics?: unknown }).diagnostics).toEqual({
      writeMissingFilePath: {
        suspected: true,
        confirmed: false,
        rawInput: { content: "x" },
      },
    });
  });

  test("does not annotate Write tool_use with file_path provided", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_w_3",
            name: "Write",
            input: { file_path: "/tmp/ok.ts", content: "x" },
          },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([line]);
    const part = messages[0]?.parts[0];
    expect((part as { diagnostics?: unknown }).diagnostics).toBeUndefined();
  });

  test("does not annotate non-Write tools with empty input", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_b_1", name: "Bash", input: {} },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([line]);
    const part = messages[0]?.parts[0];
    expect((part as { diagnostics?: unknown }).diagnostics).toBeUndefined();
  });

  test("skips malformed and empty lines without crashing", () => {
    expect(parseClaudeSessionJsonlLines([])).toEqual([]);
    expect(parseClaudeSessionJsonlLines(["", "  ", "not-json"])).toEqual([]);
  });
});
