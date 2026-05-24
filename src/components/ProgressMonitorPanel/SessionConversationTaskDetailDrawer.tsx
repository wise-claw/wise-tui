import { Collapse, Descriptions, Drawer, Empty, Tag, Typography } from "antd";
import { memo, useMemo } from "react";
import type { ClaudeSession, SessionConversationTaskItem } from "../../types";
import {
  buildSessionConversationTaskDetailSession,
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
  onClose,
}: {
  target: SessionConversationTaskDetailTarget | null;
  sessions: readonly ClaudeSession[];
  onClose: () => void;
}) {
  const width = Math.min(760, typeof window !== "undefined" ? window.innerWidth - 40 : 760);
  const task = target?.task ?? null;

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

  return (
    <Drawer
      title={task ? `${task.label} · 子代理执行` : "子代理执行详情"}
      placement="right"
      size={width}
      open={target !== null}
      onClose={onClose}
      destroyOnHidden
      classNames={{ body: "app-monitor-panel__subagent-detail-drawer-body" }}
      extra={
        task ? (
          <span className="app-monitor-panel__subagent-detail-drawer-extra">
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
            <Typography.Text type="secondary" className="app-monitor-panel__subagent-detail-hint">
              子代理仍在执行中，下方内容会随对话流式更新。
            </Typography.Text>
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
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="名称">{task.label}</Descriptions.Item>
                      {task.subtitle ? <Descriptions.Item label="类型">{task.subtitle}</Descriptions.Item> : null}
                      <Descriptions.Item label="来源">{sourceLabel(task.source)}</Descriptions.Item>
                      <Descriptions.Item label="仓库">{session.repositoryName || "—"}</Descriptions.Item>
                      <Descriptions.Item label="会话 id">
                        <Typography.Text code copyable={{ text: session.id }}>
                          {compactId(session.id)}
                        </Typography.Text>
                      </Descriptions.Item>
                      {task.toolUseId ? (
                        <Descriptions.Item label="tool_use id">
                          <Typography.Text code copyable={{ text: task.toolUseId }}>
                            {compactId(task.toolUseId)}
                          </Typography.Text>
                        </Descriptions.Item>
                      ) : null}
                      {task.invocationKey ? (
                        <Descriptions.Item label="invocation key">
                          <Typography.Text code copyable={{ text: task.invocationKey }}>
                            {compactId(task.invocationKey)}
                          </Typography.Text>
                        </Descriptions.Item>
                      ) : null}
                      {toolPart?.name ? <Descriptions.Item label="工具">{toolPart.name}</Descriptions.Item> : null}
                    </Descriptions>

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
