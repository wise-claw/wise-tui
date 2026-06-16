import { describe, expect, test } from "bun:test";
import {
  buildMarkdownDisplayHtml,
  clearMarkdownDisplayHtmlCache,
  coerceMarkdownSourceText,
  hasMarkdownStructureCues,
  isProseFenceLanguage,
  parseMarkdownSourceToHtml,
  planFencedBlockDisplay,
  renderRichMessageSourceToHtml,
  shouldRenderFencedBlockAsMarkdown,
  splitMarkdownAndTrailingDataLines,
  stabilizeStreamingMarkdown,
  unwrapProseFencedMarkdownSource,
} from "./markdownRenderPipeline";

describe("coerceMarkdownSourceText", () => {
  test("returns string input unchanged", () => {
    expect(coerceMarkdownSourceText("hello")).toBe("hello");
  });

  test("coerces nullish and non-string safely", () => {
    expect(coerceMarkdownSourceText(null)).toBe("");
    expect(coerceMarkdownSourceText(undefined)).toBe("");
    expect(coerceMarkdownSourceText(42)).toBe("42");
  });
});

describe("stabilizeStreamingMarkdown", () => {
  test("closes unclosed fenced code block", () => {
    const input = "说明：\n\n```bash\necho hi";
    const stabilized = stabilizeStreamingMarkdown(input);
    expect(stabilized.endsWith("```")).toBe(true);
    const html = parseMarkdownSourceToHtml(stabilized, { streaming: true });
    expect(html).toContain("<pre>");
    expect(html).toContain("echo hi");
  });

  test("leaves balanced fences unchanged", () => {
    const input = "```js\nconst x = 1;\n```";
    expect(stabilizeStreamingMarkdown(input)).toBe(input);
  });
});

