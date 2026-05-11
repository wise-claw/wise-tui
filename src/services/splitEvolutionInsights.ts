import type { TaskSplitFeedbackTagId } from "../constants/taskSplitFeedback";

interface EvolutionRow {
  kind?: string;
  feedbackTags?: TaskSplitFeedbackTagId[];
  qualityScore?: {
    before?: number;
    after?: number;
    delta?: number;
  };
}

export interface EvolutionTopPattern {
  tag: TaskSplitFeedbackTagId;
  count: number;
}

export interface EvolutionInsights {
  totalRows: number;
  topPatterns: EvolutionTopPattern[];
}

export interface EvolutionTemplateDashboard {
  totalRuns: number;
  promotedCount: number;
  holdbackCount: number;
  promoteRate: number;
  avgDelta: number;
  byTag: Array<{
    tag: TaskSplitFeedbackTagId;
    totalRuns: number;
    promotedCount: number;
    holdbackCount: number;
    promoteRate: number;
    avgDelta: number;
  }>;
}

export const EVOLUTION_INSIGHT_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldRefreshEvolutionInsights(lastUpdatedAtMs: number | null, nowMs = Date.now()): boolean {
  if (!Number.isFinite(lastUpdatedAtMs ?? NaN)) return true;
  return nowMs - (lastUpdatedAtMs as number) >= EVOLUTION_INSIGHT_REFRESH_INTERVAL_MS;
}

export function parseEvolutionInsightsFromJsonl(raw: string): EvolutionInsights {
  const counts = new Map<TaskSplitFeedbackTagId, number>();
  let totalRows = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as EvolutionRow;
      if (!row.kind?.startsWith("deepen_")) continue;
      totalRows += 1;
      for (const tag of row.feedbackTags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    } catch {
      // ignore malformed line
    }
  }
  const topPatterns = Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return { totalRows, topPatterns };
}

export function parseEvolutionTemplateDashboardFromJsonl(raw: string, recentLimit = 30): EvolutionTemplateDashboard {
  const rows: EvolutionRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as EvolutionRow);
    } catch {
      // ignore malformed line
    }
  }
  const recent = rows
    .filter((row) => row.kind === "deepen_template_promoted" || row.kind === "deepen_template_holdback")
    .slice(-Math.max(1, recentLimit));
  if (recent.length === 0) {
    return {
      totalRuns: 0,
      promotedCount: 0,
      holdbackCount: 0,
      promoteRate: 0,
      avgDelta: 0,
      byTag: [],
    };
  }
  let promotedCount = 0;
  let holdbackCount = 0;
  let deltaSum = 0;
  let deltaCount = 0;
  const byTagStats = new Map<TaskSplitFeedbackTagId, {
    totalRuns: number;
    promotedCount: number;
    holdbackCount: number;
    deltaSum: number;
    deltaCount: number;
  }>();
  for (const row of recent) {
    if (row.kind === "deepen_template_promoted") promotedCount += 1;
    if (row.kind === "deepen_template_holdback") holdbackCount += 1;
    const delta = row.qualityScore?.delta;
    if (typeof delta === "number" && Number.isFinite(delta)) {
      deltaSum += delta;
      deltaCount += 1;
    }
    for (const tag of row.feedbackTags ?? []) {
      const current = byTagStats.get(tag) ?? {
        totalRuns: 0,
        promotedCount: 0,
        holdbackCount: 0,
        deltaSum: 0,
        deltaCount: 0,
      };
      current.totalRuns += 1;
      if (row.kind === "deepen_template_promoted") current.promotedCount += 1;
      if (row.kind === "deepen_template_holdback") current.holdbackCount += 1;
      if (typeof delta === "number" && Number.isFinite(delta)) {
        current.deltaSum += delta;
        current.deltaCount += 1;
      }
      byTagStats.set(tag, current);
    }
  }
  const totalRuns = promotedCount + holdbackCount;
  const byTag = Array.from(byTagStats.entries())
    .map(([tag, stats]) => ({
      tag,
      totalRuns: stats.totalRuns,
      promotedCount: stats.promotedCount,
      holdbackCount: stats.holdbackCount,
      promoteRate: stats.totalRuns > 0 ? Number(((stats.promotedCount / stats.totalRuns) * 100).toFixed(1)) : 0,
      avgDelta: stats.deltaCount > 0 ? Number((stats.deltaSum / stats.deltaCount).toFixed(2)) : 0,
    }))
    .sort((a, b) => {
      if (b.totalRuns !== a.totalRuns) return b.totalRuns - a.totalRuns;
      if (b.promoteRate !== a.promoteRate) return b.promoteRate - a.promoteRate;
      return b.avgDelta - a.avgDelta;
    })
    .slice(0, 5);
  return {
    totalRuns,
    promotedCount,
    holdbackCount,
    promoteRate: totalRuns > 0 ? Number(((promotedCount / totalRuns) * 100).toFixed(1)) : 0,
    avgDelta: deltaCount > 0 ? Number((deltaSum / deltaCount).toFixed(2)) : 0,
    byTag,
  };
}

export function buildEvolutionHintForPrompt(insights: EvolutionInsights): string {
  if (insights.totalRows === 0 || insights.topPatterns.length === 0) return "";
  const lines = insights.topPatterns.map((item) => `- ${item.tag}: ${item.count} 次`);
  return [
    "## 历史失败模式（来自 ~/.wise/prd-split-evolution.jsonl）",
    `样本数：${insights.totalRows}`,
    "请在优化模板时优先约束这些高频问题：",
    ...lines,
  ].join("\n");
}
