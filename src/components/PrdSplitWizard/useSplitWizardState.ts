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
import type { TaskItem } from "../../types";
import type {
  ClusterDiffStatus,
  ClusterRunState,
  ProjectRef,
  TaskEditPatch,
  WizardState,
  WizardWriteResult,
} from "./types";
import { emptyWizardState } from "./types";
import { ensureClusterEdit } from "./taskEdits";
import {
  applyReassign,
  collectAffectedClusterIds,
  deriveEffectivePlan,
  emptyClusterPlanEdits,
  undoReassign,
  type ClusterPlanEditAction,
} from "./clusterPlanEdits";

export type Action =
  | { type: "reset"; project: ProjectRef | null; repositories: PlannerRepo[]; selectedRepositoryIds: number[]; context: TaskSplitContext | null }
  | { type: "set-project"; project: ProjectRef | null; repositories: PlannerRepo[] }
  | { type: "set-selected-repos"; ids: number[] }
  | { type: "set-prd-markdown"; markdown: string }
  | { type: "go-to-plan"; plan: ClusterPlan; prd: ReturnType<typeof prdDocumentFromMarkdownFragment>; index: RequirementsIndexV2 }
  | { type: "set-existing-parents"; existing: Map<string, ExistingParentRef> | null; diffByCluster: Record<string, ClusterDiffStatus> }
  | { type: "set-reuse-existing-parents"; value: boolean }
  | { type: "set-dispatch-only-dirty"; value: boolean }
  | { type: "patch-task-edit"; clusterId: string; taskId: string; patch: Partial<TaskEditPatch> }
  | { type: "clear-task-edit"; clusterId: string; taskId: string }
  | { type: "clear-task-anchor-edit"; clusterId: string; taskId: string }
  | { type: "delete-task"; clusterId: string; taskId: string }
  | { type: "restore-task"; clusterId: string; taskId: string }
  | { type: "add-manual-task"; clusterId: string; task: TaskItem }
  | { type: "remove-manual-task"; clusterId: string; taskId: string }
  | { type: "patch-manual-task"; clusterId: string; taskId: string; patch: Partial<TaskItem> }
  | { type: "discard-cluster-edits"; clusterId: string }
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
  | { type: "back-to-dispatch" }
  | { type: "reassign-requirement"; requirementId: string; targetClusterId: string }
  | { type: "undo-reassign"; requirementId: string }
  | { type: "add-manual-cluster"; cluster: ClusterPlanItem }
  | { type: "rename-cluster"; clusterId: string; title: string }
  | { type: "reset-cluster-plan-edits" };

