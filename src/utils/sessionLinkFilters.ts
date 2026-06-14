import type { SessionLinkRecord } from "../types/sessionLink";

export type SessionLinkFilterPreset =
  | "all"
  | "tool"
  | "http"
  | "hook"
  | "error"
  | "inferred_http";

export const SESSION_LINK_FILTER_OPTIONS: { label: string; value: SessionLinkFilterPreset }[] = [
  { label: "全部", value: "all" },
  { label: "工具", value: "tool" },
  { label: "HTTP", value: "http" },
  { label: "Hook", value: "hook" },
  { label: "仅错误", value: "error" },
  { label: "未观测 HTTP", value: "inferred_http" },
];

function isErrorRecord(r: SessionLinkRecord): boolean {
  if (r.kind === "tool_result" && r.detail?.toLowerCase().includes("error")) {
    return true;
  }
  if (r.layer === "http" && r.summary.includes("4") && r.summary.match(/\b[45]\d{2}\b/)) {
    return true;
  }
  const d = (r.detail ?? "").toLowerCase();
  return d.includes('"error"') || d.includes("is_error") || d.includes("失败");
}

export function filterSessionLinkRecords(
  records: readonly SessionLinkRecord[],
  preset: SessionLinkFilterPreset,
): SessionLinkRecord[] {
  switch (preset) {
    case "all":
      return [...records];
    case "tool":
      return records.filter((r) => r.layer === "tool");
    case "http":
      return records.filter((r) => r.layer === "http");
    case "hook":
      return records.filter((r) => r.layer === "hook" || r.kind === "skill");
    case "error":
      return records.filter(isErrorRecord);
    case "inferred_http":
      return records.filter((r) => r.layer === "http" && !r.observed);
    default:
      return [...records];
  }
}

export interface SessionLinkTurnMetric {
  turnIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  inputCount: number;
  toolCount: number;
  httpObserved: number;
  httpInferred: number;
}

export function aggregateSessionLinkRecords(records: readonly SessionLinkRecord[]): {
  stats: {
    turns: number;
    tools: number;
    httpObserved: number;
    httpInferred: number;
  };
  turnMetrics: SessionLinkTurnMetric[];
} {
  let turns = 0;
  let tools = 0;
  let httpObserved = 0;
  let httpInferred = 0;

  type TurnAcc = {
    times: number[];
    inputCount: number;
    toolCount: number;
    httpObserved: number;
    httpInferred: number;
  };
  const byTurn = new Map<number, TurnAcc>();

  for (const r of records) {
    if (r.layer === "input") turns += 1;
    if (r.layer === "tool") tools += 1;
    if (r.layer === "http") {
      if (r.observed) httpObserved += 1;
      else httpInferred += 1;
    }

    const acc = byTurn.get(r.turnIndex) ?? {
      times: [],
      inputCount: 0,
      toolCount: 0,
      httpObserved: 0,
      httpInferred: 0,
    };
    acc.times.push(r.timestampMs);
    if (r.layer === "input") acc.inputCount += 1;
    if (r.layer === "tool") acc.toolCount += 1;
    if (r.layer === "http") {
      if (r.observed) acc.httpObserved += 1;
      else acc.httpInferred += 1;
    }
    byTurn.set(r.turnIndex, acc);
  }

  const turnMetrics = [...byTurn.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turnIndex, acc]) => {
      const startMs = Math.min(...acc.times);
      const endMs = Math.max(...acc.times);
      return {
        turnIndex,
        startMs,
        endMs,
        durationMs: Math.max(0, endMs - startMs),
        inputCount: acc.inputCount,
        toolCount: acc.toolCount,
        httpObserved: acc.httpObserved,
        httpInferred: acc.httpInferred,
      };
    });

  return {
    stats: { turns, tools, httpObserved, httpInferred },
    turnMetrics,
  };
}

export function computeSessionLinkTurnMetrics(
  records: readonly SessionLinkRecord[],
): SessionLinkTurnMetric[] {
  const byTurn = new Map<number, SessionLinkRecord[]>();
  for (const r of records) {
    const list = byTurn.get(r.turnIndex) ?? [];
    list.push(r);
    byTurn.set(r.turnIndex, list);
  }
  return [...byTurn.entries()]
    .sort(([a], [b]) => a - b)
    .map(([turnIndex, recs]) => {
      const times = recs.map((r) => r.timestampMs);
      const startMs = Math.min(...times);
      const endMs = Math.max(...times);
      return {
        turnIndex,
        startMs,
        endMs,
        durationMs: Math.max(0, endMs - startMs),
        inputCount: recs.filter((r) => r.layer === "input").length,
        toolCount: recs.filter((r) => r.layer === "tool").length,
        httpObserved: recs.filter((r) => r.layer === "http" && r.observed).length,
        httpInferred: recs.filter((r) => r.layer === "http" && !r.observed).length,
      };
    });
}

/** 闭区间 [fromTurn, toTurn] 的轮次范围。 */
export interface TurnRange {
  fromTurn: number;
  toTurn: number;
}

function isValidTurnRange(range: TurnRange | null | undefined): range is TurnRange {
  if (!range) return false;
  if (!Number.isFinite(range.fromTurn) || !Number.isFinite(range.toTurn)) return false;
  if (range.fromTurn < 1 || range.toTurn < 1) return false;
  if (range.toTurn < range.fromTurn) return false;
  return true;
}

/** 按轮次区间过滤 SessionLinkRecord；range == null 表示不过滤。 */
export function filterSessionLinkRecordsByTurnRange(
  records: readonly SessionLinkRecord[],
  range: TurnRange | null | undefined,
): SessionLinkRecord[] {
  if (range == null) return [...records];
  if (!isValidTurnRange(range)) return [];
  const { fromTurn, toTurn } = range;
  return records.filter((r) => r.turnIndex >= fromTurn && r.turnIndex <= toTurn);
}

/** 按轮次区间过滤 SessionLinkTurnMetric；range == null 表示不过滤。 */
export function filterTurnMetricsByTurnRange(
  metrics: readonly SessionLinkTurnMetric[],
  range: TurnRange | null | undefined,
): SessionLinkTurnMetric[] {
  if (range == null) return [...metrics];
  if (!isValidTurnRange(range)) return [];
  const { fromTurn, toTurn } = range;
  return metrics.filter((m) => m.turnIndex >= fromTurn && m.turnIndex <= toTurn);
}

/**
 * 从 turnMetrics 推导给定区间的时间戳闭区间（startMs / endMs）。
 * - range == null：返回 null（调用方按未过滤处理）。
 * - 区间在 metrics 中无任何命中：返回 null。
 */
export function deriveTimestampRangeFromTurnMetrics(
  metrics: readonly SessionLinkTurnMetric[],
  range: TurnRange | null | undefined,
): { startMs: number; endMs: number } | null {
  if (range == null) return null;
  if (!isValidTurnRange(range)) return null;
  const matched = filterTurnMetricsByTurnRange(metrics, range);
  if (matched.length === 0) return null;
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const m of matched) {
    if (m.startMs < startMs) startMs = m.startMs;
    if (m.endMs > endMs) endMs = m.endMs;
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}
