import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import { foldToolResultUserMessagesIntoAssistant } from "../services/claudeStreamAssembler";
import {
  buildChatMessageListRows,
  shouldShowListEndThinkingHint,
  tryPatchChatMessageListRowsTail,
} from "./claudeChatMessageListRows";

function msg(partial: Partial<ClaudeMessage> & Pick<ClaudeMessage, "id" | "role">): ClaudeMessage {
  return {
    id: partial.id,
    role: partial.role,
    content: partial.content ?? "",
    timestamp: partial.timestamp ?? Date.now(),
    parts: partial.parts,
  };
}

describe("shouldShowListEndThinkingHint", () => {
  test("shows when running and last message is user", () => {
    expect(
      shouldShowListEndThinkingHint([msg({ id: 1, role: "user", content: "hi" })], "running"),
    ).toBe(true);
  });

  test("hides when idle", () => {
    expect(
      shouldShowListEndThinkingHint([msg({ id: 1, role: "user", content: "hi" })], "idle"),
    ).toBe(false);
  });

  test("hides when running but turn already failed with system notice", () => {
    expect(
      shouldShowListEndThinkingHint(
        [
          msg({ id: 1, role: "user", content: "hi" }),
          msg({ id: 2, role: "assistant", content: "partial" }),
          msg({ id: 3, role: "system", content: "Claude 轮次失败: tool parse failed" }),
        ],
        "running",
      ),
    ).toBe(false);
  });

  test("hides when last assistant is streaming non-empty reasoning (preview already indicates thinking)", () => {
    expect(
      shouldShowListEndThinkingHint(
        [
          msg({ id: 1, role: "user", content: "hi" }),
          msg({
            id: 2,
            role: "assistant",
            parts: [{ type: "reasoning", text: "让我想想这个问题" }],
          }),
        ],
        "running",
      ),
    ).toBe(false);
  });

  test("shows when last assistant reasoning is blank (just started, no preview yet)", () => {
    expect(
      shouldShowListEndThinkingHint(
        [
          msg({ id: 1, role: "user", content: "hi" }),
          msg({
            id: 2,
            role: "assistant",
            parts: [{ type: "reasoning", text: "   " }],
          }),
        ],
        "running",
      ),
    ).toBe(true);
  });

  test("shows when last assistant's final renderable part is text (not reasoning)", () => {
    expect(
      shouldShowListEndThinkingHint(
        [
          msg({ id: 1, role: "user", content: "hi" }),
          msg({
            id: 2,
            role: "assistant",
            parts: [
              { type: "reasoning", text: "思考完毕" },
              { type: "text", text: "答案是" },
            ],
          }),
        ],
        "running",
      ),
    ).toBe(true);
  });
});

