import { describe, expect, test } from "bun:test";
import type { SessionInsightsResult } from "./sessionInsights";
import {
  buildSessionInsightsAiPrompt,
  buildSessionInsightsMarkdownReport,
} from "./sessionInsightsReport";

function sampleInsights(): SessionInsightsResult {
  return {
    overview: {
      totalDurationMs: 95_000,
      turnCount: 3,
      toolCallCount: 8,
      httpObservedCount: 2,
      httpInferredCount: 1,
      avgTurnDurationMs: 31_666,
      maxTurnDurationMs: 65_000,
      p95HttpLatencyMs: 12_000,
      avgHttpLatencyMs: 8000,
      p95TtftMs: 2100,
      avgTtftMs: 1800,
      p95FirstByteMs: 900,
      tokens: {
        inputTokens: 12_000,
        outputTokens: 2000,
        cacheCreationTokens: 4000,
        cacheReadTokens: 1000,
        costUsd: 0.12,
        sampleCount: 3,
      },
      cacheHitRate: 1000 / (12000 + 4000 + 1000),
      dataCoverage: {
        hasJsonlUsage: true,
        hasHttpUsage: false,
        hasObservedHttp: true,
        hasInferredHttp: true,
        llmProxyEnabled: true,
        fccTraceCount: 0,
        opencodeGoProxyTraceCount: 0,
        hasTtftData: true,
      },
    },
    turnInsights: [],
    toolHotspots: [{ name: "Read", count: 5, turns: [1, 2] }],
    slowestTurns: [
      {
        turnIndex: 2,
        durationMs: 65_000,
        toolCount: 4,
        httpObserved: 1,
        httpLatencyMs: 10_000,
        ttftMs: 2200,
        firstByteMs: 800,
        tokens: {
          inputTokens: 5000,
          outputTokens: 800,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          costUsd: 0,
          sampleCount: 1,
        },
      },
    ],
    recommendations: [
      {
        id: "test",
        severity: "warning",
        category: "speed",
        title: "轮次 2 耗时异常",
        description: "建议检查时序图。",
        evidence: "65s",
        turnIndex: 2,
      },
    ],
  };
}

describe("buildSessionInsightsMarkdownReport", () => {
  test("includes overview and recommendations", () => {
    const md = buildSessionInsightsMarkdownReport(sampleInsights(), {
      repositoryName: "wise",
      claudeSessionId: "sess-abc",
    });
    expect(md).toContain("# Claude Code 会话 AI 使用洞察报告");
    expect(md).toContain("wise");
    expect(md).toContain("轮次 2 耗时异常");
    expect(md).toContain("Read");
  });
});

describe("buildSessionInsightsAiPrompt", () => {
  test("wraps report with analysis instructions", () => {
    const prompt = buildSessionInsightsAiPrompt(sampleInsights());
    expect(prompt).toContain("使用效率与成本优化顾问");
    expect(prompt).toContain("优先级行动清单");
    expect(prompt).toContain("轮次 2 耗时异常");
  });
});
