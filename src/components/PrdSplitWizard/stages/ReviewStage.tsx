import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useMemo, useRef, useState } from "react";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterEditState, ClusterRunState } from "../types";
import { writeClusterTasks } from "../../../services/prdSplit/trellisWriter";
import { dispatchClusterVerifier } from "../../../services/prdSplit/verifierDispatch";
import {
  buildClusterPrdMarkdown,
  buildHighlightSegments,
  type HighlightRange,
} from "../../../services/prdSplit/clusterPrdSlice";
import {
  captureSelectionOffset,
  deriveAnchorFromRange,
  shiftAnchorEdge,
} from "../anchorEdits";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { PrdDocument, TaskAnchorDescriptor, TaskItem, TaskRole } from "../../../types";
import type { RequirementsIndexV2 } from "../../../services/prdSplit/requirementsIndexVersion";
import { applyEditsToSplitResult, applyTaskEdits, isEditedTask, isManualTask } from "../taskEdits";

interface Props {
  api: UseSplitWizardStateApi;
}

interface AnchorViewerState {
  cluster: ClusterPlanItem;
  focusedTaskId: string | null;
}

export function ReviewStage({ api }: Props) {
  const { state } = api;
  const [writing, setWriting] = useState(false);
  const [verifyingClusterId, setVerifyingClusterId] = useState<string | null>(null);
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
        const edits = state.editsByCluster[cluster.id];
        const effective = applyEditsToSplitResult(run.normalized, edits);
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
            normalized: effective,
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

  const runVerifier = async (cluster: ClusterPlanItem) => {
    if (!state.project || !state.prd || !state.requirementsIndex) return;
    const run = state.clusterRuns[cluster.id];
    if (!run?.parentTaskPath) {
      message.warning("没有父任务路径，无法派 verifier");
      return;
    }
    setVerifyingClusterId(cluster.id);
    try {
      const result = await dispatchClusterVerifier({
        projectRootPath: state.project.rootPath,
        parentTaskPath: run.parentTaskPath,
        cluster,
        prd: state.prd,
        requirementsIndex: state.requirementsIndex,
        context: state.context,
        previousOutput: run.raw?.rawOutput ?? null,
        validationIssues: run.validationIssues ?? [],
      });
      if (result.errors.length === 0 && result.normalized) {
        api.patchClusterRun(cluster.id, {
          status: "succeeded",
          raw: result.raw,
          normalized: result.normalized,
          validationIssues: [],
          errors: [],
          endedAt: Date.now(),
        });
        message.success("verifier 已修复并通过 strict 校验");
      } else {
        api.patchClusterRun(cluster.id, {
          raw: result.raw,
          validationIssues: result.validationIssues,
          errors: result.errors,
        });
        message.error(`verifier 未能完全修复（${result.errors.length} 项错误）`);
      }
    } finally {
      setVerifyingClusterId(null);
    }
  };

  const openAnchorViewer = (
    cluster: ClusterPlanItem,
    _tasks: TaskItem[],
    focusTaskId: string | null,
  ) => {
    setAnchorViewer({ cluster, focusedTaskId: focusTaskId });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="第 4 步 · Review 与人工编排"
        description={
          <Typography.Paragraph style={{ margin: 0 }}>
            可在此编辑任务（标题 / 描述 / 角色 / 子项 / DoD / 溯源 requirement）、新增手工任务、删除冗余任务；
            点「PRD 锚点」查看任务在原文的位置；validation 未通过的 cluster 可派遣 verifier 二次修复；
            最后「落盘到 Trellis」会把（编辑后的）所有成功 cluster 子任务写到 <code>.trellis/tasks/&lt;parent&gt;/&lt;child&gt;/</code>。
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
          const edits = state.editsByCluster[cluster.id];
          const writeResult = state.writeResults.find((r) => r.clusterId === cluster.id);
          const effectiveTasks = run?.normalized
            ? applyTaskEdits(run.normalized.splitTasks, edits)
            : [];
          const editedCount = effectiveTasks.filter((t) => isEditedTask(t, edits)).length;
          const manualCount = effectiveTasks.filter((t) => isManualTask(t, edits)).length;
          const deletedCount = edits?.deletedTaskIds.length ?? 0;
          return {
            key: cluster.id,
            label: (
              <Space>
                <Typography.Text code>{cluster.id}</Typography.Text>
                <Typography.Text strong>{cluster.title}</Typography.Text>
                {run?.status === "succeeded" ? (
                  <Tag color="success">{effectiveTasks.length} tasks</Tag>
                ) : run?.status === "skipped-clean" ? (
                  <Tag>跳过（unchanged）</Tag>
                ) : (
                  <Tag color="error">未产出</Tag>
                )}
                {editedCount > 0 ? <Tag color="warning">已改 {editedCount}</Tag> : null}
                {manualCount > 0 ? <Tag color="blue">新增 {manualCount}</Tag> : null}
                {deletedCount > 0 ? <Tag color="red">已删 {deletedCount}</Tag> : null}
                {(run?.validationIssues?.length ?? 0) > 0 ? (
                  <Tag color="error">issue × {run!.validationIssues!.length}</Tag>
                ) : null}
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
              <ClusterTasksPanel
                cluster={cluster}
                run={run}
                edits={edits}
                requirementsIndex={state.requirementsIndex}
                api={api}
                effectiveTasks={effectiveTasks}
                writeResult={writeResult}
                verifying={verifyingClusterId === cluster.id}
                onAnchorView={(taskId) => openAnchorViewer(cluster, effectiveTasks, taskId)}
                onRunVerifier={() => runVerifier(cluster)}
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
          api={api}
          run={state.clusterRuns[anchorViewer.cluster.id]}
          edits={state.editsByCluster[anchorViewer.cluster.id]}
          onClose={() => setAnchorViewer(null)}
          onFocusTask={(taskId) =>
            setAnchorViewer((curr) => (curr ? { ...curr, focusedTaskId: taskId } : null))
          }
        />
      ) : null}
    </div>
  );
}

function ClusterTasksPanel({
  cluster,
  run,
  edits,
  api,
  effectiveTasks,
  writeResult,
  verifying,
  onAnchorView,
  onRunVerifier,
}: {
  cluster: ClusterPlanItem;
  run: ClusterRunState | undefined;
  edits: ClusterEditState | undefined;
  requirementsIndex: RequirementsIndexV2 | null;
  api: UseSplitWizardStateApi;
  effectiveTasks: TaskItem[];
  writeResult: { childTaskNames: string[]; warnings: string[]; error?: string } | undefined;
  verifying: boolean;
  onAnchorView: (taskId: string | null) => void;
  onRunVerifier: () => void;
}) {
  if (!run || !run.normalized) {
    return (
      <Typography.Text type="warning">
        未拿到 normalized 拆分结果（unchanged 跳过 / 失败请回到派发阶段）。
      </Typography.Text>
    );
  }
  const hasIssues = (run.validationIssues?.length ?? 0) > 0;
  const requirementOptions = cluster.requirementIds.map((id) => ({ value: id, label: id }));

  const addManualTask = () => {
    const ordinal = effectiveTasks.length + 1;
    const newTask: TaskItem = {
      id: `manual-${cluster.id}-${Date.now()}`,
      title: "新任务",
      description: "（请补充任务说明）",
      role: deriveDefaultRole(effectiveTasks, cluster),
      size: "M",
      estimateDays: 2,
      dependencies: [],
      sourceRefs: [],
      sourceRequirementIds: cluster.requirementIds.slice(0, 1),
      subtasks: [],
      dod: [],
      executionStatus: "executable",
      executionStatusManual: true,
      flowStatus: "todo",
    };
    api.addManualTask(cluster.id, newTask);
    message.info(`已新增任务 #${ordinal}（手工创建）`);
  };

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
      <Space wrap>
        <Button size="small" icon={<PlusOutlined />} onClick={addManualTask}>
          新增任务
        </Button>
        <Button size="small" icon={<FileSearchOutlined />} onClick={() => onAnchorView(null)}>
          锚点速览（高亮所有任务）
        </Button>
        {hasIssues ? (
          <Tooltip title="派遣 trellis-verifier 子代理，基于现有 issue 列表自动修复输出">
            <Button
              size="small"
              type="primary"
              ghost
              icon={<SafetyCertificateOutlined />}
              loading={verifying}
              onClick={onRunVerifier}
            >
              派遣 verifier（{run.validationIssues!.length} 条 issue）
            </Button>
          </Tooltip>
        ) : null}
        {edits && (Object.keys(edits.patches).length > 0 || edits.manualTasks.length > 0 || edits.deletedTaskIds.length > 0) ? (
          <Button
            size="small"
            danger
            icon={<UndoOutlined />}
            onClick={() => api.discardClusterEdits(cluster.id)}
          >
            放弃本 cluster 编辑
          </Button>
        ) : null}
      </Space>

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

      {edits?.deletedTaskIds.length ? (
        <DeletedTasksBanner
          deletedIds={edits.deletedTaskIds}
          onRestore={(taskId) => api.restoreTask(cluster.id, taskId)}
        />
      ) : null}

      {effectiveTasks.map((task, idx) => (
        <TaskEditorCard
          key={task.id}
          index={idx}
          cluster={cluster}
          task={task}
          edits={edits}
          requirementOptions={requirementOptions}
          api={api}
          onAnchorView={() => onAnchorView(task.id)}
        />
      ))}
    </Space>
  );
}

