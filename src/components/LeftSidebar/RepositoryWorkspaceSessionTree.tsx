import { memo, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
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

const WORKSPACE_SESSION_ROW_NESTED_ACTION_SELECTOR =
  ".app-workspace-session-tree__stop, .app-workspace-session-tree__archive";

function isWorkspaceSessionRowNestedActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(WORKSPACE_SESSION_ROW_NESTED_ACTION_SELECTOR));
}

function activateSession(
  sessionId: string,
  props: Pick<
    RepositoryWorkspaceSessionTreeProps,
    "onSelectSession" | "onRestoreHistorySessionAsMain" | "onHistoryDrawerSessionIdChange"
  >,
) {
  // 侧栏会话行：优先切到会话窗口（含执行环境 worker）。
  // restore-as-main 仅作无 onSelectSession 时的兜底（会改主会话绑定，不适合 worker）。
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

/**
 * 主按钮在 pointerdown 激活（与 SessionQuickActionsBar 同模式）：
 * 焦点在 Composer 时，首次 click 常被失焦/重渲吞掉，导致要点两次。
 * preventDefault 会抑制随后的 click，故键盘仍走 onClick。
 */
function handleWorkspaceSessionRowPointerDown(
  event: ReactPointerEvent<HTMLButtonElement>,
  activate: () => void,
) {
  if (event.button !== 0) return;
  if (isWorkspaceSessionRowNestedActionTarget(event.target)) return;
  event.preventDefault();
  activate();
}

function handleNestedActionPointerDown(
  event: ReactPointerEvent<HTMLElement>,
  activate: () => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  activate();
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
          const openEmployee = () => {
            const sid = item.sessionId?.trim();
            if (sid) {
              props.onHistoryDrawerSessionIdChange?.(sid);
            }
          };
          return (
            <button
              key={`emp:${item.employeeId}`}
              type="button"
              className={`app-workspace-session-tree__row${running ? " app-workspace-session-tree__row--running" : ""}`}
              onPointerDown={(event) => handleWorkspaceSessionRowPointerDown(event, openEmployee)}
              onClick={openEmployee}
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
                  onPointerDown={(event) =>
                    handleNestedActionPointerDown(event, () => {
                      props.onStopEmployeeMonitor?.(item.employeeId);
                    })
                  }
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
          const openDispatch = () => {
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
          };
          const stopDispatch = () => {
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
          };
          return (
            <button
              key={`dispatch:${item.key}`}
              type="button"
              className={`app-workspace-session-tree__row${running ? " app-workspace-session-tree__row--running" : ""}`}
              onPointerDown={(event) => handleWorkspaceSessionRowPointerDown(event, openDispatch)}
              onClick={openDispatch}
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
                  onPointerDown={(event) => handleNestedActionPointerDown(event, stopDispatch)}
                  onClick={(event) => {
                    event.stopPropagation();
                    stopDispatch();
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
          const openTeam = () => props.onOpenTeamMonitorDetail?.(item.workflowId);
          return (
            <button
              key={`team:${item.workflowId}`}
              type="button"
              className={`app-workspace-session-tree__row${running ? " app-workspace-session-tree__row--running" : ""}`}
              onPointerDown={(event) => handleWorkspaceSessionRowPointerDown(event, openTeam)}
              onClick={openTeam}
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
                  onPointerDown={(event) =>
                    handleNestedActionPointerDown(event, () => {
                      props.onStopTeamMonitor?.(item.workflowId);
                    })
                  }
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
        const activeKey = activeSessionId?.trim() ?? "";
        const isActive =
          Boolean(activeKey) &&
          (session.id === activeKey || session.claudeSessionId?.trim() === activeKey);
        const running = session.status === "running" || session.status === "connecting";
        const openSession = () => activateSession(session.id, props);
        return (
          <button
            key={`session:${session.id}`}
            type="button"
            className={`app-workspace-session-tree__row${isActive ? " app-workspace-session-tree__row--active" : ""}${running ? " app-workspace-session-tree__row--running" : ""}`}
            onPointerDown={(event) => handleWorkspaceSessionRowPointerDown(event, openSession)}
            onClick={openSession}
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
                  onPointerDown={(event) =>
                    handleNestedActionPointerDown(event, () => {
                      props.onArchiveSession?.(session.id);
                    })
                  }
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
