import { Alert, Button, Card, Checkbox, Progress, Space, Tag, Typography } from "antd";
import {
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  LoadingOutlined,
  MinusCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useCallback, useMemo, useState } from "react";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterDiffStatus, ClusterRunState } from "../types";
import { dispatchClusterSplit } from "../../../services/prdSplit/splitterDispatch";
import { createParentTask, renderParentPrd } from "../../../services/prdSplit/trellisWriter";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";

interface Props {
  api: UseSplitWizardStateApi;
}

export function SplitsStage({ api }: Props) {
  const { state } = api;
  const [dispatching, setDispatching] = useState(false);

  const clusters = state.plan?.clusters ?? [];
  const hasBaseline = (state.existingParents?.size ?? 0) > 0;
  const unchangedCount = useMemo(
    () => clusters.filter((c) => state.diffByCluster[c.id]?.kind === "unchanged").length,
    [clusters, state.diffByCluster],
  );

  const allDone = useMemo(() => {
    const runs = Object.values(state.clusterRuns);
    if (runs.length === 0) return false;
    return runs.every(
      (r) =>
        r.status === "succeeded" ||
        r.status === "failed" ||
        r.status === "skipped-clean",
    );
  }, [state.clusterRuns]);

  const anyReadyForReview = useMemo(
    () =>
      Object.values(state.clusterRuns).some(
        (r) => r.status === "succeeded" || r.status === "skipped-clean",
      ),
    [state.clusterRuns],
  );

  const runAll = useCallback(async () => {
    if (!state.plan || !state.prd || !state.requirementsIndex || !state.project) return;
    setDispatching(true);
    try {
      await Promise.allSettled(
        state.plan.clusters.map((cluster) =>
          runCluster(cluster, state, api),
        ),
      );
    } finally {
      setDispatching(false);
    }
  }, [api, state]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="第 3 步 · 派发 splitter 子代理"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            点击「派发」按钮后，每个待派的 cluster 会并行起一个短命 <code>trellis-splitter</code> 子代理，输入 bundle 落盘到
            <code> ~/.wise/prd-runs/</code>，原始输出 + normalizer 结果汇总在下方卡片里。
          </Typography.Paragraph>
        }
      />

      {hasBaseline ? (
        <Space direction="vertical" size={4}>
          <Checkbox
            checked={state.reuseExistingParents}
            onChange={(e) => api.setReuseExistingParents(e.target.checked)}
          >
            复用历史父任务（dirty / unchanged cluster 用已有的 <code>.trellis/tasks/&lt;父&gt;/</code>，不再重建）
          </Checkbox>
          <Checkbox
            checked={state.dispatchOnlyDirty}
            onChange={(e) => api.setDispatchOnlyDirty(e.target.checked)}
            disabled={unchangedCount === 0}
          >
            仅派发 dirty / new cluster（跳过 {unchangedCount} 个 unchanged）
          </Checkbox>
        </Space>
      ) : null}

      <Space>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          disabled={dispatching}
          loading={dispatching}
          onClick={runAll}
        >
          {dispatching ? "派发中…" : allDone ? "重新派发" : "派发"}
        </Button>
        {allDone ? (
          <Button onClick={() => api.goToReview()} disabled={!anyReadyForReview}>
            进入 Review
          </Button>
        ) : null}
      </Space>

      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {state.plan?.clusters.map((cluster) => {
          const run = state.clusterRuns[cluster.id];
          const diff = state.diffByCluster[cluster.id];
          return (
            <ClusterRunCard
              key={cluster.id}
              title={cluster.title}
              id={cluster.id}
              run={run}
              diff={diff}
            />
          );
        })}
      </Space>
    </div>
  );
}

