import { Alert, Button, Card, Collapse, Modal, Space, Tag, Tooltip, Typography, message } from "antd";
import { CloudUploadOutlined, FileSearchOutlined } from "@ant-design/icons";
import { useMemo, useRef, useState } from "react";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterRunState } from "../types";
import { writeClusterTasks } from "../../../services/prdSplit/trellisWriter";
import {
  buildClusterPrdMarkdown,
  buildHighlightSegments,
  type HighlightRange,
} from "../../../services/prdSplit/clusterPrdSlice";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { PrdDocument, TaskItem } from "../../../types";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";

interface Props {
  api: UseSplitWizardStateApi;
}

interface AnchorViewerState {
  cluster: ClusterPlanItem;
  tasks: TaskItem[];
  focusedTaskId: string | null;
}

export function ReviewStage({ api }: Props) {
  const { state } = api;
  const [writing, setWriting] = useState(false);
  const [anchorViewer, setAnchorViewer] = useState<AnchorViewerState | null>(null);

  const clusters = state.plan?.clusters ?? [];
  const succeededClusters = clusters.filter(
    (c) => state.clusterRuns[c.id]?.status === "succeeded",
  );

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

  const openAnchorViewer = (cluster: ClusterPlanItem, tasks: TaskItem[], focusTaskId: string | null) => {
    setAnchorViewer({ cluster, tasks, focusedTaskId: focusTaskId });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="第 4 步 · Review 与落盘"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            下方展示每个 cluster 的子任务、溯源链与锚点摘要。点「锚点速览」可在 PRD 切片中高亮任务对应原文段；
            点「落盘到 Trellis」会把所有成功 cluster 的子任务写到 <code>.trellis/tasks/&lt;parent&gt;/&lt;child&gt;/</code>。
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
                ) : run?.status === "skipped-clean" ? (
                  <Tag>跳过（unchanged）</Tag>
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
            children: (
              <ClusterTasks
                cluster={cluster}
                run={run}
                writeResult={writeResult}
                onAnchorView={(taskId) =>
                  openAnchorViewer(cluster, run?.normalized?.splitTasks ?? [], taskId)
                }
              />
            ),
          };
        })}
      />

      {anchorViewer ? (
        <AnchorViewerModal
          state={anchorViewer}
          prd={state.prd}
          requirementsIndex={state.requirementsIndex}
          onClose={() => setAnchorViewer(null)}
          onFocusTask={(taskId) =>
            setAnchorViewer((curr) => (curr ? { ...curr, focusedTaskId: taskId } : null))
          }
        />
      ) : null}
    </div>
  );
}

