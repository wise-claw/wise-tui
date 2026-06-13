import { describe, expect, test } from "bun:test";
import {
  isMermaidFenceLanguage,
  looksLikeMermaidSource,
  shouldRenderFencedBlockAsMermaid,
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
});
