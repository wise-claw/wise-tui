import type { ProjectItem, Repository, TaskSplitContext } from "../../types";
import type { PlannerRepo } from "../../services/prdSplit/clusterPlanner";
import type { ProjectRef } from "./types";

export type PrdSplitTargetKind = "project" | "repository";

export interface PrdSplitTargetModel {
  project: ProjectRef;
  repositories: PlannerRepo[];
  context: TaskSplitContext;
}

export type TrellisTargetKind = "workspace" | "standaloneRepository";

export interface TrellisTargetBase {
  kind: TrellisTargetKind;
  displayName: string;
  rootPath: string;
  repositories: PlannerRepo[];
  activeRepositoryId: number | null;
  defaultExecutionRepositoryId: number | null;
  context: TaskSplitContext;
  project: ProjectRef;
}

export interface WorkspaceTrellisTarget extends TrellisTargetBase {
  kind: "workspace";
  projectId: string;
  projectName: string;
}

export interface StandaloneRepositoryTrellisTarget extends TrellisTargetBase {
  kind: "standaloneRepository";
  repositoryId: number;
  repositoryName: string;
  activeRepositoryId: number;
  defaultExecutionRepositoryId: number;
}

export type TrellisTarget = WorkspaceTrellisTarget | StandaloneRepositoryTrellisTarget;

export type TrellisTargetResolution =
  | { ok: true; target: TrellisTarget }
  | { ok: false; reason: string };

export interface ResolveTrellisTargetInput {
  projects: ReadonlyArray<ProjectItem>;
  repositories: ReadonlyArray<Repository>;
  activeProjectId?: string | null;
  activeRepositoryId?: number | null;
  linkedProjectId?: string | null;
  linkedRepositoryId?: number | null;
}

export function projectToPrdSplitTarget(
  project: ProjectItem,
  repositories: ReadonlyArray<Repository>,
): PrdSplitTargetModel {
  const target = workspaceToTrellisTarget(project, repositories, null);
  return pickPrdSplitTargetModel(target);
}

export function repositoryToPrdSplitTarget(repository: Repository): PrdSplitTargetModel {
  return pickPrdSplitTargetModel(repositoryToTrellisTarget(repository));
}

export function resolveTrellisTarget(input: ResolveTrellisTargetInput): TrellisTargetResolution {
  const projectId = input.linkedProjectId ?? input.activeProjectId ?? null;
  const repositoryId = input.linkedRepositoryId ?? input.activeRepositoryId ?? null;

  if (projectId) {
    const project = input.projects.find((item) => item.id === projectId) ?? null;
    if (!project) {
      return { ok: false, reason: "未找到当前 Workspace。" };
    }
    const rootPath = project.rootPath?.trim();
    if (!rootPath) {
      return { ok: false, reason: "当前 Workspace 缺少 rootPath，无法作为 Trellis 根目录。" };
    }
    const target = workspaceToTrellisTarget(project, input.repositories, repositoryId);
    if (target.repositories.length === 0) {
      return { ok: false, reason: "当前 Workspace 尚未关联可执行仓库。" };
    }
    return { ok: true, target };
  }

  if (repositoryId != null) {
    const repository = input.repositories.find((item) => item.id === repositoryId) ?? null;
    if (!repository) {
      return { ok: false, reason: "未找到当前游离仓库。" };
    }
    if (!repository.path.trim()) {
      return { ok: false, reason: "当前游离仓库缺少路径，无法作为 Trellis 根目录。" };
    }
    return { ok: true, target: repositoryToTrellisTarget(repository) };
  }

  return { ok: false, reason: "请先选择 Workspace 或游离仓库。" };
}

export function workspaceToTrellisTarget(
  project: ProjectItem,
  repositories: ReadonlyArray<Repository>,
  activeRepositoryId: number | null,
): WorkspaceTrellisTarget {
  const plannerRepos = project.repositoryIds
    .map((id) => repositories.find((repo) => repo.id === id))
    .filter((repo): repo is Repository => Boolean(repo))
    .map(repositoryToPlannerRepo);
  const activeRepo = activeRepositoryId == null
    ? null
    : plannerRepos.find((repo) => repo.id === activeRepositoryId) ?? null;
  const defaultExecutionRepositoryId = activeRepo?.id ?? plannerRepos[0]?.id ?? null;
  const rootPath = project.rootPath?.trim() ?? "";
  const projectName = project.name.trim() || "Workspace";

  return {
    kind: "workspace",
    projectId: project.id,
    projectName,
    displayName: projectName,
    rootPath,
    repositories: plannerRepos,
    activeRepositoryId: activeRepo?.id ?? null,
    defaultExecutionRepositoryId,
    project: {
      id: project.id,
      name: projectName,
      rootPath,
    },
    context: {
      mode: "project",
      projectId: project.id,
      projectName,
      repositoryId: activeRepo?.id ?? defaultExecutionRepositoryId,
      repositoryName: activeRepo?.name ?? plannerRepos[0]?.name ?? null,
      repositoryPath: activeRepo?.path ?? plannerRepos[0]?.path ?? null,
      repositoryType: activeRepo?.type ?? plannerRepos[0]?.type ?? null,
    },
  };
}

export function repositoryToTrellisTarget(repository: Repository): StandaloneRepositoryTrellisTarget {
  const plannerRepo = repositoryToPlannerRepo(repository);
  const repositoryName = repository.name.trim() || "Repository";
  const rootPath = repository.path.trim();

  return {
    kind: "standaloneRepository",
    repositoryId: repository.id,
    repositoryName,
    displayName: repositoryName,
    rootPath,
    repositories: [plannerRepo],
    activeRepositoryId: repository.id,
    defaultExecutionRepositoryId: repository.id,
    project: {
      id: `repo:${repository.id}`,
      name: repositoryName,
      rootPath,
    },
    context: {
      mode: "repository",
      repositoryId: repository.id,
      repositoryName,
      repositoryPath: rootPath,
      repositoryType: repository.repositoryType,
    },
  };
}

function repositoryToPlannerRepo(repository: Repository): PlannerRepo {
  return {
    id: repository.id,
    name: repository.name,
    type: repository.repositoryType,
    path: repository.path,
  };
}

function pickPrdSplitTargetModel(target: TrellisTarget): PrdSplitTargetModel {
  return {
    project: target.project,
    repositories: target.repositories,
    context: target.context,
  };
}
