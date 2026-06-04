import { useEffect } from "react";
import type { ExecutionEnvironmentDispatchHistoryDays } from "../constants/executionEnvironmentDispatch";
import { historyDaysToSinceMs } from "../constants/executionEnvironmentDispatch";
import { listExecutionEnvironmentDispatchesForAnchor } from "../services/executionEnvironmentDispatchPersistence";
import { replaceExecutionEnvironmentDispatchesForAnchor } from "../stores/executionEnvironmentDispatchStore";

/** 按主会话锚点从 SQLite 加载执行环境派发历史并灌入内存 store。 */
export function useExecutionEnvironmentDispatchPersistence(
  activeSessionId: string | null | undefined,
  historyDays: ExecutionEnvironmentDispatchHistoryDays,
): void {
  useEffect(() => {
    const anchor = activeSessionId?.trim() ?? "";
    if (!anchor) return;

    let cancelled = false;
    const sinceMs = historyDaysToSinceMs(historyDays);

    void (async () => {
      try {
        const records = await listExecutionEnvironmentDispatchesForAnchor(anchor, sinceMs);
        if (cancelled) return;
        replaceExecutionEnvironmentDispatchesForAnchor(anchor, records);
      } catch {
        /* 持久化不可用时保留内存态 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, historyDays]);
}
