import { describe, expect, test } from "bun:test";
import {
  containsStreamingHtmlMarkup,
  htmlDocumentToMarkdown,
  llmHtmlFragmentToMarkdown,
  looksLikeLlmHtmlFragment,
  normalizeMarkdownForDisplay,
  normalizeInlineMarkdownStructures,
  normalizePipeTables,
  normalizeTableSeparatorRows,
  removeOrphanPipeLines,
} from "./markdownDisplayNormalize";
import { prepareMarkdownForDisplay } from "./markdownRenderPipeline";

const MCP_EXA_ASSISTANT_SNIPPET = `我检查一下当前可用的 MCP 工具:确认了 — **当前会话只接入了 \`codegraph\` 一个 MCP server,没有 Exa**。 ## 我之前的回答有误,纠正如下 我列出 \`mcp__exa__*\` 是**错误的** — 那是我的工具列表里看到的"agent 类型可能可用的工具",并不代表当前会话真的连了 Exa MCP。实际本会话**只有这些联网工具可用**: | 工具 | 状态 |
|------|------|
| **WebSearch** | ✅ 可用(内置,美国地区) |
| **WebFetch** | ✅ 可用(内置,15min 缓存) |
| **mcp__exa__web_search_exa** | ❌ 未连接 |
| **mcp__exa__get_code_context_exa** | ❌ 未连接 | ## 如果想接入 Exa Exa 是付费 MCP server,接入步骤大致是: \`\`\`bash
1. 申请 API key: https://exa.ai/
2. 配置 MCP server:
claude mcp add exa --env EXA_API_KEY=xxx -- npx -y exa-mcp-server
# 3. 验证
claude mcp list
\`\`\` 接入后会出现 \`mcp__exa__web_search_exa\` 等工具。 ## 现状下能做什么 只用 **WebSearch + WebFetch** 也能完成绝大多数研究任务,只是:
- 不如 Exa 适合学术/代码语义搜索
- 仅限美国地区结果
- WebFetch 不能访问需登录的页面 需要我用 WebSearch + WebFetch 帮你做点什么调研吗?`;

describe("normalizeInlineMarkdownStructures", () => {
  test("prepares Claude MCP exa assistant blob for GFM parsing", () => {
    const out = prepareMarkdownForDisplay(MCP_EXA_ASSISTANT_SNIPPET);
    expect(out).not.toContain("。 ##");
    expect(out).not.toContain("| ❌ 未连接 | ##");
    expect(out).toContain("| 工具 | 状态 |");
    expect(out).toContain("```bash");
    expect(out).toContain("claude mcp add exa");
    expect(out).toContain("## 现状下能做什么");
    expect(out).toContain("## 如果想接入 Exa");
  });
});

describe("normalizePipeTables", () => {
  test("removes orphan pipe-only lines before table blocks", () => {
    const input = ["**目录**:", "", "|", "", "| 章节 | 核心内容 |"].join("\n");
    expect(removeOrphanPipeLines(input)).not.toMatch(/^\|\s*$/m);
  });

  test("normalizes compact separator rows for remark-gfm", () => {
    const input = [
      "| 章节 | 核心内容 |",
      "|---|------|---------|",
      "| 一 | 四框架 |",
    ].join("\n");
    const out = normalizeTableSeparatorRows(input);
    expect(out).toContain("| --- | --- |");
    expect(out).not.toContain("|---|------|---------|");
    expect(out).not.toContain("| --- | --- | --- |");
  });

  test("prepares Phoenix delivery summary table for GFM parsing", () => {
    const input = [
      "设计文档已完成并通过完整性验证。",
      "",
      "#### 📄 Phoenix 整合方案交付总结",
      "",
      "**完整目录结构**(13 个章节):",
      "",
      "|",
      "",
      "| 章节 | 核心内容 |",
      "|---|------|---------|",
      "| 一 | 四框架核心特色对比 | 能力矩阵 × 4 框架 |",
      "| 二 | 第一性原理分析 | 5 公理 |",
    ].join("\n");
    const out = prepareMarkdownForDisplay(input);
    expect(out).not.toMatch(/^\|\s*$/m);
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 章节 | 核心内容 |");
    expect(out).toContain("| 一 | 四框架核心特色对比, 能力矩阵 × 4 框架 |");
  });

  test("inserts separator when GLM-style table omits it", () => {
    const input = [
      "| 总源文件 | 2262 个 |",
      "| 总代码行 | ~35.4 万行 |",
    ].join("\n");
    const out = normalizePipeTables(input);
    expect(out).toContain("| --- | --- |");
    expect(out.split("\n")).toHaveLength(3);
  });

  test("leaves valid GFM tables unchanged", () => {
    const input = [
      "| 文件 | 变更 |",
      "| --- | --- |",
      "| a.ts | 新增 |",
    ].join("\n");
    expect(normalizePipeTables(input)).toBe(input);
  });

  test("converts fullwidth pipes", () => {
    const input = "｜ a ｜ b ｜\n｜ c ｜ d ｜";
    const out = normalizePipeTables(input);
    expect(out).toContain("| --- | --- |");
    expect(out).not.toContain("｜");
  });

  test("does not touch single pipe row", () => {
    const input = "| only one row |";
    expect(normalizePipeTables(input)).toBe(input);
  });
});

