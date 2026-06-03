import { Button, Collapse, Drawer, Empty, Tag, Typography } from "antd";
import { memo, useMemo } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import {
  buildSessionConversationTaskDetailSession,
  canStopSessionConversationTask,
  findMergedToolUseInSession,
  sessionConversationTaskStatusLabel,
} from "../../utils/sessionConversationTasks";
import { ClaudeSessionMessagesColumn } from "../ClaudeSessions/ClaudeSessionMessagesColumn";
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
  const task = useMemo(() => {
    if (!target?.task) return null;
    return sessionConversationTaskItems?.find((item) => item.key === target.task.key) ?? target.task;
  }, [sessionConversationTaskItems, target]);

  const session = useMemo(() => {
    const sid = task?.sessionId?.trim();
    if (!sid) return null;
    return sessions.find((row) => row.id === sid || row.claudeSessionId?.trim() === sid) ?? null;
  }, [sessions, task]);

  const transcriptSession = useMemo(
    () => (session && task ? buildSessionConversationTaskDetailSession(session, task) : null),
    [session, task],
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
      title={task ? `${task.label} · 会话记录` : "会话记录"}
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
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无子代理记录" />
      ) : (
        <div className="app-monitor-panel__subagent-detail">
          {task.status === "running" ? (
            <div className="app-monitor-panel__subagent-detail-hint">
              <span className="app-monitor-panel__subagent-detail-hint-dot" />
              <span>子代理正在执行，内容随对话流式更新中...</span>
            </div>
          ) : null}
          <div className="app-monitor-panel__subagent-detail-session">
            {transcriptSession && transcriptSession.messages.length > 0 ? (
              <ClaudeSessionMessagesColumn session={transcriptSession} showAllMessages />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行输出" />
            )}
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
