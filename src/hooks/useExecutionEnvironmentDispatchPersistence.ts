import { useEffect } from "react";
import { maxExecutionEnvironmentDispatchHistorySinceMs } from "../constants/executionEnvironmentDispatch";
import { listExecutionEnvironmentDispatchesForAnchor } from "../services/executionEnvironmentDispatchPersistence";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  replaceExecutionEnvironmentDispatchesForAnchor,
  type ExecutionEnvironmentDispatchRecord,
} from "../stores/executionEnvironmentDispatchStore";

function mergePersistedDispatchRecordsWithLive(
  anchor: string,
  persisted: readonly ExecutionEnvironmentDispatchRecord[],
): ExecutionEnvironmentDispatchRecord[] {
  const live = getExecutionEnvironmentDispatchesSnapshotForAnchor(anchor);
  if (live.length === 0) return [...persisted];
  const byBatchId = new Map<string, ExecutionEnvironmentDispatchRecord>();
  for (const record of persisted) {
    byBatchId.set(record.batchId, record);
  }
  for (const record of live) {
    const prev = byBatchId.get(record.batchId);
    if (!prev || record.createdAt >= prev.createdAt) {
      byBatchId.set(record.batchId, record);
    }
  }
  return [...byBatchId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** 按主会话锚点从 SQLite 加载执行环境派发历史（最大窗口）并灌入内存 store。 */
export function useExecutionEnvironmentDispatchPersistence(
  activeSessionId: string | null | undefined,
): void {
  useEffect(() => {
    const anchor = activeSessionId?.trim() ?? "";
    if (!anchor) return;

    let cancelled = false;
    const sinceMs = maxExecutionEnvironmentDispatchHistorySinceMs();

    void (async () => {
      try {
        const records = await listExecutionEnvironmentDispatchesForAnchor(anchor, sinceMs);
        if (cancelled) return;
        replaceExecutionEnvironmentDispatchesForAnchor(
          anchor,
          mergePersistedDispatchRecordsWithLive(anchor, records),
        );
      } catch {
        /* 持久化不可用时保留内存态 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);
}
