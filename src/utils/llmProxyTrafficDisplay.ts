import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";

/** 根路径连通性探测，不是 Messages API。 */
export function isLlmProxyNoiseRecord(record: ClaudeLlmProxyRecord): boolean {
  const pathOnly = record.path.split("?")[0]?.trim().replace(/\/+$/, "") || "";
  const isRoot = pathOnly === "" || pathOnly === "/";
  if (!isRoot) return false;
  const method = record.method.toUpperCase();
  return method === "HEAD" || method === "GET" || method === "OPTIONS" || method === "TRACE";
}

export function filterLlmProxyRecordsForDisplay(
  records: readonly ClaudeLlmProxyRecord[],
): ClaudeLlmProxyRecord[] {
  return records.filter((r) => !isLlmProxyNoiseRecord(r));
}