describe("parseMarkdownSourceToHtml", () => {
  test("parses headings and bold for assistant-style Chinese markdown", () => {
    const source = [
      "## 1. Claude Code 首先读取 .claude/settings.json",
      "",
      "**配置目录 .claude/ + Trellis 自己的 .trellis/ 状态/规范/任务系统**",
      "",
      "* SessionStart",
      "* UserPromptSubmit",
    ].join("\n");
    const html = parseMarkdownSourceToHtml(source);
    expect(html).toContain("<h2>");
    expect(html).toContain("<strong>配置目录");
    expect(html).not.toContain("## 1.");
    expect(html).not.toContain("**配置目录");
  });

  test("renders pipe tables after normalization", () => {
    const source = [
      "| 指标 | 数量 |",
      "| 总源文件 | 2262 个 |",
    ].join("\n");
    const html = parseMarkdownSourceToHtml(source);
    expect(html).toContain("<table");
    expect(html).not.toContain("| 总源文件 |");
  });

  test("does not leave raw markdown syntax in output", () => {
    const html = parseMarkdownSourceToHtml("## Title\n\n- item one\n- item two");
    expect(html).toContain("<h2>");
    expect(html).toContain("<li>");
    expect(html).not.toMatch(/## Title/);
    expect(html).not.toMatch(/^\s*-\s+item/m);
  });
});

describe("renderRichMessageSourceToHtml", () => {
  test("renders html document as markdown instead of html embed", () => {
    const htmlDoc = "<!doctype html><html><body><p>Hello</p></body></html>";
    const html = renderRichMessageSourceToHtml(htmlDoc);
    expect(html).not.toContain("app-markdown-html-embed");
    expect(html).toContain("Hello");
  });

  test("renders mixed markdown preamble and html document as markdown", () => {
    const text = "说明文字\n<!DOCTYPE html><html><body><h1>Hi</h1></body></html>";
    const html = renderRichMessageSourceToHtml(text);
    expect(html).not.toContain("app-markdown-html-embed");
    expect(html).toContain("说明文字");
    expect(html).toContain("Hi");
    expect(html).toMatch(/<h1[^>]*>/);
  });

  test("renders glm-style html fragments as markdown", () => {
    const fragment = "<p>## Section</p><p>**bold**</p>";
    const html = renderRichMessageSourceToHtml(fragment);
    expect(html).toContain("<h2>");
    expect(html).toContain("<strong>bold</strong>");
  });
});

describe("prose fenced blocks", () => {
  test("detects invalid fence language from markdown syntax leak", () => {
    expect(isProseFenceLanguage("**5**")).toBe(true);
    expect(isProseFenceLanguage("markdown")).toBe(true);
    expect(isProseFenceLanguage("python")).toBe(false);
  });

  test("unwraps single prose fence before marked parse", () => {
    const fenced = [
      "```**5**",
      "| 组件 | 说明 |",
      "| --- | --- |",
      "| **Local** | 本地 |",
      "```",
    ].join("\n");
    expect(unwrapProseFencedMarkdownSource(fenced)).not.toContain("```");
    const html = parseMarkdownSourceToHtml(fenced);
    expect(html).toContain("<table");
    expect(html).toContain("<strong>Local</strong>");
    expect(html).not.toContain("<pre>");
  });

  test("keeps real code fences as pre", () => {
    const fenced = "```python\nimport os\nprint(os.getcwd())\n```";
    expect(unwrapProseFencedMarkdownSource(fenced)).toBe(fenced);
    const html = parseMarkdownSourceToHtml(fenced);
    expect(html).toContain("<pre>");
    expect(html).toContain("import os");
  });

  test("shouldRenderFencedBlockAsMarkdown distinguishes prose vs shell", () => {
    const table = "| a | b |\n| --- | --- |\n| **x** | y |";
    expect(hasMarkdownStructureCues(table)).toBe(true);
    expect(shouldRenderFencedBlockAsMarkdown(table, "**5**")).toBe(true);
    expect(shouldRenderFencedBlockAsMarkdown("$ npm install\n$ npm test", "bash")).toBe(false);
  });

  test("shouldRenderFencedBlockAsMarkdown treats mislabeled json/bash fences as prose", () => {
    const markdownSummary = "## 校验\n\n- bun test pass\n- tsc exit 0";
    expect(shouldRenderFencedBlockAsMarkdown(markdownSummary, "json")).toBe(true);
    expect(shouldRenderFencedBlockAsMarkdown(markdownSummary, "bash")).toBe(true);
    expect(shouldRenderFencedBlockAsMarkdown("## 校验\n\n全部通过。", "bash")).toBe(true);
    expect(shouldRenderFencedBlockAsMarkdown("- [x] bun test\n- [x] tsc", "bash")).toBe(true);
    expect(shouldRenderFencedBlockAsMarkdown('{"layer":"tool","observed":true}', "json")).toBe(false);
    expect(shouldRenderFencedBlockAsMarkdown("# install deps\nnpm i", "bash")).toBe(false);
    expect(shouldRenderFencedBlockAsMarkdown('{"a":1}\n{"b":2}', "json")).toBe(false);
  });

  test("splitMarkdownAndTrailingDataLines separates summary from NDJSON tail", () => {
    const body = [
      "## 校验",
      "",
      "- bun test pass",
      "",
      '{"layer":"tool","kind":"tool_use","observed":true}',
      '{"layer":"tool","kind":"tool_use","observed":true,"summary":"Write"}',
    ].join("\n");
    const split = splitMarkdownAndTrailingDataLines(body);
    expect(split?.markdown).toContain("## 校验");
    expect(split?.dataLines).toContain('"layer":"tool"');
    expect(planFencedBlockDisplay(body, "json").kind).toBe("markdown-plus-data");
  });
});

describe("buildMarkdownDisplayHtml", () => {
  test("caches non-streaming output", () => {
    clearMarkdownDisplayHtmlCache();
    const source = "## Cached heading";
    const first = buildMarkdownDisplayHtml(source, { streaming: false });
    const second = buildMarkdownDisplayHtml(source, { streaming: false });
    expect(first).toBe(second);
    expect(first).toContain("<h2>");
  });

  test("skips cache while streaming", () => {
    clearMarkdownDisplayHtmlCache();
    const partial = "## Stream";
    buildMarkdownDisplayHtml(partial, { streaming: true });
    buildMarkdownDisplayHtml(partial, { streaming: false });
    const cached = buildMarkdownDisplayHtml(partial, { streaming: false });
    expect(cached).toContain("<h2>");
  });

  test("wraps bare flowchart source into mermaid fence before parse", () => {
    const source = "flowchart TB\n  subgraph ENTRY\n    CLI[CLI]\n  end";
    const html = parseMarkdownSourceToHtml(source);
    expect(html).toContain("language-mermaid");
    expect(html).toContain("subgraph ENTRY");
  });

  test("streaming partial codex html document renders markdown not raw html shell", () => {
    const chunks = [
      "说明如下：\n\n<!DOCTYPE html><html><head><meta",
      '说明如下：\n\n<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><h1>Report</h1>',
      '<!DOCTYPE html><html><body><h1>Report',
    ];
    for (const chunk of chunks) {
      const html = buildMarkdownDisplayHtml(chunk, { streaming: true });
      expect(html).not.toContain("app-markdown-html-embed");
      expect(html).not.toContain("<head");
      expect(html).not.toContain("<meta");
    }
    expect(buildMarkdownDisplayHtml(chunks[1]!, { streaming: true })).toMatch(/<h1[^>]*>Report/);
    expect(buildMarkdownDisplayHtml(chunks[2]!, { streaming: true })).toMatch(/<h1[^>]*>Report/);
  });
});
