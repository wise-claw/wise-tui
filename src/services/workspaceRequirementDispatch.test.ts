import { describe, expect, mock, test } from "bun:test";

mock.module("@tauri-apps/api/path", () => ({
  homeDir: async () => "/Users/test/",
}));

mock.module("./saveComposerImage", () => ({
  saveComposerImage: async (_dir: string, filename: string, _dataUrl: string) =>
    `/Users/test/.wise/composer-images/${filename}`,
}));

const fetchCalls: string[] = [];
mock.module("./pastedImageRefs", () => ({
  fetchRemoteImageAsDataUrl: async (url: string) => {
    fetchCalls.push(url);
    if (url.includes("broken")) return null;
    return "data:image/png;base64,QUJD";
  },
}));

import {
  materializeRequirementBodyImages,
  stripMarkdownImages,
} from "./workspaceRequirementDispatch";

describe("materializeRequirementBodyImages", () => {
  test("远端 Markdown 图片下载落盘", async () => {
    fetchCalls.length = 0;
    const result = await materializeRequirementBodyImages(
      "需求图：\n\n![设计稿](https://cdn.example.com/a/design.png)",
    );
    expect(fetchCalls).toEqual(["https://cdn.example.com/a/design.png"]);
    expect(result.bodyMarkdown).toContain(
      "![设计稿](/Users/test/.wise/composer-images/requirement-remote-1.png)",
    );
    expect(result.imagePaths).toContain(
      "/Users/test/.wise/composer-images/requirement-remote-1.png",
    );
  });

  test("远端 HTML img 下载落盘", async () => {
    fetchCalls.length = 0;
    const result = await materializeRequirementBodyImages(
      '<img src="https://cdn.example.com/b/shot.webp" width="200px">',
    );
    expect(fetchCalls).toEqual(["https://cdn.example.com/b/shot.webp"]);
    expect(result.bodyMarkdown).toContain(
      '<img src="/Users/test/.wise/composer-images/requirement-remote-1.png" width="200px">',
    );
  });

  test("下载失败时保留远端引用且不算入 imagePaths", async () => {
    fetchCalls.length = 0;
    const result = await materializeRequirementBodyImages(
      "![x](https://cdn.example.com/broken.png)",
    );
    expect(result.bodyMarkdown).toContain("https://cdn.example.com/broken.png");
    expect(result.imagePaths).toEqual([]);
    expect(stripMarkdownImages(result.bodyMarkdown)).toBe("");
  });

  test("data URL 图片仍按原逻辑落盘", async () => {
    fetchCalls.length = 0;
    const result = await materializeRequirementBodyImages(
      "![x](data:image/png;base64,AQIDBA==)",
    );
    expect(fetchCalls).toEqual([]);
    expect(result.bodyMarkdown).toContain("/Users/test/.wise/composer-images/requirement-1.png");
  });
});
