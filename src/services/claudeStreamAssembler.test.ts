import { describe, expect, test } from "bun:test";
import type { ClaudeMessage, ClaudeSession, ToolUsePart } from "../types";
import {
  appendAssistantStreamParts,
  applyToolResultPartsToMessages,
  coalesceConsecutiveAssistantMessages,
  computeAssistantStreamBufferText,
  foldToolResultUserMessagesIntoAssistant,
  mergeAssistantParts,
  mergeTextPartsByContainment,
  reconcileResultFullTextParts,
  MAX_ASSISTANT_TEXT_REASONING_CHARS,
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

/** Cursor CLI `--stream-partial-output` 的逐字 text delta（取自真实 cursor-runs jsonl）。 */
const CURSOR_TEXT_DELTAS = [
  "你好", "。\n\n", "我是", " Wise", " ", "工作", "区", "里的", " Cursor", " Agent",
  "，", "可以直接", "读写", "文件", "、", "跑", " shell", "、", "改", "代码",
  "。", "你想", "先", "聊", "什么", "，", "或者", "要", "我从", "哪",
  "一块", "开始", "动手", "？",
] as const;

/** 同一轮结束时 CLI 重发的整轮全文（final flush）。 */
const CURSOR_FULL_TURN_TEXT =
  "你好。\n\n我是 Wise 工作区里的 Cursor Agent，可以直接读写文件、跑 shell、改代码。你想先聊什么，或者要我从哪一块开始动手？";

function assistantTextMessage(id: number, text: string): ClaudeMessage {
  return { id, role: "assistant", content: text, timestamp: id, parts: [{ type: "text", text }] };
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

  test("returns resultParts when content matches ignoring whitespace (formatting recovery)", () => {
    // Codex RPC：delta 丢失换行压成墙式正文，item/completed 以 result 带回 Markdown。
    const flat = "图中内容：顶部标题栏左侧工作区底部Git面板";
    const formatted = "图中内容：\n\n顶部标题栏\n\n左侧工作区\n\n底部Git面板";
    expect(
      reconcileResultFullTextParts({
        resultParts: [{ type: "text", text: formatted }],
        existingParts: [{ type: "text", text: flat }],
        lastAssistantHasText: true,
      }),
    ).toEqual([{ type: "text", text: formatted }]);
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
  test("replaceAllText swaps flattened text for authoritative markdown", () => {
    const merged = mergeAssistantParts(
      [
        { type: "reasoning", text: "看图" },
        { type: "text", text: "顶部标题栏左侧工作区" },
      ],
      [{ type: "text", text: "顶部标题栏\n\n左侧工作区" }],
      { replaceAllText: true },
    );
    expect(merged).toEqual([
      { type: "reasoning", text: "看图" },
      { type: "text", text: "顶部标题栏\n\n左侧工作区" },
    ]);
  });

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

  test("startNewTextBlock after tool keeps next delta as separate part", () => {
    const merged = mergeAssistantParts(
      [
        { type: "text", text: "先读文件。" },
        { type: "tool_use", id: "t1", name: "Read", input: {}, status: "completed" },
      ],
      [{ type: "text", text: "## 总结" }],
      { startNewTextBlock: true },
    );
    expect(merged).toHaveLength(3);
    expect((merged[2] as { text: string }).text).toBe("## 总结");
  });

  test("startNewTextBlock with paragraph heuristic still splits", () => {
    const merged = mergeAssistantParts(
      [{ type: "text", text: "第一段。" }],
      [{ type: "text", text: "## 总结" }],
      { startNewTextBlock: true },
    );
    expect(merged).toHaveLength(2);
    expect((merged[0] as { text: string }).text).toBe("第一段。");
    expect((merged[1] as { text: string }).text).toBe("## 总结");
  });

  test("spurious startNewTextBlock mid-text concatenates token fragments", () => {
    let parts = mergeAssistantParts([], [{ type: "text", text: "Inc" }], {
      startNewTextBlock: true,
    });
    parts = mergeAssistantParts(parts, [{ type: "text", text: "ubation" }], {
      startNewTextBlock: true,
    });
    parts = mergeAssistantParts(parts, [{ type: "text", text: "党" }], {
      startNewTextBlock: true,
    });
    parts = mergeAssistantParts(parts, [{ type: "text", text: "费" }], {
      startNewTextBlock: true,
    });
    const texts = parts
      .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
      .map((p) => p.text);
    expect(texts).toEqual(["Incubation党费"]);
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

  test("merges interleaved Codex reasoning and text deltas by their stable stream ids", () => {
    // Codex app-server 可在同一 turn 内交错发出 reasoning / agentMessage；若只和数组
    // 末项合并，界面会变成「思考一小段、正文一小段」的碎片列表。
    let merged = mergeAssistantParts([], [{ type: "reasoning", text: "先检查", streamId: "r-1" }]);
    merged = mergeAssistantParts(merged, [{ type: "text", text: "正在读取", streamId: "m-1" }]);
    merged = mergeAssistantParts(merged, [{ type: "reasoning", text: "调用链。", streamId: "r-1" }]);
    merged = mergeAssistantParts(merged, [{ type: "text", text: "配置。", streamId: "m-1" }]);

    expect(merged).toEqual([
      { type: "reasoning", text: "先检查调用链。", streamId: "r-1" },
      { type: "text", text: "正在读取配置。", streamId: "m-1" },
    ]);
  });

  test("spurious startNewReasoningBlock mid-thinking concatenates fragments", () => {
    let parts = mergeAssistantParts([], [{ type: "reasoning", text: "So" }], {
      startNewReasoningBlock: true,
    });
    parts = mergeAssistantParts(parts, [{ type: "reasoning", text: ":" }], {
      startNewReasoningBlock: true,
    });
    parts = mergeAssistantParts(parts, [{ type: "reasoning", text: " handleClaudeTurnComplete" }], {
      startNewReasoningBlock: true,
    });
    expect(parts).toEqual([
      { type: "reasoning", text: "So: handleClaudeTurnComplete" },
    ]);
  });

  test("startNewReasoningBlock after a tool starts a new reasoning part", () => {
    const merged = mergeAssistantParts(
      [
        { type: "reasoning", text: "Two issues:" },
        { type: "tool_use", id: "t1", name: "Grep", input: {}, status: "completed" },
      ],
      [{ type: "reasoning", text: "So:" }],
      { startNewReasoningBlock: true },
    );
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ type: "reasoning", text: "Two issues:" });
    expect(merged[2]).toMatchObject({ type: "reasoning", text: "So:" });
  });
});

describe("mergeAssistantParts tool_use ACP updates", () => {
  test("preserves real name/title when update fabricates Tool placeholder", () => {
    const merged = mergeAssistantParts(
      [
        {
          type: "tool_use",
          id: "tc1",
          name: "Read",
          input: { path: "a.rs", title: "Reading file" },
          status: "running",
        },
      ],
      [
        {
          type: "tool_use",
          id: "tc1",
          name: "Tool",
          input: { title: "Tool" },
          status: "completed",
          output: "ok",
        },
      ],
    );
    const part = merged[0] as ToolUsePart;
    expect(part.name).toBe("Read");
    expect(part.input.path).toBe("a.rs");
    expect(part.input.title).toBe("Reading file");
    expect(part.status).toBe("completed");
    expect(part.output).toBe("ok");
  });

  test("replaces locations array on update and keeps old when omitted", () => {
    const withLocs = mergeAssistantParts(
      [
        {
          type: "tool_use",
          id: "tc2",
          name: "Read",
          input: {},
          status: "running",
          locations: [{ path: "old.ts" }],
        },
      ],
      [
        {
          type: "tool_use",
          id: "tc2",
          name: "",
          input: {},
          status: "running",
          locations: [{ path: "new.ts", line: 3 }],
        },
      ],
    );
    expect((withLocs[0] as ToolUsePart).locations?.[0]?.path).toBe("new.ts");

    const keepOld = mergeAssistantParts(withLocs, [
      {
        type: "tool_use",
        id: "tc2",
        name: "",
        input: {},
        status: "completed",
        output: "done",
      },
    ]);
    expect((keepOld[0] as ToolUsePart).locations?.[0]?.path).toBe("new.ts");
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

  test("cursor text deltas reassemble into the exact turn text", () => {
    let current = session([{ role: "user", content: "你好啊", timestamp: 1 }]);
    for (const text of CURSOR_TEXT_DELTAS) {
      current = appendAssistantStreamParts(current, [{ type: "text", text }]);
    }
    expect(current.messages[1]?.content).toBe(CURSOR_FULL_TURN_TEXT);
  });

  test("cursor end-of-turn full-text flush does not duplicate the streamed turn", () => {
    let current = session([{ role: "user", content: "你好啊", timestamp: 1 }]);
    for (const text of CURSOR_TEXT_DELTAS) {
      current = appendAssistantStreamParts(current, [{ type: "text", text }]);
    }
    current = appendAssistantStreamParts(current, [
      { type: "text", text: CURSOR_FULL_TURN_TEXT },
    ]);
    expect(current.messages[1]?.content).toBe(CURSOR_FULL_TURN_TEXT);
  });
});

describe("assistant message memory limits", () => {
  function textReasoningChars(messages: readonly ClaudeMessage[]): number {
    let n = 0;
    for (const msg of messages) {
      for (const part of msg.parts ?? []) {
        if (part.type === "text" || part.type === "reasoning") {
          n += part.text.length;
        }
      }
    }
    return n;
  }

  test("reasoning-only overflow keeps head + middle notice + tail (preview stays real thinking)", () => {
    const base = session([]);
    const reasoning = "思".repeat(MAX_ASSISTANT_TEXT_REASONING_CHARS + 4000);
    const next = appendAssistantStreamParts(base, [
      { type: "reasoning", text: reasoning },
    ]);
    const msg = next.messages[0]!;
    const part = msg.parts[0]!;
    expect(part.type).toBe("reasoning");
    expect(part.text.startsWith("思".repeat(400))).toBe(true);
    expect(part.text.endsWith("思".repeat(100))).toBe(true);
    expect(part.text).toContain("…[已省略较早前 ");
    // 省略 notice 不再顶到开头：折叠预览继续显示真实思考头部
    expect(part.text.startsWith("…[已省略")).toBe(false);
    expect(textReasoningChars(next.messages)).toBeLessThanOrEqual(
      MAX_ASSISTANT_TEXT_REASONING_CHARS,
    );
  });

  test("text-only overflow still strips from start and prepends notice", () => {
    const base = session([]);
    const text = "答".repeat(MAX_ASSISTANT_TEXT_REASONING_CHARS + 4000);
    const next = appendAssistantStreamParts(base, [
      { type: "text", text },
    ]);
    const msg = next.messages[0]!;
    const part = msg.parts[0]!;
    expect(part.type).toBe("text");
    expect(part.text.startsWith("…[已省略较早前 ")).toBe(true);
    expect(part.text.endsWith("答".repeat(100))).toBe(true);
    expect(textReasoningChars(next.messages)).toBeLessThanOrEqual(
      MAX_ASSISTANT_TEXT_REASONING_CHARS,
    );
  });

  test("reasoning + text overflow yields reasoning tail to keep text intact", () => {
    const base = session([]);
    const reasoning = "思".repeat(MAX_ASSISTANT_TEXT_REASONING_CHARS);
    const text = "答".repeat(10000);
    const next = appendAssistantStreamParts(base, [
      { type: "reasoning", text: reasoning },
      { type: "text", text },
    ]);
    const msg = next.messages[0]!;
    const textPart = msg.parts.find((p) => p.type === "text")!;
    const reasoningPart = msg.parts.find((p) => p.type === "reasoning")!;
    expect(textPart.text).toBe(text);
    expect(reasoningPart.text.startsWith("思".repeat(400))).toBe(true);
    expect(reasoningPart.text).toContain("…[已省略较早前 ");
    expect(textReasoningChars(next.messages)).toBeLessThanOrEqual(
      MAX_ASSISTANT_TEXT_REASONING_CHARS,
    );
  });

  test("under-cap reasoning/text pass through untouched", () => {
    const base = session([]);
    const next = appendAssistantStreamParts(base, [
      { type: "reasoning", text: "先思考一下" },
      { type: "text", text: "结论：可以。" },
    ]);
    const msg = next.messages[0]!;
    expect(msg.parts).toEqual([
      { type: "reasoning", text: "先思考一下" },
      { type: "text", text: "结论：可以。" },
    ]);
  });
});

describe("coalesceConsecutiveAssistantMessages", () => {
  test("merges cursor-style text deltas into one assistant message", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "user",
        content: "你好",
        timestamp: 1,
        parts: [{ type: "text", text: "你好" }],
      },
      {
        id: 2,
        role: "assistant",
        content: "会话",
        timestamp: 2,
        parts: [{ type: "text", text: "会话" }],
      },
      {
        id: 3,
        role: "assistant",
        content: "已初始化",
        timestamp: 3,
        parts: [{ type: "text", text: "已初始化" }],
      },
      {
        id: 4,
        role: "assistant",
        content: "？例如",
        timestamp: 4,
        parts: [{ type: "text", text: "？例如" }],
      },
    ];
    const coalesced = coalesceConsecutiveAssistantMessages(messages);
    expect(coalesced).toHaveLength(2);
    expect(coalesced[1]?.role).toBe("assistant");
    expect(coalesced[1]?.content).toBe("会话已初始化？例如");
  });

  test("drops cursor end-of-turn full-text flush instead of duplicating the turn", () => {
    // 真实 jsonl（~/.wise/cursor-runs 落盘）序列：逐字 delta 之后 CLI 又把整轮正文整段重发一次。
    // 段落边界把 delta 切成两个 text part 后，整段快照与末条 part 无前缀关系，旧逻辑会拼接成翻倍正文。
    const messages: ClaudeMessage[] = [
      ...CURSOR_TEXT_DELTAS.map((text, index) => assistantTextMessage(index + 1, text)),
      assistantTextMessage(CURSOR_TEXT_DELTAS.length + 1, CURSOR_FULL_TURN_TEXT),
    ];
    const coalesced = coalesceConsecutiveAssistantMessages(messages);
    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.content).toBe(CURSOR_FULL_TURN_TEXT);
  });

  test("does not merge across user messages", () => {
    const messages: ClaudeMessage[] = [
      {
        id: 1,
        role: "assistant",
        content: "A",
        timestamp: 1,
        parts: [{ type: "text", text: "A" }],
      },
      {
        id: 2,
        role: "user",
        content: "B",
        timestamp: 2,
        parts: [{ type: "text", text: "B" }],
      },
      {
        id: 3,
        role: "assistant",
        content: "C",
        timestamp: 3,
        parts: [{ type: "text", text: "C" }],
      },
    ];
    expect(coalesceConsecutiveAssistantMessages(messages)).toHaveLength(3);
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
