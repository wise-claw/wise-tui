import { SendOutlined } from "@ant-design/icons";
import { Tooltip, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import {
  historyDaysToSinceMs,
  type ExecutionEnvironmentDispatchHistoryDays,
} from "../../constants/executionEnvironmentDispatch";
import { ExecutionEnvironmentDispatchHistoryDaysDropdown } from "../ProgressMonitorPanel/ExecutionEnvironmentDispatchHistoryDaysDropdown";
import {
  canStopSessionConversationTask,
  filterExecutionEnvironmentDispatchTaskItems,
  formatExecutionEnvironmentDispatchTaskTime,
} from "../../utils/sessionConversationTasks";
import { SubagentStatusIndicator } from "../ProgressMonitorPanel/SubagentStatusIndicator";
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
    () => filterExecutionEnvironmentDispatchTaskItems(sessionConversationTaskItems, dispatchSinceMs),
    [sessionConversationTaskItems, dispatchSinceMs],
  );
  const [detailTarget, setDetailTarget] = useState<SessionConversationTaskDetailTarget | null>(null);

  const runningCount = useMemo(
    () => dispatchTaskItems.filter((item) => item.status === "running").length,
    [dispatchTaskItems],
  );

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
          <div className="app-monitor-panel__session-tasks-toolbar">
            <div className="app-monitor-panel__session-tasks-toolbar-start">
              <Typography.Text className="app-monitor-panel__session-tasks-title">
                <SendOutlined className="app-monitor-panel__session-tasks-title-icon" aria-hidden />
                派发任务
              </Typography.Text>
              <span className="app-monitor-panel__session-tasks-count">
                {runningCount > 0 ? `进行中 ${runningCount}` : `共 ${dispatchTaskItems.length} 项`}
              </span>
            </div>
            {executionEnvironmentDispatchHistoryDays != null &&
            onExecutionEnvironmentDispatchHistoryDaysChange ? (
              <ExecutionEnvironmentDispatchHistoryDaysDropdown
                disabled={executionEnvironmentDispatchHistoryDaysSaving}
                value={executionEnvironmentDispatchHistoryDays}
                onChange={onExecutionEnvironmentDispatchHistoryDaysChange}
              />
            ) : null}
          </div>

          <div className="app-left-sidebar-session-tasks-panel__scroll">
            {dispatchTaskItems.length > 0 ? (
              <div className="app-monitor-panel__session-tasks-list" aria-label="当前会话派发任务">
                {dispatchTaskItems.map((item) => {
                  const showStop = canStopSessionConversationTask(item, {
                    onStopSessionConversationTask,
                  });
                  return (
                    <div className="app-monitor-panel__session-task-row" key={item.key}>
                      <button
                        type="button"
                        className="app-monitor-panel__session-task-row-main"
                        title={item.subtitle ? `${item.label} · ${item.subtitle}` : item.label}
                        onClick={() => openDetail(item)}
                      >
                        <span className="app-monitor-panel__session-task-name" title={item.label}>
                          {item.label}
                        </span>
                        {item.subtitle ? (
                          <span className="app-monitor-panel__session-task-meta">{item.subtitle}</span>
                        ) : null}
                        <span className="app-monitor-panel__session-task-time">
                          {formatExecutionEnvironmentDispatchTaskTime(item.updatedAt)}
                        </span>
                      </button>
                      <span className="app-monitor-panel__session-task-actions">
                        {showStop ? (
                          <Tooltip title="结束执行">
                            <button
                              type="button"
                              className="app-monitor-panel__session-task-stop"
                              aria-label="结束执行"
                              onClick={(event) => {
                                event.stopPropagation();
                                onStopSessionConversationTask?.(item);
                              }}
                            >
                              ■
                            </button>
                          </Tooltip>
                        ) : null}
                        <SubagentStatusIndicator status={item.status} />
                      </span>
                    </div>
                  );
                })}
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

