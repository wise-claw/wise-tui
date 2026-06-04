import { Button, Drawer, Empty, Tag } from "antd";
import { memo, useMemo, useRef } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import {
  buildSessionConversationTaskDetailSession,
  canStopSessionConversationTask,
  sessionConversationTaskStatusLabel,
} from "../../utils/sessionConversationTasks";
import { resolveMonitorSessionRepoShortLabel } from "./monitorSessionDisplay";
import { ClaudeVirtualMessageList } from "../ClaudeSessions/ClaudeVirtualMessageList";
import { HistorySessionDrawerContextBar } from "./historySessionDrawerChrome";
import {
  MonitorDrawerSessionComposer,
  type MonitorDrawerResumeSessionFn,
} from "./MonitorDrawerSessionComposer";
import { SubagentStatusIndicator } from "./SubagentStatusIndicator";
import "../ClaudeSessions/index.css";
import "./index.css";

export interface SessionConversationTaskDetailTarget {
  task: SessionConversationTaskItem;
}

function taskStatusTagColor(status: SessionConversationTaskItem["status"]): string {
  if (status === "running") return "processing";
  if (status === "failed") return "error";
  return "success";
}

export const SessionConversationTaskDetailDrawer = memo(function SessionConversationTaskDetailDrawer({
  target,
  sessions,
  sessionConversationTaskItems,
  onClose,
  onStopTask,
  onCancelSession,
  onCancelOmcDirectBatchInvocation,
  onStopSessionConversationTask,
  onResumeSession,
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
}) {
  const width = Math.min(760, typeof window !== "undefined" ? window.innerWidth - 40 : 760);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const task = useMemo(() => {
    if (!target?.task) return null;
    return sessionConversationTaskItems?.find((item) => item.key === target.task.key) ?? target.task;
  }, [sessionConversationTaskItems, target]);

  const session = useMemo(() => {
    const sid = task?.sessionId?.trim();
    if (!sid) return null;
    const hit = sessions.find((row) => row.id === sid || row.claudeSessionId?.trim() === sid);
    if (hit) return hit;
    if (task?.source === "execution_environment" && task.repositoryPath?.trim()) {
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
    return null;
  }, [sessions, task]);

  const transcriptSession = useMemo(
    () => (session && task ? buildSessionConversationTaskDetailSession(session, task, sessions) : null),
    [session, task, sessions],
  );

  const canStop = task
    ? canStopSessionConversationTask(task, {
        onCancelSession,
        onCancelOmcDirectBatchInvocation,
        onStopSessionConversationTask,
      })
    : false;

  const sessionResolvableForResume = useMemo(() => {
    const sid = task?.sessionId?.trim();
    if (!sid) return false;
    return sessions.some((row) => row.id === sid || row.claudeSessionId?.trim() === sid);
  }, [sessions, task]);

  const resumeDisabledReason = session && !sessionResolvableForResume
    ? "执行会话尚未就绪或已结束，暂无法继续"
    : null;

  return (
    <Drawer
      title={
        task
          ? task.source === "execution_environment"
            ? `${task.label} · 执行会话`
            : `${task.label} · 会话记录`
          : "会话记录"
      }
      placement="right"
      size={width}
      open={target !== null}
      onClose={onClose}
      destroyOnHidden
      classNames={{
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
      {!task || !session ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={task?.source === "execution_environment" ? "无执行会话记录" : "无子代理记录"}
        />
      ) : (
        <div className="app-monitor-panel__subagent-detail">
          <div className="app-monitor-panel__history-session-drawer-inner">
            <HistorySessionDrawerContextBar
              session={session}
              updatedAtMs={task.source === "execution_environment" ? task.updatedAt : undefined}
            />
            {task.status === "running" ? (
              <div className="app-monitor-panel__subagent-detail-hint">
                <span className="app-monitor-panel__subagent-detail-hint-dot" />
                <span>
                  {task.source === "execution_environment"
                    ? "执行会话进行中，消息将随对话流式更新…"
                    : "子代理正在执行，内容随对话流式更新中..."}
                </span>
              </div>
            ) : null}
            <div
              ref={messagesScrollRef}
              className="app-monitor-panel__history-session-drawer-scroll app-monitor-panel__subagent-detail-drawer-scroll"
            >
              {transcriptSession && transcriptSession.messages.length > 0 ? (
                <div className="app-monitor-panel__subagent-detail-messages">
                  <ClaudeVirtualMessageList
                    session={transcriptSession}
                    showListEndThinkingHint={false}
                    scrollContainerRef={messagesScrollRef}
                    listVariant="chat"
                    sessionsForDispatchLookup={sessions}
                  />
                </div>
              ) : (
                <div className="app-claude-messages-empty">
                  <p>
                    {task.source === "execution_environment" ? "暂无执行会话消息" : "暂无执行输出"}
                  </p>
                </div>
              )}
            </div>
            <MonitorDrawerSessionComposer
              session={session}
              onResumeSession={onResumeSession}
              disabledReason={resumeDisabledReason}
            />
          </div>
        </div>
      )}
    </Drawer>
  );
});
