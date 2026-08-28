import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  clipRectToViewport,
  computeCropPixels,
  elementToMarkdown,
  fitCropSize,
  htmlFragmentToMarkdown,
  parseDataUrl,
  prependRequirementNote,
} from "./selection-capture.js";

beforeAll(() => {
  const domWindow = new Window({ url: "https://example.com/app" });
  globalThis.document = domWindow.document;
});

describe("parseDataUrl", () => {
  test("接受 png base64", () => {
    const parsed = parseDataUrl("data:image/png;base64,AAA=");
    expect(parsed).toEqual({ mime: "image/png", data: "AAA=" });
  });

  test("拒绝非图片", () => {
    expect(parseDataUrl("data:text/plain;base64,AAA=")).toBeNull();
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
  });
});

describe("clipRectToViewport", () => {
  test("裁到视口内并丢掉过小矩形", () => {
    expect(
      clipRectToViewport({ left: -20, top: 10, right: 80, bottom: 90 }, { width: 100, height: 50 }),
    ).toEqual({ x: 0, y: 10, width: 80, height: 40 });
    expect(
      clipRectToViewport({ left: 10, top: 10, right: 12, bottom: 12 }, { width: 100, height: 100 }),
    ).toBeNull();
  });
});

describe("computeCropPixels / fitCropSize", () => {
  test("按 dpr 映射并夹紧到位图", () => {
    expect(computeCropPixels({ x: 10, y: 20, width: 30, height: 40 }, 2, 100, 200)).toEqual({
      sx: 20,
      sy: 40,
      sw: 60,
      sh: 80,
    });
    expect(computeCropPixels({ x: 90, y: 0, width: 40, height: 10 }, 1, 100, 20)).toEqual({
      sx: 90,
      sy: 0,
      sw: 10,
      sh: 10,
    });
  });

  test("长边缩放到上限", () => {
    expect(fitCropSize(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitCropSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});

describe("prependRequirementNote", () => {
  test("说明在前、正文在后", () => {
    expect(prependRequirementNote("  按这个改  ", "按钮是蓝的")).toBe("按这个改\n\n按钮是蓝的");
    expect(prependRequirementNote("", "只有正文")).toBe("只有正文");
    expect(prependRequirementNote("只有说明", "  ")).toBe("只有说明");
  });
});

describe("htmlFragmentToMarkdown", () => {
  test("保留标题、列表、链接和代码", () => {
    const html = `
      <h2>登录</h2>
      <p>请把 <a href="https://example.com/login">登录按钮</a> 改成蓝色。</p>
      <ul><li>主按钮</li><li>次按钮</li></ul>
      <pre>color: blue;</pre>
      <p>用 <code>primary</code> token。</p>
    `;
    const markdown = htmlFragmentToMarkdown(html, document);
    expect(markdown).toContain("## 登录");
    expect(markdown).toContain("[登录按钮](https://example.com/login)");
    expect(markdown).toContain("- 主按钮");
    expect(markdown).toContain("```");
    expect(markdown).toContain("color: blue;");
    expect(markdown).toContain("`primary`");
    expect(markdown).not.toContain("<a");
  });

  test("丢掉 script 并忽略 javascript 链接", () => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `<p>可见</p><script>alert(1)</script><a href="javascript:alert(1)">坏链</a>`;
    const markdown = elementToMarkdown(wrap);
    expect(markdown).toContain("可见");
    expect(markdown).not.toContain("alert");
    expect(markdown).toContain("坏链");
    expect(markdown).not.toContain("javascript:");
  });
});
