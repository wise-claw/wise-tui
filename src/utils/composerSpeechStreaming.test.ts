import { describe, expect, test } from "bun:test";
import {
  advanceComposerSpeechTranscriptBaseline,
  applyComposerSpeechStreamTranscript,
  appendSpeechBaselineSegment,
  commitComposerSpeechTranscriptBaselineForSend,
  createComposerSpeechStreamAnchor,
  extractComposerSpeechTranscriptDelta,
  pickLongerSpeechBaseline,
  reconcileComposerSpeechStreamAnchor,
  resolveComposerSpeechDisplayText,
  stripComposerSpeechDeltaOverlap,
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

  test("extract delta when baseline is embedded in cumulative raw", () => {
    const baseline = "还有宝可梦和神奇宝贝";
    const raw = "我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝。神奇宝贝，这些卡片能做什么";
    expect(extractComposerSpeechTranscriptDelta(baseline, raw)).toBe("神奇宝贝，这些卡片能做什么");
  });

  test("advance baseline appends sentPlain instead of replacing cumulative baseline", () => {
    const baseline = "我有很多卡片。奥特曼卡片";
    const sent = "还有宝可梦和神奇宝贝";
    expect(advanceComposerSpeechTranscriptBaseline(baseline, "", sent)).toBe(
      "我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝",
    );
  });

  test("commit baseline keeps cumulative history when lastRaw is only current phrase", () => {
    expect(
      commitComposerSpeechTranscriptBaselineForSend(
        "我有很多卡片。奥特曼卡片",
        "还有宝可梦和神奇宝贝",
        "还有宝可梦和神奇宝贝",
      ),
    ).toBe("我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝");
  });

  test("strip delta overlap removes repeated last sent plain", () => {
    expect(
      stripComposerSpeechDeltaOverlap(
        "神奇宝贝，还有宝可梦和神奇宝贝，这些卡片能做什么",
        "还有宝可梦和神奇宝贝",
      ),
    ).toBe("神奇宝贝，这些卡片能做什么");
  });

  test("pickLongerSpeechBaseline prefers cumulative over short raw", () => {
    expect(
      pickLongerSpeechBaseline(
        "我有很多卡片。奥特曼卡片",
        "还有宝可梦和神奇宝贝",
      ),
    ).toBe("我有很多卡片。奥特曼卡片");
  });

  test("appendSpeechBaselineSegment prefers longer raw hint", () => {
    const merged = appendSpeechBaselineSegment(
      "我有很多卡片。奥特曼卡片",
      "还有宝可梦和神奇宝贝",
      "我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝",
    );
    expect(merged).toBe("我有很多卡片。奥特曼卡片。还有宝可梦和神奇宝贝");
  });

  test("resolve display text replaces composer with delta only", () => {
    expect(resolveComposerSpeechDisplayText("第二句")).toEqual({ plain: "第二句", cursor: 3 });
  });

  test("strip delta overlap removes prefix duplicate from previous auto-send", () => {
    expect(
      stripComposerSpeechDeltaOverlap(
        "载一首歌，我要出发了，我出发了",
        "载一首歌，我要出发了。",
      ),
    ).toBe("我出发了");
  });

  test("extract delta after auto-send with punctuation drift", () => {
    const baseline = commitComposerSpeechTranscriptBaselineForSend(
      "",
      "载一首歌，我要出发了",
      "载一首歌，我要出发了。",
    );
    const delta = extractComposerSpeechTranscriptDelta(baseline, "载一首歌，我要出发了，我出发了");
    expect(resolveComposerSpeechDisplayText(delta).plain).toBe("我出发了");
  });
});
