import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import { parseUsageFromHttpBody, type TokenUsageBreakdown } from "./sessionInsights";
import { resolveProxyTtftMs, resolveProxyFirstByteMs, resolveProxyRttMs } from "./llmProxyTtft";

export type LlmProxyFilterKind = "all" | "messages" | "errors";

export interface LlmProxyRecordsSummary {
  total: number;
  messagesCount: number;
  errorCount: number;
  streamingCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgDurationMs: number | null;
  avgRttMs: number | null;
  avgTtfbMs: number | null;
  avgTtftMs: number | null;
  totalRequestBytes: number;
  totalResponseBytes: number;
}

/** Anthropic Messages API 或兼容路径。 */
export function isLlmProxyMessagesPath(path: string): boolean {
  const p = path.split("?")[0]?.toLowerCase() ?? "";
  return /\/v1\/messages\/?$/.test(p) || /\/messages\/?$/.test(p);
}

/** 从请求体 JSON 提取 model 字段（支持截断预览）。 */
export function parseModelFromLlmProxyRequest(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const v = JSON.parse(trimmed) as Record<string, unknown>;
      const model = v.model;
      if (typeof model === "string" && model.trim()) return model.trim();
    } catch {
      /* 截断 JSON 走 regex */
    }
  }
  const m = trimmed.match(/"model"\s*:\s*"((?:[^"\\]|\\.)*)/);
  return m?.[1]?.replace(/\\"/g, '"').trim() || null;
}

export function parseUsageFromLlmProxyRecord(
  record: ClaudeLlmProxyRecord,
): TokenUsageBreakdown | null {
  return parseUsageFromHttpBody(record.responseBodyPreview);
}

export function summarizeLlmProxyRecords(
  records: readonly ClaudeLlmProxyRecord[],
): LlmProxyRecordsSummary {
  let messagesCount = 0;
  let errorCount = 0;
  let streamingCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalRequestBytes = 0;
  let totalResponseBytes = 0;
  let durationSum = 0;
  let durationN = 0;
  let rttSum = 0;
  let rttN = 0;
  let ttfbSum = 0;
  let ttfbN = 0;
  let ttftSum = 0;
  let ttftN = 0;

  for (const rec of records) {
    if (isLlmProxyMessagesPath(rec.path)) messagesCount += 1;
    if (rec.statusCode == null || rec.statusCode >= 400) errorCount += 1;
    if (rec.isStreaming) streamingCount += 1;
    totalRequestBytes += rec.requestBytes;
    totalResponseBytes += rec.responseBytes;
    if (rec.durationMs > 0) {
      durationSum += rec.durationMs;
      durationN += 1;
    }
    const rtt = resolveProxyRttMs(rec);
    if (rtt != null && rtt > 0) {
      rttSum += rtt;
      rttN += 1;
    }
    const ttfb = resolveProxyFirstByteMs(rec);
    if (ttfb != null && ttfb > 0) {
      ttfbSum += ttfb;
      ttfbN += 1;
    }
    const ttft = resolveProxyTtftMs(rec);
    if (rec.isStreaming && ttft != null && ttft > 0) {
      ttftSum += ttft;
      ttftN += 1;
    }
    const usage = parseUsageFromLlmProxyRecord(rec);
    if (usage) {
      totalInputTokens += usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
      totalOutputTokens += usage.outputTokens;
    }
  }

  return {
    total: records.length,
    messagesCount,
    errorCount,
    streamingCount,
    totalInputTokens,
    totalOutputTokens,
    avgDurationMs: durationN > 0 ? Math.round(durationSum / durationN) : null,
    avgRttMs: rttN > 0 ? Math.round(rttSum / rttN) : null,
    avgTtfbMs: ttfbN > 0 ? Math.round(ttfbSum / ttfbN) : null,
    avgTtftMs: ttftN > 0 ? Math.round(ttftSum / ttftN) : null,
    totalRequestBytes,
    totalResponseBytes,
  };
}

export function filterLlmProxyRecordsByPanelQuery(
  records: readonly ClaudeLlmProxyRecord[],
  options: { query?: string; kind?: LlmProxyFilterKind },
): ClaudeLlmProxyRecord[] {
  const kind = options.kind ?? "all";
  let out = records;
  if (kind === "messages") {
    out = out.filter((r) => isLlmProxyMessagesPath(r.path));
  } else if (kind === "errors") {
    out = out.filter((r) => r.statusCode == null || r.statusCode >= 400);
  }
  const q = (options.query ?? "").trim().toLowerCase();
  if (!q) return [...out];
  return out.filter((r) => {
    const model = parseModelFromLlmProxyRequest(r.requestBodyPreview);
    return (
      r.path.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q) ||
      r.upstream.toLowerCase().includes(q) ||
      r.upstreamUrl.toLowerCase().includes(q) ||
      (model?.toLowerCase().includes(q) ?? false) ||
      String(r.statusCode ?? "").includes(q)
    );
  });
}

export function exportLlmProxyRecordsJson(records: readonly ClaudeLlmProxyRecord[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    },
    null,
    2,
  );
}

export function formatTokenCountShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