function DeletedTasksBanner({
  deletedIds,
  onRestore,
}: {
  deletedIds: string[];
  onRestore: (taskId: string) => void;
}) {
  return (
    <Alert
      type="warning"
      message={`已剔除 ${deletedIds.length} 个任务（落盘时不写入）`}
      description={
        <Space wrap size={4}>
          {deletedIds.map((id) => (
            <Tag key={id} closable={false}>
              <Typography.Text code>{id}</Typography.Text>{" "}
              <Button size="small" type="link" onClick={() => onRestore(id)}>
                恢复
              </Button>
            </Tag>
          ))}
        </Space>
      }
    />
  );
}

function TaskEditorCard({
  index,
  cluster,
  task,
  edits,
  requirementOptions,
  api,
  onAnchorView,
}: {
  index: number;
  cluster: ClusterPlanItem;
  task: TaskItem;
  edits: ClusterEditState | undefined;
  requirementOptions: { value: string; label: string }[];
  api: UseSplitWizardStateApi;
  onAnchorView: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const edited = isEditedTask(task, edits);
  const manual = isManualTask(task, edits);

  const onPatch = (field: keyof TaskItem, value: unknown) => {
    if (manual) {
      api.patchManualTask(cluster.id, task.id, { [field]: value } as Partial<TaskItem>);
    } else {
      api.patchTaskEdit(cluster.id, task.id, { [field]: value as never });
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <Tag color={taskColorByIndex(index)} style={{ minWidth: 24, textAlign: "center" }}>
            #{index + 1}
          </Tag>
          {editMode ? (
            <Input
              value={task.title}
              onChange={(e) => onPatch("title", e.target.value)}
              size="small"
              style={{ width: 320 }}
            />
          ) : (
            <Typography.Text strong>{task.title}</Typography.Text>
          )}
          {manual ? <Tag color="blue">新增</Tag> : edited ? <Tag color="warning">已改</Tag> : null}
        </Space>
      }
      extra={
        <Space size={4}>
          {task.taskAnchors ? (
            <Tooltip title="在 PRD 中高亮本任务对应原文段">
              <Button size="small" icon={<FileSearchOutlined />} onClick={onAnchorView}>
                PRD 锚点
              </Button>
            </Tooltip>
          ) : null}
          <Button
            size="small"
            type={editMode ? "primary" : "default"}
            icon={<EditOutlined />}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? "完成" : "编辑"}
          </Button>
          <Tooltip title={manual ? "从手动任务列表移除" : "标记删除（落盘时不写入；可恢复）"}>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                if (manual) api.removeManualTask(cluster.id, task.id);
                else api.deleteTask(cluster.id, task.id);
              }}
            />
          </Tooltip>
        </Space>
      }
    >
      <Space wrap size={4} style={{ marginBlockEnd: 8 }}>
        {editMode ? (
          <Select
            size="small"
            value={task.role}
            onChange={(v: TaskRole) => onPatch("role", v)}
            style={{ minWidth: 110 }}
            options={[
              { value: "frontend", label: "前端 frontend" },
              { value: "backend", label: "后端 backend" },
              { value: "document", label: "文档 document" },
            ]}
          />
        ) : (
          <Tag color={roleColor(task.role)}>{task.role}</Tag>
        )}
        <Tag>{task.size}</Tag>
        <Tag>预估 {task.estimateDays} d</Tag>
        {task.executionStatus === "not_executable" ? (
          <Tag color="warning">not_executable</Tag>
        ) : null}
      </Space>

      {editMode ? (
        <Form layout="vertical" size="small" component="div">
          <Form.Item label="描述">
            <Input.TextArea
              value={task.description}
              onChange={(e) => onPatch("description", e.target.value)}
              autoSize={{ minRows: 2, maxRows: 8 }}
            />
          </Form.Item>
          <Form.Item label="溯源 requirement">
            <Select
              mode="multiple"
              value={task.sourceRequirementIds}
              onChange={(v: string[]) => onPatch("sourceRequirementIds", v)}
              options={requirementOptions}
              size="small"
            />
          </Form.Item>
          <Form.Item label={`子项（${task.subtasks.length}）`}>
            <ListEditor
              items={task.subtasks}
              onChange={(items) => onPatch("subtasks", items)}
              placeholder="添加一条子项"
            />
          </Form.Item>
          <Form.Item label={`DoD（${task.dod.length}）`}>
            <ListEditor
              items={task.dod}
              onChange={(items) => onPatch("dod", items)}
              placeholder="添加一条验收标准"
            />
          </Form.Item>
        </Form>
      ) : (
        <>
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
        </>
      )}
    </Card>
  );
}

