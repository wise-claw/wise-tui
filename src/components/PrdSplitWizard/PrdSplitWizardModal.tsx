import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Modal, Result, Select, Space, Steps, Typography } from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import { ClusterPlanStage } from "./stages/ClusterPlanStage";
import { InputStage } from "./stages/InputStage";
import { ReviewStage } from "./stages/ReviewStage";
import { SplitsStage } from "./stages/SplitsStage";
import { useSplitWizardState } from "./useSplitWizardState";
import type { ProjectRef } from "./types";
import type { ProjectItem, Repository } from "../../types";
import type { PlannerRepo } from "../../services/prdSplit/clusterPlanner";

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
  /** 全部仓库列表（按 id 索引；wizard 取项目下挂载的子集）。 */
  repositories: Repository[];
  /** 初始项目；空表示让用户在 wizard 内选。 */
  initialProjectId?: string | null;
}

export function PrdSplitWizardModal({
  open,
  onClose,
  projects,
  repositories,
  initialProjectId,
}: PrdSplitWizardModalProps) {
  const api = useSplitWizardState();
  const { state } = api;

  const eligibleProjects = useMemo(
    () => projects.filter((p) => (p.rootPath ?? "").trim().length > 0),
    [projects],
  );

  const ensureProject = useCallback(
    (projectId: string | null | undefined) => {
      if (!projectId) return;
      const project = eligibleProjects.find((p) => p.id === projectId);
      if (!project) return;
      const ref: ProjectRef = {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath!,
      };
      const repos: PlannerRepo[] = project.repositoryIds
        .map((id) => repositories.find((r) => r.id === id))
        .filter((r): r is Repository => Boolean(r))
        .map((r) => ({
          id: r.id,
          name: r.name,
          type: r.repositoryType,
          path: r.path,
        }));
      api.reset(ref, repos, { mode: "project", projectId: project.id, projectName: project.name });
    },
    [api, eligibleProjects, repositories],
  );

  // 首次 open 时初始化项目选择
  useEffect(() => {
    if (!open) return;
    if (state.project) return;
    if (initialProjectId) {
      ensureProject(initialProjectId);
      return;
    }
    if (eligibleProjects.length === 1) {
      ensureProject(eligibleProjects[0].id);
    }
  }, [open, state.project, initialProjectId, eligibleProjects, ensureProject]);

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
        <ProjectPicker
          eligibleProjects={eligibleProjects}
          selectedId={state.project?.id ?? null}
          onChange={ensureProject}
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

function ProjectPicker({
  eligibleProjects,
  selectedId,
  onChange,
}: {
  eligibleProjects: ProjectItem[];
  selectedId: string | null;
  onChange: (projectId: string) => void;
}) {
  if (eligibleProjects.length === 0) {
    return (
      <Typography.Text type="warning">
        当前没有可用的 Trellis 项目（项目需要配置 <code>rootPath</code> 指向含 <code>.trellis/</code> 的目录）。
      </Typography.Text>
    );
  }
  return (
    <Space>
      <Typography.Text strong>目标项目：</Typography.Text>
      <Select
        style={{ minWidth: 260 }}
        value={selectedId ?? undefined}
        placeholder="选择项目"
        options={eligibleProjects.map((p) => ({
          value: p.id,
          label: `${p.name}（${p.rootPath}）`,
        }))}
        onChange={onChange}
      />
    </Space>
  );
}
