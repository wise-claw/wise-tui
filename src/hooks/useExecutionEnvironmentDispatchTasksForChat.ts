import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { DispatchRecordMeta } from "../utils/claudeChatMessageDisplay";
import type { ClaudeSession, SessionConversationTaskItem } from "../types";
import {
  getExecutionEnvironmentDispatchesSnapshotForAnchor,
  subscribeExecutionEnvironmentDispatches,
} from "../stores/executionEnvironmentDispatchStore";
import {
  buildExecutionEnvironmentConversationTasks,
  digestWorkerSessionsForExecutionEnvironmentTasks,
  filterExecutionEnvironmentDispatchTaskItems,
  indexDispatchWorkerSessions,
  resolveExecutionEnvironmentTaskFromTaskItems,
} from "../utils/sessionConversationTasks";

const EMPTY_TASK_ITEMS: SessionConversationTaskItem[] = [];

/** 主会话消息列表：订阅派发记录、构建任务项，并提供 O(1) 热路径解析回调。 */
export function useExecutionEnvironmentDispatchTasksForChat(
  anchorSession: ClaudeSession,
  sessions: readonly ClaudeSession[],
): {
  taskItems: SessionConversationTaskItem[];
  resolveDispatchTask: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
} {
  const anchorSessionId = anchorSession.id;
  const executionEnvironmentDispatchRecords = useSyncExternalStore(
    subscribeExecutionEnvironmentDispatches,
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(anchorSessionId),
    () => getExecutionEnvironmentDispatchesSnapshotForAnchor(anchorSessionId),
  );

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // 顶层直接调用会在每次 render 全量重算 index/digest；用 useMemo 仅在 sessions 或派发记录变化时重算。
  // digest 稳定后下游 taskItems 的 useMemo 命中率提升，resolveDispatchTask 引用更稳定（不弱于改前）。
  const workerSessionsById = useMemo(
    () => indexDispatchWorkerSessions(sessions, executionEnvironmentDispatchRecords),
    [sessions, executionEnvironmentDispatchRecords],
  );
  const workerSessionsDigest = useMemo(
    () => digestWorkerSessionsForExecutionEnvironmentTasks(workerSessionsById, executionEnvironmentDispatchRecords),
    [workerSessionsById, executionEnvironmentDispatchRecords],
  );

  const taskItems = useMemo(() => {
    if (executionEnvironmentDispatchRecords.length === 0) return EMPTY_TASK_ITEMS;
    return filterExecutionEnvironmentDispatchTaskItems(
      buildExecutionEnvironmentConversationTasks({
        anchorSession,
        sessions: sessionsRef.current,
        dispatchRecords: executionEnvironmentDispatchRecords,
      }),
    );
  }, [
    anchorSession.id,
    anchorSession.repositoryPath,
    executionEnvironmentDispatchRecords,
    workerSessionsDigest,
  ]);

  const resolveDispatchTask = useCallback(
    (meta: DispatchRecordMeta) => resolveExecutionEnvironmentTaskFromTaskItems(meta, taskItems),
    [taskItems],
  );

  return { taskItems, resolveDispatchTask };
}
