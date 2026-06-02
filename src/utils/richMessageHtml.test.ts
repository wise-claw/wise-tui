import { describe, expect, test } from "bun:test";
import {
  findHtmlDocumentStartIndex,
  messageContainsHtmlDocument,
  splitRichMessageContent,
} from "./richMessageHtml";

describe("richMessageHtml", () => {
  test("findHtmlDocumentStartIndex locates doctype and html tags", () => {
    const intro = "以下是页面内容：\n";
    const doc = "<!DOCTYPE html><html><body></body></html>";
    const text = intro + doc;
    expect(findHtmlDocumentStartIndex(text)).toBe(intro.length);
    expect(findHtmlDocumentStartIndex("<HTML lang=\"zh\">")).toBe(0);
  });

  test("splitRichMessageContent separates markdown preamble from html body", () => {
    const text = "说明文字\n<!DOCTYPE html><html><body><h1>Hi</h1></body></html>";
    expect(splitRichMessageContent(text)).toEqual({
      kind: "mixed",
      markdown: "说明文字",
      html: "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>",
    });
  });

  test("splitRichMessageContent treats pure html as html-only", () => {
    const html = "<!DOCTYPE html><html><body></body></html>";
    expect(splitRichMessageContent(html)).toEqual({ kind: "html", html });
  });

  test("splitRichMessageContent leaves markdown-only messages unchanged", () => {
    const md = "## Title\n\n- item";
    expect(splitRichMessageContent(md)).toEqual({ kind: "markdown", markdown: md });
    expect(messageContainsHtmlDocument(md)).toBe(false);
  });
});
