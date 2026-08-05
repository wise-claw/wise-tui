import { describe, expect, test } from "bun:test";
import {
  isMermaidFenceLanguage,
  looksLikeMermaidSource,
  shouldRenderFencedBlockAsMermaid,
  splitMermaidSourceAndTrailingMarkdown,
  wrapEmbeddedMermaidBlocks,
  wrapMermaidBlocksInMarkdown,
} from "./mermaidBlock";

describe("isMermaidFenceLanguage", () => {
  test("recognizes common mermaid fence tags", () => {
    expect(isMermaidFenceLanguage("mermaid")).toBe(true);
    expect(isMermaidFenceLanguage("flowchart")).toBe(true);
    expect(isMermaidFenceLanguage("graph")).toBe(true);
    expect(isMermaidFenceLanguage("flowchart TB")).toBe(true);
    expect(isMermaidFenceLanguage("graph LR")).toBe(true);
    expect(isMermaidFenceLanguage("python")).toBe(false);
  });
});

describe("looksLikeMermaidSource", () => {
  test("detects flowchart and sequence diagrams", () => {
    expect(looksLikeMermaidSource("flowchart TB")).toBe(true);
    expect(looksLikeMermaidSource("flowchart TB\n  A --> B")).toBe(true);
    expect(looksLikeMermaidSource("sequenceDiagram\n  Alice->>Bob: hi")).toBe(true);
    expect(looksLikeMermaidSource("import os")).toBe(false);
  });
});

describe("shouldRenderFencedBlockAsMermaid", () => {
  test("accepts explicit mermaid fences even for short bodies", () => {
    expect(shouldRenderFencedBlockAsMermaid("flowchart LR\n  A --> B", "mermaid")).toBe(true);
    expect(shouldRenderFencedBlockAsMermaid("flowchart TB", "mermaid")).toBe(true);
  });

  test("accepts flowchart TB with empty fence lang", () => {
    expect(shouldRenderFencedBlockAsMermaid("flowchart TB", "")).toBe(true);
    expect(shouldRenderFencedBlockAsMermaid("flowchart TB\n  A --> B", "")).toBe(true);
  });

  test("rejects real programming languages", () => {
    expect(shouldRenderFencedBlockAsMermaid("flowchart TD\n  A --> B", "typescript")).toBe(false);
  });

  test("accepts text/plain fences when body is mermaid", () => {
    expect(shouldRenderFencedBlockAsMermaid("flowchart TB\n  A --> B", "text")).toBe(true);
    expect(shouldRenderFencedBlockAsMermaid("flowchart TB\n  A --> B", "plaintext")).toBe(true);
  });

  test("accepts flowchart direction in fence info", () => {
    expect(shouldRenderFencedBlockAsMermaid("flowchart TB\n  A --> B", "flowchart TB")).toBe(true);
  });
});

describe("wrapMermaidBlocksInMarkdown", () => {
  test("wraps bare flowchart TB source", () => {
    const source = "flowchart TB\n  subgraph ENTRY\n    CLI[CLI]\n  end";
    const wrapped = wrapMermaidBlocksInMarkdown(source);
    expect(wrapped.startsWith("```mermaid\n")).toBe(true);
    expect(wrapped.endsWith("\n```")).toBe(true);
  });

  test("wraps single-line flowchart TB", () => {
    expect(wrapMermaidBlocksInMarkdown("flowchart TB")).toBe("```mermaid\nflowchart TB\n```");
  });

  test("wraps embedded flowchart in mixed markdown", () => {
    const source = [
      "架构如下：",
      "",
      "flowchart TB",
      "  A[Start] --> B[End]",
    ].join("\n");
    const wrapped = wrapEmbeddedMermaidBlocks(source);
    expect(wrapped).toContain("```mermaid");
    expect(wrapped).toContain("flowchart TB");
    expect(wrapped).toContain("架构如下：");
  });

  test("leaves non-mermaid text unchanged", () => {
    const source = "## Title\n\n- item";
    expect(wrapMermaidBlocksInMarkdown(source)).toBe(source);
  });

  test("does not swallow trailing markdown heading into mermaid fence", () => {
    const source = [
      "flowchart TD",
      "  A[用户访问页面] --> B[浏览器带 Cookie 请求后端]",
      "  I --> J[AdminLayout 再校验，失败去 /401]",
      "",
      "## 1. 登录态：后端统一认证，前端只做拦截跳转",
      "",
      "核心判断在拦截器。",
    ].join("\n");
    const wrapped = wrapMermaidBlocksInMarkdown(source);
    expect(wrapped).toContain("```mermaid\n");
    expect(wrapped).toContain("J[AdminLayout 再校验，失败去 /401]\n```");
    expect(wrapped).toContain("## 1. 登录态：后端统一认证，前端只做拦截跳转");
    expect(wrapped.indexOf("```")).toBeLessThan(wrapped.indexOf("## 1."));
    // 标题必须在围栏外
    const fenceEnd = wrapped.indexOf("\n```\n");
    expect(fenceEnd).toBeGreaterThan(0);
    expect(wrapped.slice(fenceEnd + 5)).toContain("## 1.");
    expect(wrapped.slice(0, fenceEnd)).not.toContain("## 1.");
  });

  test("splits glued markdown heading after node close bracket", () => {
    const source =
      "flowchart TD\n  I --> J[AdminLayout 再校验，失败去 /401]## 1. 登录态：后端统一认证";
    const wrapped = wrapMermaidBlocksInMarkdown(source);
    expect(wrapped).toContain("J[AdminLayout 再校验，失败去 /401]\n```");
    expect(wrapped).toContain("## 1. 登录态：后端统一认证");
    expect(wrapped).not.toContain("]##");
  });
});

describe("splitMermaidSourceAndTrailingMarkdown", () => {
  test("unglues and cuts at ATX heading", () => {
    const { mermaid, trailingMarkdown } = splitMermaidSourceAndTrailingMarkdown(
      "flowchart TD\n  I --> J[x /401]## 1. 登录态\n\n正文",
    );
    expect(mermaid).toBe("flowchart TD\n  I --> J[x /401]");
    expect(trailingMarkdown).toContain("## 1. 登录态");
    expect(trailingMarkdown).toContain("正文");
  });
});
