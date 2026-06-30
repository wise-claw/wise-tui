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

  test("buildLineEditsHeatmapWeeks ignores new added/removed fields", () => {
    // 后端 1.2.2+ 在 day bucket 上加了 linesAdded/linesRemoved 字段，
    // 热力图列化只关心 linesEdited/diffCount，必须向后兼容新字段。
    const days: ClaudeLineEditsDayBucket[] = [
      {
        date: "2026-06-02",
        linesEdited: 10,
        diffCount: 1,
        linesAdded: 8,
        linesRemoved: 2,
      },
      {
        date: "2026-06-03",
        linesEdited: 0,
        diffCount: 0,
        linesAdded: 0,
        linesRemoved: 0,
      },
      {
        date: "2026-06-04",
        linesEdited: 5,
        diffCount: 1,
        linesAdded: 5,
        linesRemoved: 0,
      },
    ];
    const { weeks } = buildLineEditsHeatmapWeeks(days);
    const active = weeks.flatMap((w) => w.cells).find((c) => c.date === "2026-06-02");
    expect(active?.linesEdited).toBe(10);
    expect(active?.diffCount).toBe(1);
  });

  describe("week padding (避免列数过少时显示超大块)", () => {
    test("weeks.length === 1 时补齐到 7，左侧 6 个占位列全 inRange=false", () => {
      // 2026-06-05 是周五，自然落在同一周内，原始 weeks 长度就是 1
      const days: ClaudeLineEditsDayBucket[] = [
        { date: "2026-06-05", linesEdited: 12, diffCount: 2 },
      ];
      const { weeks, monthLabels } = buildLineEditsHeatmapWeeks(days);
      expect(weeks).toHaveLength(7);
      // 前 6 列全 inRange=false 且为 placeholder
      for (let i = 0; i < 6; i += 1) {
        expect(weeks[i]!.cells.every((c) => c.inRange === false)).toBe(true);
        expect(weeks[i]!.key.startsWith("__pad:")).toBe(true);
        expect(weeks[i]!.isPlaceholder).toBe(true);
      }
      // 真实列在第 7 列(internal)
      expect(weeks[6]!.key).toBe("2026-06-01"); // gridStart = 该周周一
      expect(weeks[6]!.isPlaceholder).toBeFalsy();
      const realCell = weeks[6]!.cells.find((c) => c.date === "2026-06-05");
      expect(realCell?.linesEdited).toBe(12);
      expect(realCell?.inRange).toBe(true);
      // 真实列的 monthLabel 应在 weekIndex = 6
      expect(monthLabels.some((m) => m.weekIndex === 6 && m.label === "6")).toBe(true);
    });

    test("weeks.length === 3 时补齐到 7", () => {
      // 三天跨周一/周二/周三，原始 weeks 长度 1
      const days: ClaudeLineEditsDayBucket[] = [
        { date: "2026-06-01", linesEdited: 1, diffCount: 1 },
        { date: "2026-06-02", linesEdited: 2, diffCount: 1 },
        { date: "2026-06-03", linesEdited: 3, diffCount: 1 },
      ];
      const { weeks } = buildLineEditsHeatmapWeeks(days);
      expect(weeks).toHaveLength(7);
      const realColIdx = weeks.findIndex((w) => w.key === "2026-06-01");
      expect(realColIdx).toBe(6);
    });

    test("weeks.length >= 7 时不补齐", () => {
      // 造一个跨 8 周的数据
      const days: ClaudeLineEditsDayBucket[] = [];
      for (let i = 0; i < 56; i += 1) {
        const d = new Date(2026, 5, 1); // 2026-06-01
        d.setDate(d.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate(),
        ).padStart(2, "0")}`;
        days.push({ date: iso, linesEdited: i, diffCount: 1 });
      }
      const { weeks } = buildLineEditsHeatmapWeeks(days);
      expect(weeks.length).toBeGreaterThanOrEqual(7);
      // 不应有 pad key
      expect(weeks.some((w) => w.key.startsWith("__pad:"))).toBe(false);
    });

    test("weeks.length === 0 时不补齐", () => {
      const { weeks, monthLabels } = buildLineEditsHeatmapWeeks([]);
      expect(weeks).toHaveLength(0);
      expect(monthLabels).toHaveLength(0);
    });

    test("占位列的所有 cell 日期都早于 days[0]", () => {
      const days: ClaudeLineEditsDayBucket[] = [
        { date: "2026-06-05", linesEdited: 1, diffCount: 1 },
      ];
      const { weeks } = buildLineEditsHeatmapWeeks(days);
      // 占位列最右一格的 date < days[0]
      const firstDay = days[0]!.date;
      for (let i = 0; i < 6; i += 1) {
        const lastCell = weeks[i]!.cells[6]!; // 周日
        expect(lastCell.date < firstDay).toBe(true);
      }
    });

    test("所有 week.key 唯一", () => {
      const days: ClaudeLineEditsDayBucket[] = [
        { date: "2026-06-05", linesEdited: 1, diffCount: 1 },
      ];
      const { weeks } = buildLineEditsHeatmapWeeks(days);
      const keys = weeks.map((w) => w.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    test("真实列的 key 等于 weekStart", () => {
      const days: ClaudeLineEditsDayBucket[] = [
        { date: "2026-06-05", linesEdited: 1, diffCount: 1 },
      ];
      const { weeks } = buildLineEditsHeatmapWeeks(days);
      const real = weeks.find((w) => !w.key.startsWith("__pad:"));
      expect(real).toBeDefined();
      expect(real!.key).toBe(real!.weekStart);
    });
  });
});
