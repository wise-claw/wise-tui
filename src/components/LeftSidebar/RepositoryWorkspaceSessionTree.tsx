import { memo, useEffect, useMemo, useState } from "react";
import type {
  ClaudeSession,
  EmployeeMonitorItem,
  SessionConversationTaskItem,
  TeamMonitorItem,
} from "../../types";
import { useWorkspaceSidebarRowPreviewLimit } from "../../hooks/useWorkspaceSidebarRowPreviewLimit";
import { useMinuteTick } from "../../stores/minuteTickStore";
import { getSessionPreview } from "../ProgressMonitorPanel/historySessionDrawerChrome";
import { canStopSessionConversationTask } from "../../utils/sessionConversationTasks";
import {
  WORKSPACE_SIDEBAR_ROW_MORE_STEP,
  buildWorkspaceSidebarTreeRows,
  formatWorkspaceSidebarRelativeTime,
  workspaceSidebarSessionUpdatedAt,
} from "../../utils/repositoryWorkspaceTree";
import { WorkspaceSessionRowStatusSlot } from "./WorkspaceSessionRowStatus";
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
  // 侧栏会话行：优先切到会话窗口（含执行环境 worker）。
  // restore-as-main 仅作无 onSelectSession 时的兜底（会改主会话绑定，不适合 worker）。
  console.log("[wise-2click] activateSession", {
    sessionId,
    hasOnSelectSession: Boolean(props.onSelectSession),
    hasRestore: Boolean(props.onRestoreHistorySessionAsMain),
  });
  if (props.onSelectSession) {
    props.onSelectSession(sessionId);
    return;
  }
  if (props.onRestoreHistorySessionAsMain) {
    void props.onRestoreHistorySessionAsMain(sessionId);
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
  const previewLimit = useWorkspaceSidebarRowPreviewLimit();
  const [rowLimit, setRowLimit] = useState(previewLimit);

  useEffect(() => {
    setRowLimit(previewLimit);
  }, [previewLimit, repositoryPath]);

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

  // 行内相对时间在渲染期计算，需分钟级心跳推动，否则会一直停在首次渲染的值。
  useMinuteTick();

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
              <WorkspaceSessionRowStatusSlot liveStatus={item.status} />
              <span className="app-workspace-session-tree__kind" data-kind="terminal">
                终端
              </span>
              <span className="app-workspace-session-tree__title" title={item.name}>
                {item.name}
              </span>
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
                if (!sid) return;
                // 执行环境派发：打开会话窗口，不再进历史 drawer。
                if (props.onSelectSession) {
                  props.onSelectSession(sid);
                  return;
                }
                props.onHistoryDrawerSessionIdChange?.(sid);
              }}
            >
              <WorkspaceSessionRowStatusSlot liveStatus={item.status} />
              <span className="app-workspace-session-tree__kind" data-kind="dispatch">
                派发
              </span>
              <span className="app-workspace-session-tree__title" title={item.label}>
                {item.label}
              </span>
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
              <WorkspaceSessionRowStatusSlot liveStatus={item.status} />
              <span className="app-workspace-session-tree__kind" data-kind="workflow">
                工作流
              </span>
              <span className="app-workspace-session-tree__title" title={item.workflowName}>
                {item.workflowName}
              </span>
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
            <WorkspaceSessionRowStatusSlot liveStatus={session.status} />
            <span className="app-workspace-session-tree__title" title={title}>
              {title}
            </span>
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
