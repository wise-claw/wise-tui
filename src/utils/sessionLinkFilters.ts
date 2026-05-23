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
