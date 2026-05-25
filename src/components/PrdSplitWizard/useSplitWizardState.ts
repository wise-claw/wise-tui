/**
 * Headless requirement mission state machine.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TaskSplitContext } from "../../types";
import type { ClusterPlan, ClusterPlanItem, PlannerRepo, PlannerRequirement } from "../../services/prdSplit/clusterPlanner";
import {
  extractPlannerFeedbackHints,
  normalizePlannerRepoAssignments,
  planClusters,
} from "../../services/prdSplit/clusterPlanner";
import type { RequirementsIndexV2 } from "../../services/prdSplit/requirementsIndexVersion";
import { upgradeRequirementsIndex } from "../../services/prdSplit/requirementsIndexVersion";
import { buildRequirementsIndex } from "../../services/prdRequirementIndex";
import { prdDocumentFromMarkdownFragment } from "../../services/prdNormalizer";
import { readTrellisSpecFile } from "../../services/trellisSpecBridge";
import { PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH } from "../../services/prdSplit/specFeedback";
import {
  indexParentsByClusterId,
  scanProjectParentsAcrossRoots,
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
  WizardWorkflowGraphResult,
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
  | { type: "set-active-mission-id"; missionId: string | null }
  | { type: "set-project"; project: ProjectRef | null; repositories: PlannerRepo[] }
  | { type: "set-selected-repos"; ids: number[] }
  | { type: "set-prd-markdown"; markdown: string }
  | { type: "parse-plan-start"; markdown: string }
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
  | { type: "set-workflow-graph-result"; result: WizardWorkflowGraphResult | null }
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
  | { type: "mark-cluster-needs-resplit"; clusterId: string }
  | { type: "clear-cluster-needs-resplit"; clusterId: string }
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
    case "set-active-mission-id":
      return { ...state, activeMissionId: action.missionId };
    case "set-project":
      return { ...state, project: action.project, repositories: action.repositories, selectedRepositoryIds: action.repositories.map((r) => r.id) };
    case "set-selected-repos":
      return { ...state, selectedRepositoryIds: action.ids };
    case "set-prd-markdown":
      return { ...state, prdMarkdown: action.markdown };
    case "parse-plan-start":
      return { ...state, prdMarkdown: action.markdown, globalError: null };
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
        clusterNeedsResplit: {},
        globalError: null,
        editsByCluster: {},
        writeResults: [],
        workflowGraphResult: null,
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
      return { ...state, stage: "writing", writeResults: [], workflowGraphResult: null, globalError: null };
    case "add-write-result":
      return { ...state, writeResults: [...state.writeResults, action.result] };
    case "set-workflow-graph-result":
      return { ...state, workflowGraphResult: action.result };
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
        clusterNeedsResplit: {},
        editsByCluster: {},
        writeResults: [],
        workflowGraphResult: null,
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
    case "mark-cluster-needs-resplit":
      return {
        ...state,
        clusterNeedsResplit: { ...state.clusterNeedsResplit, [action.clusterId]: true },
      };
    case "clear-cluster-needs-resplit": {
      const { [action.clusterId]: _, ...rest } = state.clusterNeedsResplit;
      return { ...state, clusterNeedsResplit: rest };
    }
    case "reset-cluster-plan-edits": {
      if (!state.basePlan) return state;
      return withDerivedPlan({
        ...state,
        clusterPlanEdits: emptyClusterPlanEdits(),
        clusterNeedsResplit: {},
      });
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

async function loadPlannerLoopFeedback(rootPath: string): Promise<string | null> {
  try {
    const file = await readTrellisSpecFile(rootPath, PRD_SPLIT_LOOP_FEEDBACK_SPEC_PATH);
    return file.content;
  } catch {
    return null;
  }
}

export function buildPlannerFeedbackPromptBlock(
  content: string,
  options: { maxChars?: number; maxEntries?: number } = {},
): string {
  const trimmed = content.trim();
  if (!trimmed) return "none";
  const maxEntries = Math.max(1, options.maxEntries ?? 3);
  const maxChars = Math.max(500, options.maxChars ?? 8_000);
  const entries = trimmed
    .split(/\n(?=## \d{4}-\d{2}-\d{2}T[\d:.]+Z - PRD Split Loop Feedback)/g)
    .filter((entry) => entry.trim().startsWith("## "));
  const selected = entries.length > 0
    ? entries.slice(-maxEntries).join("\n").trim()
    : trimmed;
  return selected.length > maxChars
    ? selected.slice(selected.length - maxChars)
    : selected;
}

export function resolveWizardPlannerOptions(
  repositoryCount: number,
  requirementCount: number,
  options?: { maxRequirementsPerCluster?: number },
): { maxRequirementsPerCluster?: number } | undefined {
  if (repositoryCount !== 1) return options ?? undefined;
  return {
    ...options,
    maxRequirementsPerCluster: Math.max(1, requirementCount),
  };
}

export interface UseSplitWizardStateApi {
  state: WizardState;
  reset(project: ProjectRef | null, repositories: PlannerRepo[], context: TaskSplitContext | null): void;
  setActiveMissionId(missionId: string | null): void;
  setProject(project: ProjectRef | null, repositories: PlannerRepo[]): void;
  setSelectedRepos(ids: number[]): void;
  setPrdMarkdown(markdown: string): void;
  /** 解析 PRD → 构建 requirements-index v2 → 用 selectedRepositoryIds 派生 ClusterPlan，并跳到 plan 阶段。 */
  parseAndPlan(options?: { maxRequirementsPerCluster?: number }): Promise<{ ok: true } | { ok: false; reason: string }>;
  parseAndPlanMarkdown(markdown: string, options?: { maxRequirementsPerCluster?: number }): Promise<{ ok: true } | { ok: false; reason: string }>;
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
  setWorkflowGraphResult(result: WizardWorkflowGraphResult | null): void;
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
  markClusterNeedsResplit(clusterId: string): void;
  clearClusterNeedsResplit(clusterId: string): void;
  resetClusterPlanEdits(): void;
}

