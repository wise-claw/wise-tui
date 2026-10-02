import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentCanvasPreview } from "./DocumentCanvasPreview";
import { ConversationCanvasButton } from "./ConversationCanvasButton";

test("product proposals render as a readable document with tables and diagrams, not executable HTML", () => {
  const html = renderToStaticMarkup(<DocumentCanvasPreview path="产品方案.md" content={'# 产品设计\n\n<p align="center">居中 <b>加粗</b></p>\n\n<img src="assets/banner.svg" alt="横幅" width="100%">\n\n| 功能 | 优先级 |\n| --- | --- |\n| 搜索 | P0 |\n\n```mermaid\ngraph LR\nA-->B\n```\n<script>alert(1)</script>'} />);
  expect(html).toContain("产品设计");
  expect(html).toContain('<p align="center">居中 <b>加粗</b></p>');
  expect(html).toContain('<img src="assets/banner.svg" alt="横幅" width="100%"/>');
  expect(html).toContain("<table");
  expect(html).toContain("mermaid");
  expect(html).toContain("画布缩放");
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("<script>");
});

test("conversation exposes Canvas without mounting or running a preview until clicked", () => {
  const html = renderToStaticMarkup(<ConversationCanvasButton source="# 产品方案" />);
  expect(html).toContain("画布查看");
  expect(html).not.toContain("iframe");
  expect(renderToStaticMarkup(<ConversationCanvasButton source="  " />)).toBe("");
});
