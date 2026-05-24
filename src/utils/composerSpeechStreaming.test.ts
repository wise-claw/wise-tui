import { describe, expect, test } from "bun:test";
import {
  applyComposerSpeechStreamTranscript,
  createComposerSpeechStreamAnchor,
  reconcileComposerSpeechStreamAnchor,
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
});
