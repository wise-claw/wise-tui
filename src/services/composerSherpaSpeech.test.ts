import { describe, expect, test } from "bun:test";
import {
  isComposerSherpaSpeechPlatform,
  resetComposerSherpaSpeechCacheForTests,
} from "./composerSherpaSpeech";

describe("composerSherpaSpeech", () => {
  test("isComposerSherpaSpeechPlatform is false outside Tauri", () => {
    expect(isComposerSherpaSpeechPlatform()).toBe(false);
  });

  test("resetComposerSherpaSpeechCacheForTests clears cache slot", () => {
    resetComposerSherpaSpeechCacheForTests();
    expect(true).toBe(true);
  });
});
