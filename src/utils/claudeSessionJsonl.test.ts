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

describe("parseClaudeSessionJsonlLines — tool_result fold into assistant tool_use", () => {
  test("folds TaskUpdate tool_result into preceding assistant tool_use and drops user row", () => {
    const assistantLine = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_task_3",
            name: "TaskUpdate",
            input: { taskId: "3", status: "in_progress" },
          },
        ],
      },
      timestamp: 1,
    });
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_task_3",
            content: "Updated task #3 status",
          },
        ],
      },
      timestamp: 2,
    });

    const messages = parseClaudeSessionJsonlLines([assistantLine, userLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    const part = messages[0]?.parts[0];
    expect(part).toMatchObject({
      type: "tool_use",
      id: "toolu_task_3",
      name: "TaskUpdate",
      output: "Updated task #3 status",
      status: "completed",
    });
  });

  test("folds Bash tool_result and preserves command in input", () => {
    const assistantLine = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_bash_1",
            name: "Bash",
            input: { command: "git status" },
          },
        ],
      },
      timestamp: 1,
    });
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_bash_1",
            content: "On branch main",
          },
        ],
      },
      timestamp: 2,
    });

    const messages = parseClaudeSessionJsonlLines([assistantLine, userLine]);
    expect(messages).toHaveLength(1);
    const part = messages[0]?.parts[0];
    expect(part).toMatchObject({
      type: "tool_use",
      name: "Bash",
      input: { command: "git status" },
      output: "On branch main",
    });
  });

  test("keeps orphan tool_result user row when no matching tool_use id", () => {
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_orphan",
            content: "orphan output",
          },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([userLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.parts[0]).toMatchObject({
      type: "tool_use",
      id: "toolu_orphan",
      output: "orphan output",
    });
  });
});
