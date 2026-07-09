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
