import { useEffect, useRef } from "react";
import { useSyncExternalStore } from "react";
import type { ClaudeSession } from "../types";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  subscribeExecutionEnvironmentDispatches,
} from "../stores/executionEnvironmentDispatchStore";
import { listExecutionEnvironmentWorkerIdsNeedingTranscriptHydration } from "../utils/sessionConversationTasks";
import { runWhenIdle } from "../utils/deferIdle";

/**
 * 派发 worker 标签常被内存策略清空正文；侧栏状态依赖最后一轮消息，需在打开 drawer 前预加载磁盘 jsonl。
 */
export function useExecutionEnvironmentDispatchWorkerTranscriptPreload(
  anchorSessionId: string | null | undefined,
  sessions: readonly ClaudeSession[],
  reloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>,
): void {
  const executionEnvironmentDispatchRecords = useSyncExternalStore(
    subscribeExecutionEnvironmentDispatches,
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(anchorSessionId),
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(anchorSessionId),
  );

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const inFlightRef = useRef<Set<string>>(new Set());

  const workerIdsKey = listExecutionEnvironmentWorkerIdsNeedingTranscriptHydration(
    sessions,
    executionEnvironmentDispatchRecords,
  ).join("|");

  useEffect(() => {
    if (!anchorSessionId?.trim() || !reloadFullDiskTranscript) return;
    if (executionEnvironmentDispatchRecords.length === 0) return;

    const workerIds = listExecutionEnvironmentWorkerIdsNeedingTranscriptHydration(
      sessionsRef.current,
      executionEnvironmentDispatchRecords,
    );
    if (workerIds.length === 0) return;

    let cancelled = false;
    const idleCleanups: Array<() => void> = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const [index, workerId] of workerIds.entries()) {
      if (inFlightRef.current.has(workerId)) continue;

      const timer = setTimeout(() => {
        if (cancelled) return;
        if (inFlightRef.current.has(workerId)) return;

        inFlightRef.current.add(workerId);
        idleCleanups.push(
          runWhenIdle(() => {
            if (cancelled) {
              inFlightRef.current.delete(workerId);
              return;
            }
            void Promise.resolve(reloadFullDiskTranscript(workerId)).finally(() => {
              inFlightRef.current.delete(workerId);
            });
          }, { timeoutMs: 1200 + index * 400 }),
        );
      }, index * 120);

      timers.push(timer);
    }

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      for (const cleanup of idleCleanups) cleanup();
    };
  }, [
    anchorSessionId,
    executionEnvironmentDispatchRecords,
    reloadFullDiskTranscript,
    workerIdsKey,
  ]);
}
