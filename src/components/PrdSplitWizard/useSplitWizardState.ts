/**
 * 状态机 hook：把 PrdSplitWizard 的阶段流转封装为 reducer + 显式 action 接口。
 */

import { useCallback, useMemo, useReducer } from "react";
import type { TaskSplitContext } from "../../types";
import type { ClusterPlan, ClusterPlanItem, PlannerRepo } from "../../services/prdSplit/clusterPlanner";
import { planClusters } from "../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../services/prdSplit/requirementsIndexVersion";
import { upgradeRequirementsIndex } from "../../services/prdSplit/requirementsIndexVersion";
import { buildRequirementsIndex } from "../../services/prdRequirementIndex";
import { prdDocumentFromMarkdownFragment } from "../../services/prdNormalizer";
import {
  indexParentsByClusterId,
  scanProjectParents,
  type ExistingParentRef,
} from "../../services/prdSplit/existingParentScanner";
import { computeDirtyClusters } from "../../services/prdSplit/diffReplay";
import type {
  ClusterDiffStatus,
  ClusterRunState,
  ProjectRef,
  WizardState,
  WizardWriteResult,
} from "./types";
import { emptyWizardState } from "./types";

type Action =
  | { type: "reset"; project: ProjectRef | null; repositories: PlannerRepo[]; selectedRepositoryIds: number[]; context: TaskSplitContext | null }
  | { type: "set-project"; project: ProjectRef | null; repositories: PlannerRepo[] }
  | { type: "set-selected-repos"; ids: number[] }
  | { type: "set-prd-markdown"; markdown: string }
  | { type: "go-to-plan"; plan: ClusterPlan; prd: ReturnType<typeof prdDocumentFromMarkdownFragment>; index: RequirementsIndexV2 }
  | { type: "set-existing-parents"; existing: Map<string, ExistingParentRef> | null; diffByCluster: Record<string, ClusterDiffStatus> }
  | { type: "set-reuse-existing-parents"; value: boolean }
  | { type: "set-dispatch-only-dirty"; value: boolean }
  | { type: "go-to-dispatch" }
  | { type: "set-cluster-run"; clusterId: string; run: ClusterRunState }
  | { type: "patch-cluster-run"; clusterId: string; patch: Partial<ClusterRunState> }
  | { type: "go-to-review" }
  | { type: "begin-write" }
  | { type: "add-write-result"; result: WizardWriteResult }
  | { type: "finish-write" }
  | { type: "fail-write"; error: string }
  | { type: "set-global-error"; error: string | null }
  | { type: "back-to-input" }
  | { type: "back-to-plan" }
  | { type: "back-to-dispatch" };

function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "reset":
      return {
        ...emptyWizardState(),
        project: action.project,
        repositories: action.repositories,
        selectedRepositoryIds: action.selectedRepositoryIds,
        context: action.context,
      };
    case "set-project":
      return { ...state, project: action.project, repositories: action.repositories, selectedRepositoryIds: action.repositories.map((r) => r.id) };
    case "set-selected-repos":
      return { ...state, selectedRepositoryIds: action.ids };
    case "set-prd-markdown":
      return { ...state, prdMarkdown: action.markdown };
    case "go-to-plan":
      return {
        ...state,
        stage: "plan",
        plan: action.plan,
        prd: action.prd,
        requirementsIndex: action.index,
        clusterRuns: Object.fromEntries(
          action.plan.clusters.map((c) => [c.id, makeIdleRun(c.id)]),
        ),
        existingParents: null,
        diffByCluster: {},
        globalError: null,
      };
    case "set-existing-parents": {
      // 默认开关：若存在 unchanged cluster，开启 only-dirty；若有任何 existingParent，开启 reuse。
      const hasUnchanged = Object.values(action.diffByCluster).some((d) => d.kind === "unchanged");
      const hasExisting = (action.existing?.size ?? 0) > 0;
      return {
        ...state,
        existingParents: action.existing,
        diffByCluster: action.diffByCluster,
        reuseExistingParents: state.reuseExistingParents && hasExisting,
        dispatchOnlyDirty: state.dispatchOnlyDirty && hasUnchanged,
      };
    }
    case "set-reuse-existing-parents":
      return { ...state, reuseExistingParents: action.value };
    case "set-dispatch-only-dirty":
      return { ...state, dispatchOnlyDirty: action.value };
    case "go-to-dispatch":
      return { ...state, stage: "dispatch", globalError: null };
    case "set-cluster-run":
      return { ...state, clusterRuns: { ...state.clusterRuns, [action.clusterId]: action.run } };
    case "patch-cluster-run": {
      const prev = state.clusterRuns[action.clusterId];
      if (!prev) return state;
      return {
        ...state,
        clusterRuns: {
          ...state.clusterRuns,
          [action.clusterId]: { ...prev, ...action.patch },
        },
      };
    }
    case "go-to-review":
      return { ...state, stage: "review", globalError: null };
    case "begin-write":
      return { ...state, stage: "writing", writeResults: [], globalError: null };
    case "add-write-result":
      return { ...state, writeResults: [...state.writeResults, action.result] };
    case "finish-write":
      return { ...state, stage: "done" };
    case "fail-write":
      return { ...state, stage: "review", globalError: action.error };
    case "set-global-error":
      return { ...state, globalError: action.error };
    case "back-to-input":
      return { ...state, stage: "input" };
    case "back-to-plan":
      return { ...state, stage: "plan" };
    case "back-to-dispatch":
      return { ...state, stage: "dispatch" };
    default:
      return state;
  }
}