function ClusterTasks({
  run,
  writeResult,
  onAnchorView,
}: {
  cluster: ClusterPlanItem;
  run: ClusterRunState | undefined;
  writeResult: { childTaskNames: string[]; warnings: string[]; error?: string } | undefined;
  onAnchorView: (taskId: string | null) => void;
}) {
  if (!run || !run.normalized) {
    return (
      <Typography.Text type="warning">
        未拿到 normalized 拆分结果（unchanged 跳过 / 失败请回到派发阶段）。
      </Typography.Text>
    );
  }
  const tasks: TaskItem[] = run.normalized.splitTasks;
  const hasAnchors = tasks.some((t) => t.taskAnchors);
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {hasAnchors ? (
        <Button
          size="small"
          icon={<FileSearchOutlined />}
          onClick={() => onAnchorView(null)}
        >
          锚点速览（高亮 PRD 中所有任务范围）
        </Button>
      ) : null}
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
      {tasks.map((task, idx) => (
        <Card
          key={task.id}
          size="small"
          title={
            <Space>
              <Tag color={taskColorByIndex(idx)} style={{ minWidth: 24, textAlign: "center" }}>
                #{idx + 1}
              </Tag>
              {task.title}
            </Space>
          }
          extra={
            task.taskAnchors ? (
              <Tooltip title="在 PRD 中高亮本任务对应原文段">
                <Button size="small" icon={<FileSearchOutlined />} onClick={() => onAnchorView(task.id)}>
                  PRD 锚点
                </Button>
              </Tooltip>
            ) : null
          }
        >
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
              {task.taskAnchors.contextAfter ? (
                <>
                  ；上下文：<Typography.Text italic>{truncate(task.taskAnchors.contextAfter, 80)}</Typography.Text>
                </>
              ) : null}
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

function AnchorViewerModal({
  state,
  prd,
  requirementsIndex,
  onClose,
  onFocusTask,
}: {
  state: AnchorViewerState;
  prd: PrdDocument | null;
  requirementsIndex: RequirementsIndexV2 | null;
  onClose: () => void;
  onFocusTask: (taskId: string | null) => void;
}) {
  const { cluster, tasks, focusedTaskId } = state;
  const containerRef = useRef<HTMLDivElement>(null);

  const clusterPrd = useMemo(() => {
    if (!prd || !requirementsIndex) return "";
    return buildClusterPrdMarkdown(prd, requirementsIndex, cluster.requirementIds);
  }, [prd, requirementsIndex, cluster.requirementIds]);

  const ranges: HighlightRange[] = useMemo(
    () =>
      tasks
        .filter((t) => t.taskAnchors)
        .map((t) => ({ from: t.taskAnchors!.from, to: t.taskAnchors!.to, taskId: t.id })),
    [tasks],
  );

  const segments = useMemo(() => buildHighlightSegments(clusterPrd, ranges), [clusterPrd, ranges]);

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width="min(1100px, 92vw)"
      title={
        <Space>
          <Typography.Text>锚点速览 ·</Typography.Text>
          <Typography.Text code>{cluster.id}</Typography.Text>
          <Typography.Text strong>{cluster.title}</Typography.Text>
        </Space>
      }
    >
      <div style={{ display: "flex", gap: 12, maxHeight: "70vh" }}>
        <div
          ref={containerRef}
          style={{
            flex: 1,
            overflow: "auto",
            background: "#fafafa",
            border: "1px solid #f0f0f0",
            padding: 12,
            borderRadius: 6,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {segments.map((seg, idx) => {
            if (seg.taskIds.length === 0) return <span key={idx}>{seg.text}</span>;
            const colorIndex = tasks.findIndex((t) => t.id === seg.taskIds[0]);
            const baseColor = taskBgColor(colorIndex >= 0 ? colorIndex : 0);
            const focused = focusedTaskId && seg.taskIds.includes(focusedTaskId);
            return (
              <mark
                key={idx}
                data-task-id={seg.taskIds.join(",")}
                style={{
                  background: baseColor,
                  borderBottom: focused ? "2px solid #ff7a45" : "none",
                  padding: "0 2px",
                  borderRadius: 2,
                  cursor: "pointer",
                }}
                onClick={() => onFocusTask(seg.taskIds[0] ?? null)}
              >
                {seg.text}
              </mark>
            );
          })}
        </div>

        <div
          style={{
            width: 260,
            overflow: "auto",
            borderLeft: "1px solid #f0f0f0",
            paddingInlineStart: 12,
          }}
        >
          <Typography.Text strong>任务列表</Typography.Text>
          <ul style={{ paddingInlineStart: 18, marginBlock: 8 }}>
            {tasks.map((task, idx) => (
              <li key={task.id} style={{ marginBlockEnd: 6, fontSize: 12 }}>
                <Button
                  type={focusedTaskId === task.id ? "primary" : "link"}
                  size="small"
                  style={{ padding: 0 }}
                  onClick={() => {
                    onFocusTask(task.id);
                    requestAnimationFrame(() => {
                      const el = containerRef.current?.querySelector(
                        `mark[data-task-id*="${cssEscape(task.id)}"]`,
                      );
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    });
                  }}
                >
                  <Tag color={taskColorByIndex(idx)} style={{ marginInlineEnd: 4 }}>
                    #{idx + 1}
                  </Tag>
                  {truncate(task.title, 24)}
                </Button>
              </li>
            ))}
          </ul>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            click 任意高亮段或左侧任务可联动焦点。
          </Typography.Text>
        </div>
      </div>
    </Modal>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function roleColor(role: string): string {
  if (role === "backend") return "green";
  if (role === "document") return "purple";
  return "blue";
}

const TASK_TAG_PALETTE = ["blue", "green", "purple", "orange", "cyan", "magenta", "geekblue", "volcano"];
function taskColorByIndex(index: number): string {
  return TASK_TAG_PALETTE[index % TASK_TAG_PALETTE.length];
}

const TASK_BG_PALETTE = [
  "rgba(22, 119, 255, 0.18)",
  "rgba(82, 196, 26, 0.18)",
  "rgba(114, 46, 209, 0.18)",
  "rgba(250, 140, 22, 0.18)",
  "rgba(19, 194, 194, 0.18)",
  "rgba(235, 47, 150, 0.18)",
  "rgba(47, 84, 235, 0.18)",
  "rgba(250, 84, 28, 0.18)",
];
function taskBgColor(index: number): string {
  return TASK_BG_PALETTE[index % TASK_BG_PALETTE.length];
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
