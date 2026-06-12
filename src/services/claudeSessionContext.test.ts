import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  CLAUDE_COMPACT_SLASH_PROMPT,
  CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT,
  CONTEXT_AUTO_COMPACT_HEAVY_SKILL_PERCENT,
  CONTEXT_SATURATED_TAIL_MIN_PERCENT,
  DEFAULT_MAX_CONTEXT_TOKENS,
  estimateContextPercent,
  estimateSessionTokens,
  estimateTokensFromJsonlLines,
  formatContextStatusHint,
  getContextPercentTone,
  isCompactSlashPrompt,
  isHeavyContextSlashPrompt,
  looksLikeContextOverflowError,
  planAutoCompactBeforeSend,
  resolveSessionContextMetricsForSend,
  shouldLoadDiskForContextEstimate,
} from "./claudeSessionContext";
import { CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD } from "../constants/claudeMessageListWindow";

function session(messages: ClaudeSession["messages"], claudeSessionId: string | null = "abc"): ClaudeSession {
  return {
    id: "tab-1",
    claudeSessionId,
    repositoryPath: "/repo",
    repositoryName: "repo",
    model: "sonnet",
    status: "idle",
    messages,
    createdAt: Date.now(),
    pendingPrompt: "",
  };
}

describe("claudeSessionContext", () => {
  test("isCompactSlashPrompt recognizes compact variants", () => {
    expect(isCompactSlashPrompt("/compact")).toBe(true);
    expect(isCompactSlashPrompt("  /compact keep tests  ")).toBe(true);
    expect(isCompactSlashPrompt("/clear")).toBe(false);
  });

  test("looksLikeContextOverflowError matches common API errors", () => {
    expect(looksLikeContextOverflowError("prompt is too long for model")).toBe(true);
    expect(looksLikeContextOverflowError("network timeout")).toBe(false);
  });

  test("planAutoCompactBeforeSend skips new sessions and compact commands", () => {
    const huge = "x".repeat(DEFAULT_MAX_CONTEXT_TOKENS * 4);
    const big = session([
      {
        id: 1,
        role: "user",
        content: huge,
        parts: [{ type: "text", text: huge }],
        timestamp: 1,
      },
    ]);
    expect(planAutoCompactBeforeSend(big, "hello").needed).toBe(true);
    expect(planAutoCompactBeforeSend(session([], null), "hello").needed).toBe(false);
    expect(planAutoCompactBeforeSend(big, CLAUDE_COMPACT_SLASH_PROMPT).needed).toBe(false);
  });

  test("estimateContextPercent caps at 100", () => {
    expect(estimateContextPercent(500_000)).toBe(100);
    expect(estimateContextPercent(100_000)).toBe(50);
  });

  test("getContextPercentTone follows UI thresholds", () => {
    expect(getContextPercentTone(0)).toBe("ok");
    expect(getContextPercentTone(49)).toBe("ok");
    expect(getContextPercentTone(50)).toBe("caution");
    expect(getContextPercentTone(79)).toBe("caution");
    expect(getContextPercentTone(80)).toBe("high");
    expect(getContextPercentTone(94)).toBe("high");
    expect(getContextPercentTone(95)).toBe("critical");
    expect(getContextPercentTone(100)).toBe("critical");
  });

  test("shouldLoadDiskForContextEstimate when employee tab has empty messages", () => {
    expect(shouldLoadDiskForContextEstimate(session([], "worker-sid-1"))).toBe(true);
    expect(shouldLoadDiskForContextEstimate(session([], null))).toBe(false);
  });

  test("planAutoCompactBeforeSend uses disk metrics override for empty in-memory session", () => {
    const emptyTab = session([], "worker-sid-1");
    const metrics = {
      estimatedTokens: Math.round(DEFAULT_MAX_CONTEXT_TOKENS * 0.9),
      ctxPercent: 90,
    };
    expect(planAutoCompactBeforeSend(emptyTab, "继续任务", metrics).needed).toBe(true);
    expect(planAutoCompactBeforeSend(emptyTab, "继续任务").needed).toBe(false);
  });

  test("resolveSessionContextMetricsForSend reads jsonl when messages empty", async () => {
    const huge = "x".repeat(DEFAULT_MAX_CONTEXT_TOKENS * 4);
    const jsonlLine = JSON.stringify({
      type: "user",
      message: { role: "user", content: huge },
    });
    const metrics = await resolveSessionContextMetricsForSend(session([], "sid-1"), async () => [jsonlLine]);
    expect(metrics.ctxPercent).toBeGreaterThanOrEqual(CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT);
  });

  test("estimateTokensFromJsonlLines parses user records", () => {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "hello from disk" },
    });
    expect(estimateTokensFromJsonlLines([line])).toBeGreaterThan(0);
  });

  test("isHeavyContextSlashPrompt detects large skill commands", () => {
    expect(isHeavyContextSlashPrompt("/claude-api")).toBe(true);
    expect(isHeavyContextSlashPrompt("  /deep-research topic  ")).toBe(true);
    expect(isHeavyContextSlashPrompt("/compact")).toBe(false);
    expect(isHeavyContextSlashPrompt("hello")).toBe(false);
  });

  test("planAutoCompactBeforeSend lowers threshold for heavy skill commands", () => {
    const tab = session([], "sid-1");
    const metrics = {
      estimatedTokens: Math.round(DEFAULT_MAX_CONTEXT_TOKENS * 0.75),
      ctxPercent: 75,
    };
    expect(planAutoCompactBeforeSend(tab, "hello", metrics).needed).toBe(false);
    expect(planAutoCompactBeforeSend(tab, "/claude-api", metrics).needed).toBe(true);
    expect(metrics.ctxPercent).toBeGreaterThanOrEqual(CONTEXT_AUTO_COMPACT_HEAVY_SKILL_PERCENT);
  });

  test("formatContextStatusHint mentions heavy skill pre-compact", () => {
    const metrics = {
      estimatedTokens: Math.round(DEFAULT_MAX_CONTEXT_TOKENS * 0.8),
      ctxPercent: 80,
    };
    expect(formatContextStatusHint(metrics, "/claude-api")).toContain("大块 Skill");
  });

  test("resolveSessionContextMetricsForSend bumps estimate when jsonl tail saturated", async () => {
    const lines = Array.from({ length: CLAUDE_DISK_JSONL_TAIL_LINES_RELOAD }, () =>
      JSON.stringify({ type: "user", message: { role: "user", content: "a" } }),
    );
    const metrics = await resolveSessionContextMetricsForSend(session([], "sid-1"), async () => lines);
    expect(metrics.ctxPercent).toBeGreaterThanOrEqual(CONTEXT_SATURATED_TAIL_MIN_PERCENT);
  });

  test("estimateSessionTokens counts tool output", () => {
    const s = session([
      {
        id: 1,
        role: "assistant",
        content: "",
        parts: [
          {
            type: "tool_use",
            id: "t1",
            name: "Read",
            input: {},
            output: "abcd",
            status: "completed",
          },
        ],
        timestamp: 1,
      },
    ]);
    expect(estimateSessionTokens(s)).toBeGreaterThan(0);
  });
});
