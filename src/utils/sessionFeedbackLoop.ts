import type { SessionInsightsResult, SessionInsightRecommendation } from "./sessionInsights";
import {
  buildSessionInsightsAiOptimizationPrompt,
  buildRequestRationalityLines,
  type SessionInsightsReportMeta,
} from "./sessionInsightsReport";
import { formatDurationMs, formatTokenCount } from "./sessionInsights";
import {
  buildConfigArtifactOptimizationSection,
  type FeedbackConfigSnapshot,
} from "./sessionFeedbackConfigPatch";

export {
  buildFeedbackLoopConfigPatchPrompt,
  type FeedbackConfigPatch,
  type FeedbackConfigSnapshot,
} from "./sessionFeedbackConfigPatch";

/** 反馈闭环观测的三维指标：速度、效率（Token/成本）、质量（工具使用）。 */
export type FeedbackMetricAxis = "speed" | "efficiency" | "quality";

export interface SessionFeedbackMetricSnapshot {
  turnCount: number;
  totalDurationMs: number;
  avgTurnDurationMs: number;
  toolCallCount: number;
  toolsPerTurn: number;
  tokenTotal: number;
  outputTokenRatio: number;
  cacheHitRate: number | null;
  p95HttpLatencyMs: number | null;
  p95TtftMs: number | null;
  recommendationCount: number;
  warningCount: number;
  capturedAt: number;
  /** MCP / Skill / 子代理调用次数（会话级） */
  mcpToolCount?: number;
  skillToolCount?: number;
  subagentToolCount?: number;
  httpRequestsPerTurn?: number;
  maxTurnToolCount?: number;
  /** 增量快照：仅统计指定轮次范围 */
  scopedTurnFrom?: number;
  scopedTurnTo?: number;
  scopedTurnCount?: number;
}

export interface FeedbackMetricDelta {
  axis: FeedbackMetricAxis;
  label: string;
  before: string;
  after: string;
  /** 正值表示改善（速度更快、Token 更少、质量更好）。 */
  deltaPercent: number | null;
  improved: boolean;
}

export interface FeedbackComparisonResult {
  speedScore: number;
  efficiencyScore: number;
  qualityScore: number;
  overallScore: number;
  deltas: FeedbackMetricDelta[];
  improved: boolean;
  summary: string;
}

export type FeedbackLoopPhase =
  | "idle"
  | "running"
  | "awaiting_turns"
  | "comparing"
  | "completed"
  | "stopped";

/** 闭环运行中（需后台持续拉取洞察数据）。 */
export function isFeedbackLoopPhaseActive(phase: FeedbackLoopPhase): boolean {
  return phase === "running" || phase === "awaiting_turns" || phase === "comparing";
}

/** 是否应在抽屉关闭时仍追踪会话链路数据以驱动反馈神经网。 */
export function shouldTrackSessionLinkForFeedbackLoop(input: {
  drawerOpen: boolean;
  feedbackLoopEnabled: boolean;
  autoStart: boolean;
  loopPhase: FeedbackLoopPhase;
}): boolean {
  if (input.drawerOpen) return true;
  if (!input.feedbackLoopEnabled) return false;
  if (input.autoStart) return true;
  return isFeedbackLoopPhaseActive(input.loopPhase);
}

export interface SessionFeedbackCycle {
  cycleIndex: number;
  baseline: SessionFeedbackMetricSnapshot;
  after?: SessionFeedbackMetricSnapshot;
  comparison?: FeedbackComparisonResult;
  startedAt: number;
  completedAt?: number;
  /** 发送优化 prompt 时的轮次计数，用于增量比对 */
  baselineTurnCount: number;
  /** worker 会话返回的优化建议摘要（前 2k 字符） */
  workerResponsePreview?: string;
  workerResponseAt?: number;
}

export interface SessionFeedbackLoopState {
  sessionId: string;
  phase: FeedbackLoopPhase;
  maxCycles: number;
  currentCycleIndex: number;
  cycles: SessionFeedbackCycle[];
  initialBaseline?: SessionFeedbackMetricSnapshot;
  turnCountAtLastOptimization?: number;
  lastOptimizationPromptSentAt?: number;
  /** 收敛早停或达到上限 */
  completionReason?: "max_cycles" | "converged" | "manual";
}

export const DEFAULT_FEEDBACK_LOOP_MAX_CYCLES = 3;
export const MIN_FEEDBACK_LOOP_MAX_CYCLES = 1;
export const MAX_FEEDBACK_LOOP_MAX_CYCLES = 5;
/** |overallScore| 低于此阈值视为已收敛 */
export const FEEDBACK_LOOP_CONVERGENCE_THRESHOLD = 2;

const AXIS_LABEL: Record<FeedbackMetricAxis, string> = {
  speed: "速度",
  efficiency: "效率",
  quality: "质量",
};

