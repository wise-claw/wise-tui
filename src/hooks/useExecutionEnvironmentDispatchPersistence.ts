import { useEffect, useMemo, useRef } from "react";
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
import { sessionsReactiveStructureKey } from "../utils/sessionConversationTasks";

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
  const last =
    session.messages.length > 0 ? session.messages[session.messages.length - 1] : undefined;
  return `${session.messages.length}|${last?.id ?? ""}|${last?.timestamp ?? 0}`;
}

/** 按主会话锚点从 SQLite 加载执行环境派发历史（最大窗口）并灌入内存 store。 */
export function useExecutionEnvironmentDispatchPersistence(
  activeSessionId: string | null | undefined,
  sessions: readonly ClaudeSession[],
  repositoryMainSessionBindings: Record<string, string>,
  repositories: readonly Repository[],
): void {
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const sessionsStructureKey = sessionsReactiveStructureKey(sessions);

  const anchorSessionId = useMemo(
    () =>
      resolveExecutionEnvironmentDispatchAnchorSessionId({
        activeSessionId,
        sessions: sessionsRef.current,
        repositoryMainSessionBindings,
        repositories,
      }),
    [activeSessionId, repositoryMainSessionBindings, repositories, sessionsStructureKey],
  );

  const anchorMessagesFingerprint = useMemo(() => {
    const session = anchorSessionId
      ? sessionsRef.current.find((item) => item.id === anchorSessionId) ?? null
      : null;
    return anchorSessionMessagesFingerprint(session);
  }, [anchorSessionId, sessionsStructureKey]);

  const repositoryPath = useMemo(() => {
    if (!anchorSessionId) return "";
    return (
      sessionsRef.current.find((item) => item.id === anchorSessionId)?.repositoryPath?.trim() ??
      ""
    );
  }, [anchorSessionId, sessionsStructureKey]);

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
    const anchor = anchorSessionId?.trim() ?? "";
    if (!anchor) return;
    const session = sessionsRef.current.find((item) => item.id === anchor);
    if (!session) return;
    rehydrateExecutionEnvironmentDispatchesFromAnchorSession(session, sessionsRef.current);
  }, [anchorSessionId, anchorMessagesFingerprint]);
}
