import type { TaskSplitContext } from "../../types";
import type { ClusterPlanItem, PlannerRepo } from "./clusterPlanner";

export interface BuildClusterDispatchContextInput {
  baseContext: TaskSplitContext | null;
  cluster: ClusterPlanItem;
  repositories: readonly PlannerRepo[];
}

export function buildClusterDispatchContext(
  input: BuildClusterDispatchContextInput,
): TaskSplitContext | null {
  const { baseContext, cluster, repositories } = input;
  const repositoryId = resolveClusterRepositoryId(cluster);
  const repository =
    repositoryId == null
      ? null
      : repositories.find((candidate) => candidate.id === repositoryId) ?? null;

  if (!repository) {
    return baseContext;
  }

  return {
    ...baseContext,
    mode: baseContext?.mode ?? "project",
    repositoryId: repository.id,
    repositoryName: repository.name,
    repositoryPath: repository.path,
    repositoryType: repository.type,
  };
}

function resolveClusterRepositoryId(cluster: ClusterPlanItem): number | null {
  return cluster.primaryRepositoryId ?? cluster.repositoryIds[0] ?? null;
}
