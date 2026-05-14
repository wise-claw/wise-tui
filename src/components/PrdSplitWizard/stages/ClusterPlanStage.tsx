import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  ArrowRightOutlined,
  CloseOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import type { UseSplitWizardStateApi } from "../useSplitWizardState";
import type { ClusterDiffStatus } from "../types";
import type { Repository } from "../../../types";
import {
  nextManualClusterId,
  peekAffectedClusterEdits,
} from "../clusterPlanEdits";

interface Props {
  api: UseSplitWizardStateApi;
}

export function ClusterPlanStage({ api }: Props) {
  const { state } = api;
  const plan = state.plan;
  const [manualModalOpen, setManualModalOpen] = useState(false);

  // 进入 plan 阶段后自动扫描历史父任务，构建 diff。
  useEffect(() => {
    if (state.plan && state.existingParents === null) {
      void api.refreshExistingParents();
    }
  }, [state.plan, state.existingParents, api]);

  // 用户编辑 clusterPlanEdits（reassign / 新建 / rename）后去抖刷新 diff。
  // 首次进 plan 时 clusterPlanEdits 是空对象引用，跳过初次触发以避免与上面的 effect 重复。
  const firstEditsRef = useRef(true);
  useEffect(() => {
    if (firstEditsRef.current) {
      firstEditsRef.current = false;
      return;
    }
    if (!state.basePlan) return;
    const handle = window.setTimeout(() => {
      void api.refreshExistingParents();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [state.clusterPlanEdits, state.basePlan, api]);

  const isDispatching = useMemo(
    () =>
      Object.values(state.clusterRuns).some(
        (r) => r.status === "dispatching" || r.status === "creating-parent",
      ),
    [state.clusterRuns],
  );

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
  const hasPlanEdits =
    Object.keys(state.clusterPlanEdits.reassignedRequirements).length > 0 ||
    state.clusterPlanEdits.manualClusters.length > 0 ||
    Object.keys(state.clusterPlanEdits.titleOverrides).length > 0;
  const isRepoMode = state.context?.mode === "repository";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message="第 2 步 · 审阅任务分组"
        description={
          isRepoMode ? (
            <Typography.Paragraph style={{ margin: 0 }}>
              单仓模式：所有 requirement 会归到唯一一个任务分组，并独立生成任务。
              下方可以调整 requirement、重命名分组；多分组编辑只在多仓项目模式下启用。
            </Typography.Paragraph>
          ) : (
            <Typography.Paragraph style={{ margin: 0 }}>
              每个任务分组会单独生成任务，并行执行。子任务归属由分组的主仓决定。
              点击 requirement 标签可把它<strong>移到其他分组</strong>；点击分组标题旁的编辑按钮可<strong>重命名</strong>；底部「+ 新建分组」可<strong>手工新建</strong>。
            </Typography.Paragraph>
          )
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
            <Tag color="success">可沿用 · {unchangedCount}</Tag>
            <Tag color="warning">有变化 · {dirtyCount}</Tag>
            <Tag color="blue">新建 · {newCount}</Tag>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            未发现历史父任务（首拆）
          </Typography.Text>
        )}
        {hasPlanEdits ? (
          <Tooltip title="把任务分组编辑（移动 / 重命名 / 手工新建）全部清空，回到默认方案">
            <Button
              size="small"
              danger
              icon={<UndoOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: "清空任务分组编辑？",
                  content: "已移动的 requirement、已重命名的分组、手工新建的分组都会还原；任务编辑不受影响。",
                  okText: "清空",
                  cancelText: "取消",
                  onOk: () => api.resetClusterPlanEdits(),
                });
              }}
              disabled={isDispatching}
            >
              清空 plan 编辑
            </Button>
          </Tooltip>
        ) : null}
        {isDispatching ? (
          <Tag color="processing">派发中 · 编辑暂停</Tag>
        ) : null}
      </Space>

      {plan.diagnostics.crossRepoRequirements.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`检测到 ${plan.diagnostics.crossRepoRequirements.length} 条跨仓需求`}
          description={
            <Typography.Text>
              这些 requirement 在多个仓位上都有强匹配信号：{plan.diagnostics.crossRepoRequirements.join(", ")}。
              可点击 requirement 标签手动移到合适的分组。
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
            allClusters={plan.clusters}
            api={api}
            isDispatching={isDispatching}
            isManualCluster={state.clusterPlanEdits.manualClusters.some((c) => c.id === cluster.id)}
            reassignedRequirements={state.clusterPlanEdits.reassignedRequirements}
            titleOverrides={state.clusterPlanEdits.titleOverrides}
          />
        ))}
      </Space>

      <div>
        <Button
          icon={<PlusOutlined />}
          onClick={() => setManualModalOpen(true)}
          disabled={isDispatching || isRepoMode}
        >
          新建分组
        </Button>
        {isRepoMode ? (
          <Typography.Text type="secondary" style={{ marginInlineStart: 8, fontSize: 12 }}>
            单仓模式下不支持新建额外分组
          </Typography.Text>
        ) : null}
      </div>

      {plan.diagnostics.requirementsCoverage.orphan.length > 0 ? (
        <Alert
          type="warning"
          message={`存在 ${plan.diagnostics.requirementsCoverage.orphan.length} 条 orphan 需求（未挂到任何仓位）`}
          description={plan.diagnostics.requirementsCoverage.orphan.join(", ")}
        />
      ) : null}

      <ManualClusterModal
        open={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        api={api}
      />
    </div>
  );
}

