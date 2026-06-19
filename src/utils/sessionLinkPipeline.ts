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

const PIPELINE_CACHE_MAX = 8;
const pipelineCache = new Map<
  string,
  { events: SequenceEvent[]; records: SessionLinkRecord[] }
>();

function buildPipelineCacheKey(input: BuildSessionLinkRecordsInput): string {
  const msg = input.messages;
  const jsonl = input.jsonlLines;
  const llm = input.llmProxyRecords;
  const fcc = input.fccTraces;
  const oc = input.opencodeGoProxyTraces;
  const lastMsg = msg.length > 0 ? msg[msg.length - 1] : undefined;
  return [
    msg.length,
    lastMsg?.id ?? 0,
    lastMsg?.timestamp ?? 0,
    jsonl?.length ?? -1,
    jsonl && jsonl.length > 0 ? jsonl[jsonl.length - 1]!.length : 0,
    llm?.length ?? 0,
    llm && llm.length > 0 ? llm[llm.length - 1]!.id : "",
    fcc?.length ?? 0,
    fcc && fcc.length > 0 ? fcc[fcc.length - 1]!.id : "",
    oc?.length ?? 0,
    oc && oc.length > 0 ? oc[oc.length - 1]!.id : "",
  ].join("\0");
}

/** 测试或会话切换时清空 pipeline 缓存。 */
export function clearSessionLinkPipelineCache(): void {
  pipelineCache.clear();
}

function buildSessionLinkPipelineUncached(input: BuildSessionLinkRecordsInput): {
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

/** 一次构建 trajectory 事件 + 链路记录（LRU 缓存，供抽屉与反馈神经网复用）。 */
export function buildSessionLinkPipeline(input: BuildSessionLinkRecordsInput): {
  events: SequenceEvent[];
  records: SessionLinkRecord[];
} {
  const key = buildPipelineCacheKey(input);
  const cached = pipelineCache.get(key);
  if (cached) return cached;

  const built = buildSessionLinkPipelineUncached(input);
  if (pipelineCache.size >= PIPELINE_CACHE_MAX) {
    const oldest = pipelineCache.keys().next().value;
    if (oldest != null) pipelineCache.delete(oldest);
  }
  pipelineCache.set(key, built);
  return built;
}
