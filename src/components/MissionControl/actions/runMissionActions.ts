import { message } from "antd";
import type { ClusterPlanItem } from "../../../services/prdSplit/clusterPlanner";
import { buildClusterDispatchContext } from "../../../services/prdSplit/clusterDispatchContext";
import { dispatchClusterSplit } from "../../../services/prdSplit/splitterDispatch";
import { createParentTask, markChildrenPlanning, renderParentPrd, writeClusterTasks } from "../../../services/prdSplit/trellisWriter";
import {
  buildPrdSplitWorkflowArtifacts,
  type PrdSplitWorkflowClusterInput,
} from "../../../services/prdSplit/workflowGraphFromSplit";
import { saveWorkflowGraph } from "../../../services/workflowGraphs";
import { saveWorkflowTemplate } from "../../../services/workflowTemplates";
import { addProjectPrdWorkflow } from "../../../services/projectPrdScope";
import { WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED } from "../../../constants/workflowUiEvents";
import { applyEditsToSplitResult } from "../../PrdSplitWizard/taskEdits";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import type { ClusterRunState } from "../../PrdSplitWizard/types";

export async function runMissionClusters(api: UseSplitWizardStateApi): Promise<void> {
  const { state } = api;
  if (!state.plan || !state.prd || !state.requirementsIndex || !state.project) return;
  await Promise.allSettled(
    state.plan.clusters.map((cluster) => runSingleCluster(cluster, state, api)),
  );
}

