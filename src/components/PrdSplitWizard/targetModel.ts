import type { ProjectItem, Repository, TaskSplitContext } from "../../types";
import type { PlannerRepo } from "../../services/prdSplit/clusterPlanner";
import type { ProjectRef } from "./types";

export type PrdSplitTargetKind = "project" | "repository";

export interface PrdSplitTargetModel {
  project: ProjectRef;
  repositories: PlannerRepo[];
  context: TaskSplitContext;
}

export function projectToPrdSplitTarget(
  project: ProjectItem,
  repositories: ReadonlyArray<Repository>,
): PrdSplitTargetModel {
  return {
    project: {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath ?? "",
    },
    repositories: project.repositoryIds
      .map((id) => repositories.find((repo) => repo.id === id))
      .filter((repo): repo is Repository => Boolean(repo))
      .map(repositoryToPlannerRepo),
    context: {
      mode: "project",
      projectId: project.id,
      projectName: project.name,
    },
  };
}

export function repositoryToPrdSplitTarget(repository: Repository): PrdSplitTargetModel {
  return {
    project: {
      id: `repo-${repository.id}`,
      name: repository.name,
      rootPath: repository.path,
    },
    repositories: [repositoryToPlannerRepo(repository)],
    context: {
      mode: "repository",
      repositoryId: repository.id,
      repositoryName: repository.name,
      repositoryPath: repository.path,
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
