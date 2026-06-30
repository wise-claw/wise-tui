import type { ClaudeLineEditsDayBucket } from "../services/claudeCodeUsage";

export interface LineEditsHeatmapCell {
  date: string;
  linesEdited: number;
  diffCount: number;
  inRange: boolean;
}

export interface LineEditsHeatmapWeek {
  /** 该列周一的 ISO 日期 YYYY-MM-DD */
  weekStart: string;
  /** 稳定唯一 id：真实列等于 weekStart，占位列带 __pad: 前缀避免与 ISO 日期冲突 */
  key: string;
  /** 该列是否为补齐占位列（视觉上以极淡骨架呈现，保持 7 列结构可见） */
  isPlaceholder?: boolean;
  /** 7 格：周一 … 周日 */
  cells: LineEditsHeatmapCell[];
}

/**
 * 视觉最小有意义列数。当数据只覆盖几天（weeks.length < MIN_VISIBLE_WEEKS）时，
 * 左侧补占位列把列数补齐到 MIN_VISIBLE_WEEKS，避免 flex 列被拉伸成「超大块」。
 */
const MIN_VISIBLE_WEEKS = 7;
const PAD_KEY_PREFIX = "__pad:";

const WEEKDAY_LABELS = ["一", "三", "五"] as const;
const WEEKDAY_LABEL_ROWS = [0, 2, 4] as const;

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function mondayOfWeek(d: Date): Date {
  const out = new Date(d);
  const dow = out.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  out.setDate(out.getDate() - offset);
  return out;
}

function monthInitial(d: Date): string {
  return String(d.getMonth() + 1);
}

/** 将日桶转为 GitHub 风格热力图列（周一为行首）。 */
export function buildLineEditsHeatmapWeeks(
  days: readonly ClaudeLineEditsDayBucket[],
): { weeks: LineEditsHeatmapWeek[]; monthLabels: { weekIndex: number; label: string }[] } {
  if (days.length === 0) {
    return { weeks: [], monthLabels: [] };
  }

  const byDate = new Map<string, ClaudeLineEditsDayBucket>();
  for (const day of days) {
    byDate.set(day.date, day);
  }

  const endDate = parseIsoDate(days[days.length - 1]!.date);
  const rangeStart = parseIsoDate(days[0]!.date);
  const gridStart = mondayOfWeek(rangeStart);

  const weeks: LineEditsHeatmapWeek[] = [];
  const monthLabels: { weekIndex: number; label: string }[] = [];
  let lastMonth = -1;

  let cursor = new Date(gridStart);
  while (cursor <= endDate) {
    const weekStart = formatIsoDate(cursor);
    const cells: LineEditsHeatmapCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const cellDate = addDays(cursor, row);
      const key = formatIsoDate(cellDate);
      const bucket = byDate.get(key);
      const inRange = cellDate >= rangeStart && cellDate <= endDate;
      cells.push({
        date: key,
        linesEdited: bucket?.linesEdited ?? 0,
        diffCount: bucket?.diffCount ?? 0,
        inRange,
      });
    }

    const weekIndex = weeks.length;
    const month = cursor.getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ weekIndex, label: monthInitial(cursor) });
      lastMonth = month;
    }

    weeks.push({ weekStart, key: weekStart, cells });
    cursor = addDays(cursor, 7);
  }

  // 数据只覆盖几天时,左侧补占位列,避免 flex 列被拉伸成超大块。
  // 占位列整体早于 gridStart,inRange 全为 false,月份 label 不显示。
  if (weeks.length < MIN_VISIBLE_WEEKS) {
    const padCount = MIN_VISIBLE_WEEKS - weeks.length;
    const padWeeks: LineEditsHeatmapWeek[] = [];
    // 从 gridStart 倒推 padCount 周作为左侧占位的起点
    let padCursor = addDays(gridStart, -padCount * 7);
    for (let i = 0; i < padCount; i += 1) {
      const weekStart = formatIsoDate(padCursor);
      const cells: LineEditsHeatmapCell[] = [];
      for (let row = 0; row < 7; row += 1) {
        const cellDate = addDays(padCursor, row);
        cells.push({
          date: formatIsoDate(cellDate),
          linesEdited: 0,
          diffCount: 0,
          inRange: false,
        });
      }
      padWeeks.push({
        weekStart,
        key: `${PAD_KEY_PREFIX}${i}`,
        isPlaceholder: true,
        cells,
      });
      padCursor = addDays(padCursor, 7);
    }
    // 占位列里的 month label 不写入 monthLabels(避免连续幽灵月份)
    weeks.unshift(...padWeeks);
    // 已有的真实列 monthLabel 索引需要整体右移 padCount
    for (const m of monthLabels) {
      m.weekIndex += padCount;
    }
  }

  return { weeks, monthLabels };
}

export function weekdayLabelForRow(row: number): string {
  if (row === WEEKDAY_LABEL_ROWS[0]) return WEEKDAY_LABELS[0];
  if (row === WEEKDAY_LABEL_ROWS[1]) return WEEKDAY_LABELS[1];
  if (row === WEEKDAY_LABEL_ROWS[2]) return WEEKDAY_LABELS[2];
  return "";
}

export function heatmapLevel(linesEdited: number, maxLines: number): 0 | 1 | 2 | 3 | 4 {
  if (linesEdited <= 0 || maxLines <= 0) return 0;
  const ratio = linesEdited / maxLines;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

export function formatLinesEdited(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  return n.toLocaleString();
}

export function formatHeatmapDateLabel(iso: string): string {
  const d = parseIsoDate(iso);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${weekdays[d.getDay()]}，${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export { WEEKDAY_LABEL_ROWS };
