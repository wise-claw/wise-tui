import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  assistantMessagePostToolTextParts,
  assistantOrphanMarkdownText,
  cliToolOutputForExpandedBody,
  extractBashEmbeddedMarkdownSummary,
  looksLikeAssistantCompletionSummary,
  looksLikeLongFormChatMarkdown,
  looksLikeStructuredMarkdownSummary,
  chatAssistantTextPartClassNames,
  splitCliOutputAndMarkdownSummary,
} from "./assistantOrphanMarkdown";

describe("assistantOrphanMarkdownText", () => {
  test("returns bash embedded summary when no post-tool text part exists", () => {
    const summary = "零错误。全部改动已就绪，以下是总结：\n\n## ✅ 完成";
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "",
      timestamp: 1,
      parts: [
        { type: "text", text: "先分析一下" },
        {
          type: "tool_use",
          id: "t1",
          name: "bash",
          input: { command: "eslint" },
          output: summary,
          status: "completed",
        },
      ],
    };
    expect(assistantOrphanMarkdownText(msg)).toBe(summary);
  });

  test("returns empty when parts only contain tools (partial guard)", () => {
    // partial 守卫：parts 没有任何 text part（仅 tool_use）时，content 可能是磁盘快照
    // 的整段总结，但 partial 状态下不应把它拆为 orphan 渲染。
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "已完成！\n\n## 总结",
      parts: [{ type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" }],
      timestamp: 1,
    };
    expect(assistantOrphanMarkdownText(msg)).toBe("");
  });

  test("skips orphan extraction when parts has no text part (partial guard)", () => {
    // partial 守卫：content 已含完整总结、parts 还在加载中（没有任何 text part），
    // 不应把 content 拆为 orphan 渲染，否则 partial 文本会被提前展示成 final。
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "## 改动总结\n已完成所有改动",
      parts: [],
      timestamp: 1,
    };
    expect(assistantOrphanMarkdownText(msg)).toBe("");
  });

  test("skips orphan extraction when parts only has reasoning/tool_use (partial guard)", () => {
    // partial 状态：content 是磁盘快照的整段总结，parts 仅有 reasoning/tool_use，
    // 没有 text part 时也不应拆 orphan。
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "## 改动总结\n已完成所有改动",
      parts: [
        { type: "reasoning", text: "思考中…" },
        { type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" },
      ],
      timestamp: 1,
    };
    expect(assistantOrphanMarkdownText(msg)).toBe("");
  });

  test("extracts orphan tail when parts already has some text part", () => {
    // parts 已经开始加载（有 text part），content 末尾多出来一段才视为 orphan。
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "先说明\n\n## 总结\n完成",
      parts: [{ type: "text", text: "先说明" }],
      timestamp: 1,
    };
    expect(assistantOrphanMarkdownText(msg)).toBe("## 总结\n完成");
  });
});

describe("extractBashEmbeddedMarkdownSummary", () => {
  test("extracts markdown tail from bash output", () => {
    const summary = "零错误。全部改动已就绪，以下是总结：\n\n## ✅ 完成";
    const parts = [
      {
        type: "tool_use" as const,
        id: "b1",
        name: "bash",
        input: {},
        output: `✓ ok\n\n${summary}`,
        status: "completed" as const,
      },
    ];
    expect(extractBashEmbeddedMarkdownSummary(parts)).toBe(summary);
  });
});

describe("cliToolOutputForExpandedBody", () => {
  test("keeps only cli stdout in expanded bash body", () => {
    const part = {
      type: "tool_use" as const,
      id: "b1",
      name: "bash",
      input: {},
      output: "✓ ok\n\n零错误。全部改动已就绪，以下是总结：\n\n## ✅ 完成",
      status: "completed" as const,
    };
    expect(cliToolOutputForExpandedBody(part)).toBe("✓ ok");
  });
});