function makeIdleRun(clusterId: string): ClusterRunState {
  return { clusterId, parentTaskName: null, parentTaskPath: null, status: "idle", errors: [] };
}

export interface UseSplitWizardStateApi {
  state: WizardState;
  reset(project: ProjectRef | null, repositories: PlannerRepo[], context: TaskSplitContext | null): void;
  setProject(project: ProjectRef | null, repositories: PlannerRepo[]): void;
  setSelectedRepos(ids: number[]): void;
  setPrdMarkdown(markdown: string): void;
  /** 解析 PRD → 构建 requirements-index v2 → 用 selectedRepositoryIds 派生 ClusterPlan，并跳到 plan 阶段。 */
  parseAndPlan(options?: { maxRequirementsPerCluster?: number }): { ok: true } | { ok: false; reason: string };
  /** 在 plan 阶段调用：扫描项目下已有父任务并算每个 cluster 的 diff 状态。 */
  refreshExistingParents(): Promise<void>;
  setReuseExistingParents(value: boolean): void;
  setDispatchOnlyDirty(value: boolean): void;
  goToDispatch(): void;
  setClusterRun(clusterId: string, run: ClusterRunState): void;
  patchClusterRun(clusterId: string, patch: Partial<ClusterRunState>): void;
  goToReview(): void;
  beginWrite(): void;
  addWriteResult(result: WizardWriteResult): void;
  finishWrite(): void;
  failWrite(error: string): void;
  setGlobalError(error: string | null): void;
  backToInput(): void;
  backToPlan(): void;
  backToDispatch(): void;
}

