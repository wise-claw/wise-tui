import type { ClaudeMessage } from "../types";
import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import type { FccTraceEntry } from "../types/fccTrace";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";
import type { SessionLinkRecord } from "../types/sessionLink";
import type { SequenceEvent } from "./claudeSessionTrajectorySequence";
import { buildSessionLinkRecords } from "./buildSessionLinkRecords";
import { buildTrajectorySequenceModel } from "./claudeSessionTrajectorySequence";

function fccUpstreamRecord(entry: FccTraceEntry, turnIndex: number): SessionLinkRecord {
  return {
    id: `fcc-up-${entry.id}`,
    timestampMs: entry.timestampMs + 1,
    layer: "fcc_upstream",
    kind: "fcc_upstream",
    turnIndex,
    summary: "FCC → 上游",
    detail: entry.upstreamPreview!,
    observed: true,
    source: "fcc_trace",
    httpTraceId: entry.id,
    refs: { fccTraceId: entry.id },
  };
}

function inferTurnIndexForTimestamp(records: SessionLinkRecord[], ts: number): number {
  let lastTurn = 1;
  for (const r of records) {
    if (r.layer === "input" && r.timestampMs <= ts) {
      lastTurn = r.turnIndex;
    }
  }
  return lastTurn;
}

/** 同轮次已有真实 HTTP 时移除推断的 `api_request` 占位。 */
export function suppressInferredHttpWhenObserved(records: readonly SessionLinkRecord[]): SessionLinkRecord[] {
  const turnsWithObserved = new Set<number>();
  for (const r of records) {
    if (r.layer === "http" && r.observed) {
      turnsWithObserved.add(r.turnIndex);
    }
  }
  return records.filter((r) => {
    if (r.kind !== "api_request" || r.observed) {
      return true;
    }
    return !turnsWithObserved.has(r.turnIndex);
  });
}

export interface BuildSessionLinkRecordsInput {
  messages: readonly ClaudeMessage[];
  jsonlLines?: readonly string[] | null;
  llmProxyRecords?: readonly ClaudeLlmProxyRecord[];
  fccTraces?: readonly FccTraceEntry[];
  opencodeGoProxyTraces?: readonly OpencodeGoProxyTraceEntry[];
}

/** 由已构建的序列事件生成链路记录（避免重复跑 trajectory 模型）。 */
export function buildSessionLinkRecordsFromEvents(
  events: readonly SequenceEvent[],
  options?: { fccTraces?: readonly FccTraceEntry[] },
): SessionLinkRecord[] {
  const fcc = options?.fccTraces ?? [];
  let records = buildSessionLinkRecords(events);

  for (const trace of fcc) {
    if (!trace.upstreamPreview?.trim()) continue;
    const turn = inferTurnIndexForTimestamp(records, trace.timestampMs);
    records.push(fccUpstreamRecord(trace, turn));
  }

  records.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
    return a.id.localeCompare(b.id);
  });

  return suppressInferredHttpWhenObserved(records);
}

/** 统一入口：轨迹 + LLM 代理 + FCC trace → 链路记录（已去重推断 HTTP）。 */
export function buildSessionLinkRecordsFromSources(input: BuildSessionLinkRecordsInput): SessionLinkRecord[] {
  const fcc = input.fccTraces ?? [];
  const llm = input.llmProxyRecords ?? [];
  const opencode = input.opencodeGoProxyTraces ?? [];
  const events = buildTrajectorySequenceModel(input.messages, input.jsonlLines ?? undefined, {
    opencodeGoProxyTraces: opencode.length > 0 ? opencode : undefined,
    fccTraces: fcc.length > 0 ? fcc : undefined,
    llmProxyRecords: llm.length > 0 ? llm : undefined,
  });
  return buildSessionLinkRecordsFromEvents(events, { fccTraces: fcc });
}

/** 一次构建 trajectory 事件 + 链路记录（供全链路抽屉复用，避免双份 trajectory 计算）。 */
export function buildSessionLinkPipeline(input: BuildSessionLinkRecordsInput): {
  events: SequenceEvent[];
  records: SessionLinkRecord[];
} {
  const fcc = input.fccTraces ?? [];
  const llm = input.llmProxyRecords ?? [];
  const opencode = input.opencodeGoProxyTraces ?? [];
  const events = buildTrajectorySequenceModel(input.messages, input.jsonlLines ?? undefined, {
    opencodeGoProxyTraces: opencode.length > 0 ? opencode : undefined,
    fccTraces: fcc.length > 0 ? fcc : undefined,
    llmProxyRecords: llm.length > 0 ? llm : undefined,
  });
  return {
    events,
    records: buildSessionLinkRecordsFromEvents(events, { fccTraces: fcc }),
  };
}