async function runCluster(
  cluster: ClusterPlanItem,
  state: UseSplitWizardStateApi["state"],
  api: UseSplitWizardStateApi,
): Promise<void> {
  const diff = state.diffByCluster[cluster.id];
  if (
    state.dispatchOnlyDirty &&
    diff &&
    diff.kind === "unchanged"
  ) {
    api.setClusterRun(cluster.id, {
      clusterId: cluster.id,
      parentTaskName: diff.existingParent.parentTaskName,
      parentTaskPath: diff.existingParent.parentTaskPath,
      status: "skipped-clean",
      errors: [],
      startedAt: Date.now(),
      endedAt: Date.now(),
    });
    return;
  }

  const runStart: ClusterRunState = {
    clusterId: cluster.id,
    parentTaskName: null,
    parentTaskPath: null,
    status: "creating-parent",
    errors: [],
    startedAt: Date.now(),
  };
  api.setClusterRun(cluster.id, runStart);

  let parentTaskName: string;
  let parentTaskPath: string;

  const reuse = state.reuseExistingParents && diff && diff.kind !== "new" ? diff : null;
  if (reuse) {
    parentTaskName = reuse.existingParent.parentTaskName;
    parentTaskPath = reuse.existingParent.parentTaskPath;
    api.patchClusterRun(cluster.id, {
      parentTaskName,
      parentTaskPath,
      status: "dispatching",
    });
  } else {
    try {
      const parentMarkdown = renderParentPrd(state.prdMarkdown, {
        id: cluster.id,
        title: cluster.title,
        primaryRepositoryId: cluster.primaryRepositoryId,
        repositoryIds: cluster.repositoryIds,
      });
      const out = await createParentTask({
        projectRootPath: state.project!.rootPath,
        cluster: {
          id: cluster.id,
          title: cluster.title,
          primaryRepositoryId: cluster.primaryRepositoryId,
          repositoryIds: cluster.repositoryIds,
        },
        prdMarkdown: parentMarkdown,
        requirementsIndexJson: JSON.stringify(state.requirementsIndex!, null, 2),
        description: `Cluster ${cluster.id} · ${cluster.requirementIds.length} requirements`,
      });
      parentTaskName = out.parentTaskName;
      parentTaskPath = out.parentTaskPath;
      api.patchClusterRun(cluster.id, {
        parentTaskName,
        parentTaskPath,
        status: "dispatching",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      api.patchClusterRun(cluster.id, {
        status: "failed",
        errors: [`创建父任务失败: ${message}`],
        endedAt: Date.now(),
      });
      return;
    }
  }

  try {
    const result = await dispatchClusterSplit({
      projectRootPath: state.project!.rootPath,
      parentTaskPath,
      cluster,
      prd: state.prd!,
      requirementsIndex: state.requirementsIndex!,
      context: state.context,
    });
    const status: ClusterRunState["status"] =
      result.normalized && result.errors.length === 0 ? "succeeded" : "failed";
    api.patchClusterRun(cluster.id, {
      status,
      raw: result.raw,
      normalized: result.normalized ?? undefined,
      validationIssues: result.validationIssues,
      errors: result.errors,
      endedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.patchClusterRun(cluster.id, {
      status: "failed",
      errors: [`splitter 派发失败: ${message}`],
      endedAt: Date.now(),
    });
  }
}

function ClusterRunCard({
  id,
  title,
  run,
  diff,
}: {
  id: string;
  title: string;
  run: ClusterRunState | undefined;
  diff: ClusterDiffStatus | undefined;
}) {
  const statusTag = renderStatusTag(run?.status ?? "idle");
  const diffBadge = diff ? renderDiffBadge(diff) : null;
  const taskCount = run?.normalized?.splitTasks.length ?? 0;
  const issues = run?.validationIssues ?? [];
  const errs = run?.errors ?? [];
  const durationLabel =
    run?.startedAt && run.endedAt ? `${Math.max(1, run.endedAt - run.startedAt)} ms` : null;

  return (
    <Card
      size="small"
      title={
        <Space>
          <Typography.Text code>{id}</Typography.Text>
          <Typography.Text strong>{title}</Typography.Text>
          {diffBadge}
        </Space>
      }
      extra={
        <Space size={4}>
          {statusTag}
          {run?.parentTaskName ? <Tag color="processing">{run.parentTaskName}</Tag> : null}
          {durationLabel ? <Tag>{durationLabel}</Tag> : null}
        </Space>
      }
    >
      {run?.status === "dispatching" ? (
        <Progress percent={70} status="active" showInfo={false} />
      ) : null}
      {run?.status === "succeeded" ? (
        <Typography.Text>
          产出 <Typography.Text strong>{taskCount}</Typography.Text> 个子任务（已通过 strict 校验，等待落盘）。
        </Typography.Text>
      ) : null}
      {run?.status === "skipped-clean" ? (
        <Typography.Text type="secondary">
          unchanged — 跳过本次派发，使用已有父任务 <code>{run.parentTaskName}</code> 的历史子任务进入 Review。
        </Typography.Text>
      ) : null}
      {issues.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message={`输出未通过 strict 校验（${issues.length} 条 issue）`}
          description={
            <ul style={{ paddingInlineStart: 18, marginBlock: 0 }}>
              {issues.slice(0, 5).map((iss, idx) => (
                <li key={idx}>
                  <Typography.Text code>{iss.path}</Typography.Text>: {iss.message}
                </li>
              ))}
              {issues.length > 5 ? <li>…共 {issues.length} 条，详见 run_dir。</li> : null}
            </ul>
          }
        />
      ) : null}
      {errs.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBlockStart: 8 }}
          message="错误"
          description={
            <ul style={{ paddingInlineStart: 18, marginBlock: 0 }}>
              {errs.map((e, idx) => <li key={idx}>{e}</li>)}
            </ul>
          }
        />
      ) : null}
    </Card>
  );
}

function renderStatusTag(status: ClusterRunState["status"]) {
  switch (status) {
    case "idle":
      return <Tag>等待</Tag>;
    case "creating-parent":
      return <Tag icon={<LoadingOutlined />} color="processing">建父任务</Tag>;
    case "dispatching":
      return <Tag icon={<LoadingOutlined />} color="processing">派发中</Tag>;
    case "succeeded":
      return <Tag icon={<CheckCircleTwoTone twoToneColor="#52c41a" />} color="success">完成</Tag>;
    case "failed":
      return <Tag icon={<CloseCircleTwoTone twoToneColor="#ff4d4f" />} color="error">失败</Tag>;
    case "skipped-clean":
      return <Tag icon={<MinusCircleOutlined />}>跳过</Tag>;
    default:
      return <Tag>{status}</Tag>;
  }
}

function renderDiffBadge(diff: ClusterDiffStatus) {
  if (diff.kind === "new") return <Tag color="blue">new</Tag>;
  if (diff.kind === "unchanged") return <Tag color="success">unchanged</Tag>;
  return <Tag color="warning">dirty · {diff.reasons.length}</Tag>;
}
