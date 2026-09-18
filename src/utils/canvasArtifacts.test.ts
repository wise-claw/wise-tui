import { describe, expect, test } from "bun:test";
import { conversationCanvasArtifacts, isCanvasDocumentPath } from "./canvasArtifacts";

describe("conversation Canvas artifacts", () => {
  test("keeps product proposal, tables and diagrams intact", () => {
    const source = '# 产品方案\n\n| 功能 | 价值 |\n| --- | --- |\n| 搜索 | 提效 |\n\n```mermaid\ngraph LR\nA-->B\n```';
    expect(conversationCanvasArtifacts(source)).toEqual([{ title: "方案全文", path: "方案.md", content: source }]);
    expect(isCanvasDocumentPath("设计.MD")).toBe(true);
    expect(isCanvasDocumentPath("design.markdown")).toBe(true);
    expect(isCanvasDocumentPath("app.tsx")).toBe(false);
  });
  test("collects multiple complete pages and designs while retaining surrounding prose", () => {
    const source = '# 页面设计\n```html\n<h1>首页</h1>\n```\n~~~svg\n<svg/>\n~~~';
    const artifacts = conversationCanvasArtifacts(source);
    expect(artifacts.map((item) => item.title)).toEqual(["方案全文", "页面 1", "设计图 2"]);
    expect(artifacts[1].content).toBe("<h1>首页</h1>");
    expect(artifacts[2].path).toEndWith(".svg");
  });
  test("does not execute incomplete, nested-example or JSX fences", () => {
    expect(conversationCanvasArtifacts('```html\n<script>incomplete').length).toBe(1);
    expect(conversationCanvasArtifacts('```tsx\n<div/>\n```').length).toBe(1);
    expect(conversationCanvasArtifacts('````markdown\n```html\n<div/>\n```\n````').length).toBe(1);
    expect(conversationCanvasArtifacts('```html\n<div/>\n~~~').length).toBe(1);
  });
  test("bounds preview count for large messages", () => {
    expect(conversationCanvasArtifacts('```html\n<div/>\n```\n'.repeat(30)).length).toBe(13);
  });
});
