import { describe, expect, test } from "bun:test";
import type { SessionInsightsResult, SessionTurnInsight } from "./sessionInsights";
import {
  advanceFeedbackLoop,
  compareMetricSnapshots,
  createInitialFeedbackLoopState,
  extractIncrementalSnapshot,
  extractMetricSnapshot,
  formatComparisonMarkdown,
  compareIncrementalAgainstBaseline,
  shouldEarlyStopForConvergence,
  startFeedbackLoop,
  stopFeedbackLoop,
  buildFeedbackLoopMarkdownReport,
  extractFeedbackLoopHabits,
  buildFeedbackLoopHabitsPhraseText,
  isFeedbackLoopPhaseActive,
  shouldTrackSessionLinkForFeedbackLoop,
} from "./sessionFeedbackLoop";

function sampleInsights(overrides?: Partial<SessionInsightsResult["overview"]>): SessionInsightsResult {
  return {
    overview: {
      totalDurationMs: 120_000,
      turnCount: 4,
      toolCallCount: 20,
      httpObservedCount: 4,
      httpInferredCount: 0,
      avgTurnDurationMs: 30_000,
      maxTurnDurationMs: 60_000,
      p95HttpLatencyMs: 8000,
      avgHttpLatencyMs: 5000,
      p95TtftMs: 3000,
      avgTtftMs: 2000,
      p95FirstByteMs: null,
      tokens: {
        inputTokens: 10_000,
        outputTokens: 3000,
        cacheCreationTokens: 1000,
        cacheReadTokens: 5000,
        costUsd: 0.1,
        sampleCount: 4,
      },
      cacheHitRate: 0.33,
      dataCoverage: {
        hasJsonlUsage: true,
        hasHttpUsage: false,
        hasObservedHttp: true,
        hasInferredHttp: false,
        llmProxyEnabled: true,
        fccTraceCount: 0,
        opencodeGoProxyTraceCount: 0,
        hasTtftData: true,
      },
      ...overrides,
    },
    turnInsights: [
      turnRow(1, 25_000, 4),
      turnRow(2, 30_000, 5),
      turnRow(3, 35_000, 6),
      turnRow(4, 30_000, 5),
    ],
    toolHotspots: [],
    slowestTurns: [],
    recommendations: [
      {
        id: "tool-high-avg",
        severity: "warning",
        category: "tool",
        title: "工具过多",
        description: "test",
      },
    ],
  };
}

function turnRow(turnIndex: number, durationMs: number, toolCount: number): SessionTurnInsight {
  return {
    turnIndex,
    durationMs,
    toolCount,
    httpObserved: 1,
    httpLatencyMs: 5000,
    ttftMs: 2000,
    firstByteMs: null,
    tokens: {
      inputTokens: 2000,
      outputTokens: 500,
      cacheCreationTokens: 200,
      cacheReadTokens: 2050,
      costUsd: 0,
      sampleCount: 1,
    },
  };
}

describe("extractMetricSnapshot", () => {
  test("derives per-turn tool ratio and warning count", () => {
    const snap = extractMetricSnapshot(sampleInsights());
    expect(snap.toolsPerTurn).toBe(5);
    expect(snap.warningCount).toBe(1);
    expect(snap.tokenTotal).toBe(19_000);
  });
});

describe("extractIncrementalSnapshot", () => {
  test("aggregates only turns after baseline", () => {
    const insights = sampleInsights({
      turnCount: 5,
      toolCallCount: 24,
    });
    insights.turnInsights.push(turnRow(5, 10_000, 2));
    const inc = extractIncrementalSnapshot(insights, 4);
    expect(inc).not.toBeNull();
    expect(inc!.scopedTurnCount).toBe(1);
    expect(inc!.toolCallCount).toBe(2);
    expect(inc!.avgTurnDurationMs).toBe(10_000);
  });

  test("compareIncrementalAgainstBaseline uses per-turn reference", () => {
    const sessionBaseline = extractMetricSnapshot(sampleInsights());
    const after = extractIncrementalSnapshot(
      {
        ...sampleInsights({ turnCount: 5 }),
        turnInsights: [turnRow(5, 10_000, 2)],
      },
      4,
    )!;
    const comparison = compareIncrementalAgainstBaseline(sessionBaseline, after);
    expect(comparison.improved).toBe(true);
  });
});

