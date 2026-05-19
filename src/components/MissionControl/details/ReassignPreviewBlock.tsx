import { Alert, Descriptions, Tag, Typography } from "antd";
import { List } from "../../ui/AppList";
import type { MissionReassignPreview } from "../../../services/missionControlBackend";

interface ReassignPreviewBlockProps {
  preview: MissionReassignPreview;
}

export function ReassignPreviewBlock({ preview }: ReassignPreviewBlockProps) {
  const affectedTaskCount = preview.invalidatedTaskIds.length + preview.dependencyTaskIds.length;
  return (
    <div className="mission-reassign-preview">
      <Alert
        type="warning"
        showIcon
        message="移动需求会使相关任务规划失效"
        description="确认后会提交影响预览、移动需求，并向受影响的运行中 agent 写入 cancel 指令。"
      />
      <Descriptions size="small" column={3} className="mission-reassign-preview__stats">
        <Descriptions.Item label="脏分组">{preview.dirtyClusterCount}</Descriptions.Item>
        <Descriptions.Item label="受影响任务">{affectedTaskCount}</Descriptions.Item>
        <Descriptions.Item label="受影响 Agent">{preview.agentImpacts.length}</Descriptions.Item>
      </Descriptions>
      <PreviewList title="受影响分组" values={preview.affectedClusters} />
      <PreviewList title="失效任务" values={preview.invalidatedTaskIds} />
      <PreviewList title="依赖任务" values={preview.dependencyTaskIds} />
      {preview.agentImpacts.length > 0 ? (
        <section className="mission-reassign-preview__section">
          <Typography.Text strong>Agent 影响</Typography.Text>
          <List
            size="small"
            dataSource={preview.agentImpacts}
            renderItem={(agent) => (
              <List.Item>
                <span className="mission-reassign-preview__agent-row">
                  <Typography.Text code>{agent.assignmentId}</Typography.Text>
                  {agent.clusterId ? <Tag>{agent.clusterId}</Tag> : null}
                  <Tag color="warning">{agent.recommendedAction}</Tag>
                </span>
              </List.Item>
            )}
          />
        </section>
      ) : null}
    </div>
  );
}

function PreviewList({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <section className="mission-reassign-preview__section">
      <Typography.Text strong>{title}</Typography.Text>
      <div className="mission-reassign-preview__tags">
        {values.map((value) => <Tag key={value}>{value}</Tag>)}
      </div>
    </section>
  );
}
