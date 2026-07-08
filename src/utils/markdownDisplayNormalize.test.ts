import { describe, expect, test } from "bun:test";
import {
  breakCollapsedPipeTableOnLine,
  containsStreamingHtmlMarkup,
  htmlDocumentToMarkdown,
  llmHtmlFragmentToMarkdown,
  looksLikeLlmHtmlFragment,
  normalizeMarkdownForDisplay,
  normalizeInlineMarkdownStructures,
  normalizePipeTables,
  normalizeTableSeparatorRows,
  recoverSplitPipeTableBlocks,
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

  test("splits heading-into-emphasis inline so heading body stays separate", () => {
    const raw = "## 一、项目定位 **Wise 是一款基于 Tauri 2 的桌面 AI 研发工作台**，以 Claude Code 为底座";
    const out = normalizeInlineMarkdownStructures(raw);
    const lines = out.split("\n");
    expect(lines[0]).toBe("## 一、项目定位");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("**Wise 是一款基于 Tauri 2 的桌面 AI 研发工作台**，以 Claude Code 为底座");
  });

  test("splits heading underline-style emphasis trailing chunk", () => {
    const raw = "### 关键能力 __亮点__ 一段说明文字";
    const out = normalizeInlineMarkdownStructures(raw);
    expect(out).toMatch(/^### 关键能力\s*$/m);
    expect(out).toMatch(/\n\n__亮点__/);
  });

  test("does not split headings when emphasis is inside backticks", () => {
    const raw = "## 标题 `**不会拆**` 继续正文";
    const out = normalizeInlineMarkdownStructures(raw);
    expect(out).toBe(raw);
  });

  test("does not split a heading with no trailing emphasis", () => {
    const raw = "## 仅有一句话的标题";
    const out = normalizeInlineMarkdownStructures(raw);
    expect(out).toBe(raw);
  });

  test("renders heading + emphasis as h2 + paragraph after split", async () => {
    const { marked } = await import("marked");
    marked.use({ gfm: true, breaks: true });
    const raw = "## 一、项目定位 **Wise 是一款基于 Tauri 2 的桌面 AI 研发工作台**，以 Claude Code 为底座";
    const normalized = normalizeMarkdownForDisplay(raw);
    const html = String(marked.parse(normalized, { gfm: true, breaks: true }));
    expect(html).toMatch(/<h2[^>]*>一、项目定位<\/h2>/);
    expect(html).toMatch(/<p><strong>Wise 是一款基于 Tauri 2 的桌面 AI 研发工作台<\/strong>/);
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

describe("recoverSplitPipeTableBlocks", () => {
  test("moves single short non-pipe line between header and data rows out of the table", () => {
    const input = [
      "| ID | TITLE | CREATOR | URL |",
      "435528714",
      "| 2738 | feat-fh | 许事 | https://x.com |",
    ].join("\n");
    const out = recoverSplitPipeTableBlocks(input);
    const lines = out.split("\n");
    // 表头 + 分隔行 + 数据行（连续），短文本以 caption 形式移到表后并前后空行
    expect(lines[0]).toBe("| ID | TITLE | CREATOR | URL |");
    expect(lines[1]).toBe("| --- | --- | --- | --- |");
    expect(lines[2]).toBe("| 2738 | feat-fh | 许事 | https://x.com |");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("435528714");
  });

  test("renders recovered PR table as <table> with one body row", async () => {
    const { parseMarkdownSourceToHtml } = await import("./markdownRenderPipeline");
    const input = [
      "| ID | TITLE | CREATOR | URL |",
      "435528714",
      "| 2738 | feat-fh | 许事 | https://x.com |",
    ].join("\n");
    const html = parseMarkdownSourceToHtml(input, { streaming: false });
    expect(html).toContain("<table");
    expect(html).toContain("<td>2738</td>");
    expect(html).toContain("<td>feat-fh</td>");
    expect(html).toContain("<p>435528714</p>");
  });

  test("leaves continuous pipe tables unchanged", () => {
    const input = [
      "| ID | TITLE |",
      "| --- | --- |",
      "| 1 | a |",
    ].join("\n");
    expect(recoverSplitPipeTableBlocks(input)).toBe(input);
  });

  test("does not move long non-pipe interruptions (>80 chars)", () => {
    const input = [
      "| ID | TITLE |",
      "x".repeat(120),
      "| 1 | a |",
    ].join("\n");
    const out = recoverSplitPipeTableBlocks(input);
    // 短文本判定失败，函数应回退到原样输出
    expect(out).toBe(input);
  });

  test("does not move interruption containing a pipe character", () => {
    const input = [
      "| ID | TITLE |",
      "435528714 | 备注",
      "| 1 | a |",
    ].join("\n");
    const out = recoverSplitPipeTableBlocks(input);
    expect(out).toBe(input);
  });
});

describe("breakCollapsedPipeTableOnLine", () => {
  // 用户原样本：表头 + ASCII ----+----+ 分隔 + 数据行（数据行无前导 |），整段塌成 1 行
  const COLLAPSED_SAMPLE =
    "| IID | TITLE | CREATOR | URL ------------+------+---------+---------+--------------------------------------------------------------------- 435540123 | 2747 | feat-fh | 铮睿 | https://code.alipay.com/ant-party/ant-party-web/pull_requests/2747";

  test("splits a collapsed single-line pipe table into header / separator / data", () => {
    const out = breakCollapsedPipeTableOnLine(COLLAPSED_SAMPLE);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // 表头被识别为 4 列（原始样本表头漏了末 `|`,所以只断言含 4 个标题词）
    expect(lines[0]).toContain("IID");
    expect(lines[0]).toContain("TITLE");
    expect(lines[0]).toContain("CREATOR");
    expect(lines[0]).toContain("URL");
    // 分隔行由 buildSeparatorRow 复算：表头 4 列是 canonical（GFM 要求 sep
    // 列数 = header 列数），数据行 5 列中的末两列被合并进末格。
    expect(lines[1]).toBe("| --- | --- | --- | --- |");
    // 数据行被补上前导 `|`,末两列合并到 URL 末格
    expect(lines[2]).toContain("| 435540123 |");
    expect(lines[2]).toContain("| 2747 |");
    expect(lines[2]).toContain("feat-fh");
    expect(lines[2]).toContain("铮睿");
    expect(lines[2]).toContain("https://code.alipay.com/ant-party/ant-party-web/pull_requests/2747");
  });

  test("renders the collapsed sample end-to-end as a 4-column GFM table", async () => {
    const { parseMarkdownSourceToHtml } = await import("./markdownRenderPipeline");
    const html = parseMarkdownSourceToHtml(COLLAPSED_SAMPLE, { streaming: false });
    expect(html).toContain("<table");
    expect(html).toContain("<th>IID</th>");
    expect(html).toContain("<th>TITLE</th>");
    expect(html).toContain("<th>CREATOR</th>");
    expect(html).toContain("<th>URL</th>");
    expect(html).toContain("<td>feat-fh</td>");
    // 末列合并了「铮睿, URL」（URL 部分被 marked 渲染成 <a>），不拆开
    expect(html).toContain("铮睿,");
    expect(html).toContain("https://code.alipay.com/ant-party/ant-party-web/pull_requests/2747");
  });

  test("pads data row missing leading pipe (435540123 | 2747 | ...)", () => {
    // 表头 `| a | b |` = 2 列；数据 `1 | x | y |` 在补前导 `|` 后为 3 列。
    // headerCols=2 是 canonical，dataCols=3 多 1 列被合并到末格（`, ` join），
    // 数据行末格变成 `x, y`，分隔行保持 2 列。
    const out = breakCollapsedPipeTableOnLine(
      "| a | b | ----+---+ 1 | x | y |",
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("| a | b |");
    expect(lines[1]).toBe("| --- | --- |");
    // dataChunk 被补前导 `|`,首列 `1` 正确成为表的第一格
    expect(lines[2].trimStart().startsWith("|")).toBe(true);
    expect(lines[2]).toContain("| 1 | x, y |");
  });

  test("leaves a well-formed 4-row GFM table unchanged (no regression)", () => {
    const input = [
      "| ID | TITLE |",
      "| --- | --- |",
      "| 1 | a |",
      "| 2 | b |",
    ].join("\n");
    // 合规 GFM 表不应被 breakCollapsedPipeTableOnLine 改动（line 仍以 `|` 开头
    // 但不含 -+{3,} 簇外加 pipe；含 `---` 但 anchor 检测会在表头行/数据行先失败）
    // 关键断言：表内容与原文等价,且最终仍渲染为 <table>
    const out = normalizeInlineMarkdownStructures(input);
    expect(out).toContain("| ID | TITLE |");
    expect(out).toContain("| --- | --- |");
    expect(out).toContain("| 1 | a |");
    expect(out).toContain("| 2 | b |");
    // 行数应保持 4 行（不插入额外的 ---- 行）
    expect(out.split("\n").length).toBe(4);
  });

  test("preserves preceding paragraph when a collapsed table follows it", () => {
    const raw = `以下是本周 PR 列表：\n${COLLAPSED_SAMPLE}`;
    const out = normalizeInlineMarkdownStructures(raw);
    expect(out.startsWith("以下是本周 PR 列表：\n")).toBe(true);
    expect(out).toContain("IID");
    expect(out).toContain("TITLE");
    expect(out).toContain("CREATOR");
    expect(out).toContain("URL");
    expect(out).toContain("| --- | --- | --- | --- |");
  });

  test("does not split shell-style `| foo + bar |` (single +, not 3+ consecutive)", () => {
    const out = breakCollapsedPipeTableOnLine("| shell hint: foo + bar |");
    expect(out).toBe("| shell hint: foo + bar |");
    // 整行仍只有 1 个 `|`,不应被改成多行
    expect(out.split("\n").length).toBe(1);
  });

  test("streaming path also produces <table> for the collapsed sample", async () => {
    const { parseMarkdownSourceToHtml } = await import("./markdownRenderPipeline");
    const html = parseMarkdownSourceToHtml(COLLAPSED_SAMPLE, { streaming: true });
    expect(html).toContain("<table");
    expect(html).toContain("<th>IID</th>");
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
