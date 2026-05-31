import { describe, expect, test } from "bun:test";
import { isLikelyCursorAgentId, resolveCursorResumeAgentId } from "./cursorAgentId";

describe("cursorAgentId helpers", () => {
  test("detects cursor agent ids", () => {
    expect(isLikelyCursorAgentId("agent-78939caf-4da5-42c5-9bb8-b7cdf40e7b16")).toBe(true);
    expect(isLikelyCursorAgentId("bc-123")).toBe(true);
    expect(isLikelyCursorAgentId("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isLikelyCursorAgentId("session_123")).toBe(false);
  });

  test("ignores claude session ids when resolving cursor resume", () => {
    expect(
      resolveCursorResumeAgentId(
        { claudeSessionId: "550e8400-e29b-41d4-a716-446655440000" },
        "tab-1",
        new Map([["tab-1", "550e8400-e29b-41d4-a716-446655440000"]]),
      ),
    ).toBeNull();
    expect(
      resolveCursorResumeAgentId(
        { claudeSessionId: "agent-abc" },
        "tab-1",
      ),
    ).toBe("agent-abc");
  });
});