async function runSingleCluster(
  cluster: ClusterPlanItem,
  state: UseSplitWizardStateApi["state"],
  api: UseSplitWizardStateApi,
): Promise<void> {
  const diff = state.diffByCluster[cluster.id];
  if (state.dispatchOnlyDirty && diff?.kind === "unchanged") {
    api.setClusterRun(cluster.id, {
      clusterId: cluster.id,
      parentTaskName: diff.existingParent.parentTaskName,
      parentTaskPath: diff.existingParent.parentTaskPath,
      status: "skipped-clean",
      errors: [],
      startedAt: Date.now(),
      endedAt: Date.now(),
    });
    return;
  }

  const runStart: ClusterRunState = {
    clusterId: cluster.id,
    parentTaskName: null,
    parentTaskPath: null,
    status: "creating-parent",
    errors: [],
    startedAt: Date.now(),
  };
  api.setClusterRun(cluster.id, runStart);

  let parentTaskName: string;
  let parentTaskPath: string;
  const reuse = state.reuseExistingParents && diff && diff.kind !== "new" ? diff : null;

  if (reuse) {
    parentTaskName = reuse.existingParent.parentTaskName;
    parentTaskPath = reuse.existingParent.parentTaskPath;
    api.patchClusterRun(cluster.id, { parentTaskName, parentTaskPath, status: "dispatching" });
    if (diff?.kind === "dirty") {
      try {
        const result = await markChildrenPlanning({
          projectRootPath: state.project!.rootPath,
          parentTaskName,
        });
        if (result.updatedChildNames.length > 0) {
          api.patchClusterRun(cluster.id, {
            errors: [
              `[info] 已把 ${result.updatedChildNames.length} 个旧子任务回退到 planning：${result.updatedChildNames.join(", ")}`,
            ],
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        api.patchClusterRun(cluster.id, {
          errors: [`标记旧子任务失败（继续生成）：${errorMessage}`],
        });
      }
    }
  } else {
    try {
      const parentMarkdown = renderParentPrd(state.prdMarkdown, {
        id: cluster.id,
        title: cluster.title,
        primaryRepositoryId: cluster.primaryRepositoryId,
        repositoryIds: cluster.repositoryIds,
      });
      const out = await createParentTask({
        projectRootPath: state.project!.rootPath,
        cluster: {
          id: cluster.id,
          title: cluster.title,
          primaryRepositoryId: cluster.primaryRepositoryId,
          repositoryIds: cluster.repositoryIds,
        },
        prdMarkdown: parentMarkdown,
        requirementsIndexJson: JSON.stringify(state.requirementsIndex!, null, 2),
        description: `任务分组 ${cluster.id} · ${cluster.requirementIds.length} 条需求`,
      });
      parentTaskName = out.parentTaskName;
      parentTaskPath = out.parentTaskPath;
      api.patchClusterRun(cluster.id, { parentTaskName, parentTaskPath, status: "dispatching" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      api.patchClusterRun(cluster.id, {
        status: "failed",
        errors: [`创建父任务失败: ${errorMessage}`],
        endedAt: Date.now(),
      });
      api.setGlobalError(`创建父任务失败：${errorMessage}`);
      return;
    }
  }

  try {
    const result = await dispatchClusterSplit({
      projectRootPath: state.project!.rootPath,
      parentTaskPath,
      cluster,
      prd: state.prd!,
      requirementsIndex: state.requirementsIndex!,
      context: buildClusterDispatchContext({
        baseContext: state.context,
        cluster,
        repositories: state.repositories,
      }),
    });
    api.patchClusterRun(cluster.id, {
      status: result.normalized && result.errors.length === 0 ? "succeeded" : "failed",
      raw: result.raw,
      normalized: result.normalized ?? undefined,
      validationIssues: result.validationIssues,
      errors: result.errors,
      endedAt: Date.now(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    api.patchClusterRun(cluster.id, {
      status: "failed",
      errors: [`任务生成失败: ${errorMessage}`],
      endedAt: Date.now(),
    });
    api.setGlobalError(`任务生成失败：${errorMessage}`);
  }
}

export async function writeMissionToTrellis(api: UseSplitWizardStateApi): Promise<void> {
  const { state } = api;
  if (!state.project || !state.prd) return;
  const clusters = state.plan?.clusters ?? [];
  const succeededClusters = clusters.filter((cluster) => state.clusterRuns[cluster.id]?.status === "succeeded");
  api.beginWrite();
  try {
    const graphInputs: PrdSplitWorkflowClusterInput[] = [];
    for (const cluster of succeededClusters) {
      const run = state.clusterRuns[cluster.id];
      if (!run?.normalized || !run.parentTaskName) {
        api.addWriteResult({
          clusterId: cluster.id,
          parentTaskName: run?.parentTaskName ?? "",
          childTaskNames: [],
          childTasks: [],
          warnings: [],
          error: "缺少拆分结果或父任务名，无法落盘",
        });
        continue;
      }
      const effective = applyEditsToSplitResult(run.normalized, state.editsByCluster[cluster.id]);
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
          prdSource: state.prd,
        });
        api.addWriteResult({
          clusterId: cluster.id,
          parentTaskName: out.parentTaskName,
          childTaskNames: out.childTaskNames,
          childTasks: out.childTasks,
          warnings: out.warnings,
        });
        graphInputs.push({
          cluster,
          parentTaskName: out.parentTaskName,
          childTasks: out.childTasks,
          tasks: effective.splitTasks.map((task) => ({
            sourceTaskId: task.id,
            title: task.title,
            role: task.role,
            dependencies: task.dependencies,
            sourceRequirementIds: task.sourceRequirementIds,
            sourceRefs: task.sourceRefs,
            taskAnchors: task.taskAnchors,
          })),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        api.addWriteResult({
          clusterId: cluster.id,
          parentTaskName: run.parentTaskName,
          childTaskNames: [],
          childTasks: [],
          warnings: [],
          error: errorMessage,
        });
      }
    }
    await persistMissionWorkflowGraph(api, graphInputs);
    api.finishWrite();
    message.success("Trellis 任务已落盘完成");
  } catch (error) {
    api.failWrite(error instanceof Error ? error.message : String(error));
  }
}

async function persistMissionWorkflowGraph(
  api: UseSplitWizardStateApi,
  clustersForGraph: PrdSplitWorkflowClusterInput[],
): Promise<void> {
  const { state } = api;
  if (!state.project || clustersForGraph.length === 0) return;
  try {
    const artifacts = buildPrdSplitWorkflowArtifacts({
      projectId: state.project.id,
      projectName: state.project.name,
      projectRootPath: state.project.rootPath,
      requirementsIndex: state.requirementsIndex,
      clusters: clustersForGraph,
    });
    const savedTemplate = await saveWorkflowTemplate({
      workflowId: artifacts.workflowId,
      name: artifacts.name,
      isDefault: false,
      stages: artifacts.stages,
      projectIds: state.context?.mode === "project" ? [state.project.id] : [],
    });
    const savedGraph = await saveWorkflowGraph({
      workflowId: savedTemplate.id,
      graph: artifacts.graph,
      status: "draft",
    });
    if (state.context?.mode === "project") {
      await addProjectPrdWorkflow(state.project.id, savedTemplate.id);
    }
    api.setWorkflowGraphResult({
      workflowId: savedTemplate.id,
      workflowName: savedTemplate.name,
      status: "draft",
      nodeCount: savedGraph.graph.nodes.length,
      edgeCount: savedGraph.graph.edges.length,
      graph: savedGraph.graph,
    });
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_UI_EVENT_WORKFLOW_GRAPH_CHANGED, {
        detail: {
          workflowId: savedTemplate.id,
          status: savedGraph.status,
          projectId: state.context?.mode === "project" ? state.project.id : undefined,
        },
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    api.setWorkflowGraphResult({
      workflowId: "",
      workflowName: "PRD Split workflow",
      status: "draft",
      nodeCount: 0,
      edgeCount: 0,
      error: errorMessage,
    });
    message.warning(`Trellis 任务已写入，但 workflow graph 保存失败：${errorMessage}`);
  }
}