describe("buildChatMessageListRows", () => {
  test("skips empty assistant noise and appends thinking hint", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hello" }),
      msg({ id: 2, role: "assistant", content: "no response requested." }),
      msg({ id: 3, role: "assistant", content: "world" }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "running",
      showListEndThinkingHint: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(["message", "message", "thinking-hint"]);
    expect(rows[0]!.kind === "message" && rows[0]!.msg.id).toBe(1);
    expect(rows[1]!.kind === "message" && rows[1]!.streamingThisBubble).toBe(true);
  });

  test("skips assistant rows with no visible body", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "开始" }),
      msg({ id: 2, role: "assistant", content: "", parts: [{ type: "text", text: "" }] }),
      msg({
        id: 3,
        role: "system",
        content: "InputValidationError: EnterPlanMode failed",
      }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => (row.kind === "message" ? row.msg.id : row.kind))).toEqual([1, 3]);
  });

  test("merges consecutive same-sender rows", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "a" }),
      msg({ id: 2, role: "user", content: "b" }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind === "message" && rows[0]!.mergedWithPrevious).toBe(false);
    expect(rows[1]!.kind === "message" && rows[1]!.mergedWithPrevious).toBe(true);
  });

  test("folds absorbed tool_result user rows before building list rows", () => {
    const messages = [
      msg({
        id: 1,
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool_use",
            id: "toolu_task_3",
            name: "TaskUpdate",
            input: { taskId: "3" },
            status: "completed",
          },
        ],
      }),
      msg({
        id: 2,
        role: "user",
        content: "Updated task #3 status",
        parts: [
          {
            type: "tool_use",
            id: "toolu_task_3",
            name: "",
            input: {},
            output: "Updated task #3 status",
            status: "completed",
          },
        ],
      }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind === "message" && rows[0]!.msg.role).toBe("assistant");
    const part = rows[0]!.kind === "message" ? rows[0]!.msg.parts[0] : null;
    expect(part).toMatchObject({
      type: "tool_use",
      name: "TaskUpdate",
      output: "Updated task #3 status",
    });
  });

  test("appends files-changed-summary after idle turn with file edits", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "edit", timestamp: 10 }),
      msg({
        id: 2,
        role: "assistant",
        content: "done",
        timestamp: 11,
        parts: [
          {
            type: "tool_use",
            id: "w1",
            name: "Write",
            status: "completed",
            input: { file_path: "/repo/a.ts", content: "x\ny" },
            output: "",
          },
          { type: "text", text: "done" },
        ],
      }),
    ];
    const idleRows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(idleRows.map((r) => r.kind)).toEqual(["message", "message", "files-changed-summary"]);
    expect(idleRows[2]!.kind === "files-changed-summary" && idleRows[2]!.files[0]!.fileName).toBe(
      "a.ts",
    );

    const runningRows = buildChatMessageListRows(messages, {
      sessionStatus: "running",
      showListEndThinkingHint: false,
    });
    expect(runningRows.map((r) => r.kind)).toEqual(["message", "message"]);
  });
});

