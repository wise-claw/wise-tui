import { describe, expect, test } from "bun:test";
import {
  extractInitSessionIdFromInvocationStdoutLines,
  extractPartsFromStreamLine,
  extractSystemErrorMessageFromStreamLine,
  parseStreamLineSessionId,
} from "./claudeStreamParser";

describe("extractPartsFromStreamLine", () => {
  test("parses init lines and trims the session id", () => {
    const result = extractPartsFromStreamLine(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "  sid-1  ",
    }));

    expect(result.isInit).toBe(true);
    expect(result.sessionId).toBe("sid-1");
    expect(result.parts).toEqual([]);
  });

  test("unwraps stream_event envelopes before parsing assistant parts", () => {
    const result = extractPartsFromStreamLine(JSON.stringify({
      type: "stream_event",
      event: {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "reasoning" },
            { type: "text", text: "hello" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file: "README.md" } },
          ],
        },
      },
    }));

    expect(result.isInit).toBe(false);
    expect(result.parts).toHaveLength(3);
    expect(result.parts[0]).toEqual({ type: "reasoning", text: "reasoning" });
    expect(result.parts[1]).toEqual({ type: "text", text: "hello" });
    expect(result.parts[2]).toMatchObject({
      type: "tool_use",
      id: "tool-1",
      name: "Read",
      status: "running",
    });
  });

  test("parses result and delta text variants", () => {
    expect(extractPartsFromStreamLine(JSON.stringify({ type: "result", result: "done" })).parts)
      .toEqual([{ type: "text", text: "done" }]);
    expect(extractPartsFromStreamLine(JSON.stringify({ delta: { text: "chunk" } })).parts)
      .toEqual([{ type: "text", text: "chunk" }]);
  });

  test("parses content_block_delta text_delta and thinking_delta", () => {
    expect(
      extractPartsFromStreamLine(
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "你好" } },
        }),
      ).parts,
    ).toEqual([{ type: "text", text: "你好" }]);

    expect(
      extractPartsFromStreamLine(
        JSON.stringify({
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "planning" },
        }),
      ).parts,
    ).toEqual([{ type: "reasoning", text: "planning" }]);
  });

  test("returns an empty parse result for malformed JSON", () => {
    expect(extractPartsFromStreamLine("{not-json")).toEqual({
      parts: [],
      isInit: false,
      sessionId: null,
    });
  });

  test("parses tool_result on user messages (Claude Code subagent completion)", () => {
    const result = extractPartsFromStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_sub_1",
              content: [{ type: "text", text: "子代理已完成" }],
            },
          ],
        },
      }),
    );

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      type: "tool_use",
      id: "toolu_sub_1",
      status: "completed",
      output: "子代理已完成",
    });
  });
});

describe("stream session id helpers", () => {
  test("extracts session id from wrapped stream lines", () => {
    const line = JSON.stringify({
      type: "stream_event",
      payload: { type: "assistant", sessionId: " sid-from-payload " },
    });

    expect(parseStreamLineSessionId(line)).toBe("sid-from-payload");
  });

  test("scans invocation stdout for the first usable session id", () => {
    const lines = [
      "plain startup text",
      JSON.stringify({ type: "assistant", message: { content: "no session" } }),
      JSON.stringify({ type: "system", subtype: "init", session_id: "sid-init" }),
      JSON.stringify({ session_id: "sid-later" }),
    ];

    expect(extractInitSessionIdFromInvocationStdoutLines(lines)).toBe("sid-init");
  });

  test("falls back to any stream session id when init is absent", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: "text" } }),
      JSON.stringify({ type: "stream_event", data: { session_id: "sid-any" } }),
    ];

    expect(extractInitSessionIdFromInvocationStdoutLines(lines)).toBe("sid-any");
  });
});

describe("extractSystemErrorMessageFromStreamLine", () => {
  test("formats hook response errors", () => {
    const message = extractSystemErrorMessageFromStreamLine(JSON.stringify({
      type: "system",
      subtype: "hook_response",
      outcome: "error",
      stderr: "hook failed",
    }));

    expect(message).toBe("Claude Hook 错误: hook failed");
  });

  test("ignores non-system and malformed lines", () => {
    expect(extractSystemErrorMessageFromStreamLine(JSON.stringify({ type: "assistant" }))).toBeNull();
    expect(extractSystemErrorMessageFromStreamLine("{not-json")).toBeNull();
  });

  test("ignores placeholder unknown system errors", () => {
    expect(
      extractSystemErrorMessageFromStreamLine(
        JSON.stringify({ type: "system", message: "unknown" }),
      ),
    ).toBeNull();
    expect(
      extractSystemErrorMessageFromStreamLine(
        JSON.stringify({ type: "system", error: "Unknown" }),
      ),
    ).toBeNull();
  });

  test("formats meaningful system errors", () => {
    expect(
      extractSystemErrorMessageFromStreamLine(
        JSON.stringify({ type: "system", message: "rate limit exceeded" }),
      ),
    ).toBe("Claude 系统错误: rate limit exceeded");
  });
});
