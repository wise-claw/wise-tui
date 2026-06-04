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
  resolveExecutionEnvironmentTaskFromTaskItems,
} from "../utils/sessionConversationTasks";

function indexSessionsById(sessions: readonly ClaudeSession[]): Map<string, ClaudeSession> {
  const map = new Map<string, ClaudeSession>();
  for (const session of sessions) {
    map.set(session.id, session);
    const claudeSessionId = session.claudeSessionId?.trim();
    if (claudeSessionId) map.set(claudeSessionId, session);
  }
  return map;
}

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

  const sessionsByIdRef = useRef<Map<string, ClaudeSession>>(new Map());
  sessionsByIdRef.current = indexSessionsById(sessions);

  const workerSessionsDigest = digestWorkerSessionsForExecutionEnvironmentTasks(
    sessionsByIdRef.current,
    executionEnvironmentDispatchRecords,
  );

  const taskItems = useMemo(
    () =>
      filterExecutionEnvironmentDispatchTaskItems(
        buildExecutionEnvironmentConversationTasks({
          anchorSession,
          sessions: sessionsRef.current,
          dispatchRecords: executionEnvironmentDispatchRecords,
        }),
      ),
    [
      anchorSession.id,
      anchorSession.repositoryPath,
      executionEnvironmentDispatchRecords,
      workerSessionsDigest,
    ],
  );

  const resolveDispatchTask = useCallback(
    (meta: DispatchRecordMeta) => resolveExecutionEnvironmentTaskFromTaskItems(meta, taskItems),
    [taskItems],
  );

  return { taskItems, resolveDispatchTask };
}
