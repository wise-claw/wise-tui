import { useMemo, useRef, useSyncExternalStore } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../types";
import {
  getSessionFeedbackLoopDispatchesSnapshotForAnchor,
  subscribeSessionFeedbackLoopDispatches,
} from "../stores/sessionFeedbackLoopDispatchStore";
import {
  buildFeedbackLoopConversationTasks,
  filterSessionDispatchTaskItems,
} from "../utils/sessionConversationTasks";
import { isFeedbackLoopWorkerRepositoryName } from "../utils/sessionFeedbackLoopDispatch";

const EMPTY_TASK_ITEMS: SessionConversationTaskItem[] = [];

function digestFeedbackLoopWorkerSessions(
  sessions: readonly ClaudeSession[],
  workerSessionIds: readonly string[],
): string {
  if (workerSessionIds.length === 0) return "";
  const idSet = new Set(workerSessionIds);
  const parts: string[] = [];
  for (const session of sessions) {
    if (!idSet.has(session.id)) continue;
    const last = session.messages[session.messages.length - 1];
    parts.push(
      session.id,
      session.status,
      String(session.messages.length),
      String(last?.id ?? ""),
      session.status === "running" ? "0" : String(last?.content?.length ?? 0),
    );
  }
  return parts.join("|");
}

/** 主会话：订阅反馈神经网派发记录并构建任务项。 */
export function useSessionFeedbackLoopDispatchTasksForChat(
  anchorSession: ClaudeSession,
  sessions: readonly ClaudeSession[],
): SessionConversationTaskItem[] {
  const anchorSessionId = anchorSession.id;
  const feedbackLoopDispatchRecords = useSyncExternalStore(
    subscribeSessionFeedbackLoopDispatches,
    () => getSessionFeedbackLoopDispatchesSnapshotForAnchor(anchorSessionId),
    () => getSessionFeedbackLoopDispatchesSnapshotForAnchor(anchorSessionId),
  );

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const workerSessionIds = useMemo(
    () => feedbackLoopDispatchRecords.map((record) => record.workerSessionId),
    [feedbackLoopDispatchRecords],
  );

  const workerSessionsDigest = useMemo(
    () => digestFeedbackLoopWorkerSessions(sessionsRef.current, workerSessionIds),
    [sessions, workerSessionIds],
  );

  return useMemo(() => {
    if (feedbackLoopDispatchRecords.length === 0) return EMPTY_TASK_ITEMS;
    return filterSessionDispatchTaskItems(
      buildFeedbackLoopConversationTasks({
        anchorSession,
        sessions: sessionsRef.current,
        dispatchRecords: feedbackLoopDispatchRecords,
      }),
    );
  }, [
    anchorSession.id,
    anchorSession.repositoryPath,
    feedbackLoopDispatchRecords,
    workerSessionsDigest,
  ]);
}

export function isFeedbackLoopDispatchAnchorSession(session: ClaudeSession): boolean {
  return !isFeedbackLoopWorkerRepositoryName(session.repositoryName);
}