export function useSplitWizardState(): UseSplitWizardStateApi {
  const [state, dispatch] = useReducer(reducer, emptyWizardState());

  const parseAndPlan = useCallback<UseSplitWizardStateApi["parseAndPlan"]>(
    (options) => {
      const markdown = state.prdMarkdown.trim();
      if (!markdown) return { ok: false, reason: "请粘贴 PRD Markdown 后再继续。" };
      const prd = prdDocumentFromMarkdownFragment(markdown);
      const rawIndex = buildRequirementsIndex(prd);
      const upgraded = upgradeRequirementsIndex({
        schemaVersion: 1,
        requirements: rawIndex.requirements.map((r) => ({ id: r.id, content: r.content })),
      });
      if (upgraded.requirements.length === 0) {
        return { ok: false, reason: "PRD 中未识别到任何需求条目，请补全功能 / 非功能 / 验收章节。" };
      }
      const repos = state.selectedRepositoryIds.length === 0
        ? state.repositories
        : state.repositories.filter((r) => state.selectedRepositoryIds.includes(r.id));
      const plan = planClusters({
        repositories: repos,
        requirements: upgraded.requirements.map((r) => ({ id: r.id, content: r.content })),
        options: options ?? undefined,
      });
      dispatch({ type: "go-to-plan", plan, prd, index: upgraded });
      return { ok: true };
    },
    [state.prdMarkdown, state.repositories, state.selectedRepositoryIds],
  );

  const refreshExistingParents = useCallback<UseSplitWizardStateApi["refreshExistingParents"]>(
    async () => {
      if (!state.project || !state.plan || !state.requirementsIndex) return;
      try {
        const scanned = await scanProjectParents(state.project.rootPath);
        const indexed = indexParentsByClusterId(scanned);
        const diffByCluster = computeDiffByCluster(
          state.plan.clusters,
          state.requirementsIndex,
          indexed,
        );
        dispatch({ type: "set-existing-parents", existing: indexed, diffByCluster });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: "set-global-error", error: `扫描历史父任务失败：${message}` });
      }
    },
    [state.project, state.plan, state.requirementsIndex],
  );

  return useMemo<UseSplitWizardStateApi>(
    () => ({
      state,
      reset: (project, repositories, context) =>
        dispatch({
          type: "reset",
          project,
          repositories,
          selectedRepositoryIds: repositories.map((r) => r.id),
          context,
        }),
      setProject: (project, repositories) => dispatch({ type: "set-project", project, repositories }),
      setSelectedRepos: (ids) => dispatch({ type: "set-selected-repos", ids }),
      setPrdMarkdown: (markdown) => dispatch({ type: "set-prd-markdown", markdown }),
      parseAndPlan,
      refreshExistingParents,
      setReuseExistingParents: (value) => dispatch({ type: "set-reuse-existing-parents", value }),
      setDispatchOnlyDirty: (value) => dispatch({ type: "set-dispatch-only-dirty", value }),
      goToDispatch: () => dispatch({ type: "go-to-dispatch" }),
      setClusterRun: (clusterId, run) => dispatch({ type: "set-cluster-run", clusterId, run }),
      patchClusterRun: (clusterId, patch) => dispatch({ type: "patch-cluster-run", clusterId, patch }),
      goToReview: () => dispatch({ type: "go-to-review" }),
      beginWrite: () => dispatch({ type: "begin-write" }),
      addWriteResult: (result) => dispatch({ type: "add-write-result", result }),
      finishWrite: () => dispatch({ type: "finish-write" }),
      failWrite: (error) => dispatch({ type: "fail-write", error }),
      setGlobalError: (error) => dispatch({ type: "set-global-error", error }),
      backToInput: () => dispatch({ type: "back-to-input" }),
      backToPlan: () => dispatch({ type: "back-to-plan" }),
      backToDispatch: () => dispatch({ type: "back-to-dispatch" }),
    }),
    [state, parseAndPlan, refreshExistingParents],
  );
}

/** 计算每个 cluster 与历史基线（同 clusterId 的父任务的 requirements-index）的 diff 状态。 */
function computeDiffByCluster(
  clusters: ClusterPlanItem[],
  newIndex: RequirementsIndexV2,
  existingParents: Map<string, ExistingParentRef>,
): Record<string, ClusterDiffStatus> {
  const out: Record<string, ClusterDiffStatus> = {};
  for (const cluster of clusters) {
    const existing = existingParents.get(cluster.id);
    if (!existing || !existing.requirementsIndex) {
      out[cluster.id] = { kind: "new" };
      continue;
    }
    const diff = computeDirtyClusters({
      oldIndex: existing.requirementsIndex,
      newIndex,
      existingPlan: {
        clusters: [
          {
            id: cluster.id,
            title: cluster.title,
            primaryRepositoryId: cluster.primaryRepositoryId,
            repositoryIds: cluster.repositoryIds,
            requirementIds: cluster.requirementIds,
            dependencyClusterIds: cluster.dependencyClusterIds,
          },
        ],
        diagnostics: { requirementsCoverage: { covered: [], orphan: [] }, crossRepoRequirements: [] },
      },
    });
    if (diff.dirtyClusterIds.length === 0) {
      out[cluster.id] = { kind: "unchanged", existingParent: existing };
    } else {
      out[cluster.id] = {
        kind: "dirty",
        existingParent: existing,
        reasons: diff.reasonsByCluster[cluster.id] ?? [],
      };
    }
  }
  return out;
}