export function reducer(state: WizardState, action: Action): WizardState {
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
    case "go-to-plan": {
      const edits = emptyClusterPlanEdits();
      return {
        ...state,
        stage: "plan",
        basePlan: action.plan,
        plan: deriveEffectivePlan(action.plan, edits),
        clusterPlanEdits: edits,
        prd: action.prd,
        requirementsIndex: action.index,
        clusterRuns: Object.fromEntries(
          action.plan.clusters.map((c) => [c.id, makeIdleRun(c.id)]),
        ),
        existingParents: null,
        diffByCluster: {},
        globalError: null,
        editsByCluster: {},
        writeResults: [],
      };
    }
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
    case "patch-task-edit": {
      const cur = ensureClusterEdit(state.editsByCluster, action.clusterId);
      const prevPatch = cur.patches[action.taskId] ?? {};
      const nextPatch: TaskEditPatch = { ...prevPatch, ...action.patch };
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: {
            ...cur,
            patches: { ...cur.patches, [action.taskId]: nextPatch },
          },
        },
      };
    }
    case "clear-task-edit": {
      const cur = state.editsByCluster[action.clusterId];
      if (!cur) return state;
      const { [action.taskId]: _, ...rest } = cur.patches;
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: { ...cur, patches: rest },
        },
      };
    }
    case "clear-task-anchor-edit": {
      const cur = state.editsByCluster[action.clusterId];
      if (!cur) return state;
      const prevPatch = cur.patches[action.taskId];
      if (!prevPatch) return state;
      const { taskAnchors: _anchor, ...rest } = prevPatch;
      const restKeys = Object.keys(rest);
      const nextPatches = restKeys.length === 0
        ? Object.fromEntries(Object.entries(cur.patches).filter(([k]) => k !== action.taskId))
        : { ...cur.patches, [action.taskId]: rest };
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: { ...cur, patches: nextPatches },
        },
      };
    }
    case "delete-task": {
      const cur = ensureClusterEdit(state.editsByCluster, action.clusterId);
      // 如果是 manual task 直接从 manualTasks 移除；否则进 deletedTaskIds
      const isManual = cur.manualTasks.some((t) => t.id === action.taskId);
      if (isManual) {
        return {
          ...state,
          editsByCluster: {
            ...state.editsByCluster,
            [action.clusterId]: {
              ...cur,
              manualTasks: cur.manualTasks.filter((t) => t.id !== action.taskId),
            },
          },
        };
      }
      if (cur.deletedTaskIds.includes(action.taskId)) return state;
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: {
            ...cur,
            deletedTaskIds: [...cur.deletedTaskIds, action.taskId],
          },
        },
      };
    }
    case "restore-task": {
      const cur = state.editsByCluster[action.clusterId];
      if (!cur) return state;
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: {
            ...cur,
            deletedTaskIds: cur.deletedTaskIds.filter((id) => id !== action.taskId),
          },
        },
      };
    }
    case "add-manual-task": {
      const cur = ensureClusterEdit(state.editsByCluster, action.clusterId);
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: { ...cur, manualTasks: [...cur.manualTasks, action.task] },
        },
      };
    }
    case "remove-manual-task": {
      const cur = state.editsByCluster[action.clusterId];
      if (!cur) return state;
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: {
            ...cur,
            manualTasks: cur.manualTasks.filter((t) => t.id !== action.taskId),
          },
        },
      };
    }
    case "patch-manual-task": {
      const cur = state.editsByCluster[action.clusterId];
      if (!cur) return state;
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: {
            ...cur,
            manualTasks: cur.manualTasks.map((t) =>
              t.id === action.taskId ? { ...t, ...action.patch } : t,
            ),
          },
        },
      };
    }
    case "discard-cluster-edits":
      return {
        ...state,
        editsByCluster: {
          ...state.editsByCluster,
          [action.clusterId]: { patches: {}, manualTasks: [], deletedTaskIds: [] },
        },
      };
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
      return {
        ...state,
        stage: "input",
        basePlan: null,
        plan: null,
        clusterPlanEdits: emptyClusterPlanEdits(),
        prd: null,
        requirementsIndex: null,
        clusterRuns: {},
        existingParents: null,
        diffByCluster: {},
        editsByCluster: {},
        writeResults: [],
        globalError: null,
      };
    case "back-to-plan":
      return { ...state, stage: "plan" };
    case "back-to-dispatch":
      return { ...state, stage: "dispatch" };
    case "reassign-requirement": {
      if (!state.basePlan) return state;
      const planAction: ClusterPlanEditAction = {
        type: "reassign-requirement",
        requirementId: action.requirementId,
        targetClusterId: action.targetClusterId,
      };
      const affected = collectAffectedClusterIds(state.plan, planAction);
      const nextEdits = applyReassign(
        state.clusterPlanEdits,
        state.basePlan,
        action.requirementId,
        action.targetClusterId,
      );
      return withDerivedPlan(invalidateRuns({ ...state, clusterPlanEdits: nextEdits }, affected));
    }
    case "undo-reassign": {
      if (!state.basePlan) return state;
      const before = state.clusterPlanEdits;
      const target = before.reassignedRequirements[action.requirementId];
      if (!target) return state;
      const planAction: ClusterPlanEditAction = {
        type: "reassign-requirement",
        requirementId: action.requirementId,
        targetClusterId: target,
      };
      const affected = collectAffectedClusterIds(state.plan, planAction);
      const nextEdits = undoReassign(before, action.requirementId);
      return withDerivedPlan(invalidateRuns({ ...state, clusterPlanEdits: nextEdits }, affected));
    }
    case "add-manual-cluster": {
      if (!state.basePlan) return state;
      const baseIds = new Set(state.basePlan.clusters.map((c) => c.id));
      const manualIds = new Set(state.clusterPlanEdits.manualClusters.map((c) => c.id));
      if (baseIds.has(action.cluster.id) || manualIds.has(action.cluster.id)) return state;
      const nextEdits = {
        ...state.clusterPlanEdits,
        manualClusters: [...state.clusterPlanEdits.manualClusters, action.cluster],
      };
      const next: WizardState = {
        ...state,
        clusterPlanEdits: nextEdits,
        clusterRuns: { ...state.clusterRuns, [action.cluster.id]: makeIdleRun(action.cluster.id) },
      };
      return withDerivedPlan(next);
    }
    case "rename-cluster": {
      if (!state.basePlan) return state;
      const trimmed = action.title.trim();
      const nextOverrides = { ...state.clusterPlanEdits.titleOverrides };
      if (trimmed.length === 0) {
        delete nextOverrides[action.clusterId];
      } else {
        nextOverrides[action.clusterId] = trimmed;
      }
      const nextEdits = { ...state.clusterPlanEdits, titleOverrides: nextOverrides };
      return withDerivedPlan({ ...state, clusterPlanEdits: nextEdits });
    }
    case "reset-cluster-plan-edits": {
      if (!state.basePlan) return state;
      return withDerivedPlan({ ...state, clusterPlanEdits: emptyClusterPlanEdits() });
    }
    default:
      return state;
  }
}

