import type { ClaudeUsageSeriesPayload } from "../services/claudeCodeUsage";

export interface SessionRepositoryUsageBaseline {
  dayCount: number;
  avgTokensPerDay: number;
  avgCacheHitRate: number | null;
  totalTokens: number;
  periodLabel: string;
}

export interface SessionBaselineComparison {
  sessionTokenTotal: number;
  baselineAvgTokensPerDay: number;
  ratioToBaseline: number;
  sessionCacheHitRate: number | null;
  baselineCacheHitRate: number | null;
  summary: string;
}

const DEFAULT_BASELINE_DAYS = 7;
const HIGH_TOKEN_RATIO = 1.5;
const LOW_CACHE_DELTA = 0.12;

/** 从日粒度用量序列提取近 N 日基线（忽略无 token 的空桶）。 */
export function computeRepositoryUsageBaseline(
  series: ClaudeUsageSeriesPayload,
  maxDays = DEFAULT_BASELINE_DAYS,
): SessionRepositoryUsageBaseline | null {
  const buckets = series.buckets.filter((b) => b.totalTokens > 0).slice(-maxDays);
  if (buckets.length === 0) return null;

  const totalTokens = buckets.reduce((a, b) => a + b.totalTokens, 0);
  const cacheRates = buckets
    .map((b) => b.cacheHitRate)
    .filter((r): r is number => r != null && Number.isFinite(r));

  return {
    dayCount: buckets.length,
    avgTokensPerDay: totalTokens / buckets.length,
    avgCacheHitRate:
      cacheRates.length > 0 ? cacheRates.reduce((a, b) => a + b, 0) / cacheRates.length : null,
    totalTokens,
    periodLabel: `近 ${buckets.length} 日`,
  };
}

/** 将会话 token 与仓库基线对比，生成摘要文案。 */
export function compareSessionTokensToBaseline(input: {
  sessionTokenTotal: number;
  sessionCacheHitRate: number | null;
  baseline: SessionRepositoryUsageBaseline;
}): SessionBaselineComparison | null {
  const { sessionTokenTotal, sessionCacheHitRate, baseline } = input;
  if (sessionTokenTotal <= 0 || baseline.avgTokensPerDay <= 0) return null;

  const ratioToBaseline = sessionTokenTotal / baseline.avgTokensPerDay;
  const parts: string[] = [];

  if (ratioToBaseline >= HIGH_TOKEN_RATIO) {
    parts.push(
      `本会话 Token 为仓库${baseline.periodLabel}日均的 ${ratioToBaseline.toFixed(1)}×，偏高`,
    );
  } else if (ratioToBaseline <= 0.55) {
    parts.push(
      `本会话 Token 低于仓库${baseline.periodLabel}日均（${ratioToBaseline.toFixed(1)}×），效率较好`,
    );
  } else {
    parts.push(`本会话 Token 与仓库${baseline.periodLabel}日均接近（${ratioToBaseline.toFixed(1)}×）`);
  }

  if (
    sessionCacheHitRate != null &&
    baseline.avgCacheHitRate != null &&
    baseline.avgCacheHitRate - sessionCacheHitRate >= LOW_CACHE_DELTA
  ) {
    parts.push(
      `Cache 命中率 ${(sessionCacheHitRate * 100).toFixed(0)}%，低于基线 ${(baseline.avgCacheHitRate * 100).toFixed(0)}%`,
    );
  }

  return {
    sessionTokenTotal,
    baselineAvgTokensPerDay: baseline.avgTokensPerDay,
    ratioToBaseline,
    sessionCacheHitRate,
    baselineCacheHitRate: baseline.avgCacheHitRate,
    summary: parts.join("；"),
  };
}
