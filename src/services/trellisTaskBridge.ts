import { invoke } from "@tauri-apps/api/core";
import type { ProjectItem, Repository } from "../types";
import { selectFloatingRepositories } from "../utils/floatingRepositories";

export interface TrellisTaskSummary {
  taskId: string;
  dir: string;
  title: string;
  status: string;
  hasPrd: boolean;
  hasResearch: boolean;
  createdAt?: string;
  parent?: string;
}

export interface TrellisTaskDetail {
  taskId: string;
  dir: string;
  title: string;
  status: string;
  taskJsonRaw: string;
  prdMarkdown: string;
  researchFiles: string[];
}

export interface TrellisResearchFile {
  name: string;
  sizeBytes: number;
  modifiedAt?: number;
}

export interface TrellisRequirementWorkspaceInput {
  projectRootPath?: string | null;
  projectRepositoryPaths?: string[];
  floatingRepositoryPaths?: string[];
  includeArchived?: boolean;
}

export interface TrellisRequirementWorkspaceSource {
  sourceId: string;
  sourceKind: "project" | "projectRepository" | "floatingRepository" | string;
  rootPath: string;
  taskCount: number;
  prdCount: number;
}

export interface TrellisRequirementTaskRow extends TrellisTaskSummary {
  archived: boolean;
  rootPath: string;
  sourceKind: "project" | "projectRepository" | "floatingRepository" | string;
  repositoryId: number | null;
  clusterId: string | null;
  sourceRequirementIds: string[];
}

export interface TrellisRequirementPrdRow {
  taskId: string;
  dir: string;
  title: string;
  status: string;
  archived: boolean;
  parent?: string | null;
  rootPath: string;
  sourceKind: "project" | "projectRepository" | "floatingRepository" | string;
  repositoryId: number | null;
  clusterId: string | null;
  requirementsIndexJson: string | null;
  prdMarkdown: string;
  childTaskIds: string[];
}

export interface TrellisRequirementWorkspaceSnapshot {
  sources: TrellisRequirementWorkspaceSource[];
  prds: TrellisRequirementPrdRow[];
  tasks: TrellisRequirementTaskRow[];
}

export async function listTrellisTasks(repoPath: string): Promise<TrellisTaskSummary[]> {
  return invoke<TrellisTaskSummary[]>("trellis_list_tasks", { repoPath });
}

export async function listTrellisRequirementWorkspace(
  input: TrellisRequirementWorkspaceInput,
): Promise<TrellisRequirementWorkspaceSnapshot> {
  return invoke<TrellisRequirementWorkspaceSnapshot>("trellis_list_requirement_workspace", {
    input: {
      projectRootPath: input.projectRootPath ?? null,
      projectRepositoryPaths: input.projectRepositoryPaths ?? [],
      floatingRepositoryPaths: input.floatingRepositoryPaths ?? [],
      includeArchived: input.includeArchived ?? true,
    },
  });
}

export async function listProjectRequirementWorkspace(input: {
  project: ProjectItem;
  projects: ProjectItem[];
  repositories: Repository[];
}): Promise<TrellisRequirementWorkspaceSnapshot> {
  return listTrellisRequirementWorkspace(buildProjectRequirementWorkspaceInput(input));
}

export function buildProjectRequirementWorkspaceInput(input: {
  project: ProjectItem;
  projects: ProjectItem[];
  repositories: Repository[];
}): TrellisRequirementWorkspaceInput {
  const repositoryById = new Map(input.repositories.map((repository) => [repository.id, repository]));
  const projectRepositoryPaths = input.project.repositoryIds
    .map((id) => repositoryById.get(id)?.path?.trim() ?? "")
    .filter(Boolean);
  const floatingRepositoryPaths = selectFloatingRepositories(input.projects, input.repositories)
    .map((repository) => repository.path.trim())
    .filter(Boolean);

  return {
    projectRootPath: input.project.rootPath ?? null,
    projectRepositoryPaths,
    floatingRepositoryPaths,
    includeArchived: true,
  };
}

export async function readTrellisTask(
  repoPath: string,
  taskId: string,
): Promise<TrellisTaskDetail> {
  return invoke<TrellisTaskDetail>("trellis_read_task", { repoPath, taskId });
}

export async function writeTrellisPrd(
  repoPath: string,
  taskId: string,
  content: string,
): Promise<void> {
  return invoke("trellis_write_prd", { repoPath, taskId, content });
}

export async function writeTrellisStatus(
  repoPath: string,
  taskId: string,
  status: string,
): Promise<void> {
  return invoke("trellis_write_status", { repoPath, taskId, status });
}

/** 归档 Trellis 任务（移入 `.trellis/tasks/archive/YYYY-MM/`，与 `task.py archive` 一致）。 */
export async function archiveTrellisTask(
  repoPath: string,
  taskDir: string,
): Promise<string> {
  return invoke<string>("trellis_archive_task", { repoPath, taskDir });
}

export async function listTrellisResearch(
  repoPath: string,
  taskId: string,
): Promise<TrellisResearchFile[]> {
  return invoke<TrellisResearchFile[]>("trellis_list_research", { repoPath, taskId });
}
