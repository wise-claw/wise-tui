import { Button, Drawer, Empty, Spin, Tag } from "antd";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import { useDockSlice } from "../../hooks/useDockSlice";
import type { ComposerRegionProps } from "../ClaudeChatInput";
import { composerRegionChunk } from "../ClaudeSessions/ClaudeChatComposerTray";
import {
  buildSessionConversationTaskDetailSession,
  canStopSessionConversationTask,
  digestSessionConversationTaskTranscript,
  executionEnvironmentWorkerNeedsTranscriptHydration,
  sessionConversationTaskStatusLabel,
} from "../../utils/sessionConversationTasks";
import { isFeedbackLoopWorkerRepositoryName } from "../../utils/sessionFeedbackLoopDispatch";
import {
  findExecutionEnvironmentWorkerForTaskDetail,
  findSessionForMonitorDrawerResume,
} from "../../utils/sessionExecuteResolve";
import { resolveMonitorSessionRepoShortLabel } from "./monitorSessionDisplay";
import { ClaudeVirtualMessageList } from "../ClaudeSessions/ClaudeVirtualMessageList";
import { HistorySessionDrawerContextBar } from "./historySessionDrawerChrome";
import {
  type MonitorDrawerPrepareSessionFn,
  type MonitorDrawerResumeSessionFn,
} from "./MonitorDrawerSessionComposer";
import { SubagentStatusIndicator } from "./SubagentStatusIndicator";
import { useClaudeSessionsLiveSnapshot } from "../../stores/claudeSessionsLiveStore";
import { prefetchSessionConversationTaskDetailDrawer } from "./prefetchSessionConversationTaskDetailDrawer";
import "../ClaudeSessions/index.css";
import "./index.css";

/** 与主会话输入区共用同一 chunk；打开前预热可避免首点懒加载等待。 */
const ComposerRegionLazy = lazy(() =>
  composerRegionChunk.then((module) => ({ default: module.ComposerRegion })),
);

export { prefetchSessionConversationTaskDetailDrawer } from "./prefetchSessionConversationTaskDetailDrawer";

export interface SessionConversationTaskDetailTarget {
  task: SessionConversationTaskItem;
}

function taskStatusTagColor(status: SessionConversationTaskItem["status"]): string {
  if (status === "running") return "processing";
  if (status === "failed") return "error";
  return "success";
}

function resolveTaskSession(
  task: SessionConversationTaskItem,
  sessions: readonly ClaudeSession[],
): ClaudeSession | null {
  const sid = task.sessionId?.trim();
  if (!sid) return null;

  if (task.source === "execution_environment") {
    const found = findExecutionEnvironmentWorkerForTaskDetail(sessions, {
      workerSessionId: sid,
      repositoryPath: task.repositoryPath,
    });
    if (found) return found;
  } else if (task.source === "feedback_loop") {
    const found =
      sessions.find((item) => item.id === sid || item.claudeSessionId?.trim() === sid) ?? null;
    if (found && isFeedbackLoopWorkerRepositoryName(found.repositoryName)) return found;
  } else {
    const found = findSessionForMonitorDrawerResume(sessions, {
      sessionId: sid,
      repositoryPath: task.repositoryPath,
      taskLabel: task.label,
    });
    if (found) return found;
  }

  if (task.source !== "execution_environment" && task.source !== "feedback_loop") {
    return null;
  }

  if (!task.repositoryPath?.trim()) {
    return null;
  }

  const prompt = task.previewText?.replace(/\s+/g, " ").trim() || task.label;
  const repositoryPath = task.repositoryPath.trim();
  const stubForRepoLabel = {
    repositoryName: repositoryPath,
    repositoryPath,
  } as ClaudeSession;
  return {
    id: sid,
    claudeSessionId: null,
    repositoryPath,
    repositoryName: resolveMonitorSessionRepoShortLabel(stubForRepoLabel),
    model: "sonnet",
    status: task.status === "running" ? "running" : task.status === "failed" ? "error" : "completed",
    messages: prompt
      ? [
          {
            id: 1,
            role: "user",
            content: prompt,
            parts: [{ type: "text", text: prompt }],
            timestamp: task.updatedAt || Date.now(),
          },
        ]
      : [],
    createdAt: task.updatedAt || Date.now(),
    pendingPrompt: "",
  } satisfies ClaudeSession;
}

