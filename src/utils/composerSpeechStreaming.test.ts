import { describe, expect, test } from "bun:test";
import {
  applyComposerSpeechStreamTranscript,
  createComposerSpeechStreamAnchor,
  extractComposerSpeechTranscriptDelta,
  reconcileComposerSpeechStreamAnchor,
  resolveComposerSpeechDisplayText,
} from "./composerSpeechStreaming";

describe("composerSpeechStreaming", () => {
  test("partial updates replace utterance in place", () => {
    const anchor = createComposerSpeechStreamAnchor("hello ", 6);
    const partial = applyComposerSpeechStreamTranscript(anchor, "你", false);
    expect(partial.plain).toBe("hello 你");
    expect(partial.cursor).toBe(7);

    const partial2 = applyComposerSpeechStreamTranscript(partial.anchor, "你好", false);
    expect(partial2.plain).toBe("hello 你好");
  });

  test("final commits prefix for next utterance", () => {
    const anchor = createComposerSpeechStreamAnchor("hi ", 3);
    const final = applyComposerSpeechStreamTranscript(anchor, "世界", true);
    expect(final.plain).toBe("hi 世界");
    expect(final.anchor.prefix).toBe("hi 世界");
    expect(final.cursor).toBe(final.anchor.prefix.length);
  });

  test("reconcile drops stale anchor after composer cleared on send", () => {
    const stale = createComposerSpeechStreamAnchor("已发送的内容", 6);
    expect(reconcileComposerSpeechStreamAnchor(stale, "", 0)).toEqual({
      prefix: "",
      suffix: "",
    });
  });

  test("extract delta after send baseline in continuous session", () => {
    const baseline = "你好，我是谁";
    expect(extractComposerSpeechTranscriptDelta(baseline, "你好，我是谁")).toBe("");
    expect(extractComposerSpeechTranscriptDelta(baseline, "你好，我是谁不要发送后的消息")).toBe(
      "不要发送后的消息",
    );
    expect(extractComposerSpeechTranscriptDelta(baseline, "不要发送后的消息")).toBe(
      "不要发送后的消息",
    );
  });

  test("extract delta ignores punctuation drift between baseline and raw", () => {
    const baseline = "你好，我是谁";
    expect(extractComposerSpeechTranscriptDelta(baseline, "你好我是谁不要发送")).toBe("不要发送");
  });

  test("resolve display text replaces composer with delta only", () => {
    expect(resolveComposerSpeechDisplayText("第二句")).toEqual({ plain: "第二句", cursor: 3 });
  });

  test("isFinal must not stack on anchor when using delta replace mode", () => {
    const baseline = "第一句";
    const raw = "第一句第二句";
    const delta = extractComposerSpeechTranscriptDelta(baseline, raw);
    expect(delta).toBe("第二句");
    const first = resolveComposerSpeechDisplayText(delta);
    expect(first.plain).toBe("第二句");
    const staleAnchor = createComposerSpeechStreamAnchor("第一句", 3);
    const stacked = applyComposerSpeechStreamTranscript(staleAnchor, delta, true);
    expect(stacked.plain).toBe("第一句第二句");
    expect(first.plain).toBe("第二句");
  });
});
