import DOMPurify from "dompurify";

/** Codex 等引擎常返回完整 HTML 页面；marked 会将其包进 `<p>` 导致标签以纯文本显示。 */
const HTML_DOCUMENT_START_RE = /<!doctype\s+html\b|<html[\s>/]/i;

export type RichMessageSplit =
  | { kind: "markdown"; markdown: string }
  | { kind: "html"; html: string }
  | { kind: "mixed"; markdown: string; html: string };

export function findHtmlDocumentStartIndex(text: string): number | null {
  const match = HTML_DOCUMENT_START_RE.exec(text);
  return match ? match.index : null;
}

export function splitRichMessageContent(text: string): RichMessageSplit {
  const idx = findHtmlDocumentStartIndex(text);
  if (idx === null) {
    return { kind: "markdown", markdown: text };
  }
  const markdown = text.slice(0, idx).trimEnd();
  const html = text.slice(idx).trim();
  if (!markdown) {
    return { kind: "html", html };
  }
  return { kind: "mixed", markdown, html };
}

export function messageContainsHtmlDocument(text: string): boolean {
  return findHtmlDocumentStartIndex(text) !== null;
}

export function sanitizeRichMessageHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ["style", "script"],
  });
}
