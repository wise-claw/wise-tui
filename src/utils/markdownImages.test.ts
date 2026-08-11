import { describe, expect, test } from "bun:test";
import {
  countMarkdownImages,
  extractAbsoluteImagePathsFromMarkdown,
  htmlImageSrc,
  htmlImageTags,
  stripMarkdownImages,
} from "./markdownImages";

describe("markdownImages helpers", () => {
  test("htmlImageTags collects <img> tags", () => {
    expect(htmlImageTags('a <img src="/x.png" width="480px" /> b')).toEqual([
      '<img src="/x.png" width="480px" />',
    ]);
    expect(htmlImageSrc('<img src="/x.png" width="480px" />')).toBe("/x.png");
  });

  test("stripMarkdownImages removes markdown and html image syntax", () => {
    expect(stripMarkdownImages("你好 ![a](data:image/png;base64,abc) 世界")).toBe("你好  世界");
    expect(stripMarkdownImages("见下图\n\n![x](/tmp/a.png)")).toBe("见下图");
    expect(stripMarkdownImages('图：<img src="/tmp/a.png" width="480px" align="left" />')).toBe("图：");
  });

  test("extractAbsoluteImagePathsFromMarkdown collects both forms", () => {
    expect(
      extractAbsoluteImagePathsFromMarkdown(
        'a ![1](/Users/x/.wise/composer-images/a.png) b <img src="/tmp/b.jpg" width="120px" />',
      ),
    ).toEqual(["/Users/x/.wise/composer-images/a.png", "/tmp/b.jpg"]);
  });

  test("countMarkdownImages counts both forms", () => {
    const md = 't ![a](data:image/png;base64,abc) ![b](/tmp/b.png) <img src="data:image/png;base64,xyz" />';
    expect(countMarkdownImages(md)).toBe(3);
  });
});
