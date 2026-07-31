import { describe, expect, test } from "bun:test";
import {
  collectClipboardImageFiles,
  collectImageFilesFromClipboardHtml,
  isImageFile,
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