function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <Space orientation="vertical" size={4} style={{ width: "100%" }}>
      {items.map((item, idx) => (
        <Space key={idx} style={{ width: "100%" }}>
          <Input
            size="small"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[idx] = e.target.value;
              onChange(next);
            }}
            style={{ flex: 1, minWidth: 320 }}
          />
          <Button
            size="small"
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
          />
        </Space>
      ))}
      <Space style={{ width: "100%" }}>
        <Input
          size="small"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => {
            const v = draft.trim();
            if (v) {
              onChange([...items, v]);
              setDraft("");
            }
          }}
          style={{ flex: 1, minWidth: 320 }}
        />
        <Button
          size="small"
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => {
            const v = draft.trim();
            if (v) {
              onChange([...items, v]);
              setDraft("");
            }
          }}
        >
          添加
        </Button>
      </Space>
    </Space>
  );
}

function AnchorViewerModal({
  state,
  prd,
  requirementsIndex,
  api,
  run,
  edits,
  onClose,
  onFocusTask,
}: {
  state: AnchorViewerState;
  prd: PrdDocument | null;
  requirementsIndex: RequirementsIndexV2 | null;
  api: UseSplitWizardStateApi;
  run: ClusterRunState | undefined;
  edits: ClusterEditState | undefined;
  onClose: () => void;
  onFocusTask: (taskId: string | null) => void;
}) {
  const { cluster, focusedTaskId } = state;
  const containerRef = useRef<HTMLDivElement>(null);
  const [shiftDelta, setShiftDelta] = useState<number>(10);
  const [selectionVersion, setSelectionVersion] = useState(0);

  const clusterPrd = useMemo(() => {
    if (!prd || !requirementsIndex) return "";
    return buildClusterPrdMarkdown(prd, requirementsIndex, cluster.requirementIds);
  }, [prd, requirementsIndex, cluster.requirementIds]);

  // 每次 edits / run 变化时重算 effective tasks，保证 modal 内显示与 patch 同步。
  const tasks: TaskItem[] = useMemo(
    () => (run?.normalized ? applyTaskEdits(run.normalized.splitTasks, edits) : []),
    [run, edits],
  );

  const ranges: HighlightRange[] = useMemo(
    () =>
      tasks
        .filter((t) => t.taskAnchors)
        .map((t) => ({ from: t.taskAnchors!.from, to: t.taskAnchors!.to, taskId: t.id })),
    [tasks],
  );

  const segments = useMemo(() => buildHighlightSegments(clusterPrd, ranges), [clusterPrd, ranges]);

  const focusedTask = useMemo(
    () => tasks.find((t) => t.id === focusedTaskId) ?? null,
    [tasks, focusedTaskId],
  );

  const writeAnchorForTask = (task: TaskItem, anchor: TaskAnchorDescriptor) => {
    if (isManualTask(task, edits)) {
      api.patchManualTask(cluster.id, task.id, { taskAnchors: anchor });
    } else {
      api.patchTaskEdit(cluster.id, task.id, { taskAnchors: anchor });
    }
  };

  const resetAnchorForTask = (task: TaskItem) => {
    if (isManualTask(task, edits)) {
      // manual task 无原始锚点，无法 "复原"；直接清空。
      api.patchManualTask(cluster.id, task.id, { taskAnchors: undefined });
      return;
    }
    api.clearTaskAnchorEdit(cluster.id, task.id);
  };

  const commitSelectionToFocused = () => {
    if (!focusedTask || !containerRef.current) return;
    const offset = captureSelectionOffset(containerRef.current);
    if (!offset) {
      message.warning("请先在 PRD 视图中选中一段非空文本");
      return;
    }
    const anchor = deriveAnchorFromRange(clusterPrd, offset.from, offset.to);
    writeAnchorForTask(focusedTask, anchor);
    message.success(`已把选段写入 ${focusedTask.id} 的锚点（${anchor.to - anchor.from} 字符）`);
    window.getSelection()?.removeAllRanges();
    setSelectionVersion((v) => v + 1);
  };

  const shiftEdge = (edge: "start" | "end", delta: number) => {
    if (!focusedTask) return;
    if (!focusedTask.taskAnchors) {
      message.warning("当前任务尚无锚点 — 先用「选段→锚点」建立一个");
      return;
    }
    const next = shiftAnchorEdge(focusedTask.taskAnchors, edge, delta, clusterPrd);
    writeAnchorForTask(focusedTask, next);
  };

  const isFocusedEdited = focusedTask
    ? Boolean(edits?.patches[focusedTask.id]?.taskAnchors)
    : false;

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
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <AnchorEditToolbar
          focusedTask={focusedTask}
          isEdited={isFocusedEdited}
          shiftDelta={shiftDelta}
          onShiftDeltaChange={setShiftDelta}
          onCommitSelection={commitSelectionToFocused}
          onShiftEdge={shiftEdge}
          onReset={() => focusedTask && resetAnchorForTask(focusedTask)}
        />
        <div style={{ display: "flex", gap: 12, maxHeight: "60vh" }}>
          <div
            ref={containerRef}
            // 监听 selection 变化以驱动「选段→锚点」按钮的 enable 态。
            onMouseUp={() => setSelectionVersion((v) => v + 1)}
            onKeyUp={() => setSelectionVersion((v) => v + 1)}
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
              userSelect: "text",
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
            {/* 占位防止 lint：selectionVersion 仅用于触发 toolbar 重渲染 */}
            <span hidden>{selectionVersion}</span>
          </div>

          <div
            style={{
              width: 280,
              overflow: "auto",
              borderLeft: "1px solid #f0f0f0",
              paddingInlineStart: 12,
            }}
          >
            <Typography.Text strong>任务列表</Typography.Text>
            <ul style={{ paddingInlineStart: 18, marginBlock: 8 }}>
              {tasks.map((task, idx) => {
                const taskEdited = Boolean(edits?.patches[task.id]?.taskAnchors);
                return (
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
                      {truncate(task.title, 22)}
                      {taskEdited ? (
                        <Tag color="warning" style={{ marginInlineStart: 4 }}>
                          锚点已改
                        </Tag>
                      ) : null}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              click 高亮段或左侧任务选中焦点；选中焦点后用上方工具栏在 PRD 里选段或微调 from/to。
            </Typography.Text>
          </div>
        </div>
      </Space>
    </Modal>
  );
}

function AnchorEditToolbar({
  focusedTask,
  isEdited,
  shiftDelta,
  onShiftDeltaChange,
  onCommitSelection,
  onShiftEdge,
  onReset,
}: {
  focusedTask: TaskItem | null;
  isEdited: boolean;
  shiftDelta: number;
  onShiftDeltaChange: (v: number) => void;
  onCommitSelection: () => void;
  onShiftEdge: (edge: "start" | "end", delta: number) => void;
  onReset: () => void;
}) {
  if (!focusedTask) {
    return (
      <Alert
        type="info"
        showIcon
        message="先在右侧任务列表点一项作为「焦点任务」，工具栏会展开"
      />
    );
  }
  const anchor = focusedTask.taskAnchors;
  return (
    <Card size="small" bodyStyle={{ padding: 8 }}>
      <Space wrap size={6}>
        <Typography.Text strong>焦点：</Typography.Text>
        <Tag color="processing">{focusedTask.id}</Tag>
        <Typography.Text>{truncate(focusedTask.title, 28)}</Typography.Text>
        {anchor ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            [{anchor.from}, {anchor.to}] · {anchor.to - anchor.from} chars
          </Typography.Text>
        ) : (
          <Tag>无锚点</Tag>
        )}
        {isEdited ? <Tag color="warning">已改</Tag> : null}

        <Tooltip title="将 PRD 视图中当前选中的文本写入焦点任务的锚点（覆盖）">
          <Button size="small" type="primary" onClick={onCommitSelection}>
            选段→锚点
          </Button>
        </Tooltip>

        <span>微调步长：</span>
        <InputNumber
          size="small"
          min={1}
          max={500}
          value={shiftDelta}
          onChange={(v) => onShiftDeltaChange(typeof v === "number" ? v : 10)}
          style={{ width: 70 }}
        />
        <Tooltip title="左缘左移（扩大）">
          <Button size="small" disabled={!anchor} onClick={() => onShiftEdge("start", -shiftDelta)}>
            ↤ -{shiftDelta}
          </Button>
        </Tooltip>
        <Tooltip title="左缘右移（缩小）">
          <Button size="small" disabled={!anchor} onClick={() => onShiftEdge("start", shiftDelta)}>
            ↦ +{shiftDelta}
          </Button>
        </Tooltip>
        <Tooltip title="右缘右移（扩大）">
          <Button size="small" disabled={!anchor} onClick={() => onShiftEdge("end", shiftDelta)}>
            ↦ +{shiftDelta}
          </Button>
        </Tooltip>
        <Tooltip title="右缘左移（缩小）">
          <Button size="small" disabled={!anchor} onClick={() => onShiftEdge("end", -shiftDelta)}>
            ↤ -{shiftDelta}
          </Button>
        </Tooltip>
        <Tooltip title="复原到 splitter 生成的原始锚点（清除本地 patch）">
          <Button size="small" icon={<UndoOutlined />} disabled={!isEdited} onClick={onReset}>
            复原
          </Button>
        </Tooltip>
      </Space>
    </Card>
  );
}

function deriveDefaultRole(existingTasks: TaskItem[], cluster: ClusterPlanItem): TaskRole {
  // 用已有任务的多数 role；否则按 cluster repo type 默认。
  const counts = new Map<TaskRole, number>();
  for (const t of existingTasks) counts.set(t.role, (counts.get(t.role) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) return sorted[0][0];
  // 没有可参考任务时，从 cluster id 猜（cluster id 形如 cluster-frontend-1 / cluster-backend-1 / cluster-document-1）
  if (cluster.id.includes("frontend")) return "frontend";
  if (cluster.id.includes("backend")) return "backend";
  if (cluster.id.includes("document")) return "document";
  return "frontend";
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