describe("compareMetricSnapshots", () => {
  test("marks lower latency and fewer tools as improved", () => {
    const before = extractMetricSnapshot(sampleInsights());
    const after = extractMetricSnapshot(
      sampleInsights({
        avgTurnDurationMs: 20_000,
        toolCallCount: 12,
        turnCount: 4,
        p95TtftMs: 2000,
        tokens: {
          inputTokens: 8000,
          outputTokens: 2000,
          cacheCreationTokens: 500,
          cacheReadTokens: 6000,
          costUsd: 0.08,
          sampleCount: 4,
        },
        cacheHitRate: 0.45,
      }),
    );
    const comparison = compareMetricSnapshots(before, after);
    expect(comparison.improved).toBe(true);
    expect(comparison.speedScore).toBeGreaterThan(0);
    expect(comparison.deltas.some((d) => d.label === "均轮耗时" && d.improved)).toBe(true);
  });
});

describe("shouldEarlyStopForConvergence", () => {
  test("stops when overall score is near zero", () => {
    expect(
      shouldEarlyStopForConvergence([], {
        speedScore: 0,
        efficiencyScore: 0,
        qualityScore: 0,
        overallScore: 1,
        deltas: [],
        improved: false,
        summary: "速度→ · 效率→ · 质量→",
      }),
    ).toBe(true);
  });

  test("stops after two consecutive non-improvements", () => {
    const comparison = compareMetricSnapshots(
      extractMetricSnapshot(sampleInsights()),
      extractMetricSnapshot(sampleInsights({ avgTurnDurationMs: 35_000, toolCallCount: 24 })),
    );
    expect(comparison.improved).toBe(false);
    const cycles = [
      {
        cycleIndex: 1,
        baseline: extractMetricSnapshot(sampleInsights()),
        startedAt: 1,
        baselineTurnCount: 4,
        comparison,
      },
      {
        cycleIndex: 2,
        baseline: extractMetricSnapshot(sampleInsights()),
        startedAt: 2,
        baselineTurnCount: 4,
        comparison,
      },
    ];
    expect(shouldEarlyStopForConvergence(cycles, comparison)).toBe(true);
  });
});

describe("advanceFeedbackLoop", () => {
  test("running phase emits optimization prompt", () => {
    const state = startFeedbackLoop("sess-1", 2);
    const { state: next, action } = advanceFeedbackLoop({
      state,
      insights: sampleInsights(),
      hasNewTurnsSinceOptimization: false,
    });
    expect(action.type).toBe("send_optimization");
    if (action.type === "send_optimization") {
      expect(action.prompt).toContain("反馈神经网");
      expect(action.cycleIndex).toBe(1);
    }
    expect(next.phase).toBe("awaiting_turns");
    expect(next.cycles[0]?.baselineTurnCount).toBe(4);
  });

  test("awaiting_turns with new turns triggers next cycle", () => {
    let state = startFeedbackLoop("sess-1", 2);
    ({ state } = advanceFeedbackLoop({
      state,
      insights: sampleInsights(),
      hasNewTurnsSinceOptimization: false,
    }));
    const improved = sampleInsights({ turnCount: 5, toolCallCount: 22 });
    improved.turnInsights.push(turnRow(5, 8_000, 2));
    const { state: afterCompare, action } = advanceFeedbackLoop({
      state,
      insights: improved,
      hasNewTurnsSinceOptimization: true,
    });
    expect(afterCompare.cycles).toHaveLength(2);
    expect(afterCompare.cycles[0]?.comparison).toBeDefined();
    expect(afterCompare.cycles[0]?.after?.scopedTurnCount).toBe(1);
    expect(action.type).toBe("send_optimization");
  });

  test("completes after max cycles", () => {
    let state = startFeedbackLoop("sess-1", 1);
    ({ state } = advanceFeedbackLoop({
      state,
      insights: sampleInsights(),
      hasNewTurnsSinceOptimization: false,
    }));
    const nextInsights = sampleInsights({ turnCount: 5 });
    nextInsights.turnInsights.push(turnRow(5, 12_000, 3));
    const { state: done } = advanceFeedbackLoop({
      state,
      insights: nextInsights,
      hasNewTurnsSinceOptimization: true,
    });
    expect(done.phase).toBe("completed");
    expect(done.completionReason).toBe("max_cycles");
    expect(done.cycles).toHaveLength(1);
  });

  test("forceCompare advances without new turns", () => {
    let state = startFeedbackLoop("sess-1", 2);
    ({ state } = advanceFeedbackLoop({
      state,
      insights: sampleInsights(),
      hasNewTurnsSinceOptimization: false,
    }));
    expect(state.phase).toBe("awaiting_turns");
    const { state: stuck } = advanceFeedbackLoop({
      state,
      insights: sampleInsights(),
      hasNewTurnsSinceOptimization: false,
    });
    expect(stuck.phase).toBe("awaiting_turns");
    const nextInsights = sampleInsights({ turnCount: 5 });
    nextInsights.turnInsights.push(turnRow(5, 10_000, 2));
    const { state: done } = advanceFeedbackLoop({
      state,
      insights: nextInsights,
      hasNewTurnsSinceOptimization: false,
      forceCompare: true,
    });
    expect(done.cycles[0]?.comparison).toBeDefined();
  });
});

