import { memo, useMemo, useState } from "react";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../../types";
import { getSessionPreview } from "../ProgressMonitorPanel/historySessionDrawerChrome";
import { canStopSessionConversationTask } from "../../utils/sessionConversationTasks";
import {
  WORKSPACE_SIDEBAR_ROW_MORE_STEP,
  WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT,
  buildWorkspaceSidebarTreeRows,
  formatWorkspaceSidebarRelativeTime,
  workspaceSidebarSessionUpdatedAt,
} from "../../utils/repositoryWorkspaceTree";
import "./RepositoryWorkspaceSessionTree.css";

export type RepositoryWorkspaceSessionTreeProps = {
  repositoryPath: string;
  repositoryName: string;
  sessions: ReadonlyArray<ClaudeSession>;
  activeSessionId: string | null;
  showRunItems?: boolean;
  employeeMonitorItems?: ReadonlyArray<EmployeeMonitorItem>;
  sessionConversationTaskItems?: ReadonlyArray<SessionConversationTaskItem>;
  teamMonitorItems?: ReadonlyArray<TeamMonitorItem>;
  onSelectSession?: (sessionId: string) => void;
  onRestoreHistorySessionAsMain?: (sessionId: string) => void | Promise<void>;
  onHistoryDrawerSessionIdChange?: (sessionId: string | null) => void;
  onRefreshHistorySessions?: (scope: {
    repositoryPath: string;
    repositoryName: string;
  }) => void | Promise<void>;
  onStopEmployeeMonitor?: (employeeId: string) => void;
  onStopTeamMonitor?: (workflowId: string) => void;
  onOpenTeamMonitorDetail?: (workflowId: string) => void;
  onCancelSessionFromMonitor?: (sessionId: string) => void;
  onOpenOmcBatchInvocationDetail?: (input: {
    sessionId: string;
    repositoryPath: string;
    invocationKey: string;
  }) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  /** 归档会话：从侧栏列表移除（保留磁盘历史，可从历史会话恢复）。 */
  onArchiveSession?: (sessionId: string) => void;
};

function activateSession(
  sessionId: string,
  props: Pick<
    RepositoryWorkspaceSessionTreeProps,
    "onSelectSession" | "onRestoreHistorySessionAsMain" | "onHistoryDrawerSessionIdChange"
  >,
) {
  if (props.onRestoreHistorySessionAsMain) {
    void props.onRestoreHistorySessionAsMain(sessionId);
    return;
  }
  if (props.onSelectSession) {
    props.onSelectSession(sessionId);
    return;
  }
  props.onHistoryDrawerSessionIdChange?.(sessionId);
}

