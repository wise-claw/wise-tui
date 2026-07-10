import { describe, expect, test } from "bun:test";
import {
  describeWriteInputDefect,
  extractCodexResumeSessionIdFromStreamLine,
  extractOpencodeResumeSessionIdFromStreamLine,
  extractInitSessionIdFromInvocationStdoutLines,
  extractCursorAgentIdFromCompletePayload,
  extractCursorAgentIdFromStreamLine,
  extractPartsFromStreamLine,
  extractResultErrorMessageFromStreamLine,
  extractSystemErrorMessageFromStreamLine,
  formatClaudeResultErrorForSessionUi,
  isClaudeHarnessInjectedStreamText,
  isClaudeToolCallParseFailureText,
  isClaudeToolInputValidationErrorText,
  parseStreamLineSessionId,
  shouldClearCodexResumeSessionFromStreamLine,
  shouldClearOpencodeResumeSessionFromStreamLine,
  stripClaudeHarnessInjectedStreamText,
} from "./claudeStreamParser";

describe("extractPartsFromStreamLine", () => {
  test("parses codex session bind and clear markers", () => {
    expect(
      extractCodexResumeSessionIdFromStreamLine(
        JSON.stringify({
          type: "codex_session",
          sessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
        }),
      ),
    ).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
    expect(
      shouldClearCodexResumeSessionFromStreamLine(
        JSON.stringify({ type: "codex_session", sessionId: "" }),
      ),
    ).toBe(true);
  });

  test("parses opencode session bind and clear markers", () => {
    expect(
      extractOpencodeResumeSessionIdFromStreamLine(
        JSON.stringify({
          type: "opencode_session",
          sessionId: "ses_abc123",
        }),
      ),
    ).toBe("ses_abc123");
    expect(
      shouldClearOpencodeResumeSessionFromStreamLine(
        JSON.stringify({ type: "opencode_session", sessionId: "" }),
      ),
    ).toBe(true);
  });

  test("parses cursor agent bind without treating it as Claude init", () => {
    expect(extractCursorAgentIdFromStreamLine(JSON.stringify({
      type: "cursor_agent",
      agentId: "agent-123",
    }))).toBe("agent-123");
    expect(extractPartsFromStreamLine(JSON.stringify({
      type: "cursor_agent",
      agentId: "agent-123",
    }))).toEqual({
      parts: [],
      isInit: false,
      sessionId: null,
    });
  });

  test("parses cursor complete payload agent id", () => {
    expect(extractCursorAgentIdFromCompletePayload({
      sessionId: "tab-1",
      success: true,
      cursorAgentId: "agent-456",
    })).toBe("agent-456");
  });

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

  test("formats tool parse failure for session UI in Chinese", () => {
    expect(
      formatClaudeResultErrorForSessionUi(
        "The model's tool call could not be parsed (retry also failed)",
      ),
    ).toContain("模型工具调用无法解析");
  });

  test("does not treat result is_error as assistant text", () => {
    const line = JSON.stringify({
      type: "result",
      is_error: true,
      result: "The model's tool call could not be parsed (retry also failed)",
    });
    expect(extractPartsFromStreamLine(line)).toEqual({
      parts: [],
      isInit: false,
      sessionId: null,
    });
    expect(extractResultErrorMessageFromStreamLine(line)).toBe(
      "The model's tool call could not be parsed (retry also failed)",
    );
    expect(isClaudeToolCallParseFailureText("The model's tool call could not be parsed (retry also failed)")).toBe(true);
  });

  test("strips CLI harness retry text from assistant stream and ignores user echo", () => {
    const harness = "Your tool call was malformed and could not be parsed. Please retry.";
    expect(isClaudeHarnessInjectedStreamText(harness)).toBe(true);
    expect(stripClaudeHarnessInjectedStreamText(`它的结构。 ${harness}`)).toBe("它的结构。");
    expect(
      extractPartsFromStreamLine(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "text", text: harness }] },
        }),
      ).parts,
    ).toEqual([]);
    expect(
      extractPartsFromStreamLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: `让我 ${harness} check files` }],
          },
        }),
      ).parts,
    ).toEqual([{ type: "text", text: "让我 check files" }]);
  });

  test("REGRESSION: preserves paragraph breaks (\\n\\n) in normal assistant text", () => {
    // 普通助手回复（无 CLI 注入文案）的 \n\n 段落分隔必须原样保留，
    // 否则实时流式文本会被压成单空格、段落粘连（刷新磁盘态不经此函数反而清晰）。
    const normal = "第一段结论。\n\n第二段分析。\n\n- 列表项一\n- 列表项二";
    expect(stripClaudeHarnessInjectedStreamText(normal)).toBe(normal);
    const multiBlank = "para one\n\n\n\npara two";
    expect(stripClaudeHarnessInjectedStreamText(multiBlank)).toBe(multiBlank);
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

  test("content_block_start(text) signals new text block boundary", () => {
    expect(
      extractPartsFromStreamLine(
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_start",
            content_block: { type: "text", text: "" },
          },
        }),
      ),
    ).toEqual({
      parts: [],
      isInit: false,
      sessionId: null,
      startNewTextBlock: true,
    });
  });

  test("content_block_start(thinking) signals new reasoning block boundary", () => {
    expect(
      extractPartsFromStreamLine(
        JSON.stringify({
          type: "content_block_start",
          content_block: { type: "thinking", thinking: "" },
        }),
      ),
    ).toEqual({
      parts: [],
      isInit: false,
      sessionId: null,
      startNewReasoningBlock: true,
    });
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

  test("stores tool_result is_error only on error field (not duplicated in output)", () => {
    const result = extractPartsFromStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_fail_1",
              is_error: true,
              content: [{ type: "text", text: "File does not exist." }],
            },
          ],
        },
      }),
    );

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      type: "tool_use",
      id: "toolu_fail_1",
      status: "error",
      output: "",
      error: "File does not exist.",
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
  test("ignores hook_started progress events", () => {
    expect(
      extractSystemErrorMessageFromStreamLine(
        JSON.stringify({ type: "system", subtype: "hook_started", hook_name: "SessionStart:startup" }),
      ),
    ).toBeNull();
  });

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
    ).toBe("Claude 系统错误: 请求频率超限，请稍后重试（rate limit exceeded）");
  });
});

