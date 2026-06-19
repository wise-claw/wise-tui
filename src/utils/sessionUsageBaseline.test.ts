import { describe, expect, test } from "bun:test";
import type { ClaudeUsageSeriesPayload } from "../services/claudeCodeUsage";
import {
  compareSessionTokensToBaseline,
  computeRepositoryUsageBaseline,
} from "./sessionUsageBaseline";

function sampleSeries(): ClaudeUsageSeriesPayload {
  return {
    buckets: [
      {
        sortKey: "2026-06-01",
        label: "6/1",
        inputTokens: 10_000,
        outputTokens: 2000,
        cacheCreationTokens: 1000,
        cacheReadTokens: 5000,
        totalTokens: 18_000,
        cacheHitRate: 0.33,
        costUsd: 0.1,
        costEntries: 1,
      },
      {
        sortKey: "2026-06-02",
        label: "6/2",
        inputTokens: 12_000,
        outputTokens: 3000,
        cacheCreationTokens: 1000,
        cacheReadTokens: 7000,
        totalTokens: 23_000,
        cacheHitRate: 0.35,
        costUsd: 0.12,
        costEntries: 1,
      },
    ],
    totalTokens: 41_000,
    totalInputTokens: 22_000,
    totalCacheCreationTokens: 2000,
    totalCacheReadTokens: 12_000,
    cacheHitRate: 0.34,
    totalCostUsd: 0.22,
    totalCostEntries: 2,
    periodCaption: "test",
  };
}

describe("sessionUsageBaseline", () => {
  test("computeRepositoryUsageBaseline averages recent day buckets", () => {
    const baseline = computeRepositoryUsageBaseline(sampleSeries());
    expect(baseline).not.toBeNull();
    expect(baseline!.dayCount).toBe(2);
    expect(baseline!.avgTokensPerDay).toBe(20_500);
  });

  test("compareSessionTokensToBaseline flags high session usage", () => {
    const baseline = computeRepositoryUsageBaseline(sampleSeries())!;
    const comparison = compareSessionTokensToBaseline({
      sessionTokenTotal: 40_000,
      sessionCacheHitRate: 0.15,
      baseline,
    });
    expect(comparison).not.toBeNull();
    expect(comparison!.ratioToBaseline).toBeGreaterThan(1.5);
    expect(comparison!.summary).toContain("偏高");
  });
});
