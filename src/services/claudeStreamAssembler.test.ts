import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession } from "../types";
import {
  appendAssistantStreamParts,
  applyToolResultPartsToMessages,
  computeAssistantStreamBufferText,
  foldToolResultUserMessagesIntoAssistant,
  mergeAssistantParts,
  mergeTextPartsByContainment,
  reconcileResultFullTextParts,
} from "./claudeStreamAssembler";

function session(messages: ClaudeSession["messages"]): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: "claude-1",
    repositoryPath: "/repo",
    repositoryName: "demo/员工:终端02",
    model: "sonnet",
    status: "running",
    messages,
    createdAt: 1,
    pendingPrompt: "",
  };
}

describe("reconcileResultFullTextParts", () => {
  test("returns resultParts as fallback when last assistant has no text", () => {
    // result 早于 delta 到达、末条无可见 text -> 原样注入兜底防闪空
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "整段最终正文" }],
        existingParts: [
          { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
        ],
        lastAssistantHasText: false,
      }),
    ).toEqual([{ type: "text", text: "整段最终正文" }]);
  });

  test("returns empty when result equals existing text (delta already covered, avoid duplication)", () => {
    // delta 已流完整轮（intro + 总结），result 整段与现有拼接相同 -> 跳过避免翻倍
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro\n\n总结" }],
        existingParts: [
          { type: "text", text: "intro" },
          { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
          { type: "text", text: "总结" },
        ],
        lastAssistantHasText: true,
      }),
    ).toEqual([]);
  });

  test("returns tail with leading whitespace stripped when last part is tool_use (avoid double separator)", () => {
    // delta 只流了 intro，result = intro + 总结，末条是 tool_use -> tail 由 mergeAssistantParts 新增 text part
    // （在工具后），渲染 join("\n\n") 已在 tool_use 与新 text 间加段间分隔。tail 前导 \n\n 若保留会致
    // 「tool_use 后 \n\n + tail 前导 \n\n」双重换行，故裁掉前导空白，对齐磁盘态 [intro, tool_use, 总结]。
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro\n\n总结" }],
        existingParts: [
          { type: "text", text: "intro" },
          { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
        ],
        lastAssistantHasText: true,
      }),
    ).toEqual([{ type: "text", text: "总结" }]);
  });

  test("preserves tail leading whitespace when last part is text (intra-paragraph separator)", () => {
    // 末条是 text：tail 由 mergeAssistantParts 合并进现有 text part（mergeTextPartsByContainment 拼接），
    // 前导换行是段内分隔，保留以避免 intro 与总结粘连成 "intro总结"。
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro\n\n总结" }],
        existingParts: [{ type: "text", text: "intro" }],
        lastAssistantHasText: true,
      }),
    ).toEqual([{ type: "text", text: "\n\n总结" }]);
  });

  test("recovers tail across multiple text blocks when delta streamed partial summary", () => {
    // 多 text block（intro + tool_use + 总结）：delta 流过 intro + 总结(部分)，result = intro + 总结(完整)。
    // existingText 用 \n\n 拼接对齐 resultText 段间分隔，超集命中 -> 回收总结尾巴（由 mergeAssistantParts
    // 合并进末条总结 part）。无分隔拼接会让前缀匹配失败走 disjoint 丢失尾巴（流式缺尾、刷新磁盘态
    // 有尾 -> 实时与刷新不一致）。
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro\n\n总结完整段" }],
        existingParts: [
          { type: "text", text: "intro" },
          { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
          { type: "text", text: "总结" },
        ],
        lastAssistantHasText: true,
      }),
    ).toEqual([{ type: "text", text: "完整段" }]);
  });

  test("returns empty when multiple text blocks fully streamed and result matches (separator-aware)", () => {
    // 多 text block 已被 delta 流完整：existingText = "intro\n\n总结" 对齐 resultText，完全相同 -> []
    // （此前无分隔拼接走 disjoint，现走完全相同路径，语义更精确）。
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro\n\n总结" }],
        existingParts: [
          { type: "text", text: "intro" },
          { type: "tool_use", id: "t1", name: "bash", input: {}, status: "completed" },
          { type: "text", text: "总结" },
        ],
        lastAssistantHasText: true,
      }),
    ).toEqual([]);
  });

  test("strips tail leading whitespace when last part is reasoning (avoid double separator)", () => {
    // 末条是 reasoning：tail 新增 text part（渲染 join("\n\n") 已在 reasoning 与新 text 间加分隔），
    // 裁掉前导空白避免双重换行，与 tool_use 末条同理。
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro\n\n总结" }],
        existingParts: [
          { type: "text", text: "intro" },
          { type: "reasoning", text: "思考" },
        ],
        lastAssistantHasText: true,
      }),
    ).toEqual([{ type: "text", text: "总结" }]);
  });

  test("returns empty when existing already contains result (result is subset)", () => {
    // delta 流得比 result 更长（现有含 result 之外的尾巴）-> 跳过，不截断现有
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro" }],
        existingParts: [{ type: "text", text: "intro\n\n更多" }],
        lastAssistantHasText: true,
      }),
    ).toEqual([]);
  });

  test("returns empty when result is disjoint from existing (conservative skip)", () => {
    // result 与 delta 分歧（不连续）-> 保守跳过，依赖 complete 后磁盘重载落盘规范文本
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "完全不同的正文" }],
        existingParts: [{ type: "text", text: "intro" }],
        lastAssistantHasText: true,
      }),
    ).toEqual([]);
  });

  test("returns empty when tail is whitespace-only (result only adds trailing blank)", () => {
    // result 仅比 existing 多尾随空白 -> 尾巴 trim 后为空，跳过避免注入纯空白 part
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: "intro   " }],
        existingParts: [{ type: "text", text: "intro" }],
        lastAssistantHasText: true,
      }),
    ).toEqual([]);
  });

  test("returns empty when result has no text", () => {
    expect(
      reconcileResultFullTextParts({
        resultParts: [],
        existingParts: [{ type: "text", text: "intro" }],
        lastAssistantHasText: true,
      }),
    ).toEqual([]);
  });
});

