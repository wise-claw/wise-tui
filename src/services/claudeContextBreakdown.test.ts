import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  buildContextBreakdownSnapshot,
  formatContextTokenCount,
  type ContextOverheadEstimate,
} from "./claudeContextBreakdown";

function session(messages: ClaudeSession["messages"]): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId: "cc-1",
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "idle",
    messages,
    createdAt: Date.now(),
    pendingPrompt: "",
  };
}

const overhead: ContextOverheadEstimate = {
  systemPrompt: 500,
  toolDefinitions: 6_700,
  rules: 5_800,
  skills: 3_000,
  mcp: 794,
  subagents: 728,
};

describe("claudeContextBreakdown", () => {
  test("formatContextTokenCount uses compact K/M suffixes", () => {
    expect(formatContextTokenCount(465)).toBe("465");
    expect(formatContextTokenCount(6_700)).toBe("6.7K");
    expect(formatContextTokenCount(57_700)).toBe("58K");
  });

  test("buildContextBreakdownSnapshot sums overhead and conversation", () => {
    const snap = buildContextBreakdownSnapshot(
      session([
        {
          id: 1,
          role: "user",
          content: "x".repeat(40_000),
          parts: [],
          timestamp: 1,
        },
      ]),
      overhead,
    );
    expect(snap.categories).toHaveLength(7);
    expect(snap.categories.find((c) => c.id === "conversation")?.tokens).toBeGreaterThan(9_000);
    expect(snap.totalTokens).toBeGreaterThan(overhead.systemPrompt + overhead.toolDefinitions);
    expect(snap.estimated).toBe(true);
  });
});
