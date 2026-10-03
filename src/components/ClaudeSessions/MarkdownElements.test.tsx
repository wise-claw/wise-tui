import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownBody } from "./MarkdownElements";

describe("MarkdownBody inline code labels", () => {
  test("renders bold metadata labels from the reported session message", () => {
    const source = "- **元数据**保留 `**Type:** Build`、`**Languages:** Python`。";
    const html = renderToStaticMarkup(<MarkdownBody source={source} />);
    expect(html).toContain("<strong>元数据</strong>");
    expect(html).toContain("<code><strong>Type:</strong> Build</code>");
    expect(html).toContain("<code><strong>Languages:</strong> Python</code>");
    expect(html).not.toContain("**Type:**");
  });

  test("preserves literal Markdown examples and fenced code", () => {
    const source = "`**bold**` and `const value = 1`\n\n```ts\nconst label = \"**Type:** Build\";\n```";
    const html = renderToStaticMarkup(<MarkdownBody source={source} />);
    expect(html).toContain("<code>**bold**</code>");
    expect(html).toContain("<code>const value = 1</code>");
    expect(html).toContain("**Type:** Build");
    expect(html).not.toContain("<strong>Type:</strong>");
  });
});