export function useSplitWizardState(): UseSplitWizardStateApi {
  const [state, setState] = useState(() => emptyWizardState());
  const stateRef = useRef(state);

  const dispatch = useCallback((action: Action) => {
    const next = reducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);

  const parseAndPlanFromMarkdown = useCallback(
    async (
      markdownInput: string,
      options?: { maxRequirementsPerCluster?: number },
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const current = stateRef.current;
      const markdown = markdownInput.trim();
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
      const repos = current.selectedRepositoryIds.length === 0
        ? current.repositories
        : current.repositories.filter((r) => current.selectedRepositoryIds.includes(r.id));
      const plannerRequirements: PlannerRequirement[] = upgraded.requirements.map((r) => ({
        id: r.id,
        content: r.content,
        bodyHash: r.bodyHash,
      }));
      const loopFeedbackContent = current.project?.rootPath
        ? await loadPlannerLoopFeedback(current.project.rootPath)
        : null;
      const plannerFeedbackBlock = loopFeedbackContent
        ? buildPlannerFeedbackPromptBlock(loopFeedbackContent)
        : "none";
      const feedbackHints = plannerFeedbackBlock !== "none"
        ? extractPlannerFeedbackHints({
          feedback: plannerFeedbackBlock,
          repositories: repos,
          requirements: plannerRequirements,
        })
        : undefined;

      // 多仓库时用 AI 判断每条需求归属哪个仓库
      let repoAssignments: Record<string, number> | undefined;
      if (repos.length > 1 && current.project?.rootPath) {
        try {
          const reposInfo = repos.map((r) => ({ id: r.id, name: r.name, type: r.type }));
          const prompt = [
            "你是需求-仓库分类器。根据需求描述，将每条需求分配到最合适的仓库。",
            "",
            "仓库列表：",
            JSON.stringify(reposInfo),
            "",
            "需求列表：",
            JSON.stringify(upgraded.requirements.map((r) => ({
              id: r.id,
              content: r.content.replace(/\s+/g, " ").trim().slice(0, 200),
              bodyHash: r.bodyHash,
            }))),
            "",
            "历史 Spec 反哺（仅作为仓库边界/锚点经验，不是新需求来源）：",
            plannerFeedbackBlock,
            "",
            "要求：只输出当前需求列表中的 ID；只使用仓库列表中的 ID；当前需求列表始终是范围事实源。",
            "若历史反哺中的当前 requirementId 与 bodyHash 同时命中，可优先沿用其仓库边界；否则按当前需求文本判断。",
            "",
            "输出纯 JSON 对象，键为需求 ID，值为仓库 ID。不要任何解释或 Markdown。",
            `示例：${JSON.stringify({ [upgraded.requirements[0]?.id ?? "REQ-01"]: repos[0].id })}`,
          ].join("\n");

          const stdout = await invoke<string>("run_claude_quick", {
            projectPath: current.project.rootPath,
            prompt,
            timeoutMs: 60_000,
          });
          const parsed = JSON.parse(stdout);
          repoAssignments = normalizePlannerRepoAssignments(parsed, plannerRequirements, repos);
        } catch {
          // AI 分类失败时回退到关键词匹配，静默处理
        }
      }

      const plan = planClusters({
        repositories: repos,
        requirements: plannerRequirements,
        options: {
          ...resolveWizardPlannerOptions(repos.length, upgraded.requirements.length, options),
          repoAssignments,
          feedbackHints,
        },
      });
      dispatch({ type: "go-to-plan", plan, prd, index: upgraded });
      return { ok: true as const };
    },
    [dispatch],
  );

  const parseAndPlan = useCallback<UseSplitWizardStateApi["parseAndPlan"]>(
    async (options) => parseAndPlanFromMarkdown(stateRef.current.prdMarkdown, options),
    [parseAndPlanFromMarkdown],
  );

  const parseAndPlanMarkdown = useCallback<UseSplitWizardStateApi["parseAndPlanMarkdown"]>(
    async (markdown, options) => {
      dispatch({ type: "parse-plan-start", markdown });
      return parseAndPlanFromMarkdown(markdown, options);
    },
    [parseAndPlanFromMarkdown],
  );

  const refreshExistingParents = useCallback<UseSplitWizardStateApi["refreshExistingParents"]>(
    async () => {
      const current = stateRef.current;
      if (!current.project || !current.plan || !current.requirementsIndex) return;
      try {
        const scanned = await scanProjectParentsAcrossRoots([
          current.project.rootPath,
          ...current.repositories.map((repo) => repo.path),
        ]);
        const indexed = indexParentsByClusterId(scanned);
        const diffByCluster = computeDiffByCluster(
          current.plan.clusters,
          current.requirementsIndex,
          indexed,
        );
        dispatch({ type: "set-existing-parents", existing: indexed, diffByCluster });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: "set-global-error", error: `扫描历史父任务失败：${message}` });
      }
    },
    [dispatch],
  );

  return useMemo<UseSplitWizardStateApi>(
    () => ({
      get state() {
        return stateRef.current;
      },
      reset: (project, repositories, context) =>
        dispatch({
          type: "reset",
          project,
          repositories,
          selectedRepositoryIds: repositories.map((r) => r.id),
          context,
        }),
      setActiveMissionId: (missionId) => dispatch({ type: "set-active-mission-id", missionId }),
      setProject: (project, repositories) => dispatch({ type: "set-project", project, repositories }),
      setSelectedRepos: (ids) => dispatch({ type: "set-selected-repos", ids }),
      setPrdMarkdown: (markdown) => dispatch({ type: "set-prd-markdown", markdown }),
      parseAndPlan,
      parseAndPlanMarkdown,
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
      setWorkflowGraphResult: (result) => dispatch({ type: "set-workflow-graph-result", result }),
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
      markClusterNeedsResplit: (clusterId) => dispatch({ type: "mark-cluster-needs-resplit", clusterId }),
      clearClusterNeedsResplit: (clusterId) => dispatch({ type: "clear-cluster-needs-resplit", clusterId }),
      resetClusterPlanEdits: () => dispatch({ type: "reset-cluster-plan-edits" }),
    }),
    [state, parseAndPlan, parseAndPlanMarkdown, refreshExistingParents],
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
