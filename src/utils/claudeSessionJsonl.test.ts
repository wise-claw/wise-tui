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
    // 关键：孤儿 user 消息的 `content` 不能再承载 stdout，避免下游把它当用户正文渲染。
    expect(messages[0]?.content).toBe("");
  });

  test("does not pollute content when user message contains only tool_result block", () => {
    // 复盘：用户上报的 JSONL 形态——单条 user 消息只含一个 tool_result 块，
    // 且该 tool_use_id 在前一条 assistant 里找不到匹配（历史 session 丢失了
    // 对应 tool_use）。修复前 content 字段会被填入 stdout；修复后必须留空。
    const stdoutTable = [
      "      #     | IID  |  TITLE  | CREATOR | URL",
      "------------+------+---------+---------+----",
      "  435576195 | 2756 | feat-fh | 铮睿    | https://example/pr/2756",
    ].join("\n");
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_function_ubbktg42s6tw_1",
            content: stdoutTable,
            is_error: false,
          },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([userLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("");
    expect(messages[0]?.parts).toHaveLength(1);
    // 关键：tool_result 解析后 stdout 的实质内容必须保留到 part.output
    // （前导空白会被解析侧 .trim() 剥掉，是历史行为，不是本修复目标）。
    const part0 = messages[0]?.parts[0] as { output?: string };
    expect(part0).toMatchObject({
      type: "tool_use",
      id: "call_function_ubbktg42s6tw_1",
      status: "completed",
    });
    expect(part0.output).toContain("#     | IID  |  TITLE");
    expect(part0.output).toContain("435576195 | 2756 | feat-fh | 铮睿");
  });

  test("preserves user text content when user message mixes text + tool_result blocks", () => {
    // 边界：content 数组里 text 块 + tool_result 块共存（罕见但合法，例如用户
    // 文本提问附带一个工具结果引用），`content` 必须取 text 块 join，tool_result
    // 仍落到 parts 由 ToolUsePartDisplay 渲染。
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: "看下这个 PR" },
          {
            type: "tool_result",
            tool_use_id: "toolu_mix_1",
            content: "PR #2756 status: open",
          },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([userLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("看下这个 PR");
    expect(messages[0]?.parts).toHaveLength(2);
    expect(messages[0]?.parts[0]).toMatchObject({ type: "text", text: "看下这个 PR" });
    expect(messages[0]?.parts[1]).toMatchObject({
      type: "tool_use",
      id: "toolu_mix_1",
      output: "PR #2756 status: open",
    });
  });

  test("marks tool_result part status as error when is_error is true", () => {
    // 边界：tool_result.is_error=true 时，ToolUsePart.status 必须是 error，error 字段带原文。
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_err_1",
            content: "<tool_use_error>InputValidationError: Write failed ... file_path is missing</tool_use_error>",
            is_error: true,
          },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([userLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("");
    const part = messages[0]?.parts[0];
    expect(part).toMatchObject({
      type: "tool_use",
      id: "toolu_err_1",
      status: "error",
    });
    expect((part as { error?: string }).error).toContain("InputValidationError");
  });

  test("truncates oversized tool_result output for parts but still leaves content empty", () => {
    // 边界：超长 stdout 在解析侧被截到 4000 字符，但 user 消息 content 字段
    // 必须仍然为空（不要再回到「拿 stdout 当 user content」的反模式）。
    const oversized = "x".repeat(8_000);
    const userLine = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_big", content: oversized },
        ],
      },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([userLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("");
    const part = messages[0]?.parts[0] as { output?: string };
    expect(part.output?.length).toBeLessThanOrEqual(4_001); // 4000 + "…"
  });
});

describe("parseClaudeSessionJsonlLines — compact summary skipping", () => {
  test("skips isCompactSummary user message (上万字压缩恢复 summary 不进 UI)", () => {
    const compactLine = JSON.stringify({
      type: "user",
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
      message: {
        role: "user",
        content:
          "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request and Intent: ...",
      },
      timestamp: 1,
    });
    const normalLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: "帮我看下这个按钮" },
      timestamp: 2,
    });

    const messages = parseClaudeSessionJsonlLines([compactLine, normalLine]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toBe("帮我看下这个按钮");
  });

  test("still keeps ordinary user text message without isCompactSummary", () => {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "继续上面的重构" },
      timestamp: 1,
    });
    const messages = parseClaudeSessionJsonlLines([line]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("继续上面的重构");
  });
});

describe("parseClaudeSessionJsonlLines — uuid 去重", () => {
  test("同一 uuid 的 user 文本消息重复写入只保留一条", () => {
    const dupUuid = "11111111-2222-3333-4444-555555555555";
    const line1 = JSON.stringify({
      type: "user",
      uuid: dupUuid,
      message: { role: "user", content: "第一条" },
      timestamp: 1,
    });
    // 同 uuid 字节级重放（compact/resume 后常见）
    const line2 = JSON.stringify({
      type: "user",
      uuid: dupUuid,
      message: { role: "user", content: "第一条" },
      timestamp: 1,
    });
    const other = JSON.stringify({
      type: "user",
      uuid: "22222222-3333-4444-5555-666666666666",
      message: { role: "user", content: "第二条" },
      timestamp: 2,
    });

    const messages = parseClaudeSessionJsonlLines([line1, line2, other]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.content).toBe("第一条");
    expect(messages[1]?.content).toBe("第二条");
  });

  test("同一 uuid 的 assistant 消息重复写入只保留一条", () => {
    const dupUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const line1 = JSON.stringify({
      type: "assistant",
      uuid: dupUuid,
      message: { role: "assistant", content: [{ type: "text", text: "回复A" }] },
      timestamp: 1,
    });
    const line2 = JSON.stringify({
      type: "assistant",
      uuid: dupUuid,
      message: { role: "assistant", content: [{ type: "text", text: "回复A" }] },
      timestamp: 1,
    });

    const messages = parseClaudeSessionJsonlLines([line1, line2]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("assistant");
    expect(messages[0]?.content).toBe("回复A");
  });

  test("无 uuid 的行不去重，保持原样（老格式兼容）", () => {
    const line1 = JSON.stringify({
      type: "user",
      message: { role: "user", content: "无uuid第一条" },
      timestamp: 1,
    });
    const line2 = JSON.stringify({
      type: "user",
      message: { role: "user", content: "无uuid第一条" },
      timestamp: 1,
    });
    const messages = parseClaudeSessionJsonlLines([line1, line2]);
    // 无 uuid 无法判定重复，保留两条（与历史行为一致，不回归）
    expect(messages).toHaveLength(2);
  });
});
