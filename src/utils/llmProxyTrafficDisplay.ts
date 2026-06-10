import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";

export interface LlmProxyRecordsDisplayOptions {
  /** LLM 代理监听中且进程在跑时，隐藏 stdout 兜底记录，避免与 HTTP 抓包重复。 */
  hideStreamJsonWhenProxyActive?: boolean;
}

/** 根路径连通性探测，不是 Messages API。 */
export function isLlmProxyNoiseRecord(record: ClaudeLlmProxyRecord): boolean {
  const pathOnly = record.path.split("?")[0]?.trim().replace(/\/+$/, "") || "";
  const isRoot = pathOnly === "" || pathOnly === "/";
  if (!isRoot) return false;
  const method = record.method.toUpperCase();
  return method === "HEAD" || method === "GET" || method === "OPTIONS" || method === "TRACE";
}

/** Claude stdout 兜底记录（非 HTTP 代理真实抓包）。 */
export function isStreamJsonFallbackRecord(record: ClaudeLlmProxyRecord): boolean {
  if (record.path.startsWith("/stream-json/")) return true;
  return record.upstream.includes("stream-json");
}

function streamJsonDedupeKey(record: ClaudeLlmProxyRecord): string {
  const body = record.responseBodyPreview || record.requestBodyPreview;
  const sample = body.length > 256 ? body.slice(0, 256) : body;
  return `${record.method}|${record.path}|${sample}`;
}

/** 同一轮 stdout 可能重复 emit 多条相同 result，保留最新一条。 */
function dedupeStreamJsonFallbackRecords(
  records: readonly ClaudeLlmProxyRecord[],
): ClaudeLlmProxyRecord[] {
  const seen = new Set<string>();
  const out: ClaudeLlmProxyRecord[] = [];
  for (const record of records) {
    if (!isStreamJsonFallbackRecord(record)) {
      out.push(record);
      continue;
    }
    const key = streamJsonDedupeKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

export function filterLlmProxyRecordsForDisplay(
  records: readonly ClaudeLlmProxyRecord[],
  options?: LlmProxyRecordsDisplayOptions,
): ClaudeLlmProxyRecord[] {
  let out = records.filter((r) => !isLlmProxyNoiseRecord(r));
  if (options?.hideStreamJsonWhenProxyActive) {
    out = out.filter((r) => !isStreamJsonFallbackRecord(r));
  } else {
    out = dedupeStreamJsonFallbackRecords(out);
  }
  return out;
}