describe("tryPatchChatMessageListRowsTail", () => {
  test("reuses prefix rows when only the last message changes", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hello" }),
      msg({ id: 2, role: "assistant", content: "world" }),
    ];
    const options = { sessionStatus: "running" as const, showListEndThinkingHint: true };
    const initialRows = buildChatMessageListRows(messages, options);
    const prevFolded = foldToolResultUserMessagesIntoAssistant(messages);
    const nextMessages = [
      messages[0]!,
      msg({ id: 2, role: "assistant", content: "world!" }),
    ];
    const patched = tryPatchChatMessageListRowsTail(
      messages,
      nextMessages,
      initialRows,
      options,
      prevFolded,
    );
    expect(patched).not.toBeNull();
    expect(patched!.rows[0]).toBe(initialRows[0]);
    expect(patched!.rows[1]!.kind === "message" && patched!.rows[1]!.msg.content).toBe("world!");
    expect(patched!.rows.map((row) => row.kind)).toEqual(["message", "message", "thinking-hint"]);
  });

  test("returns null when a prefix message reference changes", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hello" }),
      msg({ id: 2, role: "assistant", content: "world" }),
    ];
    const options = { sessionStatus: "idle" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(messages, options);
    const nextMessages = [
      msg({ id: 1, role: "user", content: "hello!" }),
      messages[1]!,
    ];
    expect(
      tryPatchChatMessageListRowsTail(messages, nextMessages, initialRows, options),
    ).toBeNull();
  });

  test("returns null when message count changes", () => {
    const messages = [msg({ id: 1, role: "user", content: "hello" })];
    const options = { sessionStatus: "idle" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(messages, options);
    const nextMessages = [
      messages[0]!,
      msg({ id: 2, role: "assistant", content: "world" }),
    ];
    expect(
      tryPatchChatMessageListRowsTail(messages, nextMessages, initialRows, options),
    ).toBeNull();
  });

  test("early-returns same rows and folded when messages reference unchanged", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hello" }),
      msg({ id: 2, role: "assistant", content: "world" }),
    ];
    const options = { sessionStatus: "idle" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(messages, options);
    const prevFolded = foldToolResultUserMessagesIntoAssistant(messages);
    const patched = tryPatchChatMessageListRowsTail(
      messages,
      messages,
      initialRows,
      options,
      prevFolded,
    );
    expect(patched).not.toBeNull();
    expect(patched!.rows).toHaveLength(initialRows.length);
    expect(patched!.rows[0]).toBe(initialRows[0]);
    expect(patched!.folded).toEqual(prevFolded);
  });

  test("incremental fold reuses prefix folded refs and equals full fold", () => {
    // 前缀引用全相同、仅末条 assistant 内容变（流式典型场景）：走末条换尾增量快路径。
    const prefix = [
      msg({ id: 1, role: "user", content: "请帮我重构" }),
      msg({ id: 2, role: "assistant", content: "好的，我先看一下" }),
    ];
    const prevMessages = [...prefix, msg({ id: 3, role: "assistant", content: "正在分析" })];
    const nextMessages = [
      ...prefix,
      msg({ id: 3, role: "assistant", content: "正在分析代码结构" }),
    ];
    const options = { sessionStatus: "running" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(prevMessages, options);
    const prevFolded = foldToolResultUserMessagesIntoAssistant(prevMessages);
    const nextLast = nextMessages[nextMessages.length - 1]!;

    const patched = tryPatchChatMessageListRowsTail(
      prevMessages,
      nextMessages,
      initialRows,
      options,
      prevFolded,
    );
    expect(patched).not.toBeNull();

    // 前缀 folded 引用复用（未重算 fold），末条换为 nextLast 引用。
    expect(patched!.folded[0]).toBe(prevFolded[0]);
    expect(patched!.folded[1]).toBe(prevFolded[1]);
    expect(patched!.folded[2]).toBe(nextLast);
    // 增量结果与全量 fold 等价。
    expect(patched!.folded).toEqual(foldToolResultUserMessagesIntoAssistant(nextMessages));
    // 前缀 row 引用复用，末行重建。
    expect(patched!.rows[0]).toBe(initialRows[0]);
    expect(patched!.rows[1]).toBe(initialRows[1]);
    expect(
      patched!.rows[2]!.kind === "message" && patched!.rows[2]!.msg.content,
    ).toBe("正在分析代码结构");
  });

  test("falls back to full fold when prevFolded omitted (backwards compatible)", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hi" }),
      msg({ id: 2, role: "assistant", content: "hello" }),
    ];
    const options = { sessionStatus: "running" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(messages, options);
    const nextMessages = [
      messages[0]!,
      msg({ id: 2, role: "assistant", content: "hello!" }),
    ];
    // 不传 prevFolded：退化全量 fold，结果与传 prevFolded 一致。
    const withoutPrevFolded = tryPatchChatMessageListRowsTail(
      messages,
      nextMessages,
      initialRows,
      options,
    );
    const prevFolded = foldToolResultUserMessagesIntoAssistant(messages);
    const withPrevFolded = tryPatchChatMessageListRowsTail(
      messages,
      nextMessages,
      initialRows,
      options,
      prevFolded,
    );
    expect(withoutPrevFolded).not.toBeNull();
    expect(withPrevFolded).not.toBeNull();
    expect(withoutPrevFolded!.rows).toEqual(withPrevFolded!.rows);
    expect(withoutPrevFolded!.folded).toEqual(withPrevFolded!.folded);
  });

  test("returns null when next last message is tool-result absorbed into prefix", () => {
    // 末条变为 tool-only-user 且 tool_result 匹配前缀 assistant 的 tool_use：fold 将其吸收进前缀，
    // nextFolded 比 prevFolded 短 → 前缀 row originalIndex 越界 → null（回退 build 兜底）。
    const assistantToolUse = msg({
      id: 1,
      role: "assistant",
      content: "调用工具中",
      parts: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Read",
          input: { path: "a.ts" },
          status: "completed",
        },
      ],
    });
    const prevMessages = [
      assistantToolUse,
      msg({ id: 2, role: "assistant", content: "正在处理" }),
    ];
    const nextMessages = [
      assistantToolUse,
      msg({
        id: 3,
        role: "user",
        content: "Read result",
        parts: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "",
            input: {},
            output: "file contents",
            status: "completed",
          },
        ],
      }),
    ];
    const options = { sessionStatus: "running" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(prevMessages, options);
    const prevFolded = foldToolResultUserMessagesIntoAssistant(prevMessages);
    expect(
      tryPatchChatMessageListRowsTail(
        prevMessages,
        nextMessages,
        initialRows,
        options,
        prevFolded,
      ),
    ).toBeNull();
  });
});
