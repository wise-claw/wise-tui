import { Alert, Button, Card, Collapse, Space, Tag, Typography, message } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterRunState } from "../types";
import { writeClusterTasks } from "../../../services/prdSplit/trellisWriter";
import type { TaskItem } from "../../../types";

interface Props {
  api: UseSplitWizardStateApi;
}

export function ReviewStage({ api }: Props) {
  const { state } = api;
  const [writing, setWriting] = useState(false);

  const clusters = state.plan?.clusters ?? [];
  const succeededClusters = clusters.filter((c) => state.clusterRuns[c.id]?.status === "succeeded");

  const writeAll = async () => {
    if (!state.project) return;
    setWriting(true);
    api.beginWrite();
    try {
      for (const cluster of succeededClusters) {
        const run = state.clusterRuns[cluster.id];
        if (!run?.normalized || !run.parentTaskName) {
          api.addWriteResult({
            clusterId: cluster.id,
            parentTaskName: run?.parentTaskName ?? "",
            childTaskNames: [],
            warnings: [],
            error: "缺少 normalized 拆分结果或父任务名（无法落盘）",
          });
          continue;
        }
        try {
          const out = await writeClusterTasks({
            projectRootPath: state.project.rootPath,
            parentTaskName: run.parentTaskName,
            cluster: {
              id: cluster.id,
              title: cluster.title,
              primaryRepositoryId: cluster.primaryRepositoryId,
              repositoryIds: cluster.repositoryIds,
            },
            normalized: run.normalized,
            prdSource: state.prd!,
          });
          api.addWriteResult({
            clusterId: cluster.id,
            parentTaskName: out.parentTaskName,
            childTaskNames: out.childTaskNames,
            warnings: out.warnings,
          });
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          api.addWriteResult({
            clusterId: cluster.id,
            parentTaskName: run.parentTaskName,
            childTaskNames: [],
            warnings: [],
            error: m,
          });
        }
      }
      api.finishWrite();
      message.success("Trellis 任务已落盘完成");
    } catch (err) {
      api.failWrite(err instanceof Error ? err.message : String(err));
    } finally {
      setWriting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="第 4 步 · Review 与落盘"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            下方展示每个 cluster 的子任务、溯源链与锚点摘要。点「落盘到 Trellis」会把所有成功 cluster 的子任务写到
            <code> .trellis/tasks/&lt;parent&gt;/&lt;child&gt;/</code>。
          </Typography.Paragraph>
        }
      />

      <Space>
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          loading={writing}
          disabled={succeededClusters.length === 0}
          onClick={writeAll}
        >
          落盘到 Trellis（{succeededClusters.length} 个 cluster）
        </Button>
      </Space>

      {state.globalError ? (
        <Alert type="error" showIcon message="落盘出现错误" description={state.globalError} />
      ) : null}

      <Collapse
        defaultActiveKey={clusters.map((c) => c.id)}
        items={clusters.map((cluster) => {
          const run = state.clusterRuns[cluster.id];
          const writeResult = state.writeResults.find((r) => r.clusterId === cluster.id);
          return {
            key: cluster.id,
            label: (
              <Space>
                <Typography.Text code>{cluster.id}</Typography.Text>
                <Typography.Text strong>{cluster.title}</Typography.Text>
                {run?.status === "succeeded" ? (
                  <Tag color="success">{run.normalized?.splitTasks.length ?? 0} tasks</Tag>
                ) : (
                  <Tag color="error">未产出</Tag>
                )}
                {writeResult ? (
                  writeResult.error ? (
                    <Tag color="error">写入失败</Tag>
                  ) : (
                    <Tag color="success">已写 {writeResult.childTaskNames.length}</Tag>
                  )
                ) : null}
              </Space>
            ),
            children: <ClusterTasks run={run} writeResult={writeResult} />,
          };
        })}
      />
    </div>
  );
}

function ClusterTasks({
  run,
  writeResult,
}: {
  run: ClusterRunState | undefined;
  writeResult: { childTaskNames: string[]; warnings: string[]; error?: string } | undefined;
}) {
  if (!run || !run.normalized) {
    return <Typography.Text type="warning">未拿到 normalized 拆分结果。</Typography.Text>;
  }
  const tasks: TaskItem[] = run.normalized.splitTasks;
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {writeResult?.error ? (
        <Alert type="error" message="本 cluster 落盘失败" description={writeResult.error} />
      ) : null}
      {writeResult?.warnings.length ? (
        <Alert type="warning" message="落盘警告" description={writeResult.warnings.join("; ")} />
      ) : null}
      {writeResult?.childTaskNames.length ? (
        <Alert
          type="success"
          message={`已落盘 ${writeResult.childTaskNames.length} 个子任务`}
          description={
            <Typography.Text style={{ fontSize: 12 }}>
              {writeResult.childTaskNames.join(", ")}
            </Typography.Text>
          }
        />
      ) : null}
      {tasks.map((task) => (
        <Card key={task.id} size="small" title={task.title}>
          <Space wrap size={4} style={{ marginBlockEnd: 8 }}>
            <Tag color={roleColor(task.role)}>{task.role}</Tag>
            <Tag>{task.size}</Tag>
            <Tag>预估 {task.estimateDays} d</Tag>
            {task.executionStatus === "not_executable" ? (
              <Tag color="warning">not_executable</Tag>
            ) : null}
          </Space>
          {task.description ? (
            <Typography.Paragraph style={{ marginBlockEnd: 6 }}>{task.description}</Typography.Paragraph>
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>溯源 requirement：</Typography.Text>{" "}
          {task.sourceRequirementIds.map((id) => (
            <Tag key={id} style={{ marginBlockEnd: 4 }}>{id}</Tag>
          ))}
          {task.taskAnchors ? (
            <Typography.Paragraph type="secondary" style={{ marginBlock: 4, fontSize: 12 }}>
              锚点 textHash <Typography.Text code>{task.taskAnchors.textHash}</Typography.Text>
              {" "}@ [{task.taskAnchors.from}, {task.taskAnchors.to}]
            </Typography.Paragraph>
          ) : null}
          {task.subtasks.length > 0 ? (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12 }}>子项 ({task.subtasks.length})</summary>
              <ul style={{ paddingInlineStart: 18, marginBlock: 4 }}>
                {task.subtasks.map((s, i) => <li key={i} style={{ fontSize: 12 }}>{s}</li>)}
              </ul>
            </details>
          ) : null}
          {task.dod.length > 0 ? (
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12 }}>DoD ({task.dod.length})</summary>
              <ul style={{ paddingInlineStart: 18, marginBlock: 4 }}>
                {task.dod.map((d, i) => <li key={i} style={{ fontSize: 12 }}>{d}</li>)}
              </ul>
            </details>
          ) : null}
        </Card>
      ))}
    </Space>
  );
}

function roleColor(role: string): string {
  if (role === "backend") return "green";
  if (role === "document") return "purple";
  return "blue";
}
