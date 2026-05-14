import { useEffect } from "react";
import { Alert, Button, Card, Empty, Space, Tag, Tooltip, Typography } from "antd";
import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterDiffStatus } from "../types";

interface Props {
  api: UseSplitWizardStateApi;
}

export function ClusterPlanStage({ api }: Props) {
  const { state } = api;
  const plan = state.plan;

  // 进入 plan 阶段后自动扫描历史父任务，构建 diff。
  useEffect(() => {
    if (state.plan && state.existingParents === null) {
      void api.refreshExistingParents();
    }
  }, [state.plan, state.existingParents, api]);

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

  const dirtyCount = Object.values(state.diffByCluster).filter((d) => d.kind === "dirty").length;
  const unchangedCount = Object.values(state.diffByCluster).filter((d) => d.kind === "unchanged").length;
  const newCount = Object.values(state.diffByCluster).filter((d) => d.kind === "new").length;
  const hasBaseline = (state.existingParents?.size ?? 0) > 0;

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

      <Space size={8} wrap>
        <Tooltip title="重新扫描项目下已有父任务，重算 diff">
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void api.refreshExistingParents()}>
            重扫历史父任务
          </Button>
        </Tooltip>
        {hasBaseline ? (
          <Space size={4}>
            <Tag color="success">unchanged · {unchangedCount}</Tag>
            <Tag color="warning">dirty · {dirtyCount}</Tag>
            <Tag color="blue">new · {newCount}</Tag>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            未发现历史父任务（首拆）
          </Typography.Text>
        )}
      </Space>

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

      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {plan.clusters.map((cluster) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            diff={state.diffByCluster[cluster.id]}
          />
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

function ClusterCard({
  cluster,
  diff,
}: {
  cluster: ClusterPlanItem;
  diff?: ClusterDiffStatus;
}) {
  return (
    <Card
      size="small"
      title={
        <Space>
          <Typography.Text code>{cluster.id}</Typography.Text>
          <Typography.Text strong>{cluster.title}</Typography.Text>
          <DiffBadge diff={diff} />
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

      {diff && diff.kind === "dirty" ? <DirtyReasons diff={diff} /> : null}
      {diff && diff.kind === "unchanged" ? (
        <Typography.Paragraph type="secondary" style={{ margin: 0, marginBlockStart: 4, fontSize: 12 }}>
          已存在父任务：<code>{diff.existingParent.parentTaskName}</code>，本次输入未引入变化。
        </Typography.Paragraph>
      ) : null}
    </Card>
  );
}

function DiffBadge({ diff }: { diff: ClusterDiffStatus | undefined }) {
  if (!diff) return null;
  if (diff.kind === "new") return <Tag color="blue">new</Tag>;
  if (diff.kind === "unchanged") return <Tag color="success">unchanged</Tag>;
  return <Tag color="warning">dirty · {diff.reasons.length} 项</Tag>;
}

function DirtyReasons({
  diff,
}: {
  diff: Extract<ClusterDiffStatus, { kind: "dirty" }>;
}) {
  return (
    <div style={{ marginBlockStart: 6 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        与 <code>{diff.existingParent.parentTaskName}</code> 相比的变化：
      </Typography.Text>
      <ul style={{ paddingInlineStart: 18, marginBlock: 4 }}>
        {diff.reasons.map((reason, idx) => (
          <li key={idx} style={{ fontSize: 12 }}>
            {renderReason(reason)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderReason(
  reason: Extract<ClusterDiffStatus, { kind: "dirty" }>["reasons"][number],
): string {
  if (reason.kind === "requirement_body_changed") {
    return `修改 ${reason.id}（${reason.oldHash.slice(0, 8)} → ${reason.newHash.slice(0, 8)}）`;
  }
  if (reason.kind === "requirement_added") return `新增 ${reason.id}`;
  return `删除 ${reason.id}`;
}