describe("Write tool input validation diagnostics", () => {
  const validationErrorText =
    "<tool_use_error>InputValidationError: Write failed due to the following issue: The required parameter `file_path` is missing</tool_use_error>";

  test("describeWriteInputDefect flags missing/empty file_path but not other tools", () => {
    expect(describeWriteInputDefect(undefined).suspected).toBe(true);
    expect(describeWriteInputDefect(null).suspected).toBe(true);
    expect(describeWriteInputDefect({}).suspected).toBe(true);
    expect(describeWriteInputDefect({ content: "x" }).suspected).toBe(true);
    expect(describeWriteInputDefect({ file_path: "" }).suspected).toBe(true);
    expect(describeWriteInputDefect({ file_path: "/tmp/a.ts" }).suspected).toBe(false);
    expect(describeWriteInputDefect("not-an-object").suspected).toBe(false);
    expect(describeWriteInputDefect(["array"]).suspected).toBe(false);
  });

  test("isClaudeToolInputValidationErrorText recognizes the Write/file_path pattern", () => {
    expect(isClaudeToolInputValidationErrorText(validationErrorText)).toEqual({
      kind: "write-missing-file_path",
      raw: validationErrorText,
    });
    expect(
      isClaudeToolInputValidationErrorText(
        "<tool_use_error>InputValidationError: Bash failed ... some other field missing</tool_use_error>",
      ),
    ).toBeNull();
    expect(isClaudeToolInputValidationErrorText("")).toBeNull();
    expect(isClaudeToolInputValidationErrorText("plain text")).toBeNull();
  });

  test("assistant Write tool_use without file_path attaches suspected diagnostic", () => {
    const result = extractPartsFromStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "toolu_write_1", name: "Write", input: {} },
          ],
        },
      }),
    );

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      type: "tool_use",
      id: "toolu_write_1",
      name: "Write",
      status: "running",
      diagnostics: { writeMissingFilePath: { suspected: true, confirmed: false } },
    });
  });

  test("assistant Write tool_use with file_path does not attach diagnostic", () => {
    const result = extractPartsFromStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "toolu_write_2",
              name: "Write",
              input: { file_path: "/tmp/x.ts", content: "console.log(1)" },
            },
          ],
        },
      }),
    );

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ type: "tool_use", name: "Write" });
    expect((result.parts[0] as { diagnostics?: unknown }).diagnostics).toBeUndefined();
  });

  test("user tool_result with InputValidationError attaches confirmed diagnostic", () => {
    const result = extractPartsFromStreamLine(
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_write_1",
              is_error: true,
              content: [{ type: "text", text: validationErrorText }],
            },
          ],
        },
      }),
    );

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      type: "tool_use",
      id: "toolu_write_1",
      status: "error",
      diagnostics: {
        writeMissingFilePath: { suspected: true, confirmed: true },
      },
    });
  });

  test("formatClaudeResultErrorForSessionUi renders Chinese hint for Write/file_path validation error", () => {
    const out = formatClaudeResultErrorForSessionUi(validationErrorText);
    expect(out).toContain("Write 工具缺少 file_path");
    expect(out).toContain("~/.claude/settings.json");
  });

  test("formatClaudeResultErrorForSessionUi still falls through to generic wrap for unrelated errors", () => {
    const out = formatClaudeResultErrorForSessionUi("Some other failure");
    expect(out).toBe("Claude 轮次失败: Some other failure");
  });
});
