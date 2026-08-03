import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  buildChatMessageListRows,
  foldChatMessagesForList,
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

  test("hides when last assistant reasoning is blank (inline 思考中 card covers it)", () => {
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
    ).toBe(false);
  });

  test("renders blank-reasoning assistant message as a message row (icon + 思考中 in content)", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "hi" }),
      msg({
        id: 2,
        role: "assistant",
        parts: [{ type: "reasoning", text: "   " }],
      }),
    ];
    const showListEndThinkingHint = shouldShowListEndThinkingHint(messages, "running");
    expect(showListEndThinkingHint).toBe(false);
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "running",
      showListEndThinkingHint,
    });
    expect(rows.map((row) => (row.kind === "message" ? row.msg.id : row.kind))).toEqual([1, 2]);
    expect(rows[1]!.kind === "message" && rows[1]!.streamingThisBubble).toBe(true);
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

  test("idle rebuild survives interrupted Write with null input", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "edit", timestamp: 10 }),
      msg({
        id: 2,
        role: "assistant",
        content: "partial",
        timestamp: 11,
        parts: [
          {
            type: "tool_use",
            id: "w-null",
            name: "Write",
            status: "running",
            input: null as unknown as Record<string, unknown>,
            output: "",
          },
          { type: "text", text: "partial" },
        ],
      }),
    ];
    expect(() =>
      buildChatMessageListRows(messages, {
        sessionStatus: "idle",
        showListEndThinkingHint: false,
      }),
    ).not.toThrow();
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows.map((r) => r.kind)).toEqual(["message", "message"]);
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

  test("coalesces consecutive tool-only assistant rows into one tool group row", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "look" }),
      msg({
        id: 2,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r1",
            name: "Read",
            status: "completed",
            input: { file_path: "/repo/a.tsx" },
            output: "a",
          },
        ],
      }),
      msg({
        id: 3,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r2",
            name: "Read",
            status: "completed",
            input: { file_path: "/repo/b.tsx" },
            output: "b",
          },
        ],
      }),
      msg({
        id: 4,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "b1",
            name: "Bash",
            status: "completed",
            input: { command: "ls" },
            output: "ok",
          },
        ],
      }),
      msg({
        id: 5,
        role: "assistant",
        parts: [{ type: "text", text: "看到了这些文件" }],
      }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    // 连续 assistant（含工具 + 正文）先合并成一条消息，再渲染为单气泡。
    expect(rows.map((r) => r.kind)).toEqual(["message", "message"]);
    expect(rows[1]!.kind === "message" && rows[1]!.msg.id).toBe(2);
    expect(
      rows[1]!.kind === "message" &&
        rows[1]!.msg.parts.filter((p) => p.type === "tool_use").map((p) => (p as { id: string }).id),
    ).toEqual(["r1", "r2", "b1"]);
    expect(
      rows[1]!.kind === "message" &&
        rows[1]!.msg.parts.some((p) => p.type === "text" && p.text === "看到了这些文件"),
    ).toBe(true);
  });

  test("keeps tool and text parts in one assistant bubble when fragmented across jsonl lines", () => {
    const messages = [
      msg({
        id: 1,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r1",
            name: "Read",
            status: "completed",
            input: { file_path: "/repo/a.tsx" },
            output: "a",
          },
        ],
      }),
      msg({
        id: 2,
        role: "assistant",
        parts: [{ type: "text", text: "中间说明" }],
      }),
      msg({
        id: 3,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r2",
            name: "Read",
            status: "completed",
            input: { file_path: "/repo/b.tsx" },
            output: "b",
          },
        ],
      }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind === "message" && rows[0]!.msg.parts.map((p) => p.type)).toEqual([
      "tool_use",
      "text",
      "tool_use",
    ]);
  });

  test("coalesces consecutive assistant text fragments into one message row", () => {
    const messages = [
      msg({ id: 1, role: "user", content: "你好" }),
      msg({ id: 2, role: "assistant", parts: [{ type: "text", text: "会话已初始化" }] }),
      msg({ id: 3, role: "assistant", parts: [{ type: "text", text: "，当前状态如下：" }] }),
      msg({ id: 4, role: "assistant", parts: [{ type: "text", text: "？例如" }] }),
    ];
    const rows = buildChatMessageListRows(messages, {
      sessionStatus: "idle",
      showListEndThinkingHint: false,
    });
    expect(rows.map((r) => r.kind)).toEqual(["message", "message"]);
    expect(rows[1]!.kind === "message" && rows[1]!.msg.content).toContain("会话已初始化，当前状态如下：");
    expect(rows[1]!.kind === "message" && rows[1]!.msg.content).toContain("？例如");
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
    const prevFolded = foldChatMessagesForList(messages);
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
    const prevFolded = foldChatMessagesForList(messages);
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
    // 注意：连续 assistant 会被 coalesce，故快路径用例保持「user + 单条 assistant」。
    const userMsg = msg({ id: 1, role: "user", content: "请帮我重构" });
    const prevMessages = [
      userMsg,
      msg({ id: 2, role: "assistant", content: "正在分析" }),
    ];
    const nextMessages = [
      userMsg,
      msg({ id: 2, role: "assistant", content: "正在分析代码结构" }),
    ];
    const options = { sessionStatus: "running" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(prevMessages, options);
    const prevFolded = foldChatMessagesForList(prevMessages);
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
    expect(patched!.folded[1]).toBe(nextLast);
    // 增量结果与全量 fold 等价。
    expect(patched!.folded).toEqual(foldChatMessagesForList(nextMessages));
    // 前缀 row 引用复用，末行重建。
    expect(patched!.rows[0]).toBe(initialRows[0]);
    expect(
      patched!.rows[1]!.kind === "message" && patched!.rows[1]!.msg.content,
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
    const prevFolded = foldChatMessagesForList(messages);
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

  test("returns null when next last message is tool-result absorbed into earlier assistant", () => {
    // 中间夹 user 正文，避免连续 assistant 先被 coalesce；末条 tool_result 被 fold 进更早的 tool_use 后
    // folded 变短，tail-patch 无法安全复用前缀 → null。
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
    const waitUser = msg({ id: 2, role: "user", content: "等一下" });
    const prevMessages = [
      assistantToolUse,
      waitUser,
      msg({ id: 3, role: "assistant", content: "正在处理" }),
    ];
    const nextMessages = [
      assistantToolUse,
      waitUser,
      msg({
        id: 4,
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
    const prevFolded = foldChatMessagesForList(prevMessages);
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

  test("full-fold patches when consecutive tool-only assistants were message-coalesced", () => {
    const prevMessages = [
      msg({
        id: 1,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r1",
            name: "Read",
            status: "completed",
            input: { file_path: "/repo/a.tsx" },
            output: "a",
          },
        ],
      }),
      msg({
        id: 2,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r2",
            name: "Read",
            status: "running",
            input: { file_path: "/repo/b.tsx" },
          },
        ],
      }),
    ];
    const nextMessages = [
      prevMessages[0]!,
      msg({
        id: 2,
        role: "assistant",
        parts: [
          {
            type: "tool_use",
            id: "r2",
            name: "Read",
            status: "completed",
            input: { file_path: "/repo/b.tsx" },
            output: "b",
          },
        ],
      }),
    ];
    const options = { sessionStatus: "running" as const, showListEndThinkingHint: false };
    const initialRows = buildChatMessageListRows(prevMessages, options);
    expect(initialRows).toHaveLength(1);
    expect(
      initialRows[0]!.kind === "message" &&
        initialRows[0]!.msg.parts.filter((p) => p.type === "tool_use").map((p) => (p as { id: string }).id),
    ).toEqual(["r1", "r2"]);
    const patched = tryPatchChatMessageListRowsTail(
      prevMessages,
      nextMessages,
      initialRows,
      options,
      foldChatMessagesForList(prevMessages),
    );
    // 合并后的 folded 末条是合成对象，走全量 fold；结果仍应可用。
    expect(patched).not.toBeNull();
    expect(
      patched!.folded[0]!.parts.some(
        (p) => p.type === "tool_use" && p.id === "r2" && p.status === "completed",
      ),
    ).toBe(true);
  });
});