function ClusterCard({
  cluster,
  diff,
  allClusters,
  api,
  isDispatching,
  isManualCluster,
  reassignedRequirements,
  titleOverrides,
}: {
  cluster: ClusterPlanItem;
  diff?: ClusterDiffStatus;
  allClusters: ClusterPlanItem[];
  api: UseSplitWizardStateApi;
  isDispatching: boolean;
  isManualCluster: boolean;
  reassignedRequirements: Record<string, string>;
  titleOverrides: Record<string, string>;
}) {
  const renamed = cluster.id in titleOverrides;
  return (
    <Card
      size="small"
      title={
        <Space>
          <Typography.Text code>{cluster.id}</Typography.Text>
          <ClusterTitleEditor
            title={cluster.title}
            renamed={renamed}
            disabled={isDispatching}
            onRename={(t) => api.renameCluster(cluster.id, t)}
          />
          <DiffBadge diff={diff} />
          {isManualCluster ? <Tag color="blue">手工</Tag> : null}
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
        {cluster.requirementIds.length === 0 ? (
          <Typography.Text type="secondary" italic>（空分组，可从其他分组移入 requirement）</Typography.Text>
        ) : null}
        {cluster.requirementIds.map((reqId) => (
          <RequirementTag
            key={reqId}
            requirementId={reqId}
            sourceClusterId={cluster.id}
            allClusters={allClusters}
            api={api}
            isReassigned={reqId in reassignedRequirements}
            disabled={isDispatching}
          />
        ))}
      </Typography.Paragraph>
      {cluster.dependencyClusterIds.length > 0 ? (
        <Typography.Paragraph style={{ margin: 0, marginBlockStart: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>依赖分组：</Typography.Text>{" "}
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
          已有父任务：<code>{diff.existingParent.parentTaskName}</code>，这次输入没有新变化。
        </Typography.Paragraph>
      ) : null}
    </Card>
  );
}

function RequirementTag({
  requirementId,
  sourceClusterId,
  allClusters,
  api,
  isReassigned,
  disabled,
}: {
  requirementId: string;
  sourceClusterId: string;
  allClusters: ClusterPlanItem[];
  api: UseSplitWizardStateApi;
  isReassigned: boolean;
  disabled: boolean;
}) {
  const targets = allClusters.filter((c) => c.id !== sourceClusterId);

  const doReassign = (targetClusterId: string) => {
    const affected = peekAffectedClusterEdits(
      { plan: api.state.plan, editsByCluster: api.state.editsByCluster },
      { type: "reassign-requirement", requirementId, targetClusterId },
    );
    const exec = () => {
      api.reassignRequirement(requirementId, targetClusterId);
      for (const cid of affected) api.discardClusterEdits(cid);
      message.success(`已移动 ${requirementId} → ${targetClusterId}`);
    };
    if (affected.length === 0) {
      exec();
      return;
    }
    Modal.confirm({
      title: "确认移动",
      content: `分组 ${affected.join(", ")} 已有人工任务编辑，移动会一并丢弃这些编辑。继续？`,
      okText: "丢弃并移动",
      okType: "danger",
      cancelText: "取消",
      onOk: exec,
    });
  };

  const items = [
    ...targets.map((c) => ({
      key: c.id,
      label: (
        <span>
          移到 <Typography.Text code>{c.id}</Typography.Text> · {c.title}
        </span>
      ),
      onClick: () => doReassign(c.id),
    })),
    ...(isReassigned
      ? [
          { type: "divider" as const },
          {
            key: "__undo__",
            label: (
              <span>
                <UndoOutlined /> 撤销移动（回到默认分组）
              </span>
            ),
            onClick: () => {
              api.undoReassign(requirementId);
              message.info(`已撤销 ${requirementId} 的移动`);
            },
          },
        ]
      : []),
  ];

  const tag = (
    <Tag
      color={isReassigned ? "warning" : undefined}
      style={{ marginBlockEnd: 4, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {requirementId}
      {isReassigned ? " ✱" : ""}
    </Tag>
  );

  if (disabled || items.length === 0) return tag;

  return (
    <Dropdown menu={{ items }} trigger={["click"]}>
      {tag}
    </Dropdown>
  );
}

function ClusterTitleEditor({
  title,
  renamed,
  disabled,
  onRename,
}: {
  title: string;
  renamed: boolean;
  disabled: boolean;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  if (editing) {
    return (
      <Space size={4}>
        <Input
          size="small"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => {
            onRename(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(title);
              setEditing(false);
            }
          }}
          style={{ width: 200 }}
        />
        <Tooltip title="Esc 取消">
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            onClick={() => {
              setDraft(title);
              setEditing(false);
            }}
          />
        </Tooltip>
      </Space>
    );
  }

  return (
    <Space size={2}>
      <Typography.Text strong>{title}</Typography.Text>
      {renamed ? <Tag color="warning">已改名</Tag> : null}
      <Tooltip title={disabled ? "生成中暂不可编辑" : "重命名分组（只影响界面显示，不改父任务 slug）"}>
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          disabled={disabled}
          onClick={() => {
            setDraft(title);
            setEditing(true);
          }}
        />
      </Tooltip>
    </Space>
  );
}

interface ManualClusterFormValues {
  title: string;
  primaryRepoId: number;
  extraRepoIds: number[];
}

function ManualClusterModal({
  open,
  onClose,
  api,
}: {
  open: boolean;
  onClose: () => void;
  api: UseSplitWizardStateApi;
}) {
  const [form] = Form.useForm<ManualClusterFormValues>();
  const repos = api.state.repositories;
  const selectedRepos = useMemo(() => {
    const ids = new Set(api.state.selectedRepositoryIds);
    if (ids.size === 0) return repos;
    return repos.filter((r) => ids.has(r.id));
  }, [repos, api.state.selectedRepositoryIds]);

  const handleSubmit = (values: ManualClusterFormValues) => {
    const primary = selectedRepos.find((r) => r.id === values.primaryRepoId);
    if (!primary) {
      message.error("primary 仓位不存在");
      return;
    }
    const id = nextManualClusterId(api.state.clusterPlanEdits, primary.type, primary.id);
    const repositoryIds = unique([primary.id, ...(values.extraRepoIds ?? [])]);
    const cluster: ClusterPlanItem = {
      id,
      title: values.title.trim() || `${primary.name} · 手工`,
      primaryRepositoryId: primary.id,
      repositoryIds,
      requirementIds: [],
      dependencyClusterIds: [],
    };
    api.addManualCluster(cluster);
    message.success(`已新建 ${id}`);
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      title="新建分组"
      okText="新建"
      cancelText="取消"
      onOk={() => form.submit()}
    >
      <Form<ManualClusterFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          title: "",
          primaryRepoId: selectedRepos[0]?.id,
          extraRepoIds: [],
        }}
        onFinish={handleSubmit}
      >
        <Form.Item
          name="title"
          label="分组标题"
          rules={[{ required: true, message: "请输入分组标题" }, { whitespace: true }]}
        >
          <Input placeholder="例：前端 · 主题切换专项" maxLength={64} />
        </Form.Item>
        <Form.Item
          name="primaryRepoId"
          label="主仓（决定子任务归属）"
          rules={[{ required: true, message: "请选择主仓" }]}
        >
          <Select<number>
            options={selectedRepos.map((r) => ({
              value: r.id,
              label: `${r.name}（${labelOfRepoType(r.type)}）`,
            }))}
            placeholder="选择主仓"
          />
        </Form.Item>
        <Form.Item name="extraRepoIds" label="额外参与仓位（可选）">
          <Select<number[]>
            mode="multiple"
            placeholder="跨仓需求可勾选额外仓位"
            options={selectedRepos.map((r) => ({
              value: r.id,
              label: `${r.name}（${labelOfRepoType(r.type)}）`,
            }))}
          />
        </Form.Item>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBlock: 0 }}>
          新建的分组初始 requirementIds 为空。可在分组卡上点击其他分组的 requirement 标签把它移过来。
        </Typography.Paragraph>
      </Form>
    </Modal>
  );
}

function DiffBadge({ diff }: { diff: ClusterDiffStatus | undefined }) {
  if (!diff) return null;
  if (diff.kind === "new") return <Tag color="blue">新建</Tag>;
  if (diff.kind === "unchanged") return <Tag color="success">可沿用</Tag>;
  return <Tag color="warning">有变化 · {diff.reasons.length} 项</Tag>;
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

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function labelOfRepoType(type: Repository["repositoryType"]): string {
  if (type === "frontend") return "前端";
  if (type === "backend") return "后端";
  return "文档";
}
