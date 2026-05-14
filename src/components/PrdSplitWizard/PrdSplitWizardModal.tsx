import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, Radio, Result, Select, Space, Steps, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { ClusterPlanStage } from "./stages/ClusterPlanStage";
import { InputStage } from "./stages/InputStage";
import { ReviewStage } from "./stages/ReviewStage";
import { SplitsStage } from "./stages/SplitsStage";
import { useSplitWizardState } from "./useSplitWizardState";
import type { ProjectItem, Repository } from "../../types";
import {
  projectToPrdSplitTarget,
  repositoryToPrdSplitTarget,
  type PrdSplitTargetKind,
} from "./targetModel";

const STEP_KEYS = ["input", "plan", "dispatch", "review"] as const;
type StepKey = (typeof STEP_KEYS)[number];
const STEP_TITLES: Record<StepKey, string> = {
  input: "PRD",
  plan: "Cluster",
  dispatch: "派发",
  review: "Review",
};

export interface PrdSplitWizardModalProps {
  open: boolean;
  onClose: () => void;
  /** 可用项目列表（用于选择目标项目）。 */
  projects: ProjectItem[];
  /** 全部仓库列表（按 id 索引；wizard 取项目下挂载的子集，或在 repo 模式下作为可选目标）。 */
  repositories: Repository[];
  /** 初始项目；空表示让用户在 wizard 内选。 */
  initialProjectId?: string | null;
  /** 初始单仓目标；若 initialProjectId 缺省且本字段存在，wizard 进 repo 模式。 */
  initialRepositoryId?: number | null;
}

export function PrdSplitWizardModal({
  open,
  onClose,
  projects,
  repositories,
  initialProjectId,
  initialRepositoryId,
}: PrdSplitWizardModalProps) {
  const api = useSplitWizardState();
  const { state } = api;
  const [targetKind, setTargetKind] = useState<PrdSplitTargetKind>("project");

  const eligibleProjects = useMemo(
    () => projects.filter((p) => (p.rootPath ?? "").trim().length > 0),
    [projects],
  );
  const eligibleRepositories = useMemo(
    () => repositories.filter((r) => (r.path ?? "").trim().length > 0),
    [repositories],
  );

  const ensureProjectTarget = useCallback(
    (projectId: string | null | undefined) => {
      if (!projectId) return;
      const project = eligibleProjects.find((p) => p.id === projectId);
      if (!project) return;
      const target = projectToPrdSplitTarget(project, repositories);
      api.reset(target.project, target.repositories, target.context);
    },
    [api, eligibleProjects, repositories],
  );

  const ensureRepositoryTarget = useCallback(
    (repoId: number | null | undefined) => {
      if (repoId == null) return;
      const repo = eligibleRepositories.find((r) => r.id === repoId);
      if (!repo) return;
      const target = repositoryToPrdSplitTarget(repo);
      api.reset(target.project, target.repositories, target.context);
    },
    [api, eligibleRepositories],
  );

  const onTargetKindChange = useCallback(
    (next: PrdSplitTargetKind) => {
      if (next === targetKind) return;
      setTargetKind(next);
      api.reset(null, [], null);
    },
    [api, targetKind],
  );

  // 首次 open 时初始化目标：优先项目入口，其次单仓入口，最后单一项目自动选。
  useEffect(() => {
    if (!open) return;
    if (state.project) return;
    if (initialProjectId) {
      setTargetKind("project");
      ensureProjectTarget(initialProjectId);
      return;
    }
    if (initialRepositoryId != null) {
      setTargetKind("repository");
      ensureRepositoryTarget(initialRepositoryId);
      return;
    }
    if (eligibleProjects.length === 1) {
      ensureProjectTarget(eligibleProjects[0].id);
    }
  }, [
    open,
    state.project,
    initialProjectId,
    initialRepositoryId,
    eligibleProjects,
    ensureProjectTarget,
    ensureRepositoryTarget,
  ]);

  const stageKey: StepKey = useMemo(() => {
    if (state.stage === "input") return "input";
    if (state.stage === "plan") return "plan";
    if (state.stage === "dispatch") return "dispatch";
    return "review";
  }, [state.stage]);

  const currentStepIndex = STEP_KEYS.indexOf(stageKey);

  // 追踪用户已到达的最大步骤，用于约束 Steps 只能跳到已到达的 step。
  const maxReachedRef = useRef(0);
  if (currentStepIndex > maxReachedRef.current) {
    maxReachedRef.current = currentStepIndex;
  }
  // wizard 重置 / 切项目时回到 0
  useEffect(() => {
    if (!open) maxReachedRef.current = 0;
  }, [open]);
  useEffect(() => {
    if (state.stage === "input" && state.basePlan === null) {
      maxReachedRef.current = 0;
    }
  }, [state.stage, state.basePlan]);

  const onStepClick = useCallback(
    (idx: number) => {
      if (idx === currentStepIndex) return;
      if (idx > maxReachedRef.current) return;
      const target = STEP_KEYS[idx];
      if (target === "input") {
        Modal.confirm({
          title: "回到 PRD 编辑？",
          icon: <ExclamationCircleOutlined />,
          content: "会清空 cluster 编辑 / splitter 输出 / 任务编辑（PRD 文本保留）。",
          okText: "确认回到 PRD",
          cancelText: "取消",
          onOk: () => api.backToInput(),
        });
        return;
      }
      if (target === "plan") api.backToPlan();
      else if (target === "dispatch") api.backToDispatch();
      // review 跳转目前无 backToReview action；保留按钮路径
    },
    [api, currentStepIndex],
  );

  const onNextFromInput = useCallback(() => {
    if (!state.project) {
      api.setGlobalError("请先选择目标项目");
      return;
    }
    const result = api.parseAndPlan();
    if (!result.ok) {
      api.setGlobalError(result.reason);
    }
  }, [api, state.project]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width="min(1100px, 92vw)"
      footer={null}
      mask={{ closable: false }}
      title="需求拆分 · Trellis Artifact Pipeline"
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <TargetPicker
          targetKind={targetKind}
          onTargetKindChange={onTargetKindChange}
          eligibleProjects={eligibleProjects}
          eligibleRepositories={eligibleRepositories}
          selectedProjectId={
            state.context?.mode === "project" ? state.project?.id ?? null : null
          }
          selectedRepositoryId={
            state.context?.mode === "repository"
              ? state.context.repositoryId ?? null
              : null
          }
          onPickProject={ensureProjectTarget}
          onPickRepository={ensureRepositoryTarget}
        />

        <Steps
          size="small"
          current={currentStepIndex}
          onChange={onStepClick}
          items={STEP_KEYS.map((key, idx) => ({
            title: STEP_TITLES[key],
            disabled: idx > maxReachedRef.current,
          }))}
        />

        <div style={{ minHeight: 320 }}>
          {state.stage === "input" ? (
            <InputStage api={api} />
          ) : state.stage === "plan" ? (
            <ClusterPlanStage api={api} />
          ) : state.stage === "dispatch" ? (
            <SplitsStage api={api} />
          ) : state.stage === "review" ? (
            <ReviewStage api={api} />
          ) : state.stage === "writing" ? (
            <Result status="info" title="正在落盘…" subTitle="请勿关闭窗口" />
          ) : state.stage === "done" ? (
            <Result
              status="success"
              title="Trellis 任务已落盘完成"
              subTitle={`共写入 ${state.writeResults.reduce((sum, r) => sum + r.childTaskNames.length, 0)} 个子任务（跨 ${state.writeResults.length} 个 cluster 父任务）`}
              extra={[
                <Button key="close" onClick={onClose} type="primary">
                  关闭
                </Button>,
                <Button key="again" onClick={() => api.backToInput()}>
                  再拆一个 PRD
                </Button>,
              ]}
            />
          ) : null}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Space>
            <Button onClick={onClose}>取消</Button>
          </Space>
          <Space>
            {state.stage === "input" ? (
              <Button type="primary" onClick={onNextFromInput} disabled={!state.project}>
                下一步：规划 cluster
              </Button>
            ) : null}
            {state.stage === "plan" ? (
              <>
                <Button onClick={() => api.backToInput()}>返回</Button>
                <Button
                  type="primary"
                  onClick={() => api.goToDispatch()}
                  disabled={(state.plan?.clusters.length ?? 0) === 0}
                >
                  下一步：派发
                </Button>
              </>
            ) : null}
            {state.stage === "dispatch" ? (
              <>
                <Button onClick={() => api.backToPlan()}>返回</Button>
              </>
            ) : null}
            {state.stage === "review" ? (
              <>
                <Button onClick={() => api.backToDispatch()}>返回派发</Button>
              </>
            ) : null}
          </Space>
        </div>
      </Space>
    </Modal>
  );
}

