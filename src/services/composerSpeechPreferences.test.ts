import { describe, expect, test } from "bun:test";
import { normalizeComposerSpeechPreferences } from "./composerSpeechPreferences";

describe("normalizeComposerSpeechPreferences", () => {
  test("returns defaults for invalid payload", () => {
    expect(normalizeComposerSpeechPreferences(null)).toEqual({
      sendMode: "manual",
      autoSendEndingText: "发送",
    });
  });

  test("maps legacy holdAutoSend to silenceAutoSend", () => {
    expect(
      normalizeComposerSpeechPreferences({
        sendMode: "holdAutoSend",
      }),
    ).toEqual({
      sendMode: "silenceAutoSend",
      autoSendEndingText: "发送",
    });
  });

  test("accepts silenceAutoSend and custom ending", () => {
    expect(
      normalizeComposerSpeechPreferences({
        sendMode: "silenceAutoSend",
        autoSendEndingText: "  提交  ",
      }),
    ).toEqual({
      sendMode: "silenceAutoSend",
      autoSendEndingText: "提交",
    });
  });

  test("falls back when mode unknown or ending empty", () => {
    expect(
      normalizeComposerSpeechPreferences({
        sendMode: "invalid",
        autoSendEndingText: "   ",
      }),
    ).toEqual({
      sendMode: "manual",
      autoSendEndingText: "发送",
    });
  });
});
