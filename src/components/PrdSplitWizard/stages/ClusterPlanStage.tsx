import { Alert, Card, Empty, Space, Tag, Typography } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";

interface Props {
  api: UseSplitWizardStateApi;
}

export function ClusterPlanStage({ api }: Props) {
  const { state } = api;
  const plan = state.plan;

  if (!plan) {
    return (
      <Empty description="尚未规划 cluster。请回到上一步重新解析 PRD。" />
    );
  }

  if (plan.clusters.length === 0) {
    return (
      <Alert
        type="warning"
        showIcon
        message="未生成任何 cluster"
        description="可能原因：未选择参与的仓库；或 PRD 中未识别到需求条目。请回到上一步检查。"
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="第 2 步 · 审阅 Cluster 划分"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            每个 cluster 将被独立派发给 <code>trellis-splitter</code> 子代理，并行执行。子任务的归属仓位由 cluster 的 primary repo 决定。
          </Typography.Paragraph>
        }
      />

      {plan.diagnostics.crossRepoRequirements.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`检测到 ${plan.diagnostics.crossRepoRequirements.length} 条跨仓需求`}
          description={
            <Typography.Text>
              这些 requirement 在多个仓位上都有强匹配信号：{plan.diagnostics.crossRepoRequirements.join(", ")}
            </Typography.Text>
          }
        />
      ) : null}

      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {plan.clusters.map((cluster) => (
          <ClusterCard key={cluster.id} cluster={cluster} />
        ))}
      </Space>

      {plan.diagnostics.requirementsCoverage.orphan.length > 0 ? (
        <Alert
          type="warning"
          message={`存在 ${plan.diagnostics.requirementsCoverage.orphan.length} 条 orphan 需求（未挂到任何仓位）`}
          description={plan.diagnostics.requirementsCoverage.orphan.join(", ")}
        />
      ) : null}
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: ClusterPlanItem }) {
  return (
    <Card
      size="small"
      title={
        <Space>
          <Typography.Text code>{cluster.id}</Typography.Text>
          <Typography.Text strong>{cluster.title}</Typography.Text>
        </Space>
      }
      extra={
        <Space size={4}>
          {cluster.primaryRepositoryId != null ? (
            <Tag color="processing">repoId: {cluster.primaryRepositoryId}</Tag>
          ) : (
            <Tag color="warning">cross-repo</Tag>
          )}
          <Tag>{cluster.requirementIds.length} requirements</Tag>
        </Space>
      }
    >
      <Typography.Paragraph style={{ margin: 0 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>需求 id：</Typography.Text>{" "}
        {cluster.requirementIds.map((id) => (
          <Tag key={id} style={{ marginBlockEnd: 4 }}>
            {id}
          </Tag>
        ))}
      </Typography.Paragraph>
      {cluster.dependencyClusterIds.length > 0 ? (
        <Typography.Paragraph style={{ margin: 0, marginBlockStart: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>依赖 cluster：</Typography.Text>{" "}
          {cluster.dependencyClusterIds.map((d) => (
            <Tag key={d} icon={<ArrowRightOutlined />}>
              {d}
            </Tag>
          ))}
        </Typography.Paragraph>
      ) : null}
    </Card>
  );
}
