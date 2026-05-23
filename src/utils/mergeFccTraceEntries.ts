import type { FccTraceEntry } from "../types/fccTrace";

/** 按时间降序合并 trace，以 `id` 去重。 */
export function mergeFccTraceEntries(
  existing: readonly FccTraceEntry[],
  incoming: readonly FccTraceEntry[],
): FccTraceEntry[] {
  const byId = new Map<string, FccTraceEntry>();
  for (const row of existing) {
    byId.set(row.id, row);
  }
  for (const row of incoming) {
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.timestampMs - a.timestampMs);
}
