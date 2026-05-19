import type {
  PrdDocument,
  ProjectItem,
  Repository,
  SplitResult,
  TaskSplitContext,
} from "../../types";
import { listPrdRequirementIndexEntries } from "../prdRequirementIndex";
import {
  refreshSplitResultDerivedFields,
  syncTaskAnchorTextsFromRequirements,
} from "../taskSplitter";
import {
  remapSplitResultAnchorOffsetsFromMarkdown,
} from "../markdownAnchorOffsets";
import { buildClusterDispatchContext } from "./clusterDispatchContext";
import {
  planClusters,
  type ClusterPlan,
  type ClusterPlanItem,
  type PlannerRepo,
} from "./clusterPlanner";
import { dispatchClusterSplit, type DispatchClusterResult } from "./splitterDispatch";
import { createParentTask, renderParentPrd } from "./trellisWriter";
import { upgradeRequirementsIndex, type RequirementsIndexV2 } from "./requirementsIndexVersion";

export interface PrdSplitSubagentWorkflowInput {
  project: ProjectItem;
  repositories: Repository[];
  prd: PrdDocument;
  prdMarkdown: string;
  context: TaskSplitContext;
  model?: string | null;
  onEvent?: (event: PrdSplitSubagentWorkflowEvent) => void;
}

export type PrdSplitSubagentWorkflowEvent =
  | { type: "plan"; plan: ClusterPlan; requirementsIndex: RequirementsIndexV2 }
  | {
    type: "cluster-start";
    cluster: ClusterPlanItem;
    executionRootPath: string | null;
  }
  | {
    type: "parent-created";
    cluster: ClusterPlanItem;
    parentTaskName: string;
    parentTaskPath: string;
  }
  | {
    type: "cluster-complete";
    cluster: ClusterPlanItem;
    parentTaskName: string;
    parentTaskPath: string;
    result: DispatchClusterResult;
  };

export interface PrdSplitSubagentWorkflowOutput {
  result: SplitResult;
  plan: ClusterPlan;
  requirementsIndex: RequirementsIndexV2;
  clusterRuns: PrdSplitSubagentClusterRun[];
}

export interface PrdSplitSubagentClusterRun {
  cluster: ClusterPlanItem;
  parentTaskName: string;
  parentTaskPath: string;
  result: DispatchClusterResult;
}

export async function runPrdSplitSubagentWorkflow(
  input: PrdSplitSubagentWorkflowInput,
): Promise<PrdSplitSubagentWorkflowOutput> {
  const rootPath = input.project.rootPath?.trim();
  if (!rootPath) {
    throw new Error("当前需求助手必须关联到带 rootPath 的 Workspace，才能派发 trellis-splitter。");
  }
  const plannerRepos = buildPlannerRepos(input.project, input.repositories);
  if (plannerRepos.length === 0) {
    throw new Error("当前 Workspace 尚未关联仓库，无法派发 trellis-splitter。");
  }

  const requirementsIndex = buildRequirementsIndexV2(input.prd);
  if (requirementsIndex.requirements.length === 0) {
    throw new Error("PRD 中没有可拆分的需求条目。");
  }

  const plan = planClusters({
    repositories: plannerRepos,
    requirements: requirementsIndex.requirements.map((entry) => ({
      id: entry.id,
      content: entry.content,
    })),
  });
  input.onEvent?.({ type: "plan", plan, requirementsIndex });
  if (plan.clusters.length === 0) {
    throw new Error("未能生成可派发的需求分组。");
  }

  const clusterRuns: PrdSplitSubagentClusterRun[] = [];
  const normalizedResults: Array<{ clusterId: string; result: SplitResult }> = [];
  for (const cluster of plan.clusters) {
    const executionRootPath = buildClusterExecutionRoot(cluster, plannerRepos);
    input.onEvent?.({ type: "cluster-start", cluster, executionRootPath });
    const parent = await createParentTask({
      projectRootPath: rootPath,
      cluster: {
        id: cluster.id,
        title: cluster.title,
        primaryRepositoryId: cluster.primaryRepositoryId,
        repositoryIds: cluster.repositoryIds,
      },
      prdMarkdown: renderParentPrd(input.prdMarkdown, cluster),
      requirementsIndexJson: JSON.stringify(requirementsIndex, null, 2),
      description: `Wise 需求助手拆分分组 ${cluster.id} · ${cluster.requirementIds.length} 条需求`,
    });
    input.onEvent?.({
      type: "parent-created",
      cluster,
      parentTaskName: parent.parentTaskName,
      parentTaskPath: parent.parentTaskPath,
    });
    const result = await dispatchClusterSplit({
      projectRootPath: rootPath,
      executionRootPath,
      parentTaskPath: parent.parentTaskPath,
      cluster,
      prd: input.prd,
      requirementsIndex,
      context: buildClusterDispatchContext({
        baseContext: input.context,
        cluster,
        repositories: plannerRepos,
      }),
      model: input.model ?? null,
    });
    input.onEvent?.({
      type: "cluster-complete",
      cluster,
      parentTaskName: parent.parentTaskName,
      parentTaskPath: parent.parentTaskPath,
      result,
    });
    clusterRuns.push({
      cluster,
      parentTaskName: parent.parentTaskName,
      parentTaskPath: parent.parentTaskPath,
      result,
    });
    if (result.normalized && result.errors.length === 0) {
      normalizedResults.push({ clusterId: cluster.id, result: result.normalized });
    }
  }

  if (normalizedResults.length === 0) {
    const errors = clusterRuns
      .flatMap((run) => run.result.errors.map((error) => `${run.cluster.id}: ${error}`))
      .filter((error) => error.trim().length > 0);
    throw new Error(errors[0] ?? "trellis-splitter 未产出有效拆分结果。");
  }

  return {
    result: mergeClusterSplitResults(input.prd, input.context, normalizedResults, input.prdMarkdown),
    plan,
    requirementsIndex,
    clusterRuns,
  };
}

