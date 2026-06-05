import { useEffect, useMemo } from "react";
import type { ClaudeSession, Repository } from "../types";
import { maxExecutionEnvironmentDispatchHistorySinceMs } from "../constants/executionEnvironmentDispatch";
import {
  listExecutionEnvironmentDispatchesForAnchor,
  listExecutionEnvironmentDispatchesForRepository,
} from "../services/executionEnvironmentDispatchPersistence";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  mergeExecutionEnvironmentDispatchesForAnchor,
  type ExecutionEnvironmentDispatchRecord,
} from "../stores/executionEnvironmentDispatchStore";
import { resolveExecutionEnvironmentDispatchAnchorSessionId } from "../utils/executionEnvironmentDispatchAnchor";
import { rehydrateExecutionEnvironmentDispatchesFromAnchorSession } from "../utils/rehydrateExecutionEnvironmentDispatches";

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

function anchorSessionMessagesFingerprint(session: ClaudeSession | null | undefined): string {
  if (!session) return "";
  const last = session.messages.at(-1);
  return `${session.messages.length}|${last?.id ?? ""}|${last?.timestamp ?? 0}`;
}

/** 按主会话锚点从 SQLite 加载执行环境派发历史（最大窗口）并灌入内存 store。 */
export function useExecutionEnvironmentDispatchPersistence(
  activeSessionId: string | null | undefined,
  sessions: readonly ClaudeSession[],
  repositoryMainSessionBindings: Record<string, string>,
  repositories: readonly Repository[],
): void {
  const anchorSessionId = useMemo(
    () =>
      resolveExecutionEnvironmentDispatchAnchorSessionId({
        activeSessionId,
        sessions,
        repositoryMainSessionBindings,
        repositories,
      }),
    [activeSessionId, sessions, repositoryMainSessionBindings, repositories],
  );

  const anchorSession = useMemo(
    () =>
      anchorSessionId
        ? sessions.find((session) => session.id === anchorSessionId) ?? null
        : null,
    [anchorSessionId, sessions],
  );

  const anchorMessagesFingerprint = anchorSessionMessagesFingerprint(anchorSession);
  const repositoryPath = anchorSession?.repositoryPath?.trim() ?? "";

  useEffect(() => {
    const anchor = anchorSessionId?.trim() ?? "";
    if (!anchor) return;

    let cancelled = false;
    const sinceMs = maxExecutionEnvironmentDispatchHistorySinceMs();

    void (async () => {
      try {
        let records = await listExecutionEnvironmentDispatchesForAnchor(anchor, sinceMs);
        if (records.length === 0 && repositoryPath) {
          const byRepo = await listExecutionEnvironmentDispatchesForRepository(repositoryPath, sinceMs);
          records = byRepo.map((record) => ({ ...record, anchorSessionId: anchor }));
        }
        if (cancelled) return;
        mergeExecutionEnvironmentDispatchesForAnchor(
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
  }, [anchorSessionId, repositoryPath]);

  useEffect(() => {
    if (!anchorSession) return;
    rehydrateExecutionEnvironmentDispatchesFromAnchorSession(anchorSession, sessions);
  }, [anchorSession, anchorMessagesFingerprint, sessions]);
}
