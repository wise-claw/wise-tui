import { useState, useCallback } from "react";
import { Popover, Tag, Typography, Input, message } from "antd";
import {
  RobotOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SendOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import { useAgentAssignments } from "../../hooks/useAgentAssignments";
import {
  appendMissionInstruction,
  type MissionAgentAssignment,
} from "../../services/missionControlBackend";

interface AgentAssignmentsPanelProps {
  projectId?: string | null;
  collapsed?: boolean;
}

export function AgentAssignmentsPanel({
  projectId,
  collapsed = false,
}: AgentAssignmentsPanelProps) {
  const { running, queued } = useAgentAssignments({
    projectId,
    includeCompleted: false,
    pollIntervalMs: 5_000,
  });
  const [injectTarget, setInjectTarget] = useState<MissionAgentAssignment | null>(null);
  const [injectText, setInjectText] = useState("");
  const [injecting, setInjecting] = useState(false);

  const handleInject = useCallback(async () => {
    if (!injectTarget || !injectText.trim()) return;
    setInjecting(true);
    try {
      await appendMissionInstruction({
        missionId: injectTarget.missionId,
        targetKind: "cluster",
        targetId: injectTarget.clusterId ?? null,
        instruction: injectText.trim(),
      });
      setInjectTarget(null);
      setInjectText("");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "发送失败");
    } finally {
      setInjecting(false);
    }
  }, [injectTarget, injectText]);

  const all = [...running, ...queued].slice(0, collapsed ? 3 : 20);
  const total = running.length + queued.length;

  if (total === 0) return null;

  return (
    <div className="agent-assignments-panel">
      <div className="agent-assignments-panel__header">
        <RobotOutlined />
        <span className="agent-assignments-panel__title">
          活跃 Agent
        </span>
        <Tag style={{ fontSize: 10, fontWeight: 700, margin: 0 }}>
          {running.length} 运行 / {queued.length} 排队
        </Tag>
      </div>

      {injectTarget ? (
        <div className="agent-assignments-inject">
          <Input.TextArea
            size="small"
            rows={2}
            placeholder={`向 ${injectTarget.agentType} 注入指令…`}
            value={injectText}
            onChange={(e) => setInjectText(e.target.value)}
          />
          <div className="agent-assignments-inject__actions">
            <button
              type="button"
              className="agent-assignments-inject__send"
              disabled={!injectText.trim() || injecting}
              onClick={handleInject}
            >
              <SendOutlined /> {injecting ? "发送中…" : "发送"}
            </button>
            <button
              type="button"
              className="agent-assignments-inject__cancel"
              onClick={() => { setInjectTarget(null); setInjectText(""); }}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {collapsed ? null : (
        <div className="agent-assignments-panel__list">
          {all.map((a) => (
            <AgentAssignmentRow
              key={a.assignmentId}
              assignment={a}
              onInject={a.status === "running" ? () => setInjectTarget(a) : undefined}
            />
          ))}
          {all.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 11, padding: "8px 12px", display: "block" }}>
              当前无活跃子代理
            </Typography.Text>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AgentAssignmentRow({ assignment, onInject }: { assignment: MissionAgentAssignment; onInject?: () => void }) {
  const statusIcon =
    assignment.status === "running" ? (
      <SyncOutlined spin style={{ fontSize: 10, color: "var(--mission-info)" }} />
    ) : assignment.status === "stale" ? (
      <DisconnectOutlined style={{ fontSize: 10, color: "var(--mission-warning)" }} />
    ) : assignment.status === "completed" || assignment.status === "succeeded" ? (
      <CheckCircleOutlined style={{ fontSize: 10, color: "var(--mission-success)" }} />
    ) : assignment.status === "failed" ? (
      <CloseCircleOutlined style={{ fontSize: 10, color: "var(--mission-error)" }} />
    ) : (
      <ClockCircleOutlined style={{ fontSize: 10, color: "var(--mission-dim)" }} />
    );

  const repoName = assignment.repositoryPath?.split("/").pop() ?? "";
  const detail = [
    assignment.stage,
    repoName,
    assignment.currentFile?.split("/").pop(),
  ].filter(Boolean).join(" · ");

  return (
    <Popover
      key={assignment.assignmentId}
      trigger="hover"
      placement="right"
      content={
        <div style={{ minWidth: 200, fontSize: 12 }}>
          <div><strong>类型：</strong>{assignment.agentType}</div>
          <div><strong>阶段：</strong>{assignment.stage}</div>
          {assignment.repositoryPath ? <div><strong>仓库：</strong>{assignment.repositoryPath}</div> : null}
          {assignment.currentFile ? <div><strong>文件：</strong>{assignment.currentFile}</div> : null}
          {assignment.clusterId ? <div><strong>Cluster：</strong>{assignment.clusterId}</div> : null}
          <div><strong>状态：</strong>{assignment.status}</div>
          <div><strong>启动：</strong>{new Date(assignment.startedAt).toLocaleTimeString("zh-CN")}</div>
          <div><strong>心跳：</strong>{new Date(assignment.lastHeartbeatAt).toLocaleTimeString("zh-CN")}</div>
          {onInject ? (
            <button type="button" style={{ marginTop: 8, padding: "2px 10px", border: "1px solid var(--mission-accent-border)", borderRadius: 999, background: "var(--mission-accent-soft)", color: "var(--mission-accent)", cursor: "pointer", fontSize: 11, fontWeight: 600 }} onClick={onInject}>
              注入指令
            </button>
          ) : null}
        </div>
      }
    >
      <div className="agent-assignments-row">
        <span className="agent-assignments-row__icon">{statusIcon}</span>
        <span className="agent-assignments-row__type">{assignment.agentType}</span>
        <span className="agent-assignments-row__detail">{detail}</span>
      </div>
    </Popover>
  );
}
