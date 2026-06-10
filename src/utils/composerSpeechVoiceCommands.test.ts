import { describe, expect, test } from "bun:test";
import {
  buildComposerSpeechVoiceCommands,
  splitUtteranceAtVoiceCommand,
} from "./composerSpeechVoiceCommands";
import { DEFAULT_COMPOSER_SPEECH_PREFERENCES } from "../constants/composerSpeechPreferences";

describe("composerSpeechVoiceCommands", () => {
  test("buildComposerSpeechVoiceCommands returns empty when disabled", () => {
    expect(
      buildComposerSpeechVoiceCommands({
        ...DEFAULT_COMPOSER_SPEECH_PREFERENCES,
        voiceCommandsEnabled: false,
      }),
    ).toEqual([]);
  });

  test("detects send suffix and strips before send", () => {
    const commands = buildComposerSpeechVoiceCommands(DEFAULT_COMPOSER_SPEECH_PREFERENCES);
    expect(splitUtteranceAtVoiceCommand("帮我写个组件发送", commands)).toEqual({
      utterance: "帮我写个组件",
      action: "send",
    });
  });

  test("detects clear-only command", () => {
    const commands = buildComposerSpeechVoiceCommands(DEFAULT_COMPOSER_SPEECH_PREFERENCES);
    expect(splitUtteranceAtVoiceCommand("清除", commands)).toEqual({
      utterance: "",
      action: "clear",
    });
  });

  test("detects cancel aliases including 取消上一个任务", () => {
    const commands = buildComposerSpeechVoiceCommands(DEFAULT_COMPOSER_SPEECH_PREFERENCES);
    expect(splitUtteranceAtVoiceCommand("取消上一个任务", commands)).toEqual({
      utterance: "",
      action: "cancel",
    });
  });

  test("prefers longer cancel phrase over 取消", () => {
    const commands = buildComposerSpeechVoiceCommands(DEFAULT_COMPOSER_SPEECH_PREFERENCES);
    expect(splitUtteranceAtVoiceCommand("取消任务", commands)).toEqual({
      utterance: "",
      action: "cancel",
    });
  });

  test("detects clear with trailing punctuation", () => {
    const commands = buildComposerSpeechVoiceCommands(DEFAULT_COMPOSER_SPEECH_PREFERENCES);
    expect(splitUtteranceAtVoiceCommand("清除。", commands)).toEqual({
      utterance: "",
      action: "clear",
    });
  });

  test("does not trigger send inside 发送到", () => {
    const commands = buildComposerSpeechVoiceCommands(DEFAULT_COMPOSER_SPEECH_PREFERENCES);
    expect(splitUtteranceAtVoiceCommand("发送到邮箱", commands)).toEqual({
      utterance: "发送到邮箱",
      action: null,
    });
  });
});