function TargetPicker({
  targetKind,
  onTargetKindChange,
  eligibleProjects,
  eligibleRepositories,
  selectedProjectId,
  selectedRepositoryId,
  onPickProject,
  onPickRepository,
}: {
  targetKind: PrdSplitTargetKind;
  onTargetKindChange: (kind: PrdSplitTargetKind) => void;
  eligibleProjects: ProjectItem[];
  eligibleRepositories: Repository[];
  selectedProjectId: string | null;
  selectedRepositoryId: number | null;
  onPickProject: (projectId: string) => void;
  onPickRepository: (repoId: number) => void;
}) {
  return (
    <Space orientation="vertical" size={6} style={{ width: "100%" }}>
      <Space>
        <Typography.Text strong>拆分目标：</Typography.Text>
        <Radio.Group
          size="small"
          value={targetKind}
          onChange={(e) => onTargetKindChange(e.target.value as PrdSplitTargetKind)}
        >
          <Radio.Button value="project">项目（含多/单仓）</Radio.Button>
          <Radio.Button value="repository">单仓库（含游离）</Radio.Button>
        </Radio.Group>
      </Space>
      {targetKind === "project" ? (
        eligibleProjects.length === 0 ? (
          <Typography.Text type="warning">
            暂无可用项目（项目需配置 <code>rootPath</code> 且目录含 <code>.trellis/</code>）。可切到「单仓库」直接拆分。
          </Typography.Text>
        ) : (
          <Select
            style={{ minWidth: 360 }}
            value={selectedProjectId ?? undefined}
            placeholder="选择项目"
            options={eligibleProjects.map((p) => ({
              value: p.id,
              label: `${p.name}（${p.rootPath}）`,
            }))}
            onChange={onPickProject}
          />
        )
      ) : eligibleRepositories.length === 0 ? (
        <Typography.Text type="warning">暂无可用仓库。</Typography.Text>
      ) : (
        <>
          <Select
            style={{ minWidth: 480 }}
            value={selectedRepositoryId ?? undefined}
            placeholder="选择目标仓库"
            options={eligibleRepositories.map((r) => ({
              value: r.id,
              label: `${r.name} · ${labelOfRepoType(r.repositoryType)}（${r.path}）`,
            }))}
            onChange={onPickRepository}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            仓库目录需含 <code>.trellis/scripts/task.py</code>；否则派发到落盘阶段会被后端拒绝。
          </Typography.Text>
        </>
      )}
    </Space>
  );
}

function labelOfRepoType(type: Repository["repositoryType"]): string {
  if (type === "frontend") return "前端";
  if (type === "backend") return "后端";
  return "文档";
}