function tokenTotalFromInsights(insights: SessionInsightsResult): number {
  const t = insights.overview.tokens;
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

function countWarnings(recommendations: readonly SessionInsightRecommendation[]): number {
  return recommendations.filter((r) => r.severity === "warning" || r.severity === "critical").length;
}

function requestRationalityFields(insights: SessionInsightsResult): Pick<
  SessionFeedbackMetricSnapshot,
  "mcpToolCount" | "skillToolCount" | "subagentToolCount" | "httpRequestsPerTurn" | "maxTurnToolCount"
> {
  const req = insights.requestRationality;
  const pick = (category: "mcp" | "skill" | "subagent") =>
    req.toolCategories.find((c) => c.category === category)?.count ?? 0;
  return {
    mcpToolCount: pick("mcp"),
    skillToolCount: pick("skill"),
    subagentToolCount: pick("subagent"),
    httpRequestsPerTurn: req.httpRequestsPerTurn,
    maxTurnToolCount: req.maxTurnToolCount,
  };
}

/** 从会话洞察提取可对比的指标快照。 */
export function extractMetricSnapshot(insights: SessionInsightsResult): SessionFeedbackMetricSnapshot {
  const { overview, recommendations } = insights;
  const tokenTotal = tokenTotalFromInsights(insights);
  const inputSide =
    overview.tokens.inputTokens +
    overview.tokens.cacheCreationTokens +
    overview.tokens.cacheReadTokens;
  return {
    turnCount: overview.turnCount,
    totalDurationMs: overview.totalDurationMs,
    avgTurnDurationMs: overview.avgTurnDurationMs,
    toolCallCount: overview.toolCallCount,
    toolsPerTurn: overview.turnCount > 0 ? overview.toolCallCount / overview.turnCount : 0,
    tokenTotal,
    outputTokenRatio: inputSide > 0 ? overview.tokens.outputTokens / inputSide : 0,
    cacheHitRate: overview.cacheHitRate,
    p95HttpLatencyMs: overview.p95HttpLatencyMs,
    p95TtftMs: overview.p95TtftMs,
    recommendationCount: recommendations.length,
    warningCount: countWarnings(recommendations),
    capturedAt: Date.now(),
    ...requestRationalityFields(insights),
  };
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

/**
 * 仅聚合优化后新增轮次的指标，避免全会话均值稀释对比结果。
 * @param afterTurnExclusive 不含该轮次及之前（即 turnIndex > afterTurnExclusive）
 */
export function extractIncrementalSnapshot(
  insights: SessionInsightsResult,
  afterTurnExclusive: number,
): SessionFeedbackMetricSnapshot | null {
  const turns = insights.turnInsights.filter((t) => t.turnIndex > afterTurnExclusive);
  if (turns.length === 0) return null;

  const totalDurationMs = turns.reduce((a, t) => a + t.durationMs, 0);
  const toolCallCount = turns.reduce((a, t) => a + t.toolCount, 0);
  const tokenTotal = turns.reduce(
    (a, t) =>
      a +
      t.tokens.inputTokens +
      t.tokens.outputTokens +
      t.tokens.cacheCreationTokens +
      t.tokens.cacheReadTokens,
    0,
  );
  const inputSide = turns.reduce(
    (a, t) => a + t.tokens.inputTokens + t.tokens.cacheCreationTokens + t.tokens.cacheReadTokens,
    0,
  );
  const outputTokens = turns.reduce((a, t) => a + t.tokens.outputTokens, 0);
  const cacheRead = turns.reduce((a, t) => a + t.tokens.cacheReadTokens, 0);
  const cacheCreation = turns.reduce((a, t) => a + t.tokens.cacheCreationTokens, 0);
  const cacheDenom = inputSide + cacheCreation;
  const ttfts = turns.map((t) => t.ttftMs).filter((v): v is number => v != null && v > 0);

  const fromTurn = Math.min(...turns.map((t) => t.turnIndex));
  const toTurn = Math.max(...turns.map((t) => t.turnIndex));
  const maxTurnToolCount = turns.reduce((m, t) => Math.max(m, t.toolCount), 0);

  return {
    turnCount: turns.length,
    totalDurationMs,
    avgTurnDurationMs: totalDurationMs / turns.length,
    toolCallCount,
    toolsPerTurn: toolCallCount / turns.length,
    tokenTotal,
    outputTokenRatio: inputSide > 0 ? outputTokens / inputSide : 0,
    cacheHitRate: cacheDenom > 0 ? cacheRead / cacheDenom : null,
    p95HttpLatencyMs: null,
    p95TtftMs: percentile(ttfts, 95),
    recommendationCount: insights.recommendations.length,
    warningCount: countWarnings(insights.recommendations),
    capturedAt: Date.now(),
    maxTurnToolCount,
    scopedTurnFrom: fromTurn,
    scopedTurnTo: toTurn,
    scopedTurnCount: turns.length,
  };
}

/** 用优化前会话的均轮指标，构造与新轮次数量对齐的参照快照。 */
export function buildIncrementalReferenceSnapshot(
  sessionBaseline: SessionFeedbackMetricSnapshot,
  newTurnCount: number,
): SessionFeedbackMetricSnapshot {
  const n = Math.max(1, newTurnCount);
  const perTurnTokens =
    sessionBaseline.turnCount > 0 ? sessionBaseline.tokenTotal / sessionBaseline.turnCount : 0;
  return {
    turnCount: n,
    totalDurationMs: sessionBaseline.avgTurnDurationMs * n,
    avgTurnDurationMs: sessionBaseline.avgTurnDurationMs,
    toolCallCount: sessionBaseline.toolsPerTurn * n,
    toolsPerTurn: sessionBaseline.toolsPerTurn,
    tokenTotal: perTurnTokens * n,
    outputTokenRatio: sessionBaseline.outputTokenRatio,
    cacheHitRate: sessionBaseline.cacheHitRate,
    p95HttpLatencyMs: sessionBaseline.p95HttpLatencyMs,
    p95TtftMs: sessionBaseline.p95TtftMs,
    recommendationCount: sessionBaseline.recommendationCount,
    warningCount: sessionBaseline.warningCount,
    mcpToolCount:
      sessionBaseline.mcpToolCount != null && sessionBaseline.turnCount > 0
        ? (sessionBaseline.mcpToolCount / sessionBaseline.turnCount) * n
        : undefined,
    skillToolCount:
      sessionBaseline.skillToolCount != null && sessionBaseline.turnCount > 0
        ? (sessionBaseline.skillToolCount / sessionBaseline.turnCount) * n
        : undefined,
    subagentToolCount:
      sessionBaseline.subagentToolCount != null && sessionBaseline.turnCount > 0
        ? (sessionBaseline.subagentToolCount / sessionBaseline.turnCount) * n
        : undefined,
    httpRequestsPerTurn: sessionBaseline.httpRequestsPerTurn,
    maxTurnToolCount: sessionBaseline.maxTurnToolCount,
    capturedAt: sessionBaseline.capturedAt,
    scopedTurnCount: n,
  };
}

function appendOptionalCountDelta(
  deltas: FeedbackMetricDelta[],
  label: string,
  before: number | undefined,
  after: number | undefined,
): void {
  if (before == null && after == null) return;
  const delta = pctDelta(before ?? 0, after ?? 0, true);
  deltas.push({
    axis: "quality",
    label,
    before: before != null ? String(Math.round(before)) : "—",
    after: after != null ? String(Math.round(after)) : "—",
    deltaPercent: delta,
    improved: delta != null && delta > 0,
  });
}

function buildComparisonScores(deltas: FeedbackMetricDelta[]): {
  speedScore: number;
  efficiencyScore: number;
  qualityScore: number;
  overallScore: number;
  improved: boolean;
  summary: string;
} {
  const speedScores = deltas.filter((d) => d.axis === "speed").map((d) => scoreFromDelta(d.deltaPercent));
  const efficiencyScores = deltas
    .filter((d) => d.axis === "efficiency")
    .map((d) => scoreFromDelta(d.deltaPercent));
  const qualityScores = deltas.filter((d) => d.axis === "quality").map((d) => scoreFromDelta(d.deltaPercent));
  const avg = (values: number[]) =>
    values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

  const speedScore = avg(speedScores);
  const efficiencyScore = avg(efficiencyScores);
  const qualityScore = avg(qualityScores);
  const axisScores = [speedScore, efficiencyScore, qualityScore].filter((s) => Number.isFinite(s));
  const overallScore =
    axisScores.length > 0 ? axisScores.reduce((a, b) => a + b, 0) / axisScores.length : 0;
  const improved = overallScore > 2;

  const summaryParts: string[] = [];
  for (const [axis, score] of [
    ["speed", speedScore],
    ["efficiency", efficiencyScore],
    ["quality", qualityScore],
  ] as const) {
    const sign = score > 2 ? "↑" : score < -2 ? "↓" : "→";
    summaryParts.push(`${AXIS_LABEL[axis]}${sign}`);
  }

  return {
    speedScore,
    efficiencyScore,
    qualityScore,
    overallScore,
    improved,
    summary: summaryParts.join(" · "),
  };
}

export function compareIncrementalAgainstBaseline(
  sessionBaseline: SessionFeedbackMetricSnapshot,
  afterIncremental: SessionFeedbackMetricSnapshot,
): FeedbackComparisonResult {
  const ref = buildIncrementalReferenceSnapshot(
    sessionBaseline,
    afterIncremental.scopedTurnCount ?? afterIncremental.turnCount,
  );

  const deltas: FeedbackMetricDelta[] = [];

  const avgTurnDelta = pctDelta(ref.avgTurnDurationMs, afterIncremental.avgTurnDurationMs, true);
  deltas.push({
    axis: "speed",
    label: "均轮耗时",
    before: formatDurationMs(ref.avgTurnDurationMs),
    after: formatDurationMs(afterIncremental.avgTurnDurationMs),
    deltaPercent: avgTurnDelta,
    improved: avgTurnDelta != null && avgTurnDelta > 0,
  });

  const ttftDelta =
    ref.p95TtftMs != null && afterIncremental.p95TtftMs != null
      ? pctDelta(ref.p95TtftMs, afterIncremental.p95TtftMs, true)
      : null;
  if (ref.p95TtftMs != null || afterIncremental.p95TtftMs != null) {
    deltas.push({
      axis: "speed",
      label: "TTFT P95",
      before: formatMs(ref.p95TtftMs),
      after: formatMs(afterIncremental.p95TtftMs),
      deltaPercent: ttftDelta,
      improved: ttftDelta != null && ttftDelta > 0,
    });
  }

  const toolsDelta = pctDelta(ref.toolsPerTurn, afterIncremental.toolsPerTurn, true);
  deltas.push({
    axis: "quality",
    label: "工具/轮",
    before: formatToolsPerTurn(ref.toolsPerTurn),
    after: formatToolsPerTurn(afterIncremental.toolsPerTurn),
    deltaPercent: toolsDelta,
    improved: toolsDelta != null && toolsDelta > 0,
  });

  const toolCountDelta = pctDelta(ref.toolCallCount, afterIncremental.toolCallCount, true);
  deltas.push({
    axis: "quality",
    label: "工具次数",
    before: String(Math.round(ref.toolCallCount)),
    after: String(Math.round(afterIncremental.toolCallCount)),
    deltaPercent: toolCountDelta,
    improved: toolCountDelta != null && toolCountDelta > 0,
  });

  appendOptionalCountDelta(deltas, "MCP 次数", ref.mcpToolCount, afterIncremental.mcpToolCount);
  appendOptionalCountDelta(deltas, "Skill 次数", ref.skillToolCount, afterIncremental.skillToolCount);

  const tokenPerTurnBefore = ref.turnCount > 0 ? ref.tokenTotal / ref.turnCount : 0;
  const tokenPerTurnAfter =
    afterIncremental.turnCount > 0 ? afterIncremental.tokenTotal / afterIncremental.turnCount : 0;
  const tokenPerTurnDelta = pctDelta(tokenPerTurnBefore, tokenPerTurnAfter, true);
  deltas.push({
    axis: "efficiency",
    label: "Token/轮",
    before: tokenPerTurnBefore > 0 ? formatTokenCount(tokenPerTurnBefore) : "—",
    after: tokenPerTurnAfter > 0 ? formatTokenCount(tokenPerTurnAfter) : "—",
    deltaPercent: tokenPerTurnDelta,
    improved: tokenPerTurnDelta != null && tokenPerTurnDelta > 0,
  });

  const tokenDelta = pctDelta(ref.tokenTotal, afterIncremental.tokenTotal, true);
  deltas.push({
    axis: "efficiency",
    label: "Token 合计",
    before: ref.tokenTotal > 0 ? formatTokenCount(ref.tokenTotal) : "—",
    after: afterIncremental.tokenTotal > 0 ? formatTokenCount(afterIncremental.tokenTotal) : "—",
    deltaPercent: tokenDelta,
    improved: tokenDelta != null && tokenDelta > 0,
  });

  const cacheBefore = ref.cacheHitRate;
  const cacheAfter = afterIncremental.cacheHitRate;
  const cacheDelta =
    cacheBefore != null && cacheAfter != null ? pctDelta(cacheBefore, cacheAfter, false) : null;
  if (cacheBefore != null || cacheAfter != null) {
    deltas.push({
      axis: "efficiency",
      label: "Cache 命中率",
      before: formatRatio(cacheBefore),
      after: formatRatio(cacheAfter),
      deltaPercent: cacheDelta,
      improved: cacheDelta != null && cacheDelta > 0,
    });
  }

  const scores = buildComparisonScores(deltas);

  return {
    ...scores,
    deltas,
  };
}

export function normalizeFeedbackLoopMaxCycles(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_FEEDBACK_LOOP_MAX_CYCLES;
  return Math.max(MIN_FEEDBACK_LOOP_MAX_CYCLES, Math.min(MAX_FEEDBACK_LOOP_MAX_CYCLES, n));
}

export function shouldEarlyStopForConvergence(
  cycles: readonly SessionFeedbackCycle[],
  latestComparison: FeedbackComparisonResult,
  threshold = FEEDBACK_LOOP_CONVERGENCE_THRESHOLD,
): boolean {
  if (Math.abs(latestComparison.overallScore) <= threshold) {
    return true;
  }
  const completed = cycles.filter((c) => c.comparison != null);
  if (completed.length >= 2) {
    const last = completed[completed.length - 1]?.comparison;
    const prev = completed[completed.length - 2]?.comparison;
    if (last && prev && !last.improved && !prev.improved) {
      return true;
    }
  }
  return false;
}

function pctDelta(before: number, after: number, lowerIsBetter: boolean): number | null {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (before === 0 && after === 0) return 0;
  if (before === 0) return lowerIsBetter ? (after < 0 ? 100 : -100) : after > 0 ? 100 : -100;
  const raw = ((after - before) / Math.abs(before)) * 100;
  return lowerIsBetter ? -raw : raw;
}

function scoreFromDelta(deltaPercent: number | null, weight = 1): number {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return 0;
  const clamped = Math.max(-100, Math.min(100, deltaPercent));
  return clamped * weight;
}

function formatMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatDurationMs(value);
}

function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatToolsPerTurn(value: number): string {
  return value.toFixed(1);
}

/** 对比两轮快照，计算速度/效率/质量三维得分。 */
export function compareMetricSnapshots(
  baseline: SessionFeedbackMetricSnapshot,
  after: SessionFeedbackMetricSnapshot,
): FeedbackComparisonResult {
  const deltas: FeedbackMetricDelta[] = [];

  const avgTurnDelta = pctDelta(baseline.avgTurnDurationMs, after.avgTurnDurationMs, true);
  deltas.push({
    axis: "speed",
    label: "均轮耗时",
    before: formatDurationMs(baseline.avgTurnDurationMs),
    after: formatDurationMs(after.avgTurnDurationMs),
    deltaPercent: avgTurnDelta,
    improved: avgTurnDelta != null && avgTurnDelta > 0,
  });

  const ttftDelta =
    baseline.p95TtftMs != null && after.p95TtftMs != null
      ? pctDelta(baseline.p95TtftMs, after.p95TtftMs, true)
      : null;
  if (baseline.p95TtftMs != null || after.p95TtftMs != null) {
    deltas.push({
      axis: "speed",
      label: "TTFT P95",
      before: formatMs(baseline.p95TtftMs),
      after: formatMs(after.p95TtftMs),
      deltaPercent: ttftDelta,
      improved: ttftDelta != null && ttftDelta > 0,
    });
  }

  const tokenDelta = pctDelta(baseline.tokenTotal, after.tokenTotal, true);
  deltas.push({
    axis: "efficiency",
    label: "Token 合计",
    before: baseline.tokenTotal > 0 ? formatTokenCount(baseline.tokenTotal) : "—",
    after: after.tokenTotal > 0 ? formatTokenCount(after.tokenTotal) : "—",
    deltaPercent: tokenDelta,
    improved: tokenDelta != null && tokenDelta > 0,
  });

  const cacheBefore = baseline.cacheHitRate;
  const cacheAfter = after.cacheHitRate;
  const cacheDelta =
    cacheBefore != null && cacheAfter != null
      ? pctDelta(cacheBefore, cacheAfter, false)
      : null;
  if (cacheBefore != null || cacheAfter != null) {
    deltas.push({
      axis: "efficiency",
      label: "Cache 命中率",
      before: formatRatio(cacheBefore),
      after: formatRatio(cacheAfter),
      deltaPercent: cacheDelta,
      improved: cacheDelta != null && cacheDelta > 0,
    });
  }

  const toolsDelta = pctDelta(baseline.toolsPerTurn, after.toolsPerTurn, true);
  deltas.push({
    axis: "quality",
    label: "工具/轮",
    before: formatToolsPerTurn(baseline.toolsPerTurn),
    after: formatToolsPerTurn(after.toolsPerTurn),
    deltaPercent: toolsDelta,
    improved: toolsDelta != null && toolsDelta > 0,
  });

  const warnDelta = pctDelta(baseline.warningCount, after.warningCount, true);
  deltas.push({
    axis: "quality",
    label: "警告项",
    before: String(baseline.warningCount),
    after: String(after.warningCount),
    deltaPercent: warnDelta,
    improved: warnDelta != null && warnDelta > 0,
  });

  appendOptionalCountDelta(deltas, "MCP 次数", baseline.mcpToolCount, after.mcpToolCount);
  appendOptionalCountDelta(deltas, "Skill 次数", baseline.skillToolCount, after.skillToolCount);

  const scores = buildComparisonScores(deltas);

  return {
    ...scores,
    deltas,
  };
}

export function createInitialFeedbackLoopState(
  sessionId: string,
  maxCycles = DEFAULT_FEEDBACK_LOOP_MAX_CYCLES,
): SessionFeedbackLoopState {
  return {
    sessionId,
    phase: "idle",
    maxCycles,
    currentCycleIndex: 0,
    cycles: [],
  };
}

export type FeedbackLoopAdvanceAction =
  | { type: "send_optimization"; prompt: string; cycleIndex: number }
  | { type: "record_comparison"; comparison: FeedbackComparisonResult; cycleIndex: number }
  | { type: "complete"; reason: string }
  | { type: "none" };

export interface AdvanceFeedbackLoopInput {
  state: SessionFeedbackLoopState;
  insights: SessionInsightsResult;
  meta?: SessionInsightsReportMeta;
  /** 上一轮优化后是否出现新轮次（turnCount 增加）。 */
  hasNewTurnsSinceOptimization: boolean;
  /** 启用收敛早停 */
  earlyStopConvergence?: boolean;
  /** 忽略轮次门槛，立即比对当前洞察 */
  forceCompare?: boolean;
  /** 在优化 prompt 中包含 CLAUDE.md / rules / MCP / skills 指引 */
  optimizeConfigArtifacts?: boolean;
  configSnapshot?: FeedbackConfigSnapshot | null;
}

/** 状态机：根据当前洞察与轮次变化推进反馈闭环。 */
export function advanceFeedbackLoop(input: AdvanceFeedbackLoopInput): {
  state: SessionFeedbackLoopState;
  action: FeedbackLoopAdvanceAction;
} {
  const {
    insights,
    meta,
    hasNewTurnsSinceOptimization,
    earlyStopConvergence = true,
    forceCompare = false,
    optimizeConfigArtifacts = false,
    configSnapshot = null,
  } = input;
  let state = { ...input.state, cycles: [...input.state.cycles] };
  const snapshot = extractMetricSnapshot(insights);

  if (state.phase === "idle" || state.phase === "stopped" || state.phase === "completed") {
    return { state, action: { type: "none" } };
  }

  if (state.phase === "running") {
    const cycleIndex = state.currentCycleIndex + 1;
    const baseline = state.initialBaseline ?? snapshot;
    const baselineTurnCount = snapshot.turnCount;
    const cycle: SessionFeedbackCycle = {
      cycleIndex,
      baseline: state.initialBaseline ?? snapshot,
      startedAt: Date.now(),
      baselineTurnCount,
    };
    state = {
      ...state,
      currentCycleIndex: cycleIndex,
      initialBaseline: state.initialBaseline ?? snapshot,
      cycles: [...state.cycles, cycle],
      phase: "awaiting_turns",
      turnCountAtLastOptimization: snapshot.turnCount,
      lastOptimizationPromptSentAt: Date.now(),
    };
    const prompt = buildFeedbackLoopOptimizationPrompt({
      insights,
      meta,
      cycleIndex,
      maxCycles: state.maxCycles,
      baseline,
      previousCycles: state.cycles.slice(0, -1),
      optimizeConfigArtifacts: input.optimizeConfigArtifacts,
      configSnapshot: input.configSnapshot,
    });
    return {
      state,
      action: { type: "send_optimization", prompt, cycleIndex },
    };
  }

  if (state.phase === "awaiting_turns") {
    if (!hasNewTurnsSinceOptimization && !forceCompare) {
      return { state, action: { type: "none" } };
    }

    const activeCycle = state.cycles[state.cycles.length - 1];
    if (!activeCycle) {
      return { state: { ...state, phase: "stopped" }, action: { type: "none" } };
    }

    const afterSnapshot =
      extractIncrementalSnapshot(insights, activeCycle.baselineTurnCount) ?? snapshot;
    const comparison = compareIncrementalAgainstBaseline(activeCycle.baseline, afterSnapshot);
    const completedCycle: SessionFeedbackCycle = {
      ...activeCycle,
      after: afterSnapshot,
      comparison,
      completedAt: Date.now(),
    };
    const cycles = [...state.cycles.slice(0, -1), completedCycle];
    state = { ...state, cycles, phase: "comparing" };

    const converged =
      earlyStopConvergence && shouldEarlyStopForConvergence(cycles, comparison);

    if (state.currentCycleIndex >= state.maxCycles || converged) {
      return {
        state: {
          ...state,
          phase: "completed",
          completionReason: converged ? "converged" : "max_cycles",
        },
        action: {
          type: "record_comparison",
          comparison,
          cycleIndex: completedCycle.cycleIndex,
        },
      };
    }

    const nextCycleIndex = state.currentCycleIndex + 1;
    const nextCycle: SessionFeedbackCycle = {
      cycleIndex: nextCycleIndex,
      baseline: snapshot,
      startedAt: Date.now(),
      baselineTurnCount: snapshot.turnCount,
    };
    state = {
      ...state,
      currentCycleIndex: nextCycleIndex,
      cycles: [...cycles, nextCycle],
      phase: "awaiting_turns",
      turnCountAtLastOptimization: snapshot.turnCount,
      lastOptimizationPromptSentAt: Date.now(),
    };
    const prompt = buildFeedbackLoopOptimizationPrompt({
      insights,
      meta,
      cycleIndex: nextCycleIndex,
      maxCycles: state.maxCycles,
      baseline: snapshot,
      previousCycles: cycles,
      lastComparison: comparison,
      optimizeConfigArtifacts,
      configSnapshot,
    });
    return {
      state,
      action: { type: "send_optimization", prompt, cycleIndex: nextCycleIndex },
    };
  }

  if (state.phase === "comparing") {
    return { state: { ...state, phase: "completed" }, action: { type: "none" } };
  }

  return { state, action: { type: "none" } };
}

export function startFeedbackLoop(
  sessionId: string,
  maxCycles = DEFAULT_FEEDBACK_LOOP_MAX_CYCLES,
): SessionFeedbackLoopState {
  return {
    sessionId,
    phase: "running",
    maxCycles,
    currentCycleIndex: 0,
    cycles: [],
  };
}

export function stopFeedbackLoop(state: SessionFeedbackLoopState): SessionFeedbackLoopState {
  return { ...state, phase: "stopped", completionReason: "manual" };
}

const WORKER_RESPONSE_PREVIEW_MAX = 2000;

/** 将 worker 优化响应附加到指定循环（供 UI 展示与报告导出）。 */
export function attachFeedbackCycleWorkerResponse(
  state: SessionFeedbackLoopState,
  cycleIndex: number,
  responseText: string,
): SessionFeedbackLoopState {
  const trimmed = responseText.trim();
  if (!trimmed) return state;
  const preview =
    trimmed.length > WORKER_RESPONSE_PREVIEW_MAX
      ? `${trimmed.slice(0, WORKER_RESPONSE_PREVIEW_MAX)}…`
      : trimmed;
  const cycles = state.cycles.map((cycle) =>
    cycle.cycleIndex === cycleIndex
      ? { ...cycle, workerResponsePreview: preview, workerResponseAt: Date.now() }
      : cycle,
  );
  return { ...state, cycles };
}

/** 提取优先处理的洞察警告（驱动闭环启动与 UI 展示）。 */
export function pickTopFeedbackWarnings(
  insights: SessionInsightsResult,
  limit = 4,
): SessionInsightRecommendation[] {
  const severityOrder: Record<SessionInsightRecommendation["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return [...insights.recommendations]
    .filter((r) => r.id !== "all-good")
    .sort(
      (a, b) =>
        severityOrder[a.severity] - severityOrder[b.severity] ||
        a.category.localeCompare(b.category),
    )
    .slice(0, limit);
}

/** 根据上一轮对比或洞察，推断本轮优化聚焦方向。 */
export function inferOptimizationFocusHint(input: {
  lastComparison?: FeedbackComparisonResult;
  insights?: SessionInsightsResult;
}): string {
  const { lastComparison, insights } = input;
  if (lastComparison) {
    const axes: { axis: FeedbackMetricAxis; score: number; hint: string }[] = [
      {
        axis: "speed",
        score: lastComparison.speedScore,
        hint: "优先压缩均轮耗时与 TTFT：合并工具步骤、减少模型 HTTP 往返",
      },
      {
        axis: "efficiency",
        score: lastComparison.efficiencyScore,
        hint: "优先降低 Token/轮与 Cache 写入：稳定 prompt、控制读取范围、截断 MCP 大响应",
      },
      {
        axis: "quality",
        score: lastComparison.qualityScore,
        hint: "优先缩短工具链并审视 MCP/Skill：减少重复探索、合并同 server 调用",
      },
    ];
    const weakest = [...axes].sort((a, b) => a.score - b.score)[0];
    if (weakest && weakest.score < 0) {
      return `上一轮 **${AXIS_LABEL[weakest.axis]}** 维度偏弱（${weakest.score.toFixed(1)}），${weakest.hint}。`;
    }
  }

  if (insights) {
    const req = insights.requestRationality;
    const mcp = req.toolCategories.find((c) => c.category === "mcp")?.count ?? 0;
    const skill = req.toolCategories.find((c) => c.category === "skill")?.count ?? 0;
    if (mcp >= 5) {
      return "洞察显示 **MCP 调用偏多**，本轮请重点评估可否用内置工具替代、合并 MCP 请求并 disable 未用 server。";
    }
    if (skill >= 4) {
      return "洞察显示 **Skill 调用偏多**，本轮请重点判断哪些 Skill 可内联为 rules/memory 或 1–2 步内置工具。";
    }
    if (req.httpRequestsPerTurn >= 1.5) {
      return "洞察显示 **模型 HTTP 往返偏多**，本轮请合并工具链、减少无效 assistant 轮次。";
    }
    const top = pickTopFeedbackWarnings(insights, 1)[0];
    if (top) {
      return `洞察优先项：**${top.title}** — ${top.description}`;
    }
  }

  return "保持速度/效率/质量均衡优化；若数据不足请在输出中标注「未观测」。";
}

export interface BuildFeedbackLoopOptimizationPromptInput {
  insights: SessionInsightsResult;
  meta?: SessionInsightsReportMeta;
  cycleIndex: number;
  maxCycles: number;
  baseline: SessionFeedbackMetricSnapshot;
  previousCycles: readonly SessionFeedbackCycle[];
  lastComparison?: FeedbackComparisonResult;
  /** 启用配置 Artifact 优化指引 */
  optimizeConfigArtifacts?: boolean;
  configSnapshot?: FeedbackConfigSnapshot | null;
}

/** 构建带轮次对比上下文的自我优化 prompt。 */
export function buildFeedbackLoopOptimizationPrompt(
  input: BuildFeedbackLoopOptimizationPromptInput,
): string {
  const basePrompt = buildSessionInsightsAiOptimizationPrompt(input.insights, input.meta);
  const lines: string[] = [
    "你是 Wise **会话反馈神经网** 的优化节点。",
    "",
    `当前为第 **${input.cycleIndex}/${input.maxCycles}** 轮自我优化循环。`,
    "目标：在 **速度**（墙钟/TTFT/HTTP 往返）、**效率**（Token/Cache/单轮峰值）、**质量**（工具链长度/重复探索/接口合理性）三维上持续改进。",
    "",
    "## 本轮基线",
    "",
    `- 轮次 ${input.baseline.turnCount} · 均轮 ${formatDurationMs(input.baseline.avgTurnDurationMs)}`,
    `- 工具 ${input.baseline.toolCallCount}（${formatToolsPerTurn(input.baseline.toolsPerTurn)}/轮）`,
    `- Token ${input.baseline.tokenTotal > 0 ? formatTokenCount(input.baseline.tokenTotal) : "—"}`,
    `- 警告项 ${input.baseline.warningCount}`,
    "",
    ...buildRequestRationalityLines(input.insights.requestRationality),
  ];

  lines.push("## 本轮聚焦", "", inferOptimizationFocusHint({
    lastComparison: input.lastComparison,
    insights: input.insights,
  }), "");

  if (input.lastComparison) {
    lines.push("## 上一轮对比结果", "");
    lines.push(formatComparisonMarkdown(input.lastComparison));
    lines.push("");
    lines.push(
      input.lastComparison.improved
        ? "上一轮已有改善，请在此基础上继续收敛，避免过度优化导致质量回退。"
        : "上一轮改善不明显，请调整策略：合并工具步骤、缩小搜索范围、稳定 system prompt，并审视 MCP/Skill 是否可替换为更轻量的内置工具。",
    );
    lines.push("");
  }

  if (input.previousCycles.length > 0) {
    lines.push("## 历史循环", "");
    for (const cycle of input.previousCycles) {
      if (!cycle.comparison) continue;
      lines.push(
        `- 循环 ${cycle.cycleIndex}：${cycle.comparison.summary}（综合 ${cycle.comparison.overallScore.toFixed(1)}）`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## 输出要求",
    "",
    "1. **本轮优化策略**（针对速度/效率/质量各 1–2 条可执行动作）",
    "2. **接口请求合理性**（须覆盖以下维度，有数据则引用、无则标注「未观测」）：",
    "   - **MCP**：是否滥用/过多、可否用 Read/Grep/Shell 替代、是否重复读 schema、是否应 disable 未用 server",
    "   - **Skill**：是否必要、是否重复 invoke、能否沉淀为 rules/memory",
    "   - **子代理/Task**：并行度是否过高、子任务 scope 是否过大",
    "   - **请求次数**：单轮工具链峰值、模型 HTTP 往返、重复 Read/Grep/Explore",
    "   - **请求体量**：单轮 Token 峰值、大段粘贴、MCP 响应未截断",
    "   - **耗时**：均轮/TTFT/工具 vs 模型瓶颈、串行 MCP 导致的墙钟放大",
    "3. **工具使用调整**（减少重复 Read/Grep、合并探索、何时用 Task 子代理）",
    "4. **下轮验证指标**（列出 3 个可量化观测点，含 MCP/Skill 次数或 HTTP/轮）",
    "5. **立即执行清单**（用户下一条消息可直接照做的步骤）",
    "",
    "约束：不要调用工具；基于以下洞察数据推断。",
    "",
  );

  if (input.optimizeConfigArtifacts) {
    lines.push(...buildConfigArtifactOptimizationSection(input.configSnapshot), "");
  }

  lines.push("---", "", basePrompt);

  return lines.join("\n");
}

export function formatComparisonMarkdown(comparison: FeedbackComparisonResult): string {
  const lines: string[] = [
    `综合得分：**${comparison.overallScore.toFixed(1)}**（速度 ${comparison.speedScore.toFixed(1)} · 效率 ${comparison.efficiencyScore.toFixed(1)} · 质量 ${comparison.qualityScore.toFixed(1)}）`,
    "",
    "| 维度 | 指标 | 前 | 后 | 变化 |",
    "|------|------|----|----|------|",
  ];
  for (const d of comparison.deltas) {
    const delta =
      d.deltaPercent != null
        ? `${d.deltaPercent > 0 ? "+" : ""}${d.deltaPercent.toFixed(1)}%`
        : "—";
    const mark = d.improved ? "✓" : d.deltaPercent != null && d.deltaPercent < 0 ? "✗" : "·";
    lines.push(`| ${AXIS_LABEL[d.axis]} | ${d.label} | ${d.before} | ${d.after} | ${mark} ${delta} |`);
  }
  return lines.join("\n");
}

export function buildFeedbackLoopComparisonPrompt(
  cycles: readonly SessionFeedbackCycle[],
  meta?: SessionInsightsReportMeta,
): string {
  const lines: string[] = [
    "你是 Wise **会话反馈神经网** 的评估节点。",
    "",
    "请基于以下各轮自我优化循环的指标对比，总结：",
    "1. 速度/效率/质量三维的整体趋势",
    "2. 哪些优化策略有效、哪些无效",
    "3. 接口请求合理性方面的得失（MCP/Skill/子代理、请求次数/体量/耗时）",
    "4. 下一轮应保留/放弃的习惯",
    "",
  ];
  if (meta?.repositoryName) lines.push(`仓库：${meta.repositoryName}`);
  if (meta?.claudeSessionId) lines.push(`Session：\`${meta.claudeSessionId}\``);
  lines.push("");

  for (const cycle of cycles) {
    if (!cycle.comparison || !cycle.after) continue;
    lines.push(`### 循环 ${cycle.cycleIndex}`, "");
    lines.push(formatComparisonMarkdown(cycle.comparison));
    lines.push("");
  }

  lines.push("约束：不要调用工具；仅基于上表数据推断。");
  return lines.join("\n");
}

export interface FeedbackLoopTrendPoint {
  cycleIndex: number;
  speedScore: number;
  efficiencyScore: number;
  qualityScore: number;
  overallScore: number;
  improved: boolean;
}

export function buildFeedbackLoopTrend(cycles: readonly SessionFeedbackCycle[]): FeedbackLoopTrendPoint[] {
  return cycles
    .filter((c) => c.comparison != null)
    .map((c) => ({
      cycleIndex: c.cycleIndex,
      speedScore: c.comparison!.speedScore,
      efficiencyScore: c.comparison!.efficiencyScore,
      qualityScore: c.comparison!.qualityScore,
      overallScore: c.comparison!.overallScore,
      improved: c.comparison!.improved,
    }));
}

/** 导出完整反馈神经网 Markdown 报告。 */
export function buildFeedbackLoopMarkdownReport(
  state: SessionFeedbackLoopState,
  meta?: SessionInsightsReportMeta,
  options?: { insights?: SessionInsightsResult },
): string {
  const lines: string[] = ["# 会话反馈神经网报告", ""];
  if (meta?.repositoryName) lines.push(`- **仓库**：${meta.repositoryName}`);
  if (meta?.claudeSessionId) lines.push(`- **Claude Session**：\`${meta.claudeSessionId}\``);
  lines.push(`- **生成时间**：${new Date().toISOString()}`);
  lines.push(
    `- **状态**：${state.phase}${state.completionReason ? `（${state.completionReason}）` : ""}`,
  );
  lines.push(`- **循环**：${state.cycles.filter((c) => c.comparison).length}/${state.maxCycles}`);
  lines.push("");

  if (state.initialBaseline) {
    const b = state.initialBaseline;
    lines.push("## 初始基线", "");
    lines.push(`- 轮次 ${b.turnCount} · 均轮 ${formatDurationMs(b.avgTurnDurationMs)}`);
    lines.push(`- 工具 ${b.toolCallCount}（${b.toolsPerTurn.toFixed(1)}/轮）`);
    lines.push(`- Token ${b.tokenTotal > 0 ? formatTokenCount(b.tokenTotal) : "—"}`);
    lines.push(`- 警告项 ${b.warningCount}`);
    if (b.mcpToolCount != null || b.skillToolCount != null) {
      lines.push(
        `- **接口**：MCP ${b.mcpToolCount ?? 0} · Skill ${b.skillToolCount ?? 0} · HTTP ${b.httpRequestsPerTurn?.toFixed(1) ?? "—"}/轮`,
      );
    }
    lines.push("");
  }

  if (options?.insights) {
    lines.push(...buildRequestRationalityLines(options.insights.requestRationality));
  }

  const habits = extractFeedbackLoopHabits(state);
  if (habits.length > 0) {
    lines.push("## 沉淀习惯", "");
    for (const h of habits) {
      lines.push(`- ${h}`);
    }
    lines.push("");
  }

  const trend = buildFeedbackLoopTrend(state.cycles);
  if (trend.length > 0) {
    lines.push("## 得分趋势", "");
    lines.push("| 循环 | 综合 | 速度 | 效率 | 质量 | 改善 |");
    lines.push("|------|------|------|------|------|------|");
    for (const p of trend) {
      lines.push(
        `| ${p.cycleIndex} | ${p.overallScore.toFixed(1)} | ${p.speedScore.toFixed(1)} | ${p.efficiencyScore.toFixed(1)} | ${p.qualityScore.toFixed(1)} | ${p.improved ? "是" : "否"} |`,
      );
    }
    lines.push("");
  }

  for (const cycle of state.cycles) {
    if (!cycle.comparison) continue;
    lines.push(`## 循环 ${cycle.cycleIndex}`, "");
    if (cycle.after?.scopedTurnCount != null) {
      lines.push(
        `> 增量比对：轮次 ${cycle.after.scopedTurnFrom}–${cycle.after.scopedTurnTo}（${cycle.after.scopedTurnCount} 轮）`,
      );
      lines.push("");
    }
    lines.push(formatComparisonMarkdown(cycle.comparison));
    if (cycle.workerResponsePreview) {
      lines.push("", "### Worker 优化建议", "", cycle.workerResponsePreview, "");
    } else {
      lines.push("");
    }
  }

  return lines.join("\n");
}

export const FEEDBACK_LOOP_HABITS_PHRASE_ID = "wise-feedback-loop-habits";
export const FEEDBACK_LOOP_HABITS_PHRASE_TITLE = "神经网习惯";

/** 从已完成循环中提取可复用的工具使用习惯。 */
export function extractFeedbackLoopHabits(state: SessionFeedbackLoopState): string[] {
  const habits = new Set<string>();
  for (const cycle of state.cycles) {
    if (!cycle.comparison) continue;
    for (const d of cycle.comparison.deltas) {
      if (!d.improved) continue;
      if (d.label === "工具/轮" || d.label === "工具次数") {
        habits.add("合并探索步骤，避免同路径重复 Read/Grep");
      }
      if (d.label === "均轮耗时") {
        habits.add("缩小单轮探索范围，优先 codegraph 一次定位再 Read");
      }
      if (d.label === "TTFT P95") {
        habits.add("稳定 system prompt，减少每轮动态前缀与大段粘贴");
      }
      if (d.label === "Token 合计" || d.label === "Token/轮") {
        habits.add("控制单轮读取范围与 MCP 响应体量，长结果先摘要再继续");
      }
      if (d.label === "MCP 次数") {
        habits.add("本地任务优先内置工具，MCP 仅用于外部系统且避免重复 schema 读取");
      }
      if (d.label === "Skill 次数") {
        habits.add("Skill 用于复杂流程；简单操作不要反复 invoke 同一 Skill");
      }
      if (d.label === "警告项") {
        habits.add("优先处理洞察中的 MCP/Skill 滥用与单轮工具链过长警告");
      }
    }
    if (cycle.comparison.improved) {
      habits.add("保持当前轮次内的工具链长度与并行度");
    }
  }
  if (habits.size === 0) {
    if (state.completionReason === "converged") {
      habits.add("当前节奏已收敛，保持现有探索-执行-验证模式");
    } else {
      habits.add("每轮先明确目标再调用工具，避免无目的广搜");
      habits.add("本地任务优先内置工具，MCP/Skill 仅在确有必要时使用");
    }
  }
  return [...habits].slice(0, 8);
}

export function buildFeedbackLoopHabitsPhraseText(habits: readonly string[]): string {
  if (habits.length === 0) return "";
  return [
    "【反馈神经网 · 工具使用习惯】",
    ...habits.map((h, i) => `${i + 1}. ${h}`),
  ].join("\n");
}

/** 供主会话 AI 从闭环结果蒸馏长期习惯。 */
export function buildFeedbackLoopHabitsPrompt(
  state: SessionFeedbackLoopState,
  meta?: SessionInsightsReportMeta,
): string {
  const habits = extractFeedbackLoopHabits(state);
  const report = buildFeedbackLoopMarkdownReport(state, meta);
  return [
    "你是 Wise **会话反馈神经网** 的习惯沉淀节点。",
    "",
    "请基于以下闭环报告，输出 **3–5 条可长期遵守** 的 Claude Code 工具使用习惯（Markdown 列表）。",
    "每条习惯须：具体、可执行、可观测（说明如何验证是否遵守）。",
    "须覆盖 **接口请求合理性**：MCP/Skill 使用边界、请求频次与体量控制、避免单轮工具链过长。",
    "",
    "规则引擎已提取的候选习惯：",
    ...habits.map((h) => `- ${h}`),
    "",
    "约束：不要调用工具。",
    "",
    "---",
    "",
    report,
  ].join("\n");
}

export function summarizeFeedbackLoopOutcome(state: SessionFeedbackLoopState): {
  finalOverallScore: number | null;
  cycleCount: number;
  improvedCycles: number;
} {
  const completed = state.cycles.filter((c) => c.comparison != null);
  const last = completed[completed.length - 1]?.comparison;
  return {
    finalOverallScore: last?.overallScore ?? null,
    cycleCount: completed.length,
    improvedCycles: completed.filter((c) => c.comparison?.improved).length,
  };
}