describe("assistantMessagePostToolTextParts", () => {
  test("ignores text before last tool", () => {
    const parts = [
      { type: "text" as const, text: "引导语" },
      { type: "tool_use" as const, id: "t1", name: "bash", input: {}, status: "completed" as const },
      { type: "text" as const, text: "工具后总结" },
    ];
    expect(assistantMessagePostToolTextParts(parts)).toBe("工具后总结");
  });
});

describe("looksLikeStructuredMarkdownSummary", () => {
  test("detects completion summary markdown", () => {
    expect(looksLikeStructuredMarkdownSummary("已完成！\n\n## 大屏改动总结")).toBe(true);
    expect(
      looksLikeStructuredMarkdownSummary("零错误。全部改动已就绪，以下是总结：\n\n## ✅ 大屏视频播放功能 — 完成"),
    ).toBe(true);
    expect(looksLikeStructuredMarkdownSummary("plain text")).toBe(false);
  });

  test("keeps legacy alias in sync", () => {
    expect(looksLikeAssistantCompletionSummary("已完成！\n\n## 总结")).toBe(true);
  });
});

describe("looksLikeLongFormChatMarkdown", () => {
  test("detects bold-section technical summaries without ## headings", () => {
    const text = [
      "All tests pass — GitPanel 62/62.",
      "",
      "**优化总结**",
      "",
      "**单仓 GitPanel 切换卡顿**",
      "",
      "- **定位**：`useEffect` 在 mount 时同步拉 IPC",
      "- **修复**：改为 `runWhenIdle` 延迟加载",
      "- **效果**：切换耗时从 800ms 降到 120ms",
      "",
      "**验证**",
      "",
      "- `bun test src/components/GitPanel` → 62 pass",
    ].join("\n");
    expect(looksLikeLongFormChatMarkdown(text)).toBe(true);
  });

  test("ignores short plain replies", () => {
    expect(looksLikeLongFormChatMarkdown("好的，我来处理。")).toBe(false);
  });

  // 回归："多个说明点 + 末尾段"形态（旧实现只数无序列表 + 段间 ≥5 双重落空，
  // 流式态不挂 chat-prose → 0.45em；磁盘态 0.65em，视觉差距被感知为「最后几段集中到一起」）。
  test("REGRESSION: numbered list + trailing paragraph triggers long-prose (multi 步骤 + 总结)", () => {
    expect(
      looksLikeLongFormChatMarkdown(
        "下面是步骤：\n\n1. 打开 IDE\n2. 选择项目\n3. 点击运行\n\n如果失败请重试。",
      ),
    ).toBe(true);
  });

  test("REGRESSION: numbered list + bullet list + trailing paragraph triggers long-prose", () => {
    expect(
      looksLikeLongFormChatMarkdown(
        "下面是详细步骤：\n\n1. 打开文件\n2. 选择内容\n3. 复制\n4. 粘贴到新位置\n5. 保存\n\n关键点：\n- 注意编码\n- 注意换行\n- 注意权限",
      ),
    ).toBe(true);
  });

  test("REGRESSION: 6-item ordered list + intro + outro triggers long-prose (典型「操作流程」)", () => {
    expect(
      looksLikeLongFormChatMarkdown(
        "操作流程：\n\n1. 打开应用\n2. 点击菜单\n3. 选择导出\n4. 保存文件\n\n注意保存路径。",
      ),
    ).toBe(true);
  });

  test("REGRESSION: short plain list (only ordered items, no \\\\n\\\\n) still does NOT trigger long-prose", () => {
    // 单段多列表项 + 无段间空行 = 不应挂 chat-prose（避免把短单段拉成卡片）
    expect(looksLikeLongFormChatMarkdown("1. 第一步\n2. 第二步\n3. 第三步")).toBe(false);
  });

  // 流式期早触发：text 累积 < 720 字时，磁盘态规则几乎全 false；流式态若已出现 ≥2 段就提前挂 chat-prose，
  // 消除「末段粘连」（4px vs 0.65em 视觉断崖）。单段不挂，避免短回复误挂卡片。
  test("STREAMING: ≥2 paragraphs triggers long-prose even when text < 720 chars", () => {
    expect(looksLikeLongFormChatMarkdown("第一步说明\n\n第二步说明", false, true)).toBe(true);
  });

  test("STREAMING: single paragraph short reply does NOT trigger long-prose", () => {
    expect(looksLikeLongFormChatMarkdown("好的，我来处理。", false, true)).toBe(false);
  });

  test("STREAMING: single-paragraph multi-list (no \\\\n\\\\n) does NOT trigger long-prose", () => {
    // 短单段列表不应挂卡片（与磁盘态已有的 case 对齐）
    expect(looksLikeLongFormChatMarkdown("1. 第一步\n2. 第二步\n3. 第三步", false, true)).toBe(false);
  });

  test("DISK: ≥2 paragraphs without streamingShortOk does NOT auto-trigger long-prose (字节级等价)", () => {
    // 磁盘 JSONL 装配路径不传 streamingShortOk，行为必须与改动前完全一致——「短两段」文本不应挂卡片。
    expect(looksLikeLongFormChatMarkdown("第一步说明\n\n第二步说明", false, false)).toBe(false);
    expect(looksLikeLongFormChatMarkdown("第一步说明\n\n第二步说明", false)).toBe(false);
  });

  // 组合：summary 优先于 streamingShortOk 早触发——带"已完成/改动总结"语境的即使短两段也是 summary
  test("STREAMING: summary path beats streamingShortOk early-trigger", () => {
    // "已完成！\n\n## 改动总结" = summary=true（looksLikeStructuredMarkdownSummary）
    // streamingShortOk 早触发分支在 summary 之后，不会拦截；最终走 summary 分支
    expect(looksLikeLongFormChatMarkdown("已完成！\n\n## 改动总结", false, true)).toBe(true);
  });

  // 边界：段数刚到 2 vs 不到 2 的临界
  test("STREAMING: paragraphs boundary 2 (1 -> false, 2 -> true, 3 -> true)", () => {
    // 1 段（即便长）不挂；2 段挂；3 段挂
    expect(looksLikeLongFormChatMarkdown("一段很长的文字内容".repeat(20), false, true)).toBe(false);
    expect(looksLikeLongFormChatMarkdown("第一段\n\n第二段", false, true)).toBe(true);
    expect(looksLikeLongFormChatMarkdown("第一段\n\n第二段\n\n第三段", false, true)).toBe(true);
  });

  // 边界：段间分隔 \n\n 但被 stripClaudeHarnessInjectedStreamText 压平后的形态——这种修复由调用方负责
  test("STREAMING: 多空白折叠后的段数仍按 \\n\\n 切割", () => {
    // "para1\n\n\n\npara2" 的 split(/\n\s*\n/) 会得到 ["para1", "para2"] 两个段（多换行折叠）
    expect(looksLikeLongFormChatMarkdown("para1\n\n\n\npara2", false, true)).toBe(true);
  });
});

