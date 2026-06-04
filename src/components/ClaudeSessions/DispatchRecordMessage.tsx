import { memo, useMemo } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import {
  enrichDispatchRecordMeta,
  formatDispatchRecordSentence,
} from "../../utils/claudeChatMessageDisplay";
import { resolveExecutionEnvironmentTaskFromDispatchMeta } from "../../utils/sessionConversationTasks";
import type { ExecutionEnvironmentDispatchRecord } from "../../stores/executionEnvironmentDispatchStore";

interface Props {
  dispatch: DispatchRecordMeta;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  anchorSession?: ClaudeSession | null;
  executionEnvironmentDispatchRecords?: readonly ExecutionEnvironmentDispatchRecord[];
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
}

function DispatchRecordMessageInner({
  dispatch,
  sessionsForDispatchLookup,
  anchorSession,
  executionEnvironmentDispatchRecords = [],
  onOpenHistorySessionInInspector,
  onOpenTaskDetail,
  onOpenSessionConversationTaskDetail,
}: Props) {
  const sentence = useMemo(
    () => formatDispatchRecordSentence(enrichDispatchRecordMeta(dispatch, sessionsForDispatchLookup)),
    [dispatch, sessionsForDispatchLookup],
  );
  const sessionId = dispatch.targetSessionId?.trim();
  const canOpenSession = Boolean(sessionId && onOpenHistorySessionInInspector);
  const taskId = dispatch.taskId?.trim();

  const executionEnvironmentTask = useMemo(() => {
    if (!anchorSession || !onOpenSessionConversationTaskDetail) return null;
    return resolveExecutionEnvironmentTaskFromDispatchMeta(dispatch, {
      anchorSession,
      sessions: sessionsForDispatchLookup ?? [],
      dispatchRecords: executionEnvironmentDispatchRecords,
    });
  }, [
    anchorSession,
    dispatch,
    executionEnvironmentDispatchRecords,
    onOpenSessionConversationTaskDetail,
    sessionsForDispatchLookup,
  ]);

  const canOpenExecutionEnvironmentTask = Boolean(executionEnvironmentTask && onOpenSessionConversationTaskDetail);

  return (
    <div className="app-system-dispatch-card app-system-dispatch-card--sentence">
      {canOpenSession ? (
        <button
          type="button"
          className="app-system-dispatch-card__sentence-link"
          onClick={() => onOpenHistorySessionInInspector!(sessionId!)}
        >
          {sentence}
        </button>
      ) : canOpenExecutionEnvironmentTask ? (
        <button
          type="button"
          className="app-system-dispatch-card__sentence-link"
          title="查看执行会话详情"
          onClick={() => onOpenSessionConversationTaskDetail!(executionEnvironmentTask!)}
        >
          {sentence}
        </button>
      ) : (
        <p className="app-system-dispatch-card__sentence">{sentence}</p>
      )}
      {taskId ? (
        <div className="app-system-dispatch-card__actions">
          <button
            type="button"
            className="app-system-dispatch-card__btn"
            onClick={() => onOpenTaskDetail?.(taskId)}
          >
            查看任务详情
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const DispatchRecordMessage = memo(DispatchRecordMessageInner);