describe("computeAssistantStreamBufferText", () => {
  test("appends incoming text for delta events", () => {
    // delta 事件：增量追加 prevAssist + text
    expect(computeAssistantStreamBufferText("intro", "总结", false)).toBe("intro总结");
  });

  test("overwrites buffer with result full text (avoid doubling)", () => {
    // result 事件：缓冲此前已累积 delta 流过的 intro+总结，result 整轮文本覆盖而非追加，
    // 避免缓冲翻倍 -> complete 时 fromRef/previewRaw 翻倍 -> notifyCompletion 通知内容翻倍。
    expect(computeAssistantStreamBufferText("intro总结", "intro\n\n总结", true)).toBe("intro\n\n总结");
  });

  test("preserves prevAssist when result text is empty", () => {
    // result 无文本（如纯工具回合 result 无 result 字段）：保持 prevAssist，不覆盖为空
    expect(computeAssistantStreamBufferText("intro", "", true)).toBe("intro");
  });

  test("overwrites even when result text equals prevAssist (idempotent align)", () => {
    // result 文本与缓冲相同（delta 已流完整轮）：覆盖为相同值，幂等对齐权威
    expect(computeAssistantStreamBufferText("intro\n\n总结", "intro\n\n总结", true)).toBe("intro\n\n总结");
  });

  test("delta with empty text keeps buffer unchanged", () => {
    expect(computeAssistantStreamBufferText("intro", "", false)).toBe("intro");
  });
});

describe("mergeTextPartsByContainment", () => {
  test("returns incoming when equal (no duplication)", () => {
    expect(mergeTextPartsByContainment("正文", "正文")).toBe("正文");
  });

  test("returns incoming when incoming starts with existing (result full text covers delta)", () => {
    // delta 累积 = "intro"，result 整段 = "intro\n\n总结" -> 用 result，不拼成 "introintro\n\n总结"
    expect(mergeTextPartsByContainment("intro", "intro\n\n总结")).toBe("intro\n\n总结");
  });

  test("keeps existing when incoming is strict prefix of existing (reverse replay/truncation)", () => {
    // incoming 是 existing 的严格前缀（倒序重放/截断重发）-> 保留 existing，不拼成 "intro总结intro"
    expect(mergeTextPartsByContainment("intro总结", "intro")).toBe("intro总结");
  });

  test("concatenates when no containment (normal delta increment)", () => {
    expect(mergeTextPartsByContainment("你好", "世界")).toBe("你好世界");
  });

  test("concatenates when existing is empty", () => {
    expect(mergeTextPartsByContainment("", "正文")).toBe("正文");
  });
});