function RepositoryWorkspaceSessionTreeInner(props: RepositoryWorkspaceSessionTreeProps) {
  const {
    repositoryPath,
    repositoryName,
    sessions,
    activeSessionId,
    showRunItems = true,
  } = props;
  const [rowLimit, setRowLimit] = useState(WORKSPACE_SIDEBAR_ROW_PREVIEW_LIMIT);

  const allRows = useMemo(
    () =>
      buildWorkspaceSidebarTreeRows({
        sessions,
        repositoryPath,
        showRunItems,
        employeeMonitorItems: props.employeeMonitorItems,
        sessionConversationTaskItems: props.sessionConversationTaskItems,
        teamMonitorItems: props.teamMonitorItems,
      }),
    [
      sessions,
      repositoryPath,
      showRunItems,
      props.employeeMonitorItems,
      props.sessionConversationTaskItems,
      props.teamMonitorItems,
    ],
  );

  const visibleRows = allRows.slice(0, rowLimit);
  const hasMoreRows = allRows.length > rowLimit;
  const hasAny = allRows.length > 0;

  const handleMore = () => {
    void props.onRefreshHistorySessions?.({
      repositoryPath,
      repositoryName,
    });
    setRowLimit((prev) => prev + WORKSPACE_SIDEBAR_ROW_MORE_STEP);
  };

  if (!hasAny) {
    return (
      <div className="app-repository-sessions app-workspace-session-tree" aria-label="会话与运行">
        <div className="app-workspace-session-tree__empty">暂无会话</div>
      </div>
    );
  }

  return (
    <div className="app-repository-sessions app-workspace-session-tree" aria-label="会话与运行">
      {visibleRows.map((row) => {
        if (row.kind === "employee") {
          const item = row.item;
          const running = item.status === "in_progress";
          return (
            <button
              key={`emp:${item.employeeId}`}
              type="button"
              className={`app-workspace-session-tree__row${running ? " app-workspace-session-tree__row--running" : ""}`}
              onClick={() => {
                const sid = item.sessionId?.trim();
                if (sid) {
                  props.onHistoryDrawerSessionIdChange?.(sid);
                  return;
                }
              }}
            >
              <span className="app-workspace-session-tree__kind" data-kind="terminal">
                终端
              </span>
              <span className="app-workspace-session-tree__title" title={item.name}>
                {item.name}
              </span>
              {running ? <span className="app-workspace-session-tree__dot" aria-label="运行中" /> : null}
              <span className="app-workspace-session-tree__time">
                {formatWorkspaceSidebarRelativeTime(item.updatedAt)}
              </span>
              {running && props.onStopEmployeeMonitor ? (
                <span
                  className="app-workspace-session-tree__stop"
                  role="button"
                  tabIndex={0}
                  aria-label="结束终端"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onStopEmployeeMonitor?.(item.employeeId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onStopEmployeeMonitor?.(item.employeeId);
                  }}
                >
                  停止
                </span>
              ) : null}
            </button>
          );
        }

        if (row.kind === "dispatch") {
          const item = row.item;
          const running = item.status === "running";
          const canStop = canStopSessionConversationTask(item, {
            onCancelSession: props.onCancelSessionFromMonitor,
            onCancelOmcDirectBatchInvocation: props.onCancelOmcDirectBatchInvocation,
            onStopSessionConversationTask: props.onStopSessionConversationTask,
          });
          return (
            <button
              key={`dispatch:${item.key}`}
              type="button"
              className={`app-workspace-session-tree__row${running ? " app-workspace-session-tree__row--running" : ""}`}
              onClick={() => {
                if (item.invocationKey && item.sessionId && item.repositoryPath) {
                  props.onOpenOmcBatchInvocationDetail?.({
                    sessionId: item.sessionId,
                    repositoryPath: item.repositoryPath,
                    invocationKey: item.invocationKey,
                  });
                  return;
                }
                const sid = item.sessionId?.trim();
                if (sid) props.onHistoryDrawerSessionIdChange?.(sid);
              }}
            >
              <span className="app-workspace-session-tree__kind" data-kind="dispatch">
                派发
              </span>
              <span className="app-workspace-session-tree__title" title={item.label}>
                {item.label}
              </span>
              {running ? <span className="app-workspace-session-tree__dot" aria-label="运行中" /> : null}
              <span className="app-workspace-session-tree__time">
                {formatWorkspaceSidebarRelativeTime(item.updatedAt)}
              </span>
              {canStop ? (
                <span
                  className="app-workspace-session-tree__stop"
                  role="button"
                  tabIndex={0}
                  aria-label="停止派发"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (props.onStopSessionConversationTask) {
                      props.onStopSessionConversationTask(item);
                      return;
                    }
                    if (item.cancelMode === "invocation" && item.invocationKey) {
                      props.onCancelOmcDirectBatchInvocation?.(item.invocationKey);
                      return;
                    }
                    const sid = item.sessionId?.trim();
                    if (sid) props.onCancelSessionFromMonitor?.(sid);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onStopSessionConversationTask?.(item);
                  }}
                >
                  停止
                </span>
              ) : null}
            </button>
          );
        }

        if (row.kind === "team") {
          const item = row.item;
          const running = item.status === "in_progress";
          return (
            <button
              key={`team:${item.workflowId}`}
              type="button"
              className={`app-workspace-session-tree__row${running ? " app-workspace-session-tree__row--running" : ""}`}
              onClick={() => props.onOpenTeamMonitorDetail?.(item.workflowId)}
            >
              <span className="app-workspace-session-tree__kind" data-kind="workflow">
                工作流
              </span>
              <span className="app-workspace-session-tree__title" title={item.workflowName}>
                {item.workflowName}
              </span>
              {running ? <span className="app-workspace-session-tree__dot" aria-label="运行中" /> : null}
              <span className="app-workspace-session-tree__time">
                {formatWorkspaceSidebarRelativeTime(item.updatedAt)}
              </span>
              {running && props.onStopTeamMonitor ? (
                <span
                  className="app-workspace-session-tree__stop"
                  role="button"
                  tabIndex={0}
                  aria-label="停止工作流"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onStopTeamMonitor?.(item.workflowId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onStopTeamMonitor?.(item.workflowId);
                  }}
                >
                  停止
                </span>
              ) : null}
            </button>
          );
        }

        const session = row.item;
        const title = getSessionPreview(session);
        const updatedAt = workspaceSidebarSessionUpdatedAt(session);
        const isActive = session.id === activeSessionId;
        const running = session.status === "running" || session.status === "connecting";
        return (
          <button
            key={`session:${session.id}`}
            type="button"
            className={`app-workspace-session-tree__row${isActive ? " app-workspace-session-tree__row--active" : ""}${running ? " app-workspace-session-tree__row--running" : ""}`}
            onClick={() => activateSession(session.id, props)}
          >
            <span className="app-workspace-session-tree__title" title={title}>
              {title}
            </span>
            {running ? <span className="app-workspace-session-tree__dot" aria-label="运行中" /> : null}
            <span className="app-workspace-session-tree__meta">
              <span className="app-workspace-session-tree__time">
                {formatWorkspaceSidebarRelativeTime(updatedAt)}
              </span>
              {props.onArchiveSession ? (
                <span
                  className="app-workspace-session-tree__archive"
                  role="button"
                  tabIndex={0}
                  aria-label="归档会话"
                  title="归档"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onArchiveSession?.(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    props.onArchiveSession?.(session.id);
                  }}
                >
                  归档
                </span>
              ) : null}
            </span>
          </button>
        );
      })}

      {hasMoreRows ? (
        <button type="button" className="app-workspace-session-tree__more" onClick={handleMore}>
          More
        </button>
      ) : null}
    </div>
  );
}

export const RepositoryWorkspaceSessionTree = memo(RepositoryWorkspaceSessionTreeInner);
