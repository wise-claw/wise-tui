import { memo, useMemo } from "react";
import type { ClaudeSession } from "../../types";
import type { DispatchRecordMeta } from "../../utils/claudeChatMessageDisplay";
import {
  enrichDispatchRecordMeta,
  formatDispatchRecordSentence,
} from "../../utils/claudeChatMessageDisplay";

interface Props {
  dispatch: DispatchRecordMeta;
  sessionsForDispatchLookup?: readonly ClaudeSession[];
  onOpenHistorySessionInInspector?: (sessionId: string) => void;
  onOpenTaskDetail?: (taskId: string) => void;
}

function DispatchRecordMessageInner({
  dispatch,
  sessionsForDispatchLookup,
  onOpenHistorySessionInInspector,
  onOpenTaskDetail,
}: Props) {
  const sentence = useMemo(
    () => formatDispatchRecordSentence(enrichDispatchRecordMeta(dispatch, sessionsForDispatchLookup)),
    [dispatch, sessionsForDispatchLookup],
  );
  const sessionId = dispatch.targetSessionId?.trim();
  const canOpenSession = Boolean(sessionId && onOpenHistorySessionInInspector);
  const taskId = dispatch.taskId?.trim();

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
