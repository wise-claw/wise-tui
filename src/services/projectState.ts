import { invoke } from "@tauri-apps/api/core";
import type { ProjectItem } from "../types";

type TaskTemplateKey = "repositorySplit" | "projectSplit";

export async function listProjects(): Promise<ProjectItem[]> {
  return invoke<ProjectItem[]>("list_projects");
}

export async function createProject(name: string, rootPath?: string | null): Promise<ProjectItem> {
  return invoke<ProjectItem>("create_project", {
    name,
    iconDisplayName: null,
    iconColor: null,
    rootPath: rootPath ?? null,
  });
}

export async function updateProjectName(projectId: string, name: string): Promise<ProjectItem> {
  return invoke<ProjectItem>("update_project_name", { projectId, name });
}

export async function deleteProject(projectId: string): Promise<void> {
  return invoke("delete_project", { projectId });
}

export async function addRepositoryToProject(projectId: string, repositoryId: number): Promise<ProjectItem> {
  return invoke<ProjectItem>("add_repository_to_project", { projectId, repositoryId });
}

export interface ReconcileProjectWorkspaceResult {
  project: ProjectItem;
  addedRepositoryPaths: string[];
}

export async function reconcileProjectWorkspace(projectId: string): Promise<ReconcileProjectWorkspaceResult> {
  return invoke<ReconcileProjectWorkspaceResult>("reconcile_project_workspace", { projectId });
}

export async function reorderProjectRepositoriesInProject(
  projectId: string,
  repositoryIds: number[],
): Promise<void> {
  return invoke("reorder_project_repositories", {
    projectId,
    repositoryIds,
  });
}

export async function removeRepositoryFromProject(projectId: string, repositoryId: number): Promise<void> {
  return invoke("remove_repository_from_project", { projectId, repositoryId });
}

export async function getActiveProjectId(): Promise<string | null> {
  return invoke<string | null>("get_active_project_id");
}

export async function setActiveProjectId(projectId: string | null): Promise<void> {
  return invoke("set_active_project_id", { projectId });
}

export async function resolveProjectRootFromRepository(repositoryPath: string): Promise<string | null> {
  return invoke<string | null>("resolve_project_root_from_repository", { repositoryPath });
}

export async function getTaskTemplate(key: TaskTemplateKey): Promise<string | null> {
  return invoke<string | null>("get_task_template", { key });
}

export async function setTaskTemplate(key: TaskTemplateKey, value: string): Promise<void> {
  return invoke("set_task_template", { key, value });
}
