import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { inlineCanvasAssets, resolveCanvasAssetPath } from "./repositoryCanvasAssets";
const dom = new Window();
const saved = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
beforeAll(() => Object.defineProperty(globalThis, "DOMParser", { value: dom.DOMParser, configurable: true }));
afterAll(() => {
  if (saved) Object.defineProperty(globalThis, "DOMParser", saved);
  else Reflect.deleteProperty(globalThis, "DOMParser");
  dom.happyDOM.abort();
});

describe("Canvas local assets", () => {
  test("normalizes within root and rejects escapes including encoded traversal", () => {
    expect(resolveCanvasAssetPath("pages/demo.html", "../img/a.png?v=2#mark")).toBe("img/a.png");
    expect(resolveCanvasAssetPath("pages/demo.html", "/assets/a.png")).toBe("assets/a.png");
    expect(resolveCanvasAssetPath("demo.html", "https://cdn.test/a.png")).toBeNull();
    expect(resolveCanvasAssetPath("demo.html", "#shape")).toBeNull();
    expect(() => resolveCanvasAssetPath("demo.html", "%2e%2e/secret.png")).toThrow();
    expect(() => resolveCanvasAssetPath("demo.html", "..\\secret.png")).toThrow();
  });
  test("inlines styles relative to their own directory, scripts and cached images", async () => {
    const reads: string[] = [];
    const result = await inlineCanvasAssets('<link rel="stylesheet" href="../css/main.css" media="screen"><img src="../img/a.png"><script src="app.js"></script>', "pages/demo.html", {
      text: async (path) => {
        expect(path).toBe("css/main.css");
        return 'body {background:url(../img/a.png)} @font-face {src:url(../fonts/a.woff2)}';
      },
      base64: async (path) => { reads.push(path); return "YWJj"; },
    });
    expect(result.content).toContain('media="screen"');
    expect(result.content).toContain("data:image/png;base64,YWJj");
    expect(result.content).toContain("data:font/woff2;base64,YWJj");
    expect(result.content).toContain("data:text/javascript;base64,YWJj");
    expect(reads.sort()).toEqual(["fonts/a.woff2", "img/a.png", "pages/app.js"]);
    expect(result.warnings).toEqual([]);
  });
  test("reports missing resources, unsupported imports and limits without discarding the page", async () => {
    const result = await inlineCanvasAssets('<h1>仍然可看</h1><img src="missing.png"><script type="module" src="app.js"></script><style>@import "other.css";</style>', "demo.html", {
      text: async () => "",
      base64: async () => { throw new Error("文件不存在"); },
    });
    expect(result.content).toContain("仍然可看");
    expect(result.warnings.join(" ")).toContain("missing.png");
    expect(result.warnings.join(" ")).toContain("相对 import");
    expect(result.warnings.join(" ")).toContain("@import");
  });
  test("caps resource reads to avoid unbounded loads", async () => {
    let reads = 0;
    const result = await inlineCanvasAssets(Array.from({ length: 70 }, (_, i) => `<img src="${i}.png">`).join(""), "demo.html", {
      text: async () => "", base64: async () => { reads++; return "YQ=="; },
    });
    expect(reads).toBe(64);
    expect(result.warnings.length).toBe(6);
  });
});
