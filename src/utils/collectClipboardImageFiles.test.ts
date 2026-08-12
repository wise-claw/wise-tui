import { describe, expect, test } from "bun:test";
import {
  collectClipboardImageFiles,
  collectClipboardImageRefs,
  collectImageFilesFromClipboardHtml,
  decodeFileUrl,
  isImageFile,
  isLikelyImagePaste,
} from "./collectClipboardImageFiles";

function mockFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function mockDataTransfer(opts: {
  items?: Array<{ type: string; file: File | null }>;
  files?: File[];
}): DataTransfer {
  const rawItems = opts.items ?? [];
  const files = opts.files ?? [];
  const items = rawItems.map((entry) => ({
    type: entry.type,
    kind: entry.file ? "file" : "string",
    getAsFile: () => entry.file,
  }));
  return {
    items: {
      length: items.length,
      ...items,
      [Symbol.iterator]: function* () {
        yield* items;
      },
    } as unknown as DataTransferItemList,
    files: {
      length: files.length,
      ...files,
      item: (i: number) => files[i] ?? null,
      [Symbol.iterator]: function* () {
        yield* files;
      },
    } as unknown as FileList,
  } as DataTransfer;
}

describe("isImageFile", () => {
  test("认 mime", () => {
    expect(isImageFile(mockFile("x.bin", "image/png"))).toBe(true);
  });

  test("mime 空时认扩展名", () => {
    expect(isImageFile(mockFile("shot.webp", ""))).toBe(true);
    expect(isImageFile(mockFile("notes.txt", ""))).toBe(false);
  });
});

describe("isLikelyImagePaste", () => {
  function typesDt(types: string[], plain = ""): DataTransfer {
    return {
      types,
      items: { length: 0, [Symbol.iterator]: function* () {} },
      files: { length: 0, item: () => null, [Symbol.iterator]: function* () {} },
      getData: (type: string) => (type === "text/plain" ? plain : ""),
    } as unknown as DataTransfer;
  }

  test("clipboardData 为空视为图片粘贴（截屏复制等场景）", () => {
    expect(isLikelyImagePaste(null)).toBe(true);
    expect(isLikelyImagePaste(undefined)).toBe(true);
  });

  test("types 含 Files 或 image/* 视为图片粘贴", () => {
    expect(isLikelyImagePaste(typesDt(["Files"]))).toBe(true);
    expect(isLikelyImagePaste(typesDt(["text/plain", "image/png"]))).toBe(true);
  });

  test("纯文本是一整段图片 URL 视为图片粘贴", () => {
    expect(isLikelyImagePaste(typesDt(["text/plain"], "https://cdn.example.com/a/photo.png"))).toBe(
      true,
    );
  });

  test("普通文本粘贴不算图片", () => {
    expect(isLikelyImagePaste(typesDt(["text/plain"], "hello world"))).toBe(false);
  });

  test("Safari DOMStringList 形态的 types 也能识别", () => {
    const dt = {
      types: { length: 1, item: (i: number) => (i === 0 ? "image/png" : null) },
      items: { length: 0, [Symbol.iterator]: function* () {} },
      files: { length: 0, item: () => null, [Symbol.iterator]: function* () {} },
      getData: () => "",
    } as unknown as DataTransfer;
    expect(isLikelyImagePaste(dt)).toBe(true);
  });
});

