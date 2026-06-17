import { useCallback, useMemo, useState } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import {
  historyDaysToSinceMs,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../../constants/executionEnvironmentDispatch";
import { ExecutionEnvironmentDispatchHistoryDaysDropdown } from "../ProgressMonitorPanel/ExecutionEnvironmentDispatchHistoryDaysDropdown";
import {
  canStopSessionConversationTask,
  filterSessionDispatchTaskItems,
} from "../../utils/sessionConversationTasks";
import { SessionConversationDispatchTaskRow } from "../ProgressMonitorPanel/SessionConversationDispatchTaskRow";
import {
  SessionConversationTaskDetailDrawer,
  type SessionConversationTaskDetailTarget,
} from "../ProgressMonitorPanel/SessionConversationTaskDetailDrawer";
import "../ProgressMonitorPanel/index.css";
import "./SessionConversationTasksPanel.css";

export function SessionConversationTasksPanel({
  sessions,
  sessionConversationTaskItems,
  onStopSessionConversationTask,
  onResumeSession,
  onReloadFullDiskTranscript,
  onPrepareSessionForMonitorDrawer,
  executionEnvironmentDispatchHistoryDays,
  onExecutionEnvironmentDispatchHistoryDaysChange,
  executionEnvironmentDispatchHistoryDaysSaving = false,
}: {
  sessions: readonly ClaudeSession[];
  sessionConversationTaskItems: readonly SessionConversationTaskItem[];
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  onResumeSession?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerResumeSessionFn;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onPrepareSessionForMonitorDrawer?: import("../ProgressMonitorPanel/MonitorDrawerSessionComposer").MonitorDrawerPrepareSessionFn;
  executionEnvironmentDispatchHistoryDays?: ExecutionEnvironmentDispatchHistoryDays;
  onExecutionEnvironmentDispatchHistoryDaysChange?: (
    days: ExecutionEnvironmentDispatchHistoryDays,
  ) => void | Promise<void>;
  executionEnvironmentDispatchHistoryDaysSaving?: boolean;
}) {
  const dispatchSinceMs = useMemo(
    () =>
      executionEnvironmentDispatchHistoryDays != null
        ? historyDaysToSinceMs(executionEnvironmentDispatchHistoryDays)
        : undefined,
    [executionEnvironmentDispatchHistoryDays],
  );

  const dispatchTaskItems = useMemo(
    () => filterSessionDispatchTaskItems(sessionConversationTaskItems, dispatchSinceMs),
    [sessionConversationTaskItems, dispatchSinceMs],
  );
  const [detailTarget, setDetailTarget] = useState<SessionConversationTaskDetailTarget | null>(null);

  const openDetail = useCallback((item: SessionConversationTaskItem) => {
    setDetailTarget({ task: item });
  }, []);

  return (
    <div className="app-left-sidebar-session-tasks-panel">
      <div className="app-monitor-panel">
        <div
          className={`app-monitor-panel__section app-monitor-panel__section--session-tasks${
            dispatchTaskItems.length === 0 ? " app-monitor-panel__section--session-tasks-empty" : ""
          }`}
        >
          {executionEnvironmentDispatchHistoryDays != null &&
          onExecutionEnvironmentDispatchHistoryDaysChange ? (
            <div className="app-monitor-panel__session-tasks-head-actions">
              <ExecutionEnvironmentDispatchHistoryDaysDropdown
                disabled={executionEnvironmentDispatchHistoryDaysSaving}
                value={executionEnvironmentDispatchHistoryDays}
                onChange={onExecutionEnvironmentDispatchHistoryDaysChange}
                compact
              />
            </div>
          ) : null}

          <div className="app-left-sidebar-session-tasks-panel__scroll">
            {dispatchTaskItems.length > 0 ? (
              <div className="app-monitor-panel__session-tasks-list" aria-label="当前会话派发任务">
                {dispatchTaskItems.map((item) => (
                  <SessionConversationDispatchTaskRow
                    key={item.key}
                    item={item}
                    showStop={canStopSessionConversationTask(item, {
                      onStopSessionConversationTask,
                    })}
                    onOpenDetail={openDetail}
                    onStop={onStopSessionConversationTask}
                  />
                ))}
              </div>
            ) : (
              <div className="app-monitor-panel__session-tasks-empty-hint">
                近 {executionEnvironmentDispatchHistoryDays ?? 1} 天暂无派发记录
              </div>
            )}
          </div>
        </div>
      </div>

      {detailTarget ? (
        <SessionConversationTaskDetailDrawer
          target={detailTarget}
          sessions={sessions}
          sessionConversationTaskItems={dispatchTaskItems}
          onClose={() => setDetailTarget(null)}
          onStopTask={onStopSessionConversationTask}
          onStopSessionConversationTask={onStopSessionConversationTask}
          onResumeSession={onResumeSession}
          onReloadFullDiskTranscript={onReloadFullDiskTranscript}
          onPrepareSessionForMonitorDrawer={onPrepareSessionForMonitorDrawer}
        />
      ) : null}
    </div>
  );
}
