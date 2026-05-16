import { Collapse, Progress, Tag, Typography } from "antd";
import {
  LoadingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
} from "@ant-design/icons";
import type { MissionRunState } from "../presenter/types";

interface AgentExecutionPanelProps {
  runState: MissionRunState;
  stdoutMap: Record<string, string[]>;
}

export function AgentExecutionPanel({ runState, stdoutMap }: AgentExecutionPanelProps) {
  const entries = Object.values(runState.clusters);
  if (entries.length === 0) return null;

  const isActive = runState.phase === "dispatching" || runState.phase === "writing";

  return (
    <section className={`mission-agent-panel ${isActive ? "mission-agent-panel--active" : ""}`}>
      <div className="mission-agent-panel__header">
        <span className="mission-agent-panel__title">
          <CodeOutlined />
          子代理执行
        </span>
        <span className="mission-agent-panel__summary">
          {entries.filter((c) => c.status === "running").length} 运行中
          {" · "}
          {entries.filter((c) => c.status === "succeeded").length} 完成
          {entries.filter((c) => c.status === "failed").length > 0
            ? ` · ${entries.filter((c) => c.status === "failed").length} 失败`
            : ""}
        </span>
      </div>

      <div className="mission-agent-panel__list">
        {entries.map((entry) => {
          const statusIcon =
            entry.status === "running" ? <LoadingOutlined spin /> :
            entry.status === "succeeded" ? <CheckCircleOutlined /> :
            entry.status === "failed" ? <CloseCircleOutlined /> :
            <ClockCircleOutlined />;

          const statusColor =
            entry.status === "running" ? "processing" :
            entry.status === "succeeded" ? "success" :
            entry.status === "failed" ? "error" : "default";

          const outLines = stdoutMap[Object.keys(runState.clusters).find(
            (k) => runState.clusters[k] === entry,
          ) ?? ""] ?? [];

          return (
            <div key={entry.stageLabel} className="mission-agent-panel__row">
              <div className="mission-agent-panel__row-head">
                <span className="mission-agent-panel__row-icon">{statusIcon}</span>
                <Typography.Text className="mission-agent-panel__row-label" strong>
                  {entry.stageLabel}
                </Typography.Text>
                <Tag color={statusColor} style={{ fontSize: 10, fontWeight: 700 }}>
                  {entry.status === "running" ? `${entry.progressPercent}%` : entry.status}
                </Tag>
                {entry.elapsedMs > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 10 }}>
                    {(entry.elapsedMs / 1000).toFixed(1)}s
                  </Typography.Text>
                ) : null}
              </div>
              {entry.status === "running" ? (
                <Progress
                  percent={entry.progressPercent}
                  size="small"
                  showInfo={false}
                  strokeColor="var(--mission-accent)"
                  trailColor="var(--mission-surface-soft)"
                  style={{ margin: "4px 0 0" }}
                />
              ) : null}
              {entry.error ? (
                <Typography.Text type="danger" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                  {entry.error.summary}
                </Typography.Text>
              ) : null}
              {outLines.length > 0 ? (
                <Collapse
                  ghost
                  size="small"
                  className="mission-agent-panel__output"
                  items={[{
                    key: "stdout",
                    label: `输出 (${outLines.length} 行)`,
                    children: (
                      <pre className="mission-agent-panel__stdout">
                        {outLines.slice(-40).join("\n")}
                      </pre>
                    ),
                  }]}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