describe("feedback loop lifecycle", () => {
  test("stop sets phase to stopped", () => {
    const stopped = stopFeedbackLoop(createInitialFeedbackLoopState("x"));
    expect(stopped.phase).toBe("stopped");
    expect(stopped.completionReason).toBe("manual");
  });

  test("formatComparisonMarkdown includes axis labels", () => {
    const before = extractMetricSnapshot(sampleInsights());
    const after = extractMetricSnapshot(sampleInsights({ avgTurnDurationMs: 15_000 }));
    const md = formatComparisonMarkdown(compareMetricSnapshots(before, after));
    expect(md).toContain("速度");
    expect(md).toContain("均轮耗时");
  });

  test("extractFeedbackLoopHabits returns phrases", () => {
    const habits = extractFeedbackLoopHabits(createInitialFeedbackLoopState("x"));
    expect(habits.length).toBeGreaterThan(0);
    expect(buildFeedbackLoopHabitsPhraseText(habits)).toContain("神经网");
  });

  test("buildFeedbackLoopMarkdownReport includes trend table", () => {
    let state = startFeedbackLoop("sess-1", 1);
    ({ state } = advanceFeedbackLoop({
      state,
      insights: sampleInsights(),
      hasNewTurnsSinceOptimization: false,
    }));
    const nextInsights = sampleInsights({ turnCount: 5 });
    nextInsights.turnInsights.push(turnRow(5, 10_000, 2));
    ({ state } = advanceFeedbackLoop({
      state,
      insights: nextInsights,
      hasNewTurnsSinceOptimization: true,
    }));
    const md = buildFeedbackLoopMarkdownReport(state, { repositoryName: "wise" });
    expect(md).toContain("得分趋势");
    expect(md).toContain("wise");
  });
});

describe("shouldTrackSessionLinkForFeedbackLoop", () => {
  test("drawer open always tracks", () => {
    expect(
      shouldTrackSessionLinkForFeedbackLoop({
        drawerOpen: true,
        feedbackLoopEnabled: false,
        autoStart: false,
        loopPhase: "idle",
      }),
    ).toBe(true);
  });

  test("tracks when loop is active and drawer closed", () => {
    expect(
      shouldTrackSessionLinkForFeedbackLoop({
        drawerOpen: false,
        feedbackLoopEnabled: true,
        autoStart: false,
        loopPhase: "awaiting_turns",
      }),
    ).toBe(true);
  });

  test("tracks when autoStart enabled even if idle", () => {
    expect(
      shouldTrackSessionLinkForFeedbackLoop({
        drawerOpen: false,
        feedbackLoopEnabled: true,
        autoStart: true,
        loopPhase: "idle",
      }),
    ).toBe(true);
  });

  test("does not track when disabled and drawer closed", () => {
    expect(
      shouldTrackSessionLinkForFeedbackLoop({
        drawerOpen: false,
        feedbackLoopEnabled: false,
        autoStart: true,
        loopPhase: "running",
      }),
    ).toBe(false);
  });
});
