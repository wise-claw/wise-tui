import { Button, Collapse, Drawer, Empty, Tag, Typography } from "antd";
import { memo, useMemo, useRef } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import {
  buildSessionConversationTaskDetailSession,
  canStopSessionConversationTask,
  findMergedToolUseInSession,
  sessionConversationTaskStatusLabel,
} from "../../utils/sessionConversationTasks";
import { ClaudeVirtualMessageList } from "../ClaudeSessions/ClaudeVirtualMessageList";
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

function sourceLabel(source: SessionConversationTaskItem["source"]): string {
  if (source === "message_tool") return "对话工具";
  if (source === "invocation_stream") return "后台流式";
  if (source === "execution_environment") return "执行环境派发";
  return "后台快照";
}

function compactId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) return "—";
  if (normalized.length <= 18) return normalized;
  return `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
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
}: {
  target: SessionConversationTaskDetailTarget | null;
  sessions: readonly ClaudeSession[];
  sessionConversationTaskItems?: readonly SessionConversationTaskItem[];
  onClose: () => void;
  onStopTask?: (task: SessionConversationTaskItem) => void;
  onCancelSession?: (sessionId: string) => void;
  onCancelOmcDirectBatchInvocation?: (invocationKey: string) => void;
  onStopSessionConversationTask?: (item: SessionConversationTaskItem) => void;
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
      return {
        id: sid,
        claudeSessionId: null,
        repositoryPath: task.repositoryPath.trim(),
        repositoryName: task.subtitle?.trim() || "执行环境",
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

  const toolPart = useMemo(() => {
    if (!session || !task?.toolUseId?.trim()) return null;
    return findMergedToolUseInSession(session.messages, task.toolUseId);
  }, [session, task]);

  const canStop = task
    ? canStopSessionConversationTask(task, {
        onCancelSession,
        onCancelOmcDirectBatchInvocation,
        onStopSessionConversationTask,
      })
    : false;

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
      classNames={{ body: "app-monitor-panel__subagent-detail-drawer-body" }}
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
          <div className="app-claude-chat app-monitor-panel__subagent-detail-session app-monitor-panel__subagent-detail-session--chat-layout">
            <div ref={messagesScrollRef} className="app-claude-messages">
              {transcriptSession && transcriptSession.messages.length > 0 ? (
                <ClaudeVirtualMessageList
                  session={transcriptSession}
                  showListEndThinkingHint={false}
                  scrollContainerRef={messagesScrollRef}
                  listVariant="chat"
                  sessionsForDispatchLookup={sessions}
                />
              ) : (
                <div className="app-claude-messages-empty">
                  <p>
                    {task.source === "execution_environment" ? "暂无执行会话消息" : "暂无执行输出"}
                  </p>
                </div>
              )}
            </div>
          </div>

          <Collapse
            size="small"
            ghost
            items={[
              {
                key: "metadata",
                label: "元数据",
                children: (
                  <>
                    <div className="app-monitor-panel__subagent-metadata-grid">
                      <div className="app-monitor-panel__subagent-metadata-item">
                        <span className="app-monitor-panel__subagent-metadata-label">名称</span>
                        <span className="app-monitor-panel__subagent-metadata-value" title={task.label}>
                          {task.label}
                        </span>
                      </div>
                      {task.subtitle ? (
                        <div className="app-monitor-panel__subagent-metadata-item">
                          <span className="app-monitor-panel__subagent-metadata-label">类型</span>
                          <span className="app-monitor-panel__subagent-metadata-value" title={task.subtitle}>
                            {task.subtitle}
                          </span>
                        </div>
                      ) : null}
                      <div className="app-monitor-panel__subagent-metadata-item">
                        <span className="app-monitor-panel__subagent-metadata-label">来源</span>
                        <span className="app-monitor-panel__subagent-metadata-value">
                          {sourceLabel(task.source)}
                        </span>
                      </div>
                      <div className="app-monitor-panel__subagent-metadata-item">
                        <span className="app-monitor-panel__subagent-metadata-label">仓库</span>
                        <span className="app-monitor-panel__subagent-metadata-value" title={session.repositoryName || ""}>
                          {session.repositoryName || "—"}
                        </span>
                      </div>
                      <div className="app-monitor-panel__subagent-metadata-item">
                        <span className="app-monitor-panel__subagent-metadata-label">会话 ID</span>
                        <span className="app-monitor-panel__subagent-metadata-value">
                          <Typography.Text code copyable={{ text: session.id }} className="app-monitor-panel__subagent-metadata-code">
                            {compactId(session.id)}
                          </Typography.Text>
                        </span>
                      </div>
                      {task.toolUseId ? (
                        <div className="app-monitor-panel__subagent-metadata-item">
                          <span className="app-monitor-panel__subagent-metadata-label">Tool Use ID</span>
                          <span className="app-monitor-panel__subagent-metadata-value">
                            <Typography.Text code copyable={{ text: task.toolUseId }} className="app-monitor-panel__subagent-metadata-code">
                              {compactId(task.toolUseId)}
                            </Typography.Text>
                          </span>
                        </div>
                      ) : null}
                      {task.invocationKey ? (
                        <div className="app-monitor-panel__subagent-metadata-item">
                          <span className="app-monitor-panel__subagent-metadata-label">Invocation Key</span>
                          <span className="app-monitor-panel__subagent-metadata-value">
                            <Typography.Text code copyable={{ text: task.invocationKey }} className="app-monitor-panel__subagent-metadata-code">
                              {compactId(task.invocationKey)}
                            </Typography.Text>
                          </span>
                        </div>
                      ) : null}
                      {toolPart?.name ? (
                        <div className="app-monitor-panel__subagent-metadata-item">
                          <span className="app-monitor-panel__subagent-metadata-label">对应工具</span>
                          <span className="app-monitor-panel__subagent-metadata-value" title={toolPart.name}>
                            {toolPart.name}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="app-monitor-panel__subagent-detail-section">
                      <Typography.Text strong className="app-monitor-panel__subagent-detail-section-title">
                        摘要
                      </Typography.Text>
                      <pre className="app-monitor-panel__subagent-detail-pre">{task.previewText || "—"}</pre>
                    </div>
                  </>
                ),
              },
            ]}
          />
        </div>
      )}
    </Drawer>
  );
});
