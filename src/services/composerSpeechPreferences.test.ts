import { describe, expect, test } from "bun:test";
import { normalizeComposerSpeechPreferences } from "./composerSpeechPreferences";

describe("normalizeComposerSpeechPreferences", () => {
  test("returns defaults for invalid payload", () => {
    expect(normalizeComposerSpeechPreferences(null)).toEqual({
      sendMode: "manual",
      autoSendEndingText: "发送",
      silenceAutoSendIdleMs: 1000,
      speechToRequirementEnabled: false,
      speechPolishEnabled: true,
      speechEngineMode: "auto",
      senseVoiceLang: "auto",
      voiceCommandsEnabled: true,
      voiceCommandClearText: "清除",
      voiceCommandCancelText: "取消",
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
      silenceAutoSendIdleMs: 1000,
      speechToRequirementEnabled: false,
      speechPolishEnabled: true,
      speechEngineMode: "auto",
      senseVoiceLang: "auto",
      voiceCommandsEnabled: true,
      voiceCommandClearText: "清除",
      voiceCommandCancelText: "取消",
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
      silenceAutoSendIdleMs: 1000,
      speechToRequirementEnabled: false,
      speechPolishEnabled: true,
      speechEngineMode: "auto",
      senseVoiceLang: "auto",
      voiceCommandsEnabled: true,
      voiceCommandClearText: "清除",
      voiceCommandCancelText: "取消",
    });
  });

  test("disables speechPolish when explicitly false", () => {
    expect(
      normalizeComposerSpeechPreferences({
        speechPolishEnabled: false,
      }),
    ).toMatchObject({
      speechPolishEnabled: false,
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
    ).toMatchObject({ silenceAutoSendIdleMs: 400 });
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
      silenceAutoSendIdleMs: 1000,
      speechToRequirementEnabled: false,
      speechPolishEnabled: true,
      speechEngineMode: "auto",
      senseVoiceLang: "auto",
      voiceCommandsEnabled: true,
      voiceCommandClearText: "清除",
      voiceCommandCancelText: "取消",
    });
  });

  test("normalizes voice command preferences", () => {
    expect(
      normalizeComposerSpeechPreferences({
        voiceCommandsEnabled: false,
        voiceCommandClearText: "  清空  ",
        voiceCommandCancelText: "  停止  ",
      }),
    ).toMatchObject({
      voiceCommandsEnabled: false,
      voiceCommandClearText: "清空",
      voiceCommandCancelText: "停止",
    });
  });

  test("normalizes speechEngineMode", () => {
    expect(
      normalizeComposerSpeechPreferences({
        speechEngineMode: "sensevoice",
      }),
    ).toMatchObject({ speechEngineMode: "sensevoice" });
  });
});
