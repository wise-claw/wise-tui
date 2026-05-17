import type { ClusterPlanItem } from "../../services/prdSplit/clusterPlanner";
import type { MissionSnapshotRecord } from "../../services/missionControlBackend";
import type { ProjectItem, Repository } from "../../types";
import type { UseSplitWizardStateApi } from "../PrdSplitWizard/useSplitWizardState";
import type { MissionViewModel, TaskDetailVM } from "./presenter/types";

export type MissionWorkspaceAction =
  | "claude-session"
  | "code-graph"
  | "workflow-config"
  | "progress-monitor"
  | "prompts"
  | "mcp-hub"
  | "skills-hub"
  | "code-anchor"
  | "engineering";

export interface MissionWorkspaceActionTarget {
  missionId: string | null;
  projectId: string | null;
  projectName: string;
  rootPath: string;
  primaryRepositoryId: number | null;
  repositoryIds: number[];
  selectedRequirementId: string | null;
  selectedTaskId: string | null;
  selectedClusterId: string | null;
  selectedCodeAnchor: TaskDetailVM["codeAnchors"][number] | null;
  workflowId: string | null;
}

interface BuildMissionWorkspaceActionTargetInput {
  activeMission?: MissionSnapshotRecord | null;
  api: UseSplitWizardStateApi;
  projects: ProjectItem[];
  repositories: Repository[];
  viewModel: MissionViewModel;
}

export function buildMissionWorkspaceActionTarget({
  activeMission,
  api,
  projects,
  repositories,
  viewModel,
}: BuildMissionWorkspaceActionTargetInput): MissionWorkspaceActionTarget {
  const selectedDetail = viewModel.selectedTaskDetail;
  const selectedCluster = findSelectedCluster({
    clusters: api.state.plan?.clusters ?? [],
    selectedClusterId: selectedDetail?.clusterId ?? null,
  });
  const projectId = api.state.project?.id ?? activeMission?.projectId ?? viewModel.project.id ?? null;
  const projectFromList = projectId ? projects.find((project) => project.id === projectId) ?? null : null;
  const projectName =
    api.state.project?.name ??
    activeMission?.projectName ??
    projectFromList?.name ??
    viewModel.project.name;
  const rootPath = api.state.project?.rootPath ?? activeMission?.rootPath ?? viewModel.project.rootPath;
  const repositoryIds = normalizeRepositoryIds({
    selectedCluster,
    selectedRepositoryIds: api.state.selectedRepositoryIds,
    allRepos: api.state.repositories,
    knownRepositoryIds: new Set(repositories.map((repo) => repo.id)),
  });
  const primaryRepositoryId =
    selectedDetail?.codeAnchors.find((anchor) => anchor.repositoryId != null)?.repositoryId ??
    selectedCluster?.primaryRepositoryId ??
    repositoryIds[0] ??
    null;

  return {
    missionId: activeMission?.missionId ?? api.state.activeMissionId ?? null,
    projectId,
    projectName,
    rootPath,
    primaryRepositoryId,
    repositoryIds,
    selectedRequirementId: viewModel.selection.requirementId ?? null,
    selectedTaskId: selectedDetail?.taskId ?? viewModel.selection.taskId ?? null,
    selectedClusterId: selectedDetail?.clusterId ?? selectedCluster?.id ?? null,
    selectedCodeAnchor: selectedDetail?.codeAnchors[0] ?? null,
    workflowId: api.state.workflowGraphResult?.workflowId ?? null,
  };
}

function findSelectedCluster(input: {
  clusters: ClusterPlanItem[];
  selectedClusterId: string | null;
}): ClusterPlanItem | null {
  if (!input.selectedClusterId) return null;
  return input.clusters.find((cluster) => cluster.id === input.selectedClusterId) ?? null;
}

function normalizeRepositoryIds(input: {
  selectedCluster: ClusterPlanItem | null;
  selectedRepositoryIds: number[];
  allRepos: Array<{ id: number }>;
  knownRepositoryIds: Set<number>;
}): number[] {
  const clusterIds = input.selectedCluster?.repositoryIds ?? [];
  const selectedIds = input.selectedRepositoryIds.length > 0
    ? input.selectedRepositoryIds
    : input.allRepos.map((repo) => repo.id);
  return uniqueNumberIds(clusterIds.length > 0 ? clusterIds : selectedIds)
    .filter((id) => input.knownRepositoryIds.has(id));
}

function uniqueNumberIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