describe("llmHtmlFragmentToMarkdown", () => {
  test("detects glm html fragments", () => {
    expect(looksLikeLlmHtmlFragment("<p>hello</p>")).toBe(true);
    expect(looksLikeLlmHtmlFragment("## pure markdown")).toBe(false);
    expect(
      looksLikeLlmHtmlFragment("<!DOCTYPE html><html><body></body></html>"),
    ).toBe(false);
  });

  test("unwraps pipe tables from p tags", () => {
    const html = [
      "<p>Let me look at key areas:</p>",
      "<ol><li>Overall</li><li>Size</li></ol>",
      "<p>| 指标 | 数量 |</p>",
      "<p>| 总源文件 | 2262 个 |</p>",
      "<p>| 总代码行 | ~35.4 万行 |</p>",
    ].join("");
    const md = llmHtmlFragmentToMarkdown(html);
    expect(md).toContain("Let me look at key areas:");
    expect(md).toContain("- Overall");
    expect(md).toContain("| 总源文件 | 2262 个 |");
    expect(md).not.toContain("<p>");
  });

  test("converts html table to pipe rows", () => {
    const html =
      "<table><tr><th>指标</th><th>数量</th></tr><tr><td>总源文件</td><td>2262</td></tr></table>";
    const md = llmHtmlFragmentToMarkdown(html);
    expect(md).toContain("| 指标 | 数量 |");
    expect(md).toContain("| 总源文件 | 2262 |");
  });

  test("htmlDocumentToMarkdown extracts body and converts headings", () => {
    const doc = "<!DOCTYPE html><html><body><h1>Title</h1><p>Body text</p></body></html>";
    const md = htmlDocumentToMarkdown(doc);
    expect(md).toContain("# Title");
    expect(md).toContain("Body text");
    expect(md).not.toContain("<h1>");
  });

  test("htmlDocumentToMarkdown strips partial head while streaming", () => {
    const partial = "<!DOCTYPE html><html><head><meta";
    expect(htmlDocumentToMarkdown(partial, { streaming: true })).toBe("");
    const withBody =
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>Report</h1>';
    const md = htmlDocumentToMarkdown(withBody, { streaming: true });
    expect(md).toContain("# Report");
    expect(md).not.toContain("<head");
  });

  test("streaming converts partial headings and links", () => {
    expect(llmHtmlFragmentToMarkdown("<h1>Report", { streaming: true })).toContain("# Report");
    expect(llmHtmlFragmentToMarkdown('Intro <a href="https://x.com">link', { streaming: true })).toContain(
      "[link](https://x.com)",
    );
  });

  test("streaming converts partial html tables to pipe rows", async () => {
    const { marked } = await import("marked");
    marked.use({ gfm: true, breaks: true });
    const partial = "<table><tr><th>指标</th><th>数量</th></tr><tr><td>A</td><td>1</td></tr>";
    const normalized = normalizeMarkdownForDisplay(partial, { streaming: true });
    const html = String(marked.parse(normalized, { gfm: true, breaks: true }));
    expect(html).toContain("<table");
    expect(html).toContain("指标");
    expect(html).toContain("A");
  });

  test("containsStreamingHtmlMarkup detects volatile tags", () => {
    expect(containsStreamingHtmlMarkup("<head><meta")).toBe(true);
    expect(containsStreamingHtmlMarkup("## pure markdown")).toBe(false);
  });
});

describe("normalizeMarkdownForDisplay", () => {
  test("renders table via marked after normalization", async () => {
    const { marked } = await import("marked");
    const raw = [
      "## 项目概况",
      "",
      "| 指标 | 数量 |",
      "| 总源文件 | 2262 个 |",
    ].join("\n");
    const html = String(marked.parse(normalizeMarkdownForDisplay(raw), { gfm: true, breaks: true }));
    expect(html).toContain("<table");
    expect(html).not.toContain("| 总源文件 |");
  });

  test("renders glm html fragment with table via marked", async () => {
    const { marked } = await import("marked");
    marked.use({ gfm: true, breaks: true });
    const htmlInput = [
      "<p>Let me look at key areas:</p>",
      "<ol><li>Overall</li><li>Size</li></ol>",
      "<p>| 指标 | 数量 |</p>",
      "<p>| 总源文件 | 2262 个 |</p>",
      "<p>| 总代码行 | ~35.4 万行 |</p>",
    ].join("");
    const normalized = normalizeMarkdownForDisplay(htmlInput);
    const html = String(marked.parse(normalized, { gfm: true, breaks: true }));
    expect(html).toContain("<table");
    expect(html).toContain("<ul>");
    expect(html).not.toMatch(/<p>\|/);
  });

  test("streaming partial html document does not leak head tags", async () => {
    const { buildMarkdownDisplayHtml } = await import("./markdownRenderPipeline");
    const partial = "分析如下：\n\n<!DOCTYPE html><html><head><meta";
    const html = buildMarkdownDisplayHtml(partial, { streaming: true });
    expect(html).not.toContain("app-markdown-html-embed");
    expect(html).not.toContain("<head");
    expect(html).not.toContain("<meta");
    expect(html).toContain("分析如下");
  });
});
