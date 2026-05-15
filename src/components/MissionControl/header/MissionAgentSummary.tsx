import { Badge, Popover, Space, Tag } from "antd";
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ClockCircleOutlined } from "@ant-design/icons";
import type { MissionRunState } from "../presenter/types";

export function MissionAgentSummary({ runState }: { runState: MissionRunState }) {
  const entries = Object.values(runState.clusters);
  if (entries.length === 0) return null;

  const running = entries.filter((c) => c.status === "running").length;
  const succeeded = entries.filter((c) => c.status === "succeeded").length;
  const failed = entries.filter((c) => c.status === "failed").length;
  const queued = entries.filter((c) => c.status === "queued").length;

  const content = (
    <div style={{ minWidth: 200 }}>
      {entries.map((c, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
          <span>{`子代理 ${i + 1}`}</span>
          <Tag color={c.status === "succeeded" ? "green" : c.status === "failed" ? "red" : c.status === "running" ? "blue" : "default"}>
            {c.stageLabel}
          </Tag>
        </div>
      ))}
    </div>
  );

  return (
    <Popover content={content} title="子代理活动">
      <Space size={8} className="mission-agent-summary">
        {running > 0 && (
          <Badge count={running} overflowCount={99}>
            <Tag icon={<LoadingOutlined spin />} color="processing">运行中</Tag>
          </Badge>
        )}
        {succeeded > 0 && (
          <Tag icon={<CheckCircleOutlined />} color="success">{succeeded} 完成</Tag>
        )}
        {failed > 0 && (
          <Tag icon={<CloseCircleOutlined />} color="error">{failed} 失败</Tag>
        )}
        {queued > 0 && running === 0 && (
          <Tag icon={<ClockCircleOutlined />}>{queued} 等待</Tag>
        )}
      </Space>
    </Popover>
  );
}
