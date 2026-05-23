import { describe, expect, test } from "bun:test";
import { normalizeComposerSpeechPreferences } from "./composerSpeechPreferences";

describe("normalizeComposerSpeechPreferences", () => {
  test("returns defaults for invalid payload", () => {
    expect(normalizeComposerSpeechPreferences(null)).toEqual({
      sendMode: "manual",
    });
  });

  test("maps legacy holdAutoSend to silenceAutoSend", () => {
    expect(
      normalizeComposerSpeechPreferences({
        sendMode: "holdAutoSend",
      }),
    ).toEqual({
      sendMode: "silenceAutoSend",
    });
  });

  test("accepts silenceAutoSend", () => {
    expect(
      normalizeComposerSpeechPreferences({
        sendMode: "silenceAutoSend",
      }),
    ).toEqual({
      sendMode: "silenceAutoSend",
    });
  });

  test("falls back when mode unknown", () => {
    expect(
      normalizeComposerSpeechPreferences({
        sendMode: "invalid",
      }),
    ).toEqual({
      sendMode: "manual",
    });
  });
});
