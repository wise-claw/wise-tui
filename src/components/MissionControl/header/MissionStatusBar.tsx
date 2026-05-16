import { Tag, Typography } from "antd";
import {
  RocketOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  DisconnectOutlined,
} from "@ant-design/icons";
import { useAgentAssignments } from "../../../hooks/useAgentAssignments";
import type { MissionRunState } from "../presenter/types";

interface MissionStatusBarProps {
  missionId: string | null;
  runState: MissionRunState;
}

export function MissionStatusBar({ missionId, runState }: MissionStatusBarProps) {
  const { running, queued } = useAgentAssignments({
    missionId,
    enabled: Boolean(missionId),
    pollIntervalMs: 5_000,
  });
  const stale = running.filter((assignment) => assignment.status === "stale");
  const activeRunning = running.filter((assignment) => assignment.status !== "stale");

  const phaseLabel =
    runState.phase === "idle" ? "就绪"
    : runState.phase === "parsing" ? "解析中"
    : runState.phase === "dispatching" ? "派发中"
    : runState.phase === "writing" ? "写入中"
    : runState.phase === "done" ? "完成"
    : runState.phase;

  const phaseIcon =
    runState.phase === "done" ? <CheckCircleOutlined />
    : runState.phase === "idle" ? <ClockCircleOutlined />
    : <SyncOutlined spin />;

  if (!missionId) return null;

  return (
    <div className="mission-status-bar">
      <div className="mission-status-bar__mission">
        <RocketOutlined />
        <Typography.Text className="mission-status-bar__id" code>
          {missionId.slice(0, 8)}
        </Typography.Text>
        <Tag
          icon={phaseIcon}
          color={runState.phase === "done" ? "success" : runState.phase === "idle" ? "default" : "processing"}
        >
          {phaseLabel}
        </Tag>
      </div>
      <div className="mission-status-bar__agents">
        {activeRunning.length > 0 ? (
          <Tag color="processing" style={{ fontSize: 11 }}>
            {activeRunning.length} 运行中
          </Tag>
        ) : null}
        {stale.length > 0 ? (
          <Tag color="warning" style={{ fontSize: 11 }}>
            {stale.length} 疑似断连
          </Tag>
        ) : null}
        {queued.length > 0 ? (
          <Tag style={{ fontSize: 11 }}>{queued.length} 排队</Tag>
        ) : null}
        {running.map((a) => (
          <span key={a.assignmentId} className="mission-status-bar__agent-pill">
            <span className="mission-status-bar__agent-dot" data-status={a.status === "stale" ? "stale" : "running"} />
            <span>{a.agentType}</span>
            <span className="mission-status-bar__agent-stage">· {a.stage}</span>
            {a.status === "stale" ? <DisconnectOutlined style={{ fontSize: 10 }} /> : null}
            {a.currentFile ? (
              <span className="mission-status-bar__agent-file" title={a.currentFile}>
                {a.currentFile.split("/").pop()}
              </span>
            ) : null}
          </span>
        ))}
        {queued.map((a) => (
          <span key={a.assignmentId} className="mission-status-bar__agent-pill">
            <span className="mission-status-bar__agent-dot" />
            <span>{a.agentType}</span>
            <span className="mission-status-bar__agent-stage">· {a.stage}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
