import { describe, expect, test } from "bun:test";
import { DEFAULT_COMPOSER_SPEECH_PREFERENCES } from "../constants/composerSpeechPreferences";
import {
  processComposerSpeechTranscriptUpdate,
  shouldUseLlmSpeechPolish,
} from "./composerSpeechTranscriptPipeline";

describe("composerSpeechTranscriptPipeline", () => {
  test("shouldUseLlmSpeechPolish skips short clean utterances", () => {
    expect(shouldUseLlmSpeechPolish("今天干什么")).toBe(false);
    expect(shouldUseLlmSpeechPolish("帮我写一个登录组件")).toBe(false);
    expect(shouldUseLlmSpeechPolish("嗯那个帮我写个组件")).toBe(true);
    expect(
      shouldUseLlmSpeechPolish("请帮我重构整个项目的鉴权模块并补齐单元测试"),
    ).toBe(true);
  });

  test("detects clear command on final raw fallback", () => {
    expect(
      processComposerSpeechTranscriptUpdate({
        engine: "sensevoice",
        baseline: "今天干什么",
        lastSentPlain: "今天干什么",
        rawTranscript: "清除",
        isFinal: true,
        speechPrefs: DEFAULT_COMPOSER_SPEECH_PREFERENCES,
      }),
    ).toEqual({ type: "clear" });
  });

  test("strips sent plain and returns noop for duplicate sensevoice transcript", () => {
    expect(
      processComposerSpeechTranscriptUpdate({
        engine: "sensevoice",
        baseline: "",
        lastSentPlain: "今天干什么",
        rawTranscript: "今天干什么",
        isFinal: true,
        speechPrefs: DEFAULT_COMPOSER_SPEECH_PREFERENCES,
      }),
    ).toEqual({ type: "noop" });
  });

  test("returns apply with shouldAutoSend for ending send command", () => {
    expect(
      processComposerSpeechTranscriptUpdate({
        engine: "web",
        baseline: "",
        lastSentPlain: "",
        rawTranscript: "写个组件发送",
        isFinal: true,
        speechPrefs: DEFAULT_COMPOSER_SPEECH_PREFERENCES,
      }),
    ).toEqual({
      type: "apply",
      spokenText: "写个组件",
      shouldAutoSend: true,
      useLlmPolish: false,
    });
  });

  test("waits for final when polish enabled and LLM needed", () => {
    expect(
      processComposerSpeechTranscriptUpdate({
        engine: "web",
        baseline: "",
        lastSentPlain: "",
        rawTranscript: "嗯那个写组件",
        isFinal: false,
        speechPrefs: { ...DEFAULT_COMPOSER_SPEECH_PREFERENCES, speechPolishEnabled: true },
      }),
    ).toEqual({ type: "noop" });
  });

  test("applies partial clean utterance without waiting for final", () => {
    expect(
      processComposerSpeechTranscriptUpdate({
        engine: "web",
        baseline: "",
        lastSentPlain: "",
        rawTranscript: "今天干什么",
        isFinal: false,
        speechPrefs: { ...DEFAULT_COMPOSER_SPEECH_PREFERENCES, speechPolishEnabled: true },
      }),
    ).toEqual({
      type: "apply",
      spokenText: "今天干什么",
      shouldAutoSend: false,
      useLlmPolish: false,
    });
  });

  test("auto send on partial skips final wait even with fillers", () => {
    expect(
      processComposerSpeechTranscriptUpdate({
        engine: "web",
        baseline: "",
        lastSentPlain: "",
        rawTranscript: "嗯写个组件发送",
        isFinal: false,
        speechPrefs: { ...DEFAULT_COMPOSER_SPEECH_PREFERENCES, speechPolishEnabled: true },
      }),
    ).toEqual({
      type: "apply",
      spokenText: "嗯写个组件",
      shouldAutoSend: true,
      useLlmPolish: false,
    });
  });
});
