import { describe, expect, test } from "bun:test";
import {
  normalizeComposerSpeechAutoSendEndingText,
  splitUtteranceAtAutoSendEnding,
} from "./composerSpeechAutoSendEnding";

describe("composerSpeechAutoSendEnding", () => {
  test("normalize trims whitespace", () => {
    expect(normalizeComposerSpeechAutoSendEndingText("  发送  ")).toBe("发送");
  });

  test("detects suffix and strips before send", () => {
    expect(splitUtteranceAtAutoSendEnding("帮我写个组件发送", "发送")).toEqual({
      utterance: "帮我写个组件",
      shouldAutoSend: true,
    });
  });

  test("does not trigger when suffix missing", () => {
    expect(splitUtteranceAtAutoSendEnding("发送到邮箱", "发送")).toEqual({
      utterance: "发送到邮箱",
      shouldAutoSend: false,
    });
  });

  test("only ending word yields empty utterance with auto send", () => {
    expect(splitUtteranceAtAutoSendEnding("发送", "发送")).toEqual({
      utterance: "",
      shouldAutoSend: true,
    });
  });

  test("empty ending never triggers", () => {
    expect(splitUtteranceAtAutoSendEnding("你好发送", "   ")).toEqual({
      utterance: "你好发送",
      shouldAutoSend: false,
    });
  });
});
