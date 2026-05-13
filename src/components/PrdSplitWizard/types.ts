/**
 * Wizard state machine types for PrdSplitWizard.
 *
 * Flow:
 *   idle → input → plan → dispatch → review → writing → done
 *                                                    ↘ error → 回到对应 stage
 */

import type { PrdDocument, SplitResult, TaskSplitContext } from "../../types";
import type { ClusterPlan, ClusterPlanItem, PlannerRepo } from "../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../services/prdSplit/requirementsIndexVersion";
import type {
  ClaudeSplitStrictValidationIssue,
} from "../../services/claudeSplitOutputNormalize";
import type { DispatchClusterRawOutput } from "../../services/prdSplit/splitterDispatch";

export type WizardStage = "input" | "plan" | "dispatch" | "review" | "writing" | "done";

export interface ProjectRef {
  id: string;
  name: string;
  rootPath: string;
}

/** 每个 cluster 在 dispatch 阶段的运行态。 */
export interface ClusterRunState {
  clusterId: string;
  parentTaskName: string | null;
  parentTaskPath: string | null;
  status: "idle" | "creating-parent" | "dispatching" | "succeeded" | "failed";
  raw?: DispatchClusterRawOutput;
  normalized?: SplitResult;
  validationIssues?: ClaudeSplitStrictValidationIssue[];
  errors: string[];
  startedAt?: number;
  endedAt?: number;
}

export interface WizardWriteResult {
  clusterId: string;
  parentTaskName: string;
  childTaskNames: string[];
  warnings: string[];
  error?: string;
}

export interface WizardState {
  stage: WizardStage;
  /** 当前 wizard 关联的项目根；从入参或下拉选择。 */
  project: ProjectRef | null;
  /** 项目下可用的仓库列表。 */
  repositories: PlannerRepo[];
  /** PRD 原始 markdown（输入阶段编辑）。 */
  prdMarkdown: string;
  /** 解析后的 PRD 文档（input → plan 计算）。 */
  prd: PrdDocument | null;
  /** v2 requirements index（input → plan 计算）。 */
  requirementsIndex: RequirementsIndexV2 | null;
  /** cluster plan（plan stage 持有，dispatch/review 沿用）。 */
  plan: ClusterPlan | null;
  /** 选中参与拆分的 repo id 子集；空 = 用项目下全部 repo。 */
  selectedRepositoryIds: number[];
  /** dispatch 阶段每 cluster 的运行态。 */
  clusterRuns: Record<string, ClusterRunState>;
  /** Trellis context（mode/policy 等），目前只用 project 维度，其它字段 null。 */
  context: TaskSplitContext | null;
  /** 写入 Trellis 后的结果汇总。 */
  writeResults: WizardWriteResult[];
  /** 顶层错误（非 cluster 局部）。 */
  globalError: string | null;
}

export function emptyWizardState(): WizardState {
  return {
    stage: "input",
    project: null,
    repositories: [],
    prdMarkdown: "",
    prd: null,
    requirementsIndex: null,
    plan: null,
    selectedRepositoryIds: [],
    clusterRuns: {},
    context: null,
    writeResults: [],
    globalError: null,
  };
}

export interface ClusterReviewItem {
  cluster: ClusterPlanItem;
  run: ClusterRunState;
}
