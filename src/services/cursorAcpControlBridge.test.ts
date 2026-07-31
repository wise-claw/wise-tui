import { describe, expect, test } from "bun:test";
import {
  decodeCursorAcpQuestionRequestId,
  encodeCursorAcpQuestionRequestId,
} from "./cursorAcpControlBridge";

describe("cursorAcpControlBridge id encoding", () => {
  test("round-trips request and question ids", () => {
    const encoded = encodeCursorAcpQuestionRequestId("42", "q1");
    expect(encoded).toBe("acp-q:42::q1");
    expect(decodeCursorAcpQuestionRequestId(encoded)).toEqual({
      requestId: "42",
      questionId: "q1",
    });
  });

  test("returns null for non-encoded ids", () => {
    expect(decodeCursorAcpQuestionRequestId("plain-id")).toBeNull();
    expect(decodeCursorAcpQuestionRequestId("acp-q:missing")).toBeNull();
  });
});
