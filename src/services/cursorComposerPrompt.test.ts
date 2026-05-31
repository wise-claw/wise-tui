import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ImageAttachmentPart } from "../types";

const saveComposerImage = mock(async () => "/tmp/wise/composer-images/demo.png");

mock.module("./saveComposerImage", () => ({ saveComposerImage }));

describe("buildCursorSdkAttachments", () => {
  beforeEach(() => {
    saveComposerImage.mockClear();
  });

  test("returns saved attachment paths with mime types", async () => {
    const { buildCursorSdkAttachments } = await import("./cursorComposerPrompt");
    const images: ImageAttachmentPart[] = [
      {
        filename: "shot.png",
        dataUrl: "data:image/png;base64,abc",
        start: 0,
        end: 0,
      },
    ];
    const out = await buildCursorSdkAttachments({
      repositoryPath: "/repo/demo",
      images,
    });
    expect(out).toEqual([
      { path: "/tmp/wise/composer-images/demo.png", mimeType: "image/png" },
    ]);
    expect(saveComposerImage).toHaveBeenCalledWith("/repo/demo", "shot.png", "data:image/png;base64,abc");
  });
});

describe("buildCursorComposerSendPayload", () => {
  beforeEach(() => {
    saveComposerImage.mockClear();
  });

  test("keeps image paths in bubble but omits them from SDK outbound prompt", async () => {
    const { buildCursorComposerSendPayload } = await import("./cursorComposerPrompt");
    const images: ImageAttachmentPart[] = [
      {
        filename: "shot.png",
        dataUrl: "data:image/png;base64,abc",
        start: 0,
        end: 0,
      },
    ];
    const out = await buildCursorComposerSendPayload({
      prompt: [{ type: "text", text: "图片里有什么" }],
      contextItems: [],
      images,
      repositoryPath: "/repo/demo",
    });
    expect(out.userBubblePrompt).toContain("@/tmp/wise/composer-images/demo.png");
    expect(out.outbound).toBe("图片里有什么");
    expect(out.outbound).not.toContain("@/tmp/wise/composer-images/demo.png");
    expect(out.cursorAttachments).toEqual([
      { path: "/tmp/wise/composer-images/demo.png", mimeType: "image/png" },
    ]);
  });

  test("uses default outbound when prompt is empty but images exist", async () => {
    const { buildCursorComposerSendPayload } = await import("./cursorComposerPrompt");
    const images: ImageAttachmentPart[] = [
      {
        filename: "shot.png",
        dataUrl: "data:image/png;base64,abc",
        start: 0,
        end: 0,
      },
    ];
    const out = await buildCursorComposerSendPayload({
      prompt: [],
      contextItems: [],
      images,
      repositoryPath: "/repo/demo",
    });
    expect(out.outbound).toBe("请描述附图中的内容。");
    expect(out.userBubblePrompt).toContain("附图：");
  });
});
