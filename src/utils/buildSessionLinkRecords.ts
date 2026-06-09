import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import type { SessionLinkLayer, SessionLinkObservedSource, SessionLinkRecord } from "../types/sessionLink";
import type { SequenceEvent, SequenceEventKind } from "./claudeSessionTrajectorySequence";
import { resolveProxyTtftMs } from "./llmProxyTtft";

function layerForKind(kind: SequenceEventKind): SessionLinkLayer {
  switch (kind) {
    case "user_input":
      return "input";
    case "tool_use":
    case "tool_result":
      return "tool";
    case "hook":
    case "skill":
      return "hook";
    case "api_request":
      return "http";
    case "thinking":
    case "assistant_text":
      return "protocol";
    case "system":
    case "jsonl_other":
      return "protocol";
    default:
      return "protocol";
  }
}

function sourceForEvent(ev: SequenceEvent): SessionLinkObservedSource {
  if (ev.rawJsonlLine) return "jsonl";
  return "memory";
}

function extractToolUseId(ev: SequenceEvent): string | undefined {
  if (ev.drilldown?.toolPart.id) return ev.drilldown.toolPart.id;
  const sub = ev.subtitle ?? "";
  const m = sub.match(/toolu_[\w-]+/i) || sub.match(/\b(tool_[\w-]+)\b/i);
  return m?.[0];
}

function sequenceEventToRecord(ev: SequenceEvent, turnIndex: number): SessionLinkRecord {
  const isOpencodeObservedHttp =
    ev.kind === "api_request" &&
    Boolean(ev.flags.observedHttp) &&
    ev.id.startsWith("opencode-go-api-");
  const isFccObservedHttp =
    ev.kind === "api_request" && Boolean(ev.flags.observedHttp) && ev.id.startsWith("fcc-api-");
  const isLlmObservedHttp =
    ev.kind === "api_request" && Boolean(ev.flags.observedHttp) && ev.id.startsWith("llm-api-");
  const isObservedHttp = isOpencodeObservedHttp || isFccObservedHttp || isLlmObservedHttp;
  const isInferredHttp = ev.kind === "api_request" && !isObservedHttp;
  const opencodeTraceId = isOpencodeObservedHttp
    ? ev.id.replace(/^opencode-go-api-/, "")
    : undefined;
  const fccTraceId = isFccObservedHttp ? ev.id.replace(/^fcc-api-/, "") : undefined;
  const llmProxyId = isLlmObservedHttp ? ev.id.replace(/^llm-api-/, "") : undefined;
  const summary =
    ev.subtitle?.trim() ||
    ev.label ||
    (isInferredHttp ? "模型 HTTP（未直连观测）" : ev.kind);
  return {
    id: `seq-${ev.id}`,
    timestampMs: ev.timestamp,
    layer: layerForKind(ev.kind),
    kind: isObservedHttp ? "http_request" : ev.kind,
    turnIndex,
    summary,
    detail: ev.detail,
    observed: !isInferredHttp,
    source: isOpencodeObservedHttp
      ? "opencode_go_proxy"
      : isFccObservedHttp
        ? "fcc_trace"
        : isLlmObservedHttp
          ? "llm_proxy"
          : isInferredHttp
            ? "inferred"
            : sourceForEvent(ev),
    messageId: ev.messageId,
    toolUseId: extractToolUseId(ev),
    httpTraceId: opencodeTraceId ?? fccTraceId ?? llmProxyId,
    refs: {
      sequenceEventId: ev.id,
      opencodeGoProxyTraceId: opencodeTraceId,
      fccTraceId,
      llmProxyRecordId: llmProxyId,
    },
  };
}

function formatProxyLatencyMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function llmProxyToRecord(rec: ClaudeLlmProxyRecord, turnIndex: number): SessionLinkRecord {
  const path = rec.path?.trim() || "/";
  const ttft = resolveProxyTtftMs(rec);
  const latencyHint =
    ttft != null
      ? ` · TTFT ${formatProxyLatencyMs(ttft)}`
      : rec.durationMs > 0
        ? ` · ${rec.durationMs}ms`
        : "";
  return {
    id: `llm-${rec.id}`,
    timestampMs: rec.timestampMs,
    layer: "http",
    kind: "http_request",
    turnIndex,
    summary: `${rec.method} ${path}${rec.statusCode != null ? ` · ${rec.statusCode}` : ""}${latencyHint}`,
    detail: [
      rec.upstreamUrl?.trim() ? `upstream: ${rec.upstreamUrl}` : `upstream: ${rec.upstream}`,
      rec.requestBodyPreview?.trim() ? `request:\n${rec.requestBodyPreview}` : "",
      rec.responseBodyPreview?.trim() ? `response:\n${rec.responseBodyPreview}` : "",
    ]
      .filter(Boolean)
      .join("\n\n---\n\n"),
    observed: true,
    source: "llm_proxy",
    httpTraceId: rec.id,
    refs: { llmProxyRecordId: rec.id },
  };
}

/** 将轨迹事件与可选 LLM 代理记录合并为全链路分析记录（按时间排序）。 */
export function buildSessionLinkRecords(
  events: readonly SequenceEvent[],
  options?: { llmProxyRecords?: readonly ClaudeLlmProxyRecord[] },
): SessionLinkRecord[] {
  const out: SessionLinkRecord[] = [];
  let turnIndex = 0;

  for (const ev of events) {
    if (ev.kind === "user_input") {
      turnIndex += 1;
    }
    const ti = ev.kind === "user_input" ? turnIndex : Math.max(1, turnIndex);
    out.push(sequenceEventToRecord(ev, ti));
  }

  const llm = options?.llmProxyRecords ?? [];
  for (const rec of llm) {
    const turn = inferTurnIndexForTimestamp(out, rec.timestampMs);
    out.push(llmProxyToRecord(rec, turn));
  }

  out.sort((a, b) => {
    if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
    return a.id.localeCompare(b.id);
  });

  return out;
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

export function countSessionLinkStats(records: readonly SessionLinkRecord[]): {
  turns: number;
  tools: number;
  httpObserved: number;
  httpInferred: number;
} {
  const turns = records.filter((r) => r.layer === "input").length;
  const tools = records.filter((r) => r.layer === "tool").length;
  const httpObserved = records.filter((r) => r.layer === "http" && r.observed).length;
  const httpInferred = records.filter((r) => r.layer === "http" && !r.observed).length;
  return { turns, tools, httpObserved, httpInferred };
}
