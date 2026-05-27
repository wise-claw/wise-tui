import { Tooltip, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import { canStopSessionConversationTask } from "../../utils/sessionConversationTasks";
import { SubagentStatusIndicator } from "../ProgressMonitorPanel/SubagentStatusIndicator";
import {
  SessionConversationTaskDetailDrawer,
  type SessionConversationTaskDetailTarget,
} from "../ProgressMonitorPanel/SessionConversationTaskDetailDrawer";
import "../ProgressMonitorPanel/index.css";
import "./SessionConversationTasksPanel.css";

function RepositoryMiniIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden>
      <path d="M3 4.5h10v7H3z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5 4.5V3h6v1.5M5.25 7h5.5M5.25 9.5h3.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function SessionConversationTasksPanel({
  sessions,
  sessionConversationTaskItems,
  onStopSessionConversationTask,
}: {
  sessions: readonly ClaudeSession[];
  sessionConversationTaskItems: readonly SessionConversationTaskItem[];
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
}) {
  const [detailTarget, setDetailTarget] = useState<SessionConversationTaskDetailTarget | null>(null);

  const runningCount = useMemo(
    () => sessionConversationTaskItems.filter((item) => item.status === "running").length,
    [sessionConversationTaskItems],
  );

  const openDetail = useCallback((item: SessionConversationTaskItem) => {
    setDetailTarget({ task: item });
  }, []);

  return (
    <div className="app-left-sidebar-session-tasks-panel">
      <div className="app-monitor-panel">
        <div className="app-monitor-panel__section app-monitor-panel__section--session-tasks">
          <div className="app-monitor-panel__section-head">
            <div className="app-monitor-panel__section-title-wrap">
              <Typography.Text className="app-monitor-panel__section-title">
                <span className="app-monitor-panel__section-icon">
                  <RepositoryMiniIcon />
                </span>
                子代理 / 任务
              </Typography.Text>
              <Typography.Text className="app-monitor-panel__meta">
                {runningCount > 0 ? `进行中 ${runningCount}` : `共 ${sessionConversationTaskItems.length} 项`}
              </Typography.Text>
            </div>
          </div>

          <div className="app-left-sidebar-session-tasks-panel__scroll">
            <div className="app-monitor-panel__subagent-tree" aria-label="当前对话子代理与任务">
              {sessionConversationTaskItems.map((item) => {
                const showStop = canStopSessionConversationTask(item, {
                  onStopSessionConversationTask,
                });
                return (
                  <div className="app-monitor-panel__session-task-row" key={item.key}>
                    <button
                      type="button"
                      className="app-monitor-panel__subagent-row app-monitor-panel__subagent-row--clickable app-monitor-panel__session-task-row-main"
                      title={item.previewText}
                      onClick={() => openDetail(item)}
                    >
                      <span className="app-monitor-panel__subagent-branch" aria-hidden />
                      <span className="app-monitor-panel__subagent-main">
                        <span className="app-monitor-panel__subagent-name">{item.label}</span>
                        {item.subtitle ? (
                          <span className="app-monitor-panel__subagent-stage">{item.subtitle}</span>
                        ) : null}
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
          </div>
        </div>
      </div>

      <SessionConversationTaskDetailDrawer
        target={detailTarget}
        sessions={sessions}
        sessionConversationTaskItems={sessionConversationTaskItems}
        onClose={() => setDetailTarget(null)}
        onStopTask={onStopSessionConversationTask}
        onStopSessionConversationTask={onStopSessionConversationTask}
      />
    </div>
  );
}