/** 重算 effective plan + 同步 clusterRuns 集合（新增的 cluster 加 idle run、被剔除的 cluster 删 run）。 */
function withDerivedPlan(state: WizardState): WizardState {
  if (!state.basePlan) return state;
  const effective = deriveEffectivePlan(state.basePlan, state.clusterPlanEdits);
  const effectiveIds = new Set(effective.clusters.map((c) => c.id));
  const nextRuns: Record<string, ClusterRunState> = {};
  for (const id of effectiveIds) {
    nextRuns[id] = state.clusterRuns[id] ?? makeIdleRun(id);
  }
  return { ...state, plan: effective, clusterRuns: nextRuns };
}

/** 把指定 cluster 的 run 重置回 idle（保留 dispatching / creating-parent 进行中的状态）。 */
function invalidateRuns(state: WizardState, clusterIds: string[]): WizardState {
  if (clusterIds.length === 0) return state;
  const nextRuns = { ...state.clusterRuns };
  for (const cid of clusterIds) {
    const cur = nextRuns[cid];
    if (!cur) continue;
    if (cur.status === "dispatching" || cur.status === "creating-parent") continue;
    nextRuns[cid] = makeIdleRun(cid);
  }
  return { ...state, clusterRuns: nextRuns };
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
  patchTaskEdit(clusterId: string, taskId: string, patch: Partial<TaskEditPatch>): void;
  clearTaskEdit(clusterId: string, taskId: string): void;
  clearTaskAnchorEdit(clusterId: string, taskId: string): void;
  deleteTask(clusterId: string, taskId: string): void;
  restoreTask(clusterId: string, taskId: string): void;
  addManualTask(clusterId: string, task: TaskItem): void;
  removeManualTask(clusterId: string, taskId: string): void;
  patchManualTask(clusterId: string, taskId: string, patch: Partial<TaskItem>): void;
  discardClusterEdits(clusterId: string): void;
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
  reassignRequirement(requirementId: string, targetClusterId: string): void;
  undoReassign(requirementId: string): void;
  addManualCluster(cluster: ClusterPlanItem): void;
  renameCluster(clusterId: string, title: string): void;
  resetClusterPlanEdits(): void;
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
      patchTaskEdit: (clusterId, taskId, patch) =>
        dispatch({ type: "patch-task-edit", clusterId, taskId, patch }),
      clearTaskEdit: (clusterId, taskId) =>
        dispatch({ type: "clear-task-edit", clusterId, taskId }),
      clearTaskAnchorEdit: (clusterId, taskId) =>
        dispatch({ type: "clear-task-anchor-edit", clusterId, taskId }),
      deleteTask: (clusterId, taskId) => dispatch({ type: "delete-task", clusterId, taskId }),
      restoreTask: (clusterId, taskId) => dispatch({ type: "restore-task", clusterId, taskId }),
      addManualTask: (clusterId, task) => dispatch({ type: "add-manual-task", clusterId, task }),
      removeManualTask: (clusterId, taskId) =>
        dispatch({ type: "remove-manual-task", clusterId, taskId }),
      patchManualTask: (clusterId, taskId, patch) =>
        dispatch({ type: "patch-manual-task", clusterId, taskId, patch }),
      discardClusterEdits: (clusterId) => dispatch({ type: "discard-cluster-edits", clusterId }),
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
      reassignRequirement: (requirementId, targetClusterId) =>
        dispatch({ type: "reassign-requirement", requirementId, targetClusterId }),
      undoReassign: (requirementId) => dispatch({ type: "undo-reassign", requirementId }),
      addManualCluster: (cluster) => dispatch({ type: "add-manual-cluster", cluster }),
      renameCluster: (clusterId, title) => dispatch({ type: "rename-cluster", clusterId, title }),
      resetClusterPlanEdits: () => dispatch({ type: "reset-cluster-plan-edits" }),
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
