import { describe, expect, test } from "bun:test";
import { normalizeComposerSpeechPreferences } from "./composerSpeechPreferences";

describe("normalizeComposerSpeechPreferences", () => {
  test("returns defaults for invalid payload", () => {
    expect(normalizeComposerSpeechPreferences(null)).toEqual({
      sendMode: "manual",
      autoSendEndingText: "发送",
      silenceAutoSendIdleMs: 1500,
      speechToRequirementEnabled: false,
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
      silenceAutoSendIdleMs: 1500,
      speechToRequirementEnabled: false,
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
      silenceAutoSendIdleMs: 1500,
      speechToRequirementEnabled: false,
    });
  });

  test("clamps and steps silenceAutoSendIdleMs", () => {
    expect(
      normalizeComposerSpeechPreferences({
        silenceAutoSendIdleMs: 1234,
      }),
    ).toMatchObject({ silenceAutoSendIdleMs: 1200 });
    expect(
      normalizeComposerSpeechPreferences({
        silenceAutoSendIdleMs: 50,
      }),
    ).toMatchObject({ silenceAutoSendIdleMs: 500 });
    expect(
      normalizeComposerSpeechPreferences({
        silenceAutoSendIdleMs: 99_999,
      }),
    ).toMatchObject({ silenceAutoSendIdleMs: 10_000 });
  });

  test("enables speechToRequirement when true", () => {
    expect(
      normalizeComposerSpeechPreferences({
        speechToRequirementEnabled: true,
      }),
    ).toMatchObject({
      speechToRequirementEnabled: true,
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
      silenceAutoSendIdleMs: 1500,
      speechToRequirementEnabled: false,
    });
  });
});
