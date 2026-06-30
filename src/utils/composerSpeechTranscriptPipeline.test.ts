import { describe, expect, test } from "bun:test";
import { DEFAULT_COMPOSER_SPEECH_PREFERENCES } from "../constants/composerSpeechPreferences";
import {
  detectComposerSpeechInterimCommand,
  detectComposerSpeechInterimTrigger,
  resolveComposerSpeechSegmentAction,
} from "./composerSpeechTranscriptPipeline";

const PREFS = DEFAULT_COMPOSER_SPEECH_PREFERENCES;

describe("resolveComposerSpeechSegmentAction", () => {
  test("commits a plain segment with no auto-send by default (manual mode)", () => {
    expect(
      resolveComposerSpeechSegmentAction({
        segmentText: "帮我写一个登录组件",
        speechPrefs: PREFS,
      }),
    ).toEqual({ type: "commit", spokenText: "帮我写一个登录组件", shouldAutoSend: false });
  });

  test("voice 'clear' command yields clear", () => {
    expect(
      resolveComposerSpeechSegmentAction({ segmentText: "清除", speechPrefs: PREFS }),
    ).toEqual({ type: "clear" });
  });

  test("voice 'cancel' command yields cancel", () => {
    expect(
      resolveComposerSpeechSegmentAction({ segmentText: "取消", speechPrefs: PREFS }),
    ).toEqual({ type: "cancel" });
  });

  test("ending '发送' is stripped and marks auto-send (voice commands include send phrase)", () => {
    expect(
      resolveComposerSpeechSegmentAction({
        segmentText: "写个组件发送",
        speechPrefs: PREFS,
      }),
    ).toEqual({ type: "commit", spokenText: "写个组件", shouldAutoSend: true });
  });

  test("forceAutoSend (silence) sends without an ending word", () => {
    expect(
      resolveComposerSpeechSegmentAction({
        segmentText: "把登录逻辑改一下",
        speechPrefs: { ...PREFS, sendMode: "silenceAutoSend" },
        forceAutoSend: true,
      }),
    ).toEqual({ type: "commit", spokenText: "把登录逻辑改一下", shouldAutoSend: true });
  });

  test("endingWordAutoSend mode strips the ending word when voice commands are off", () => {
    expect(
      resolveComposerSpeechSegmentAction({
        segmentText: "写个组件发送",
        speechPrefs: {
          ...PREFS,
          voiceCommandsEnabled: false,
          sendMode: "endingWordAutoSend",
        },
      }),
    ).toEqual({ type: "commit", spokenText: "写个组件", shouldAutoSend: true });
  });

  test("empty segment is a noop", () => {
    expect(
      resolveComposerSpeechSegmentAction({ segmentText: "   ", speechPrefs: PREFS }),
    ).toEqual({ type: "noop" });
  });

  test("REQ1: each segment is resolved on its OWN text only (no prior-segment carryover)", () => {
    // The resolver has no baseline/lastSent inputs at all — a second segment cannot
    // be contaminated by a previous one because there is no cross-segment state.
    const first = resolveComposerSpeechSegmentAction({
      segmentText: "第一段内容",
      speechPrefs: PREFS,
    });
    const second = resolveComposerSpeechSegmentAction({
      segmentText: "第二段内容",
      speechPrefs: PREFS,
    });
    expect(first).toEqual({ type: "commit", spokenText: "第一段内容", shouldAutoSend: false });
    expect(second).toEqual({ type: "commit", spokenText: "第二段内容", shouldAutoSend: false });
  });
});

describe("detectComposerSpeechInterimCommand / Trigger", () => {
  test("detects clear/cancel/send commands mid-stream", () => {
    expect(detectComposerSpeechInterimCommand("清除", PREFS)).toBe("clear");
    expect(detectComposerSpeechInterimCommand("取消", PREFS)).toBe("cancel");
    expect(detectComposerSpeechInterimCommand("写个组件发送", PREFS)).toBe("send");
    expect(detectComposerSpeechInterimCommand("写个组件", PREFS)).toBeNull();
  });

  test("interim trigger also fires on ending word when voice commands are disabled", () => {
    const prefs = { ...PREFS, voiceCommandsEnabled: false, sendMode: "endingWordAutoSend" as const };
    expect(detectComposerSpeechInterimTrigger("写个组件发送", prefs)).toBe("send");
    expect(detectComposerSpeechInterimTrigger("写个组件", prefs)).toBeNull();
  });

  test("no interim command when voice commands disabled and manual mode", () => {
    const prefs = { ...PREFS, voiceCommandsEnabled: false, sendMode: "manual" as const };
    expect(detectComposerSpeechInterimTrigger("写个组件发送", prefs)).toBeNull();
  });
});
