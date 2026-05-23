import { describe, expect, test } from "bun:test";
import {
  buildSpeechInsertion,
  collectFinalSpeechTranscript,
  needsLeadingSpaceBeforeInsert,
  speechRecognitionErrorMessage,
} from "./composerSpeechRecognition";

describe("composerSpeechRecognition", () => {
  test("needsLeadingSpaceBeforeInsert only between latin tokens", () => {
    expect(needsLeadingSpaceBeforeInsert("hello", 5, "world")).toBe(true);
    expect(needsLeadingSpaceBeforeInsert("你好", 2, "世界")).toBe(false);
    expect(needsLeadingSpaceBeforeInsert("hello", 5, "世界")).toBe(false);
    expect(needsLeadingSpaceBeforeInsert("", 0, "hi")).toBe(false);
  });

  test("buildSpeechInsertion trims and collapses whitespace", () => {
    expect(buildSpeechInsertion("fix", 3, "  the   bug  ")).toEqual({
      insertion: " the bug",
      nextCursor: 11,
    });
  });

  test("buildSpeechInsertion adds space between latin words", () => {
    expect(buildSpeechInsertion("run", 3, "tests")).toEqual({
      insertion: " tests",
      nextCursor: 9,
    });
  });

  test("collectFinalSpeechTranscript ignores interim results", () => {
    const event = {
      resultIndex: 0,
      results: [
        { isFinal: false, length: 1, 0: { transcript: "临" } },
        { isFinal: true, length: 1, 0: { transcript: "时" } },
        { isFinal: true, length: 1, 0: { transcript: "结果" } },
      ],
    };
    expect(collectFinalSpeechTranscript(event)).toBe("时结果");
  });

  test("speechRecognitionErrorMessage maps known errors", () => {
    expect(speechRecognitionErrorMessage("not-allowed")).toContain("麦克风");
    expect(speechRecognitionErrorMessage("aborted")).toBe("");
  });
});
