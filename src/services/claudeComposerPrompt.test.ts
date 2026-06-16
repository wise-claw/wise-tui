import { describe, expect, mock, test } from "bun:test";
import type { ImageAttachmentPart } from "../types";

mock.module("./saveComposerImage", () => ({
  saveComposerImage: async () => "/tmp/wise/composer-images/demo.png",
}));

import {
  buildClaudeComposerSendPayload,
  buildComposerInsertFromPlainText,
  collapseRepeatedComposerMain,
  stripComposerAttachedImageSuffix,
} from "./claudeComposerPrompt";

describe("claudeComposerPrompt dedupe", () => {
  test("stripComposerAttachedImageSuffix removes trailing 附图 block", () => {
    const main = "你好\n\n附图：@/tmp/a.png";
    expect(stripComposerAttachedImageSuffix(main)).toBe("你好");
    expect(stripComposerAttachedImageSuffix("你好\n\n附图:@/tmp/a.png")).toBe("你好");
    expect(
      stripComposerAttachedImageSuffix(
        "你好 附图：@/Users/sjl/.wise/composer-images/wise/demo-image.png。",
      ),
    ).toBe("你好");
    expect(
      stripComposerAttachedImageSuffix(
        "终端01 在 2026/6/3 22:44:53 执行 你好 附图：@/tmp/a.png。",
      ),
    ).toBe("终端01 在 2026/6/3 22:44:53 执行 你好");
  });

  test("collapseRepeatedComposerMain folds duplicated body", () => {
    const dup = "你好\n\n附图：@/tmp/a.png\n\n你好\n\n附图：@/tmp/a.png";
    expect(collapseRepeatedComposerMain(dup)).toBe("你好\n\n附图：@/tmp/a.png");
  });

  test("buildClaudeComposerSendPayload uses userBubbleMain for bubble only", async () => {
    const images: ImageAttachmentPart[] = [
      {
        type: "image",
        id: "img_1",
        filename: "a.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,AA==",
      },
    ];
    const payload = await buildClaudeComposerSendPayload({
      prompt: [
        {
          type: "text",
          text: "你好\n\n附图：@/tmp/old.png\n\n你好\n\n附图：@/tmp/old.png",
          start: 0,
          end: 0,
        },
      ],
      contextItems: [],
      images,
      repositoryPath: "/repo",
      userBubbleMain: "你好",
    });
    expect(payload.userBubblePrompt).toBe("你好\n\n附图：@/tmp/wise/composer-images/demo.png");
    expect(payload.outbound).toBe("你好\n\n附图：@/tmp/wise/composer-images/demo.png");
    expect(payload.imageDiskPaths).toEqual(["/tmp/wise/composer-images/demo.png"]);
  });

  test("buildClaudeComposerSendPayload applies defaultInstructionPrefix to outbound only", async () => {
    const payload = await buildClaudeComposerSendPayload({
      prompt: [{ type: "text", text: "你好", start: 0, end: 0 }],
      contextItems: [],
      images: [],
      repositoryPath: "/repo",
      userBubbleMain: "你好",
      defaultInstructionPrefix: "/autopilot",
    });
    expect(payload.userBubblePrompt).toBe("你好");
    expect(payload.outbound).toBe("/autopilot 你好");
  });

  test("buildClaudeComposerSendPayload inserts defaultInstruction after @mention in outbound", async () => {
    const payload = await buildClaudeComposerSendPayload({
      prompt: [{ type: "text", text: "@终端1 你好", start: 0, end: 0 }],
      contextItems: [],
      images: [],
      repositoryPath: "/repo",
      userBubbleMain: "@终端1 你好",
      defaultInstructionPrefix: "/autopilot",
    });
    expect(payload.userBubblePrompt).toBe("@终端1 你好");
    expect(payload.outbound).toBe("@终端1 /autopilot 你好");
  });

  test("buildComposerInsertFromPlainText strips 附图 suffix for editor main", () => {
    const path = "/tmp/wise/composer-images/a.png";
    const { composerMain, attachmentPaths } = buildComposerInsertFromPlainText(
      `你好\n\n附图：@${path}`,
    );
    expect(composerMain).toBe("你好");
    expect(attachmentPaths).toEqual([path]);

    const inline = buildComposerInsertFromPlainText(`你好 附图：@${path}。`);
    expect(inline.composerMain).toBe("你好");
    expect(inline.attachmentPaths).toEqual([path]);
  });

  test("buildClaudeComposerSendPayload does not duplicate 附图 when main already has suffix", async () => {
    const images: ImageAttachmentPart[] = [
      {
        type: "image",
        id: "img_1",
        filename: "a.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,AA==",
      },
    ];
    const payload = await buildClaudeComposerSendPayload({
      prompt: [{ type: "text", text: "你好\n\n附图：@/tmp/old.png", start: 0, end: 0 }],
      contextItems: [],
      images,
      repositoryPath: "/repo",
    });
    expect(payload.outbound).toBe("你好\n\n附图：@/tmp/wise/composer-images/demo.png");
    expect(payload.outbound.match(/附图/g)?.length).toBe(1);
  });

  test("buildClaudeComposerSendPayload keeps native slash command without context bar files", async () => {
    const payload = await buildClaudeComposerSendPayload({
      prompt: [{ type: "text", text: "/loom:init", start: 0, end: 11 }],
      contextItems: [{ type: "file", path: "src/main.ts", label: "main.ts" }],
      images: [],
      repositoryPath: "/repo",
    });
    expect(payload.outbound).toBe("/loom:init");
  });

  test("buildClaudeComposerSendPayload normalizes slash after @ mention and drops images", async () => {
    const payload = await buildClaudeComposerSendPayload({
      prompt: [{ type: "text", text: "@foo /loom:init", start: 0, end: 15 }],
      contextItems: [],
      images: [
        {
          type: "image",
          id: "img_1",
          filename: "a.png",
          mime: "image/png",
          dataUrl: "data:image/png;base64,AA==",
        },
      ],
      repositoryPath: "/repo",
    });
    expect(payload.outbound).toBe("/loom:init");
    expect(payload.imageDiskPaths).toEqual([null]);
  });
});
