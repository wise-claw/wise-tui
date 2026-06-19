import { describe, expect, test } from "bun:test";
import type { ClaudeLineEditsDayBucket } from "../services/claudeCodeUsage";
import { buildLineEditsHeatmapWeeks, heatmapLevel } from "./claudeLineEditsHeatmap";

describe("claudeLineEditsHeatmap", () => {
  test("buildLineEditsHeatmapWeeks aligns Monday rows and month labels", () => {
    const days: ClaudeLineEditsDayBucket[] = [
      { date: "2026-06-02", linesEdited: 10, diffCount: 1 },
      { date: "2026-06-03", linesEdited: 0, diffCount: 0 },
      { date: "2026-06-04", linesEdited: 5, diffCount: 1 },
    ];
    const { weeks, monthLabels } = buildLineEditsHeatmapWeeks(days);
    expect(weeks.length).toBeGreaterThan(0);
    expect(weeks[0]!.cells).toHaveLength(7);
    expect(monthLabels.some((m) => m.label === "6")).toBe(true);
    const active = weeks.flatMap((w) => w.cells).find((c) => c.date === "2026-06-02");
    expect(active?.linesEdited).toBe(10);
  });

  test("heatmapLevel maps relative intensity", () => {
    expect(heatmapLevel(0, 100)).toBe(0);
    expect(heatmapLevel(10, 100)).toBe(1);
    expect(heatmapLevel(90, 100)).toBe(4);
  });
});
