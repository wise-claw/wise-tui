import { describe, expect, mock, test } from "bun:test";
import type { ImageAttachmentPart, Prompt } from "../../types";

mock.module("../../services/appSettingsStore", () => ({
  getAppSetting: async () => null,
  setAppSetting: async () => {},
  deleteAppSetting: async () => {},
}));

import { addToHistory, navigatePromptHistory, resetPromptHistoryCacheForTests } from "./prompt-history";

const textPrompt = (text: string): Prompt => [{ type: "text", text, start: 0, end: 0 }];

const sampleImage = (id: string): ImageAttachmentPart => ({
  type: "image",
  id,
  filename: "a.png",
  mime: "image/png",
  dataUrl: "data:image/png;base64,AA==",
});

describe("prompt-history images", () => {
  test("navigate up restores images from the latest history entry", () => {
    resetPromptHistoryCacheForTests();
    const sent: Prompt = textPrompt("你好");
    const images = [sampleImage("img_1")];
    addToHistory(sent, "normal", undefined, images);

    const result = navigatePromptHistory("up", textPrompt(""), -1, "normal", []);
    expect(result.index).toBe(0);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.id).toBe("img_1");
    expect(result.savedCurrent).not.toBeNull();
  });

  test("navigate down from index 0 returns to saved draft with images", () => {
    resetPromptHistoryCacheForTests();
    addToHistory(textPrompt("prior"), "normal");
    const current: Prompt = textPrompt("draft");
    const currentImages = [sampleImage("draft_img")];
    const saved = navigatePromptHistory("up", current, -1, "normal", currentImages);
    expect(saved.savedCurrent?.images?.[0]?.id).toBe("draft_img");

    const down = navigatePromptHistory("down", saved.prompt, 0, "normal", saved.images);
    expect(down.index).toBe(-1);
  });
});