describe("chatAssistantTextPartClassNames", () => {
  test("maps structured summary to completion card", () => {
    expect(chatAssistantTextPartClassNames("已完成！\n\n## 总结").partClassName).toContain(
      "app-message-part--completion-summary",
    );
  });

  test("maps bold long prose to long-prose card", () => {
    const text = [
      "**Section A**",
      "",
      "- item one",
      "- item two",
      "",
      "**Section B**",
      "",
      "- item three",
      "- item four",
    ].join("\n");
    const { partClassName } = chatAssistantTextPartClassNames(text);
    expect(partClassName).toContain("app-message-part--long-prose");
  });

  // 流式期早触发：text 累积 < 720 字且含 ≥2 段时，streaming=true 立即挂 long-prose 卡片 + chat-prose，
  // 消除「末段粘连」；streaming=false（磁盘态）行为字节级等价。
  test("STREAMING: short 2-paragraph reply gets long-prose card", () => {
    const { partClassName, markdownClassName } = chatAssistantTextPartClassNames(
      "第一步说明\n\n第二步说明",
      true,
    );
    expect(partClassName).toContain("app-message-part--long-prose");
    expect(markdownClassName).toBe("app-markdown--chat-prose");
  });

  test("DISK: short 2-paragraph reply does NOT get long-prose card (字节级等价)", () => {
    const { partClassName, markdownClassName } = chatAssistantTextPartClassNames(
      "第一步说明\n\n第二步说明",
      false,
    );
    expect(partClassName).not.toContain("app-message-part--long-prose");
    expect(markdownClassName).toBeUndefined();
  });

  test("STREAMING: single-paragraph short reply stays plain (no card)", () => {
    const { partClassName, markdownClassName } = chatAssistantTextPartClassNames(
      "好的，我来处理。",
      true,
    );
    expect(partClassName).not.toContain("app-message-part--long-prose");
    expect(partClassName).not.toContain("app-message-part--completion-summary");
    expect(markdownClassName).toBeUndefined();
  });

  // 边界：summary 优先于 long-prose / streaming 早触发——带"已完成/改动总结"语境的即使短文本也是 summary 卡片
  test("summary priority over long-prose: structured summary card wins regardless of streaming", () => {
    const summaryText = "已完成！\n\n## 改动总结";
    // 磁盘态
    const disk = chatAssistantTextPartClassNames(summaryText, false);
    expect(disk.partClassName).toContain("app-message-part--completion-summary");
    expect(disk.partClassName).not.toContain("app-message-part--long-prose");
    // 流式态
    const stream = chatAssistantTextPartClassNames(summaryText, true);
    expect(stream.partClassName).toContain("app-message-part--completion-summary");
    expect(stream.partClassName).not.toContain("app-message-part--long-prose");
  });

  // 边界：纯 5+ 列表项（无段间空行）—— 磁盘态兜底 ≥5 listItems 应挂 long-prose；流式态单段形态不挂
  test("5+ list items single paragraph: both disk and streaming get long-prose (listItems >= 5 wins over streamingShortOk)", () => {
    const text5list = "- 1\n- 2\n- 3\n- 4\n- 5";
    // listItems >= 5 是全局规则，磁盘态与流式态都命中；streamingShortOk 早触发分支不"吃掉"该全局规则
    const disk = chatAssistantTextPartClassNames(text5list, false);
    expect(disk.partClassName).toContain("app-message-part--long-prose");
    expect(disk.markdownClassName).toBe("app-markdown--chat-prose");
    const stream = chatAssistantTextPartClassNames(text5list, true);
    expect(stream.partClassName).toContain("app-message-part--long-prose");
    expect(stream.markdownClassName).toBe("app-markdown--chat-prose");
  });

  // 边界：混合 markdown 形态（## 标题 + 列表 + 段落）—— 两种模式都挂 long-prose
  test("mixed ## heading + list + paragraph: both disk and streaming get long-prose", () => {
    const mixed = "## 步骤\n\n1. 第一步\n2. 第二步\n\n注意事项：\n\n- 小心编码";
    const disk = chatAssistantTextPartClassNames(mixed, false);
    expect(disk.partClassName).toContain("app-message-part--long-prose");
    const stream = chatAssistantTextPartClassNames(mixed, true);
    expect(stream.partClassName).toContain("app-message-part--long-prose");
  });

  // 边界：极长单段（> 720 字符）—— 兜底规则在两种模式都挂 long-prose
  test("very long single paragraph (>720 chars): both modes get long-prose via length fallback", () => {
    const long = "这是很长很长的单段文字" + "x".repeat(800);
    const disk = chatAssistantTextPartClassNames(long, false);
    expect(disk.partClassName).toContain("app-message-part--long-prose");
    const stream = chatAssistantTextPartClassNames(long, true);
    expect(stream.partClassName).toContain("app-message-part--long-prose");
  });

  // 边界：空字符串 —— 不会抛异常，className 是基础 text part
  test("empty text: returns base text part without long-prose/completion-summary", () => {
    const { partClassName, markdownClassName } = chatAssistantTextPartClassNames("", false);
    expect(partClassName).toBe("app-message-part app-message-part--text");
    expect(markdownClassName).toBeUndefined();
    const stream = chatAssistantTextPartClassNames("", true);
    expect(stream.partClassName).toBe("app-message-part app-message-part--text");
    expect(stream.markdownClassName).toBeUndefined();
  });

  // 边界：纯空白 —— 不会挂卡片
  test("whitespace-only text: no card", () => {
    const { partClassName } = chatAssistantTextPartClassNames("   \n\n   ", false);
    expect(partClassName).toBe("app-message-part app-message-part--text");
    const stream = chatAssistantTextPartClassNames("   \n\n   ", true);
    expect(stream.partClassName).toBe("app-message-part app-message-part--text");
  });

  // 字节级等价（磁盘态）：不传 streaming / 传 undefined / 传 false 三种调用结果完全相同
  test("DISK byte-equivalence: undefined / omitted / false / absent streaming arg all identical", () => {
    const samples = [
      "好的，我来处理。",
      "1. 第一步\n2. 第二步\n3. 第三步",
      "## 标题\n\n一段内容",
      "第一步说明\n\n第二步说明",
      "a".repeat(800),
    ];
    for (const text of samples) {
      const omitted = chatAssistantTextPartClassNames(text);
      const undef = chatAssistantTextPartClassNames(text, undefined);
      const falseArg = chatAssistantTextPartClassNames(text, false);
      expect(undef.partClassName).toBe(omitted.partClassName);
      expect(undef.markdownClassName).toBe(omitted.markdownClassName);
      expect(falseArg.partClassName).toBe(omitted.partClassName);
      expect(falseArg.markdownClassName).toBe(omitted.markdownClassName);
    }
  });

  // 磁盘态多形态：heading+list、bold+list、bold+headings+paragraphs —— 字节级稳定
  test("DISK byte-equivalence: multiple markdown shapes return stable long-prose classification", () => {
    // 三个按现有规则命中 long-prose（非 summary）的形态：纯稳定性 + 长 prose className 字节级锁定
    const samples = [
      // heading + 有序列表 + outro（避免 summary 关键词）：heading+listItems>=2 命中
      "## 步骤\n\n1. a\n2. b\n\n注意事项",
      // bold ×2 + 列表 + 段：boldSectionHeaders=2 + paragraphs=3 命中
      "**A 节**\n\n- 1\n- 2\n\n**B 节**\n\n- 3\n- 4",
      // 极长单段（>=720 字符）：兜底规则命中
      "a".repeat(800),
    ];
    for (const text of samples) {
      const a = chatAssistantTextPartClassNames(text);
      const b = chatAssistantTextPartClassNames(text);
      expect(a.partClassName).toBe(b.partClassName);
      expect(a.markdownClassName).toBe(b.markdownClassName);
      expect(a.partClassName).toContain("app-message-part--long-prose");
      expect(a.partClassName).not.toContain("app-message-part--completion-summary");
      expect(a.markdownClassName).toBe("app-markdown--chat-prose");
    }
  });
});

describe("splitCliOutputAndMarkdownSummary", () => {
  test("splits eslint stdout from trailing summary markdown", () => {
    const output = [
      "✓ 0 problems",
      "",
      "零错误。全部改动已就绪，以下是总结：",
      "",
      "## ✅ 大屏视频播放功能 — 完成",
    ].join("\n");
    const split = splitCliOutputAndMarkdownSummary(output);
    expect(split?.cli).toBe("✓ 0 problems");
    expect(split?.markdown.startsWith("零错误")).toBe(true);
  });
});
