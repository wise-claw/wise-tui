import { Alert, Button, Card, Progress, Space, Tag, Typography } from "antd";
import {
  CheckCircleTwoTone,
  CloseCircleTwoTone,
  LoadingOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useCallback, useMemo, useState } from "react";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterRunState } from "../types";
import { dispatchClusterSplit } from "../../../services/prdSplit/splitterDispatch";
import { createParentTask } from "../../../services/prdSplit/trellisWriter";
import { renderParentPrd } from "../../../services/prdSplit/trellisWriter";

interface Props {
  api: UseSplitWizardStateApi;
}

export function SplitsStage({ api }: Props) {
  const { state } = api;
  const [dispatching, setDispatching] = useState(false);

  const allDone = useMemo(() => {
    const runs = Object.values(state.clusterRuns);
    if (runs.length === 0) return false;
    return runs.every((r) => r.status === "succeeded" || r.status === "failed");
  }, [state.clusterRuns]);

  const anySucceeded = useMemo(
    () => Object.values(state.clusterRuns).some((r) => r.status === "succeeded"),
    [state.clusterRuns],
  );

  const runAll = useCallback(async () => {
    if (!state.plan || !state.prd || !state.requirementsIndex || !state.project) return;
    setDispatching(true);
    try {
      await Promise.allSettled(
        state.plan.clusters.map(async (cluster) => {
          const runStart: ClusterRunState = {
            clusterId: cluster.id,
            parentTaskName: null,
            parentTaskPath: null,
            status: "creating-parent",
            errors: [],
            startedAt: Date.now(),
          };
          api.setClusterRun(cluster.id, runStart);

          // 1. 建父任务并把 cluster PRD 切片 + requirements-index 写盘。
          let parentTaskName: string;
          let parentTaskPath: string;
          try {
            const parentMarkdown = renderParentPrd(
              extractClusterPrdSlice(state.prdMarkdown, cluster.requirementIds, state.requirementsIndex!),
              {
                id: cluster.id,
                title: cluster.title,
                primaryRepositoryId: cluster.primaryRepositoryId,
                repositoryIds: cluster.repositoryIds,
              },
            );
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
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            api.patchClusterRun(cluster.id, {
              status: "failed",
              errors: [`创建父任务失败: ${message}`],
              endedAt: Date.now(),
            });
            return;
          }

          api.patchClusterRun(cluster.id, {
            parentTaskName,
            parentTaskPath,
            status: "dispatching",
          });

          // 2. 派 splitter subagent。
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
        }),
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
            点击「派发」按钮后，每个 cluster 会并行起一个短命 <code>trellis-splitter</code> 子代理，输入 bundle 落盘到
            <code> ~/.wise/prd-runs/</code>，原始输出 + normalizer 结果汇总在下方卡片里。
          </Typography.Paragraph>
        }
      />

      <Space>
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          disabled={dispatching}
          loading={dispatching}
          onClick={runAll}
        >
          {dispatching ? "派发中…" : allDone ? "重新派发所有 cluster" : "派发所有 cluster"}
        </Button>
        {allDone ? (
          <Button onClick={() => api.goToReview()} disabled={!anySucceeded}>
            进入 Review
          </Button>
        ) : null}
      </Space>

      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {state.plan?.clusters.map((cluster) => {
          const run = state.clusterRuns[cluster.id];
          return <ClusterRunCard key={cluster.id} title={cluster.title} id={cluster.id} run={run} />;
        })}
      </Space>
    </div>
  );
}

function ClusterRunCard({
  id,
  title,
  run,
}: {
  id: string;
  title: string;
  run: ClusterRunState | undefined;
}) {
  const statusTag = renderStatusTag(run?.status ?? "idle");
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
    default:
      return <Tag>{status}</Tag>;
  }
}

/**
 * 从原 PRD markdown 中抽取 cluster 关联 requirement 的相关段落作为父任务 PRD。
 * 这里采用宽容策略：保留完整 PRD（让 splitter 输入端的 PRD 切片由 buildSplitRequestPayload 处理），
 * 父任务 prd.md 留存完整 PRD 以供后续上下文。
 */
function extractClusterPrdSlice(
  fullMarkdown: string,
  _clusterRequirementIds: string[],
  _index: unknown,
): string {
  return fullMarkdown;
}
