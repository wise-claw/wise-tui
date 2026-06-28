import { describe, expect, test } from "bun:test";
import type { ClaudeSession } from "../types";
import {
  CLAUDE_COMPACT_SLASH_PROMPT,
  COMPRESS_NOTICE_DEBOUNCE_MS,
  composeCompactNoticeTokens,
  CONTEXT_AUTO_COMPACT_BEFORE_SEND_PERCENT,
  CONTEXT_AUTO_COMPACT_HEAVY_SKILL_PERCENT,
  CONTEXT_BACKGROUND_COMPACT_PERCENT,
  CONTEXT_BACKGROUND_COMPACT_FRESH_MS,
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
  planBackgroundAutoCompact,
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

  test("planAutoCompactBeforeSend skips when recent background compact lowered usage", () => {
    const tab = session([], "sid-1");
    const metrics = {
      estimatedTokens: Math.round(DEFAULT_MAX_CONTEXT_TOKENS * 0.82),
      ctxPercent: 82,
    };
    const recentAt = Date.now() - 60_000;
    expect(planAutoCompactBeforeSend(tab, "hello", metrics, recentAt).needed).toBe(false);
    expect(planAutoCompactBeforeSend(tab, "hello", metrics, null).needed).toBe(false);
    expect(
      planAutoCompactBeforeSend(tab, "hello", {
        estimatedTokens: Math.round(DEFAULT_MAX_CONTEXT_TOKENS * 0.92),
        ctxPercent: 92,
      }, recentAt).needed,
    ).toBe(true);
  });

  test("planBackgroundAutoCompact only runs for idle sessions with disk id", () => {
    const huge = "x".repeat(DEFAULT_MAX_CONTEXT_TOKENS * 3);
    const busy = session(
      [{ id: 1, role: "user", content: huge, parts: [{ type: "text", text: huge }], timestamp: 1 }],
      "sid-1",
    );
    busy.status = "running";
    expect(planBackgroundAutoCompact(busy).needed).toBe(false);

    const idle = { ...busy, status: "idle" as const };
    expect(planBackgroundAutoCompact(idle).needed).toBe(true);
    expect(planBackgroundAutoCompact(session([], null)).needed).toBe(false);
  });

  test("formatContextStatusHint mentions background compact before send threshold", () => {
    const metrics = {
      estimatedTokens: Math.round(DEFAULT_MAX_CONTEXT_TOKENS * 0.74),
      ctxPercent: 74,
    };
    // 74% 在 background compact 阈值（72%）以上，hint 应提示空闲时整理。
    expect(formatContextStatusHint(metrics)).toBe("空闲时自动整理");
    // backgroundCompactInFlight=true 时覆盖为「后台整理中」短标签，与 sysmsg 不重复。
    expect(formatContextStatusHint(metrics, undefined, true)).toBe("后台整理中");
    expect(metrics.ctxPercent).toBeGreaterThanOrEqual(CONTEXT_BACKGROUND_COMPACT_PERCENT);
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

  describe("composeCompactNoticeTokens / 压缩降噪", () => {
    const metrics = { estimatedTokens: 176_000, ctxPercent: 88 };

    test("auto-before-send 输出共享 token，且 hint 不与 sysmsg 字面重复", () => {
      const out = composeCompactNoticeTokens(metrics, "auto-before-send");
      expect(out.sysmsg).toContain("/compact");
      expect(out.sysmsg).toContain("88%");
      expect(out.hint.length).toBeGreaterThan(0);
      expect(out.sysmsg).not.toContain(out.hint);
    });

    test("overflow-retry / manual 输出不同 sysmsg 但 hint 都是短标签", () => {
      const a = composeCompactNoticeTokens(metrics, "overflow-retry");
      const b = composeCompactNoticeTokens(metrics, "manual");
      expect(a.sysmsg).not.toBe(b.sysmsg);
      expect(a.hint.length).toBeLessThanOrEqual(6);
      expect(b.hint.length).toBeLessThanOrEqual(6);
    });

    test("formatContextStatusHint 不再与 sysmsg 字面重复", () => {
      // 旧实现：`发送前将自动压缩历史` 会与 sysmsg `正在自动执行 /compact 压缩历史…` 部分重复。
      const hint = formatContextStatusHint(metrics, "hello");
      const out = composeCompactNoticeTokens(metrics, "auto-before-send");
      expect(hint).not.toContain("压缩历史");
      expect(hint).not.toBe(out.sysmsg);
    });

    test("COMPRESS_NOTICE_DEBOUNCE_MS 在 1-5s 之间，约束去重窗口", () => {
      expect(COMPRESS_NOTICE_DEBOUNCE_MS).toBeGreaterThanOrEqual(1_000);
      expect(COMPRESS_NOTICE_DEBOUNCE_MS).toBeLessThanOrEqual(5_000);
    });
  });
});