describe("mergeAssistantParts text containment", () => {
  test("replaces last text part when incoming result full text covers it (no duplication)", () => {
    // 末尾 text = delta 累积 "intro"；result 整段 "intro\n\n总结" 到达 -> 替换为 result，不拼接翻倍
    const merged = mergeAssistantParts(
      [{ type: "text", text: "intro" }],
      [{ type: "text", text: "intro\n\n总结" }],
    );
    const text = merged
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("");
    expect(text).toBe("intro\n\n总结");
  });

  test("concatenates normal delta increments", () => {
    const merged = mergeAssistantParts(
      [{ type: "text", text: "你好" }],
      [{ type: "text", text: "世界" }],
    );
    expect((merged[0] as { text: string }).text).toBe("你好世界");
  });

  test("keeps multiple text blocks from one assistant snapshot as separate parts", () => {
    const merged = mergeAssistantParts(
      [{ type: "tool_use", id: "t1", name: "Read", input: {}, status: "completed" }],
      [
        { type: "text", text: "## 总结\n\n已完成。" },
        { type: "text", text: "- 改动一\n- 改动二" },
      ],
    );
    const texts = merged
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text);
    expect(texts).toEqual(["## 总结\n\n已完成。", "- 改动一\n- 改动二"]);
  });

  test("multi-text assistant snapshot without prior parts stays separate", () => {
    const merged = mergeAssistantParts([], [
      { type: "text", text: "第一段" },
      { type: "text", text: "第二段" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.type)).toEqual(["text", "text"]);
  });

  test("startNewTextBlock option keeps next delta as separate part", () => {
    const merged = mergeAssistantParts(
      [{ type: "text", text: "第一段。" }],
      [{ type: "text", text: "## 总结" }],
      { startNewTextBlock: true },
    );
    expect(merged).toHaveLength(2);
    expect((merged[0] as { text: string }).text).toBe("第一段。");
    expect((merged[1] as { text: string }).text).toBe("## 总结");
  });

  test("heuristic splits markdown summary after completed sentence", () => {
    const merged = mergeAssistantParts(
      [{ type: "text", text: "工具执行完毕。" }],
      [{ type: "text", text: "## 改动总结" }],
    );
    expect(merged).toHaveLength(2);
  });
});

describe("mergeAssistantParts reasoning containment", () => {
  test("replaces last reasoning when incoming full thinking covers it (no duplication)", () => {
    // thinking 全量重发：incoming 以 existing 开头 -> 用 incoming，不拼成 "先分析先分析…"
    const merged = mergeAssistantParts(
      [{ type: "reasoning", text: "先分析" }],
      [{ type: "reasoning", text: "先分析，再执行" }],
    );
    expect((merged[0] as { text: string }).text).toBe("先分析，再执行");
  });

  test("keeps one reasoning when incoming equals existing", () => {
    const merged = mergeAssistantParts(
      [{ type: "reasoning", text: "思考" }],
      [{ type: "reasoning", text: "思考" }],
    );
    expect(merged).toHaveLength(1);
    expect((merged[0] as { text: string }).text).toBe("思考");
  });

  test("concatenates normal thinking_delta increments", () => {
    // 正常 thinking_delta 增量不以 existing 开头 -> 拼接
    const merged = mergeAssistantParts(
      [{ type: "reasoning", text: "先分析" }],
      [{ type: "reasoning", text: "，再执行" }],
    );
    expect((merged[0] as { text: string }).text).toBe("先分析，再执行");
  });
});

describe("appendAssistantStreamParts", () => {
  test("does not drop assistant reply that starts with the same greeting as user prompt", () => {
    const base = session([{ role: "user", content: "你好", timestamp: 1 }]);
    const next = appendAssistantStreamParts(base, [{ type: "text", text: "你好" }]);
    expect(next.messages.some((item) => item.role === "assistant")).toBe(true);
    expect(next.messages[next.messages.length - 1]?.content).toBe("你好");
  });

  test("appends full assistant reply after short greeting prompt", () => {
    const base = session([{ role: "user", content: "你好", timestamp: 1 }]);
    const next = appendAssistantStreamParts(base, [
      { type: "text", text: "你好！👋 有什么我可以帮你的？" },
    ]);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[1]?.role).toBe("assistant");
    expect(next.messages[1]?.content).toBe("你好！👋 有什么我可以帮你的？");
  });
});

describe("foldToolResultUserMessagesIntoAssistant", () => {
  function assistantTool(id: string, name: string): ClaudeMessage {
    return {
      id: 1,
      role: "assistant",
      content: "",
      timestamp: 1,
      parts: [
        {
          type: "tool_use",
          id,
          name,
          input: { taskId: "3" },
          status: "completed",
        },
      ],
    };
  }

  function toolResultUser(id: string, output: string): ClaudeMessage {
    return {
      id: 2,
      role: "user",
      content: output,
      timestamp: 2,
      parts: [
        {
          type: "tool_use",
          id,
          name: "",
          input: {},
          output,
          status: "completed",
        },
      ],
    };
  }

  test("merges tool-only user message into preceding assistant tool_use", () => {
    const folded = foldToolResultUserMessagesIntoAssistant([
      assistantTool("toolu_1", "TaskUpdate"),
      toolResultUser("toolu_1", "Updated task #3 status"),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.parts[0]).toMatchObject({
      name: "TaskUpdate",
      output: "Updated task #3 status",
    });
  });

  test("applyToolResultPartsToMessages reports matched ids", () => {
    const messages: ClaudeMessage[] = [assistantTool("toolu_1", "TaskList")];
    const updates = [
      {
        type: "tool_use" as const,
        id: "toolu_1",
        name: "",
        input: {},
        output: "task list body",
        status: "completed" as const,
      },
    ];
    const applied = applyToolResultPartsToMessages(messages, updates);
    expect(applied.matchedIds.has("toolu_1")).toBe(true);
    expect(applied.messages[0]?.parts[0]).toMatchObject({ output: "task list body" });
  });
});
