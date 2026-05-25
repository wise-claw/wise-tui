import type { TaskItem, TaskRole } from "../../types";
import type { WorkflowFacade } from "../../types/workflow";
import {
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  type SplitTodoCountUpdatedDetail,
  type WorkflowOmcBatchRuntimeDetail,
} from "../../constants/workflowUiEvents";
import { notifySplitTodoCountUpdated } from "../../utils/notifySplitTodoCountUpdated";
import { buildParallelGroups } from "../taskDependency";
import { getWorkflowFacade } from "../workflow";
import { resolveTrellisSubagentForStage } from "../workflow/trellisDefaults";
import type { ClusterPlanItem, PlannerRepo } from "./clusterPlanner";
import {
  runMaterializedSplitTasksFanout,
  type ExecutionFanoutResult,
  type ExecutionFanoutSnapshot,
  type RunWaveBatch,
} from "./executionFanout";
import type { WriteClusterTasksOutput } from "./trellisWriter";

export interface MaterializedFanoutRepositoryMetadata {
  ownerRepositoryId?: number;
  ownerRepositoryName?: string;
  ownerRepositoryPath?: string;
  repositoryType?: TaskRole;
}

export interface MaterializedFanoutRepositoryTarget {
  repositoryPath: string;
  repositoryMetadata?: MaterializedFanoutRepositoryMetadata;
}

export interface MaterializedFanoutInput {
  facade?: WorkflowFacade;
  sessionId: string;
  projectId?: string | null;
  projectRootPath: string;
  repositoryPath: string;
  sourceTasks: TaskItem[];
  materializedResult: WriteClusterTasksOutput;
  parallelGroups?: string[][];
  subagentType?: string;
  repositoryMetadata?: MaterializedFanoutRepositoryMetadata;
  onSnapshot?: (snapshot: ExecutionFanoutSnapshot) => void;
  runWaveBatch?: RunWaveBatch;
}

export async function runWorkspaceTrellisMaterializedFanout(
  input: MaterializedFanoutInput,
): Promise<ExecutionFanoutResult> {
  const subagentType = input.subagentType?.trim() || resolveTrellisSubagentForStage("implement") || "trellis-implement";
  const parallelGroups = input.parallelGroups && input.parallelGroups.length > 0
    ? input.parallelGroups
    : buildParallelGroups(input.sourceTasks);
  emitSplitTodoUpdated(input, false);
  emitOmcRuntime({
    active: true,
    sessionId: input.sessionId,
    runningCount: input.sourceTasks.length,
  });
  try {
    const result = await runMaterializedSplitTasksFanout({
      facade: input.facade ?? getWorkflowFacade(),
      sessionId: input.sessionId,
      repositoryPath: input.repositoryPath,
      projectRootPath: input.projectRootPath,
      sourceTasks: input.sourceTasks,
      materializedResult: input.materializedResult,
      parallelGroups,
      subagentType,
      repositoryMetadata: {
        ...(input.repositoryMetadata ?? {}),
        ownerRepositoryPath: input.repositoryMetadata?.ownerRepositoryPath ?? input.repositoryPath,
      },
      onSnapshot: input.onSnapshot,
      runWaveBatch: input.runWaveBatch,
    });
    emitSplitTodoUpdated(input, false);
    return result;
  } finally {
    emitOmcRuntime({
      active: false,
      sessionId: input.sessionId,
      runningCount: 0,
    });
  }
}

export function dispatchWorkspaceTrellisMaterializedFanout(
  input: MaterializedFanoutInput,
): Promise<ExecutionFanoutResult | null> {
  if (!input.repositoryPath.trim()) {
    const message = "缺少可执行仓库路径，无法自动派发实现子代理。";
    console.error("[prdSplit] Workspace Trellis fan-out failed:", message);
    return Promise.reject(new Error(message));
  }
  return runWorkspaceTrellisMaterializedFanout(input).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[prdSplit] Workspace Trellis fan-out failed:", message);
    throw error;
  });
}

export function resolveMaterializedFanoutRepositoryTarget(
  cluster: ClusterPlanItem,
  repositories: readonly PlannerRepo[],
): MaterializedFanoutRepositoryTarget {
  const repoId = cluster.primaryRepositoryId ?? cluster.repositoryIds[0] ?? null;
  const repo = repoId == null ? repositories[0] : repositories.find((item) => item.id === repoId);
  if (!repo) return { repositoryPath: "" };
  return {
    repositoryPath: repo.path,
    repositoryMetadata: {
      ownerRepositoryId: repo.id,
      ownerRepositoryName: repo.name,
      ownerRepositoryPath: repo.path,
      repositoryType: repo.type,
    },
  };
}

function emitSplitTodoUpdated(input: MaterializedFanoutInput, openTaskDrawer: boolean): void {
  const detail: SplitTodoCountUpdatedDetail = {
    source: "trellis",
    openTaskDrawer,
    projectId: input.projectId ?? null,
    parentTaskName: input.materializedResult.parentTaskName,
    childTaskNames: input.materializedResult.childTaskNames,
    focusParentTaskName: input.materializedResult.parentTaskName,
    focusChildTaskNames: input.materializedResult.childTaskNames,
  };
  notifySplitTodoCountUpdated(detail);
}

function emitOmcRuntime(detail: Omit<WorkflowOmcBatchRuntimeDetail, "updatedAt">): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
      detail: {
        ...detail,
        resetInvocationUi: false,
        updatedAt: Date.now(),
      } satisfies WorkflowOmcBatchRuntimeDetail,
    }),
  );
}