function sessionNeedsDiskTranscriptHydration(
  session: ClaudeSession,
  task?: SessionConversationTaskItem | null,
): boolean {
  if (task?.source === "execution_environment" || task?.source === "feedback_loop") {
    return executionEnvironmentWorkerNeedsTranscriptHydration(session);
  }
  if (session.status === "running" || session.status === "connecting") return false;
  if (!session.claudeSessionId?.trim()) return false;
  if (!session.transcriptMemoryUnlimited) return true;
  const hasAssistant = session.messages.some((msg) => msg.role === "assistant");
  return !hasAssistant;
}

const SessionConversationTaskDetailBody = memo(function SessionConversationTaskDetailBody({
  task,
  session,
  transcriptSession,
  resumeComposerSession,
  resumeContext,
  mountComposer,
  onResumeSession,
  onRespondToQuestion,
  onDismissQuestion,
  onRespondToPermission,
  onToggleTodo,
  onSendFollowup,
  onRestoreRevert,
  onClearFollowups,
  onClearRevertItems,
  onCancelSession,
}: {
  task: SessionConversationTaskItem;
  session: ClaudeSession;
  transcriptSession: ClaudeSession;
  resumeComposerSession: ClaudeSession | null;
  resumeContext: {
    sessionId: string;
    repositoryPath?: string;
    repositoryDisplayName?: string;
    taskLabel?: string;
  } | undefined;
  /** 抽屉壳先绘制后再挂载 Tiptap 输入区，缩短首开可见延迟。 */
  mountComposer: boolean;
  onResumeSession?: MonitorDrawerResumeSessionFn;
  onRespondToQuestion?: (sessionId: string, answers: string[], customAnswer?: string) => void;
  onDismissQuestion?: (sessionId: string) => void;
  onRespondToPermission?: (
    sessionId: string,
    response: "allow_once" | "allow_always" | "deny",
  ) => void;
  onToggleTodo?: (sessionId: string, todoId: string) => void;
  onSendFollowup?: (sessionId: string, id: string) => void;
  onRestoreRevert?: (sessionId: string, itemId: string) => void;
  onClearFollowups?: (sessionId: string) => void;
  onClearRevertItems?: (sessionId: string) => void;
  onCancelSession?: (sessionId: string) => void;
}) {
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const workerId = resumeComposerSession?.id?.trim() || "";
  const dockSlice = useDockSlice(workerId || null);

  const handleExecute = useCallback<NonNullable<ComposerRegionProps["onExecute"]>>(
    (sessionId, prompt, _consumePending, _dispatchTarget, _executeOptions) => {
      if (!onResumeSession) return;
      void onResumeSession({
        sessionId,
        prompt,
        repositoryPath: resumeContext?.repositoryPath ?? session.repositoryPath,
        repositoryDisplayName: resumeContext?.repositoryDisplayName ?? session.repositoryName,
        taskLabel: resumeContext?.taskLabel,
      });
    },
    [
      onResumeSession,
      resumeContext?.repositoryPath,
      resumeContext?.repositoryDisplayName,
      resumeContext?.taskLabel,
      session.repositoryPath,
      session.repositoryName,
    ],
  );

  // drawer 场景暂不支持切模型：worker 模型由派发时决定，这里保持 no-op。
  const handleSessionModelChange = useCallback(() => {}, []);

  const handleCancel = useCallback<NonNullable<ComposerRegionProps["onCancel"]>>(() => {
    if (workerId) onCancelSession?.(workerId);
  }, [onCancelSession, workerId]);

  return (
    <div className="app-monitor-panel__subagent-detail">
      <div className="app-monitor-panel__history-session-drawer-inner">
        <HistorySessionDrawerContextBar
          session={session}
          updatedAtMs={
            task.source === "execution_environment" || task.source === "feedback_loop"
              ? task.updatedAt
              : undefined
          }
        />
        {task.status === "running" ? (
          <div className="app-monitor-panel__subagent-detail-hint">
            <span className="app-monitor-panel__subagent-detail-hint-dot" />
            <span>
              {task.source === "execution_environment"
                ? "执行会话进行中，消息将随对话流式更新…"
                : task.source === "feedback_loop"
                  ? "反馈神经网 worker 执行中，消息将随对话流式更新…"
                  : "子代理正在执行，内容随对话流式更新中..."}
            </span>
          </div>
        ) : null}
        {task.source === "feedback_loop" && task.feedbackLoopComparisonScore != null ? (
          <div className="app-monitor-panel__subagent-detail-hint app-monitor-panel__subagent-detail-hint--score">
            <Tag
            variant="filled" color={task.feedbackLoopComparisonScore > 2 ? "success" : task.feedbackLoopComparisonScore < -2 ? "error" : "default"}
            >
              闭环比对得分 {task.feedbackLoopComparisonScore >= 0 ? "+" : ""}
              {task.feedbackLoopComparisonScore.toFixed(1)}
            </Tag>
          </div>
        ) : null}
        <div
          ref={messagesScrollRef}
          className="app-monitor-panel__history-session-drawer-scroll app-monitor-panel__subagent-detail-drawer-scroll"
        >
          {transcriptSession.messages.length > 0 ? (
            <div className="app-monitor-panel__subagent-detail-messages">
              <ClaudeVirtualMessageList
                session={transcriptSession}
                showListEndThinkingHint={false}
                scrollContainerRef={messagesScrollRef}
                listVariant="chat"
              />
            </div>
          ) : (
            <div className="app-claude-messages-empty">
              <p>
                {task.source === "execution_environment"
                  ? "暂无执行会话消息"
                  : task.source === "feedback_loop"
                    ? "暂无神经网 worker 消息"
                    : "暂无执行输出"}
              </p>
            </div>
          )}
        </div>
        {onResumeSession && resumeComposerSession ? (
          <div className="app-monitor-panel__drawer-composer">
            {mountComposer ? (
              <Suspense
                fallback={
                  <div
                    className="app-claude-composer-tray__loading"
                    aria-busy="true"
                    aria-label="输入区加载中"
                  >
                    <Spin size="small" />
                  </div>
                }
              >
                <ComposerRegionLazy
                  session={resumeComposerSession}
                  draftBucketKey={`monitor-drawer:${task.key}`}
                  onExecute={handleExecute}
                  onSessionModelChange={handleSessionModelChange}
                  onCancel={handleCancel}
                  allowSendWhileBusy
                  compactFooterChrome
                  todos={dockSlice.todos}
                  questionRequest={dockSlice.questionRequest}
                  questionRequestStatus={dockSlice.questionRequestStatus}
                  questionRequestError={dockSlice.questionRequestError}
                  permissionRequest={dockSlice.permissionRequest}
                  permissionRequestStatus={dockSlice.permissionRequestStatus}
                  permissionRequestError={dockSlice.permissionRequestError}
                  followupItems={dockSlice.followupItems}
                  revertItems={dockSlice.revertItems}
                  respondQuestionAt={
                    onRespondToQuestion ?? ((_sid: string, _answers: string[]) => {})
                  }
                  dismissQuestionAt={onDismissQuestion ?? ((_sid: string) => {})}
                  onRespondToPermission={(response) => {
                    if (workerId) void onRespondToPermission?.(workerId, response);
                  }}
                  onToggleTodo={(todoId) => {
                    if (workerId) void onToggleTodo?.(workerId, todoId);
                  }}
                  onSendFollowup={(id) => {
                    if (workerId) void onSendFollowup?.(workerId, id);
                  }}
                  onRestoreRevert={(id) => {
                    if (workerId) void onRestoreRevert?.(workerId, id);
                  }}
                  onClearFollowups={() => {
                    if (workerId) void onClearFollowups?.(workerId);
                  }}
                  onClearRevertItems={() => {
                    if (workerId) void onClearRevertItems?.(workerId);
                  }}
                />
              </Suspense>
            ) : (
              <div
                className="app-claude-composer-tray__loading"
                aria-busy="true"
                aria-label="输入区加载中"
              >
                <Spin size="small" />
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

function SessionConversationTaskDetailDrawerInner({
  target,
  sessions: sessionsProp,
  sessionConversationTaskItems,
  onClose,
  onStopTask,
  onCancelSession,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
  onResumeSession,
  onReloadFullDiskTranscript,
  onPrepareSessionForMonitorDrawer,
  onRespondToQuestion,
  onDismissQuestion,
  onRespondToPermission,
  onToggleTodo,
  onSendFollowup,
  onRestoreRevert,
  onClearFollowups,
  onClearRevertItems,
}: {
  target: SessionConversationTaskDetailTarget | null;
  sessions: readonly ClaudeSession[];
  sessionConversationTaskItems?: readonly SessionConversationTaskItem[];
  onClose: () => void;
  onStopTask?: (task: SessionConversationTaskItem) => void;
  onCancelSession?: (sessionId: string) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
  onResumeSession?: MonitorDrawerResumeSessionFn;
  onReloadFullDiskTranscript?: (sessionKey: string) => void | Promise<void>;
  onPrepareSessionForMonitorDrawer?: MonitorDrawerPrepareSessionFn;
  onRespondToQuestion?: (sessionId: string, answers: string[], customAnswer?: string) => void;
  onDismissQuestion?: (sessionId: string) => void;
  onRespondToPermission?: (
    sessionId: string,
    response: "allow_once" | "allow_always" | "deny",
  ) => void;
  onToggleTodo?: (sessionId: string, todoId: string) => void;
  onSendFollowup?: (sessionId: string, id: string) => void;
  onRestoreRevert?: (sessionId: string, itemId: string) => void;
  onClearFollowups?: (sessionId: string) => void;
  onClearRevertItems?: (sessionId: string) => void;
}) {
  const open = target !== null;
  // 抽屉自行订阅 live sessions，避免打开时把整个运行面板拖进 live 订阅重绘。
  const liveSessions = useClaudeSessionsLiveSnapshot(open);
  const sessions = open && liveSessions.length > 0 ? liveSessions : sessionsProp;

  const width = Math.min(760, typeof window !== "undefined" ? window.innerWidth - 40 : 760);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const hydrateInFlightRef = useRef(false);
  const [mountComposer, setMountComposer] = useState(false);

  const task = useMemo(() => {
    if (!target?.task) return null;
    return sessionConversationTaskItems?.find((item) => item.key === target.task.key) ?? target.task;
  }, [sessionConversationTaskItems, target]);

  const session = useMemo(() => (task ? resolveTaskSession(task, sessions) : null), [sessions, task]);

  const transcriptSession = useMemo(
    () => (session && task ? buildSessionConversationTaskDetailSession(session, task, sessions) : null),
    [session, task, sessions],
  );

  const openTaskKey = target?.task.key ?? null;

  const transcriptDigest = useMemo(
    () => (task && session ? digestSessionConversationTaskTranscript(task, session) : ""),
    [task, session],
  );

  useEffect(() => {
    hydrateInFlightRef.current = false;
  }, [openTaskKey]);

  useEffect(() => {
    if (!open) {
      setMountComposer(false);
      return;
    }
    prefetchSessionConversationTaskDetailDrawer();
    let cancelled = false;
    let outerRaf = 0;
    let innerRaf = 0;
    outerRaf = window.requestAnimationFrame(() => {
      innerRaf = window.requestAnimationFrame(() => {
        if (!cancelled) setMountComposer(true);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(outerRaf);
      window.cancelAnimationFrame(innerRaf);
    };
  }, [open, openTaskKey]);

  useEffect(() => {
    if (!openTaskKey || !task) {
      return;
    }

    const workerKey = task.sessionId?.trim();
    if (!workerKey) return;

    const resolveLive = () => resolveTaskSession(task, sessionsRef.current);

    const live = resolveLive();
    if (live && !sessionNeedsDiskTranscriptHydration(live, task)) {
      return;
    }

    if (hydrateInFlightRef.current) return;

    let cancelled = false;
    hydrateInFlightRef.current = true;

    void (async () => {
      try {
        let prepared =
          findExecutionEnvironmentWorkerForTaskDetail(sessionsRef.current, {
            workerSessionId: workerKey,
            repositoryPath: task.repositoryPath,
          }) ?? null;

        if (onPrepareSessionForMonitorDrawer && (!prepared || !prepared.claudeSessionId?.trim())) {
          prepared = await onPrepareSessionForMonitorDrawer({
            sessionId: workerKey,
            repositoryPath: task.repositoryPath,
            repositoryDisplayName: session?.repositoryName,
            taskLabel: task.label,
          });
        }

        if (cancelled) return;

        const afterPrepare = prepared ?? resolveLive();
        if (!afterPrepare) return;

        if (onReloadFullDiskTranscript && sessionNeedsDiskTranscriptHydration(afterPrepare, task)) {
          await onReloadFullDiskTranscript(afterPrepare.id);
        }
      } finally {
        hydrateInFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    openTaskKey,
    task,
    transcriptDigest,
    session?.repositoryName,
    onReloadFullDiskTranscript,
    onPrepareSessionForMonitorDrawer,
  ]);

  const canStop = task
    ? canStopSessionConversationTask(task, {
        onCancelSession,
        onCancelOmcDirectBatchInvocation,
        onStopSessionConversationTask,
      })
    : false;

  const resumeComposerSession = useMemo(() => {
    if (!session || !task) return session;
    const workerId = task.sessionId?.trim();
    if (task.source !== "execution_environment" || !workerId) return session;
    const live =
      findExecutionEnvironmentWorkerForTaskDetail(sessions, {
        workerSessionId: workerId,
        repositoryPath: task.repositoryPath,
      }) ?? session;
    return live.id === workerId ? live : { ...live, id: workerId };
  }, [session, task, sessions]);

  const resumeContext = useMemo(() => {
    const workerId = task?.sessionId?.trim();
    if (!workerId) return undefined;
    return {
      sessionId: workerId,
      repositoryPath: task?.repositoryPath,
      repositoryDisplayName: session?.repositoryName,
      taskLabel: task?.label,
    };
  }, [session?.repositoryName, task]);

  return (
    <Drawer
      title={
        <span className="app-monitor-panel__history-drawer-headline">
          {task
            ? task.source === "execution_environment"
              ? `${task.label} · 执行会话`
              : `${task.label} · 会话记录`
            : "会话记录"}
        </span>
      }
      placement="right"
      size={width}
      open={open}
      onClose={onClose}
      destroyOnHidden
      classNames={{
        header: "app-monitor-panel__history-session-drawer-header",
        body: "app-monitor-panel__history-session-drawer-body app-monitor-panel__subagent-detail-drawer-body",
      }}
      extra={
        task ? (
          <span className="app-monitor-panel__subagent-detail-drawer-extra">
            {canStop && onStopTask && task ? (
              <Button
                size="small"
                danger
                onClick={() => onStopTask(task)}
              >
                结束执行
              </Button>
            ) : null}
            <SubagentStatusIndicator status={task.status} />
            <Tag color={taskStatusTagColor(task.status)}>{sessionConversationTaskStatusLabel(task.status)}</Tag>
          </span>
        ) : null
      }
    >
      {!task || !session || !transcriptSession ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={task?.source === "execution_environment" ? "无执行会话记录" : "无子代理记录"}
        />
      ) : (
        <SessionConversationTaskDetailBody
          task={task}
          session={session}
          transcriptSession={transcriptSession}
          resumeComposerSession={resumeComposerSession}
          resumeContext={resumeContext}
          mountComposer={mountComposer}
          onResumeSession={onResumeSession}
          onRespondToQuestion={onRespondToQuestion}
          onDismissQuestion={onDismissQuestion}
          onRespondToPermission={onRespondToPermission}
          onToggleTodo={onToggleTodo}
          onSendFollowup={onSendFollowup}
          onRestoreRevert={onRestoreRevert}
          onClearFollowups={onClearFollowups}
          onClearRevertItems={onClearRevertItems}
          onCancelSession={onCancelSession}
        />
      )}
    </Drawer>
  );
}

export const SessionConversationTaskDetailDrawer = memo(SessionConversationTaskDetailDrawerInner);