describe("collectClipboardImageFiles", () => {
  test("空剪贴板", () => {
    expect(collectClipboardImageFiles(null)).toEqual([]);
    expect(collectClipboardImageFiles(undefined)).toEqual([]);
  });

  test("从 items 取 image/*", () => {
    const png = mockFile("a.png", "image/png");
    const txt = mockFile("a.txt", "text/plain");
    const dt = mockDataTransfer({
      items: [
        { type: "text/plain", file: txt },
        { type: "image/png", file: png },
      ],
    });
    expect(collectClipboardImageFiles(dt)).toEqual([png]);
  });

  test("items 无图时回退 files", () => {
    const png = mockFile("shot.png", "image/png");
    const dt = mockDataTransfer({
      items: [{ type: "text/plain", file: mockFile("t.txt", "text/plain") }],
      files: [png, mockFile("doc.md", "text/markdown")],
    });
    expect(collectClipboardImageFiles(dt)).toEqual([png]);
  });

  test("getAsFile 为 null 时跳过", () => {
    const dt = mockDataTransfer({
      items: [{ type: "image/png", file: null }],
    });
    expect(collectClipboardImageFiles(dt)).toEqual([]);
  });

  test("从 text/html data URL 还原图片", () => {
    const dataUrl = "data:image/png;base64,AQID";
    const dt = {
      items: { length: 0 } as unknown as DataTransferItemList,
      files: { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as FileList,
      getData: (type: string) => (type === "text/html" ? `<img src="${dataUrl}">` : ""),
    } as DataTransfer;
    const files = collectClipboardImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]!.type).toBe("image/png");
    expect(files[0]!.name).toContain("pasted-image");
  });
});

describe("collectImageFilesFromClipboardHtml", () => {
  test("无 data URL 时为空", () => {
    expect(collectImageFilesFromClipboardHtml("<img src='https://x/a.png'>")).toEqual([]);
  });
});

describe("collectClipboardImageRefs", () => {
  function stringDt(entries: Array<[string, string]>): DataTransfer {
    return {
      items: { length: 0, [Symbol.iterator]: function* () {} },
      files: { length: 0, item: () => null, [Symbol.iterator]: function* () {} },
      getData: (type: string) => entries.find(([t]) => t === type)?.[1] ?? "",
    } as unknown as DataTransfer;
  }

  test("html 远端 URL", () => {
    const dt = stringDt([["text/html", '<img src="https://cdn.example.com/a/photo.png" alt="x">']]);
    const refs = collectClipboardImageRefs(dt);
    expect(refs.files).toEqual([]);
    expect(refs.remoteUrls).toEqual(["https://cdn.example.com/a/photo.png"]);
    expect(refs.localPaths).toEqual([]);
  });

  test("uri-list 的 file:// 路径", () => {
    const dt = stringDt([
      ["text/uri-list", "file:///Users/me/Pictures/photo.png\r\n"],
      ["text/plain", "file:///Users/me/Pictures/photo.png"],
    ]);
    const refs = collectClipboardImageRefs(dt);
    expect(refs.files).toEqual([]);
    expect(refs.remoteUrls).toEqual([]);
    expect(refs.localPaths).toEqual(["/Users/me/Pictures/photo.png"]);
  });

  test("纯文本夹带路径不误判", () => {
    const dt = stringDt([["text/plain", "参考 /Users/me/Pictures/photo.png 修改"]]);
    const refs = collectClipboardImageRefs(dt);
    expect(refs.localPaths).toEqual([]);
  });

  test("单行绝对图片路径文本视为本地图片", () => {
    const dt = stringDt([["text/plain", "/Users/me/Pictures/shot.png"]]);
    const refs = collectClipboardImageRefs(dt);
    expect(refs.localPaths).toEqual(["/Users/me/Pictures/shot.png"]);
  });

  test("已有文件时不继续扫远端/本地", () => {
    const png = mockFile("a.png", "image/png");
    const dt = mockDataTransfer({
      items: [{ type: "image/png", file: png }],
      files: [],
    });
    const refs = collectClipboardImageRefs(dt);
    expect(refs.files).toEqual([png]);
    expect(refs.remoteUrls).toEqual([]);
    expect(refs.localPaths).toEqual([]);
  });

  test("decodeFileUrl 处理 file:// 与百分号编码", () => {
    expect(decodeFileUrl("file:///Users/a/b%20c.png")).toBe("/Users/a/b c.png");
    expect(decodeFileUrl("/plain/path.png")).toBe("/plain/path.png");
    expect(decodeFileUrl("https://x/a.png")).toBeNull();
  });
});
