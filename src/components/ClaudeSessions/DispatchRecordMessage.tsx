import { memo, useMemo } from "react";
import type { SessionConversationTaskItem } from "../../types";
import type { DispatchRecordMeta, SessionDispatchLookup } from "../../utils/claudeChatMessageDisplay";
import {
  enrichDispatchRecordMeta,
  formatDispatchRecordSentence,
} from "../../utils/claudeChatMessageDisplay";

interface Props {
  dispatch: DispatchRecordMeta;
  sessionsForDispatchLookup?: SessionDispatchLookup;
  resolveExecutionEnvironmentDispatchTask?: (meta: DispatchRecordMeta) => SessionConversationTaskItem | null;
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
  onOpenSessionConversationTaskDetail?: (task: SessionConversationTaskItem) => void;
}

function DispatchRecordMessageInner({
  dispatch,
  sessionsForDispatchLookup,
  resolveExecutionEnvironmentDispatchTask,
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
    if (!resolveExecutionEnvironmentDispatchTask || !onOpenSessionConversationTaskDetail) return null;
    if (dispatch.dispatchType?.trim() !== "执行环境") return null;
    return resolveExecutionEnvironmentDispatchTask(dispatch);
  }, [dispatch, onOpenSessionConversationTaskDetail, resolveExecutionEnvironmentDispatchTask]);

  const canOpenExecutionEnvironmentTask = Boolean(executionEnvironmentTask && onOpenSessionConversationTaskDetail);

  return (
    <div className="app-system-dispatch-card app-system-dispatch-card--sentence">
      {canOpenExecutionEnvironmentTask ? (
        <button
          type="button"
          className="app-system-dispatch-card__sentence-link"
          title="打开执行会话"
          onClick={() => onOpenSessionConversationTaskDetail!(executionEnvironmentTask!)}
        >
          {sentence}
        </button>
      ) : canOpenSession ? (
        <button
          type="button"
          className="app-system-dispatch-card__sentence-link"
          onClick={() => onOpenHistorySessionInInspector!(sessionId!)}
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

function dispatchMetaEqual(a: DispatchRecordMeta, b: DispatchRecordMeta): boolean {
  return (
    a.dispatchType === b.dispatchType &&
    a.targetName === b.targetName &&
    a.engineName === b.engineName &&
    a.targetSessionId === b.targetSessionId &&
    a.dispatchBatchId === b.dispatchBatchId &&
    a.taskId === b.taskId &&
    a.dispatchTime === b.dispatchTime &&
    a.dispatchContent === b.dispatchContent
  );
}

export const DispatchRecordMessage = memo(DispatchRecordMessageInner, (prev, next) => {
  if (prev.sessionsForDispatchLookup !== next.sessionsForDispatchLookup) return false;
  if (prev.resolveExecutionEnvironmentDispatchTask !== next.resolveExecutionEnvironmentDispatchTask) return false;
  if (prev.onOpenHistorySessionInInspector !== next.onOpenHistorySessionInInspector) return false;
  if (prev.onOpenTaskDetail !== next.onOpenTaskDetail) return false;
  if (prev.onOpenSessionConversationTaskDetail !== next.onOpenSessionConversationTaskDetail) return false;
  return dispatchMetaEqual(prev.dispatch, next.dispatch);
});