function buildPlannerRepos(project: ProjectItem, repositories: Repository[]): PlannerRepo[] {
  const repoById = new Map(repositories.map((repository) => [repository.id, repository]));
  return project.repositoryIds
    .map((id) => repoById.get(id) ?? null)
    .filter((repository): repository is Repository => Boolean(repository))
    .map((repository) => ({
      id: repository.id,
      name: repository.name,
      type: repository.repositoryType,
      path: repository.path,
    }));
}

function buildClusterExecutionRoot(cluster: ClusterPlanItem, repositories: PlannerRepo[]): string | null {
  const repositoryId = cluster.primaryRepositoryId ?? cluster.repositoryIds[0] ?? null;
  if (repositoryId == null) return null;
  return repositories.find((repository) => repository.id === repositoryId)?.path ?? null;
}

function buildRequirementsIndexV2(prd: PrdDocument): RequirementsIndexV2 {
  return upgradeRequirementsIndex({
    schemaVersion: 1,
    requirements: listPrdRequirementIndexEntries(prd).map((entry) => ({
      id: entry.id,
      content: entry.content,
    })),
  });
}

function mergeClusterSplitResults(
  prd: PrdDocument,
  context: TaskSplitContext,
  clusterResults: { clusterId: string; result: SplitResult }[],
  prdMarkdown: string,
): SplitResult {
  const results = namespaceClusterSplitResults(clusterResults);
  const tasks = results.flatMap((result) => result.splitTasks);
  const anchorDescriptors = Object.assign(
    {},
    ...results.map((result) => result.taskAnchorDescriptors ?? {}),
  ) as SplitResult["taskAnchorDescriptors"];
  const anchorTexts = Object.assign(
    {},
    ...results.map((result) => result.taskAnchorTexts ?? {}),
  ) as SplitResult["taskAnchorTexts"];
  const claudeLinks = results.flatMap((result) => result.claudeSplitMapping?.taskRequirementLinks ?? []);
  const merged = refreshSplitResultDerivedFields({
    source: prd,
    context,
    splitTasks: tasks,
    executableTasks: [],
    taskAnchorDescriptors: anchorDescriptors && Object.keys(anchorDescriptors).length > 0
      ? anchorDescriptors
      : undefined,
    taskAnchorTexts: anchorTexts && Object.keys(anchorTexts).length > 0 ? anchorTexts : undefined,
    criticalPath: [],
    parallelGroups: [],
    unmetPreconditions: [],
    claudeSplitMapping: claudeLinks.length > 0
      ? {
        version: 1,
        taskRequirementLinks: claudeLinks,
        capturedAtMs: Date.now(),
      }
      : undefined,
  });
  return syncTaskAnchorTextsFromRequirements(
    remapSplitResultAnchorOffsetsFromMarkdown(prdMarkdown, merged),
  );
}

function namespaceClusterSplitResults(
  clusterResults: { clusterId: string; result: SplitResult }[],
): SplitResult[] {
  if (clusterResults.length <= 1) {
    return clusterResults.map(({ result }) => result);
  }
  return clusterResults.map(({ clusterId, result }) => namespaceClusterSplitResult(clusterId, result));
}

function namespaceClusterSplitResult(clusterId: string, result: SplitResult): SplitResult {
  const idMap = new Map(result.splitTasks.map((task) => [task.id, namespaceTaskId(clusterId, task.id)]));
  const remapTaskId = (taskId: string): string => idMap.get(taskId) ?? taskId;
  const remapRecord = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!record) return undefined;
    const out: Record<string, T> = {};
    for (const [taskId, value] of Object.entries(record)) {
      out[remapTaskId(taskId)] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  return {
    ...result,
    splitTasks: result.splitTasks.map((task) => ({
      ...task,
      id: remapTaskId(task.id),
      dependencies: task.dependencies.map(remapTaskId),
    })),
    taskAnchorDescriptors: remapRecord(result.taskAnchorDescriptors),
    taskAnchorTexts: remapRecord(result.taskAnchorTexts),
    taskAnchorPositions: remapRecord(result.taskAnchorPositions),
    claudeSplitMapping: result.claudeSplitMapping
      ? {
        ...result.claudeSplitMapping,
        taskRequirementLinks: result.claudeSplitMapping.taskRequirementLinks.map((link) => ({
          ...link,
          taskId: remapTaskId(link.taskId),
        })),
        idRemap: [
          ...(result.claudeSplitMapping.idRemap ?? []),
          ...Array.from(idMap.entries()).map(([from, to]) => ({ from, to })),
        ],
      }
      : undefined,
  };
}

function namespaceTaskId(clusterId: string, taskId: string): string {
  return `${clusterId}-${taskId}`;
}
