import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import type { FccTraceEntry } from "../types/fccTrace";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";
import type { SequenceEvent } from "./claudeSessionTrajectorySequence";

export const INFERRED_HTTP_DETAIL_PLACEHOLDER =
  "尚未捕获模型 HTTP 请求/响应体。\n\n" +
  "· OpenCode Go 代理：确认代理已运行且 Claude settings 已对齐（需含 requestPreview / responsePreview）。\n" +
  "· Free Claude Code：确认 fcc-server 运行且已将 trace 写入 ~/.fcc/traces/（需含 requestPreview / responsePreview）。\n" +
  "· 或开启顶栏「LLM 代理」监听，上游指向 FCC，由 Wise 中转抓包。";

const MATCH_WINDOW_MS = 300_000;

export function opencodeGoProxyTraceHttpDetail(entry: OpencodeGoProxyTraceEntry): string {
  const method = (entry.method?.trim() || "POST").toUpperCase();
  const path = entry.path?.trim() || "/v1/messages";
  const status = entry.statusCode != null ? String(entry.statusCode) : "";
  const duration = entry.durationMs > 0 ? `${entry.durationMs}ms` : "";
  const claudeModel = entry.claudeModel?.trim() ?? "";
  const upstreamModel = entry.upstreamModel?.trim() ?? "";
  return [
    `${method} ${path}${status ? ` · ${status}` : ""}${duration ? ` · ${duration}` : ""}`,
    claudeModel ? `claude model: ${claudeModel}` : "",
    upstreamModel ? `upstream model: ${upstreamModel}` : "",
    entry.upstreamUrl?.trim() ? `upstream: ${entry.upstreamUrl}` : "",
    entry.isStreaming ? "streaming: true" : "",
    entry.requestPreview?.trim() ? `request:\n${entry.requestPreview}` : "",
    entry.responsePreview?.trim() ? `response:\n${entry.responsePreview}` : "",
    entry.errorMessage?.trim() ? `error: ${entry.errorMessage}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function opencodeGoProxyTraceHttpSubtitle(entry: OpencodeGoProxyTraceEntry): string {
  const method = (entry.method?.trim() || "POST").toUpperCase();
  const path = entry.path?.trim() || "/v1/messages";
  const status = entry.statusCode != null ? String(entry.statusCode) : "";
  const duration = entry.durationMs > 0 ? `${entry.durationMs}ms` : "";
  const model = entry.claudeModel?.trim() || entry.upstreamModel?.trim() || "";
  return [
    `${method} ${path}`,
    status || undefined,
    duration || undefined,
    model ? `model: ${model}` : undefined,
    entry.isStreaming ? "stream" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function fccTraceHttpDetail(entry: FccTraceEntry): string {
  const method = (entry.method?.trim() || "POST").toUpperCase();
  const path = entry.path?.trim() || "/v1/messages";
  const status = entry.statusCode != null ? String(entry.statusCode) : "";
  const duration = entry.durationMs != null ? `${entry.durationMs}ms` : "";
  const model = entry.model?.trim() ?? "";
  return [
    `${method} ${path}${status ? ` · ${status}` : ""}${duration ? ` · ${duration}` : ""}`,
    model ? `model: ${model}` : "",
    entry.anthropicRequestId?.trim() ? `request-id: ${entry.anthropicRequestId}` : "",
    entry.requestPreview?.trim() ? `request:\n${entry.requestPreview}` : "",
    entry.responsePreview?.trim() ? `response:\n${entry.responsePreview}` : "",
    entry.upstreamPreview?.trim() ? `upstream:\n${entry.upstreamPreview}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function fccTraceHttpSubtitle(entry: FccTraceEntry): string {
  const method = (entry.method?.trim() || "POST").toUpperCase();
  const path = entry.path?.trim() || "/v1/messages";
  const status = entry.statusCode != null ? String(entry.statusCode) : "";
  const duration = entry.durationMs != null ? `${entry.durationMs}ms` : "";
  const model = entry.model?.trim() ?? "";
  return [
    `${method} ${path}`,
    status || undefined,
    duration || undefined,
    model ? `model: ${model}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function llmProxyHttpDetail(rec: ClaudeLlmProxyRecord): string {
  const path = rec.path?.trim() || "/";
  return [
    `${rec.method} ${path}${rec.statusCode != null ? ` · ${rec.statusCode}` : ""}${
      rec.durationMs != null ? ` · ${rec.durationMs}ms` : ""
    }`,
    rec.upstreamUrl?.trim() ? `upstream: ${rec.upstreamUrl}` : `upstream: ${rec.upstream}`,
    rec.requestBodyPreview?.trim() ? `request:\n${rec.requestBodyPreview}` : "",
    rec.responseBodyPreview?.trim() ? `response:\n${rec.responseBodyPreview}` : "",
    rec.requestTruncated || rec.responseTruncated ? "[body truncated]" : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function llmProxyHttpSubtitle(rec: ClaudeLlmProxyRecord): string {
  const path = rec.path?.trim() || "/";
  return `${rec.method} ${path}${rec.statusCode != null ? ` · ${rec.statusCode}` : ""}`;
}

interface Timestamped {
  id: string;
  timestampMs: number;
}

function findBestMatchForEvent<T extends Timestamped>(
  ev: SequenceEvent,
  pool: readonly T[],
  used: ReadonlySet<string>,
): T | null {
  let best: T | null = null;
  let bestDelta = Infinity;
  for (const item of pool) {
    if (used.has(item.id)) continue;
    const delta = Math.abs(item.timestampMs - ev.timestamp);
    if (delta > MATCH_WINDOW_MS) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      best = item;
    }
  }
  return best;
}

type ObservedHttpSource = "opencode_go_proxy" | "fcc" | "llm_proxy";

function applyObservedHttp(
  ev: SequenceEvent,
  opts: { id: string; subtitle: string; detail: string; source: ObservedHttpSource },
): void {
  ev.id =
    opts.source === "opencode_go_proxy"
      ? `opencode-go-api-${opts.id}`
      : opts.source === "fcc"
        ? `fcc-api-${opts.id}`
        : `llm-api-${opts.id}`;
  ev.flags.observedHttp = true;
  ev.subtitle = opts.subtitle;
  ev.detail = opts.detail;
  ev.label = "REQUEST";
}

export interface EnrichSequenceHttpResult {
  events: SequenceEvent[];
  /** 未能对齐到占位 `api_request` 的 OpenCode Go trace（由调用方合并进时间线）。 */
  unusedOpencodeGoProxyTraces: OpencodeGoProxyTraceEntry[];
  /** 未能对齐到占位 `api_request` 的 FCC trace（由调用方合并进时间线）。 */
  unusedFccTraces: FccTraceEntry[];
}

/** 将 OpenCode Go / FCC / LLM 代理记录填入已存在的 `api_request` 占位。 */
export function enrichSequenceEventsWithObservedHttp(
  events: readonly SequenceEvent[],
  options?: {
    opencodeGoProxyTraces?: readonly OpencodeGoProxyTraceEntry[];
    fccTraces?: readonly FccTraceEntry[];
    llmProxyRecords?: readonly ClaudeLlmProxyRecord[];
  },
): EnrichSequenceHttpResult {
  const opencode = options?.opencodeGoProxyTraces ?? [];
  const fcc = options?.fccTraces ?? [];
  const llm = options?.llmProxyRecords ?? [];
  if (opencode.length === 0 && fcc.length === 0 && llm.length === 0) {
    return { events: [...events], unusedOpencodeGoProxyTraces: [], unusedFccTraces: [] };
  }

  const copy = events.map((e) => ({ ...e, flags: { ...e.flags } }));
  const usedOpencode = new Set<string>();
  const usedFcc = new Set<string>();
  const usedLlm = new Set<string>();

  for (const ev of copy) {
    if (ev.kind !== "api_request" || ev.flags.observedHttp) continue;

    const opencodeMatch = findBestMatchForEvent(ev, opencode, usedOpencode);
    if (opencodeMatch) {
      usedOpencode.add(opencodeMatch.id);
      applyObservedHttp(ev, {
        id: opencodeMatch.id,
        subtitle: opencodeGoProxyTraceHttpSubtitle(opencodeMatch),
        detail: opencodeGoProxyTraceHttpDetail(opencodeMatch),
        source: "opencode_go_proxy",
      });
      continue;
    }

    const fccMatch = findBestMatchForEvent(ev, fcc, usedFcc);
    if (fccMatch) {
      usedFcc.add(fccMatch.id);
      applyObservedHttp(ev, {
        id: fccMatch.id,
        subtitle: fccTraceHttpSubtitle(fccMatch),
        detail: fccTraceHttpDetail(fccMatch),
        source: "fcc",
      });
      continue;
    }

    const llmMatch = findBestMatchForEvent(ev, llm, usedLlm);
    if (llmMatch) {
      usedLlm.add(llmMatch.id);
      applyObservedHttp(ev, {
        id: llmMatch.id,
        subtitle: llmProxyHttpSubtitle(llmMatch),
        detail: llmProxyHttpDetail(llmMatch),
        source: "llm_proxy",
      });
    }
  }

  const unusedOpencode = opencode.filter((e) => !usedOpencode.has(e.id));
  const unusedFcc = fcc.filter((e) => !usedFcc.has(e.id));
  return {
    events: copy,
    unusedOpencodeGoProxyTraces: unusedOpencode,
    unusedFccTraces: unusedFcc,
  };
}
