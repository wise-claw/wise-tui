import { describe, expect, test } from "bun:test";
import { HTTP_URL_BODY_RE, normalizeAutolinkUrl, plainTextToLinkedHtml } from "./autolinkUrl";

describe("normalizeAutolinkUrl", () => {
  test("strips trailing CJK and fullwidth period after path", () => {
    const raw = "https://cursor.com/cn/docs/sdk/typescript修复下。";
    expect(normalizeAutolinkUrl(raw)).toBe("https://cursor.com/cn/docs/sdk/typescript");
  });

  test("strips trailing CJK from percent-encoded href", () => {
    const encoded =
      "https://cursor.com/cn/docs/sdk/typescript%E4%BF%AE%E5%A4%8D%E4%B8%8B%E3%80%82";
    expect(normalizeAutolinkUrl(encoded)).toBe("https://cursor.com/cn/docs/sdk/typescript");
  });

  test("strips ASCII sentence punctuation", () => {
    expect(normalizeAutolinkUrl("https://example.com/foo).")).toBe("https://example.com/foo");
  });

  test("keeps valid path and query", () => {
    expect(normalizeAutolinkUrl("https://example.com/a/b?q=1&x=2")).toBe(
      "https://example.com/a/b?q=1&x=2",
    );
  });
});

describe("plainTextToLinkedHtml", () => {
  test("wraps http(s) URLs in clickable anchors", () => {
    const html = plainTextToLinkedHtml("链接: https://code.alipay.com/ant-party/ant-party-web/pull_requests/2758");
    expect(html).toContain('href="https://code.alipay.com/ant-party/ant-party-web/pull_requests/2758"');
    expect(html).toContain('class="app-markdown-link"');
    expect(html).toContain("链接:");
  });

  test("escapes HTML before linkifying", () => {
    const html = plainTextToLinkedHtml("<script>https://example.com</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("HTTP_URL_BODY_RE", () => {
  test("does not consume CJK immediately after path", () => {
    const text = "参考https://cursor.com/cn/docs/sdk/typescript修复下。";
    HTTP_URL_BODY_RE.lastIndex = 0;
    const m = HTTP_URL_BODY_RE.exec(text);
    expect(m?.[0]).toBe("https://cursor.com/cn/docs/sdk/typescript");
  });
});
