import { describe, expect, test } from "bun:test";
import {
  isLikelyCodexResumeId,
  resolveCodexResumeSessionId,
  sessionHasPriorCodexTurn,
} from "./codexSessionId";

describe("codexSessionId helpers", () => {
  test("detects codex resume ids", () => {
    expect(isLikelyCodexResumeId("0199a213-81c0-7800-8aa1-bbab2a035a53")).toBe(true);
    expect(isLikelyCodexResumeId("my-thread")).toBe(true);
    expect(isLikelyCodexResumeId("agent-abc")).toBe(false);
    expect(isLikelyCodexResumeId("bc-123")).toBe(false);
  });

  test("does not resume before first codex turn", () => {
    expect(
      resolveCodexResumeSessionId(
        {
          claudeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
          messages: [],
        },
        "tab-1",
      ),
    ).toBeNull();
  });

  test("resumes after prior codex system marker", () => {
    expect(
      resolveCodexResumeSessionId(
        {
          claudeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
          messages: [
            {
              role: "system",
              content: "Codex 执行中（模型：默认）…",
              timestamp: 1,
              parts: [],
            },
          ],
        },
        "tab-1",
      ),
    ).toBe("0199a213-81c0-7800-8aa1-bbab2a035a53");
  });

  test("sessionHasPriorCodexTurn matches codex system lines", () => {
    expect(sessionHasPriorCodexTurn([])).toBe(false);
    expect(
      sessionHasPriorCodexTurn([
        {
          role: "system",
          content: "Codex 执行中（模型：gpt-5）…",
          timestamp: 1,
          parts: [],
        },
      ]),
    ).toBe(true);
  });
});
