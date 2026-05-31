import { describe, expect, test } from "bun:test";
import { sdkMessageToClaudeStreamLines } from "./cursorSdkStream.ts";

describe("sdkMessageToClaudeStreamLines", () => {
  test("maps assistant text blocks", () => {
    const lines = sdkMessageToClaudeStreamLines({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
      },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe("assistant");
  });

  test("maps tool_call running and completed", () => {
    const running = sdkMessageToClaudeStreamLines({
      type: "tool_call",
      call_id: "call-1",
      name: "Read",
      status: "running",
      args: { path: "README.md" },
    });
    expect(running[0]?.message).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call-1",
          name: "Read",
          input: { path: "README.md" },
        },
      ],
    });

    const done = sdkMessageToClaudeStreamLines({
      type: "tool_call",
      call_id: "call-1",
      name: "Read",
      status: "completed",
      result: "file contents",
    });
    expect(done[0]?.type).toBe("user");
  });
});
