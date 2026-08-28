import { describe, expect, test } from "bun:test";
import {
  buildChromeSelectionRequirementMarkdown,
  chromeSelectionHasContent,
  normalizeChromeSelectionRequirementEvent,
} from "./chromeSelectionRequirement";

describe("normalizeChromeSelectionRequirementEvent", () => {
  test("接受 camelCase 并丢掉无效图片", () => {
    const event = normalizeChromeSelectionRequirementEvent({
      text: "  改按钮颜色  ",
      pageUrl: "https://example.com/app",
      pageTitle: "设计稿",
      images: [
        { alt: "主按钮", path: "/Users/me/.wise/composer-images/a.png" },
        { alt: "坏路径", path: "relative.png" },
        { alt: "远端", url: "https://cdn.example.com/b.png" },
        { alt: "重复", path: "/Users/me/.wise/composer-images/a.png" },
        { alt: "javascript", url: "javascript:alert(1)" },
        null,
      ],
    });
    expect(event).toEqual({
      text: "改按钮颜色",
      pageUrl: "https://example.com/app",
      pageTitle: "设计稿",
      images: [
        { alt: "主按钮", path: "/Users/me/.wise/composer-images/a.png" },
        { alt: "远端", url: "https://cdn.example.com/b.png" },
      ],
    });
  });

  test("兼容 snake_case 页信息", () => {
    const event = normalizeChromeSelectionRequirementEvent({
      text: "hello",
      page_url: "https://example.com",
      page_title: "Demo",
      images: [],
    });
    expect(event?.pageUrl).toBe("https://example.com");
    expect(event?.pageTitle).toBe("Demo");
  });
});

describe("chromeSelectionHasContent", () => {
  test("文字或图片任一即可", () => {
    expect(
      chromeSelectionHasContent({
        text: "",
        pageUrl: "",
        pageTitle: "",
        images: [{ alt: "", url: "https://cdn.example.com/a.png" }],
      }),
    ).toBe(true);
    expect(
      chromeSelectionHasContent({
        text: "只要文字",
        pageUrl: "",
        pageTitle: "",
        images: [],
      }),
    ).toBe(true);
    expect(
      chromeSelectionHasContent({
        text: "  ",
        pageUrl: "https://example.com",
        pageTitle: "x",
        images: [],
      }),
    ).toBe(false);
  });
});

describe("buildChromeSelectionRequirementMarkdown", () => {
  test("图文混排并附加来源", () => {
    const markdown = buildChromeSelectionRequirementMarkdown({
      text: "把登录按钮改成蓝色",
      pageUrl: "https://example.com/login",
      pageTitle: "登录页",
      images: [
        { alt: "当前按钮", path: "/tmp/a.png" },
        { alt: "参考", url: "https://cdn.example.com/ref.png" },
      ],
    });
    expect(markdown).toBe(
      [
        "把登录按钮改成蓝色",
        "",
        "![当前按钮](/tmp/a.png)",
        "",
        "![参考](https://cdn.example.com/ref.png)",
        "",
        "来源：[登录页](https://example.com/login)",
      ].join("\n"),
    );
  });

  test("仅图片时用页面标题作正文", () => {
    const markdown = buildChromeSelectionRequirementMarkdown({
      text: "",
      pageUrl: "https://example.com/shot",
      pageTitle: "截图页",
      images: [{ alt: "", path: "/tmp/shot.png" }],
    });
    expect(markdown.startsWith("截图页")).toBe(true);
    expect(markdown).toContain("![网页图片](/tmp/shot.png)");
  });

  test("用户补充说明保留在正文前", () => {
    const markdown = buildChromeSelectionRequirementMarkdown({
      text: "按这个改登录按钮\n\n当前是灰色主按钮",
      pageUrl: "https://example.com/login",
      pageTitle: "登录页",
      images: [{ alt: "选区截图", path: "/tmp/shot.jpg" }],
    });
    expect(markdown.startsWith("按这个改登录按钮")).toBe(true);
    expect(markdown).toContain("![选区截图](/tmp/shot.jpg)");
  });

  test("转义标题中的方括号", () => {
    const markdown = buildChromeSelectionRequirementMarkdown({
      text: "修复",
      pageUrl: "https://example.com",
      pageTitle: "A [beta] 页",
      images: [],
    });
    expect(markdown).toContain("来源：[A beta 页](https://example.com)");
  });
});
