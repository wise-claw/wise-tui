import { describe, expect, test } from "bun:test";
import type { ClaudeMessage } from "../types";
import {
  assistantMessagePostToolTextParts,
  assistantOrphanMarkdownText,
  cliToolOutputForExpandedBody,
  extractBashEmbeddedMarkdownSummary,
  looksLikeAssistantCompletionSummary,
  looksLikeStructuredMarkdownSummary,
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

  test("returns full content when parts only contain tools", () => {
    const msg: ClaudeMessage = {
      id: 1,
      role: "assistant",
      content: "已完成！\n\n## 总结",
      parts: [{ type: "tool_use", id: "t1", name: "Edit", input: {}, status: "completed" }],
      timestamp: 1,
    };
    expect(assistantOrphanMarkdownText(msg)).toBe("已完成！\n\n## 总结");
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
